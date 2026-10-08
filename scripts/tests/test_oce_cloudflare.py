import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('oce_cf', ROOT / 'ops/oce-cloudflare.py')
cf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cf)


class PrivateDemoTests(unittest.TestCase):
    def setUp(self):
        self.m = {'account_id': 'a' * 32, 'zone_id': 'b' * 32,
                  'tunnel_id': '11111111-1111-1111-1111-111111111111',
                  'application_id': '22222222-2222-2222-2222-222222222222',
                  'team_name': 'dao-test', 'emails': ['owner@example.test', 'guest@example.test']}
        self.base = '/accounts/' + self.m['account_id']
        self.app = {'id': self.m['application_id'], 'type': 'self_hosted', 'domain': cf.HOST,
                    'allowed_idps': ['otp'], 'aud': 'c' * 64}
        self.policy = {'decision': 'allow', 'include': [{'email': {'email': e}} for e in self.m['emails']]}
        self.config = {'ingress': [{'hostname': cf.HOST, 'service': 'http://127.0.0.1:8080',
                       'originRequest': {'access': {'required': True, 'teamName': 'dao-test',
                                                   'audTag': ['c' * 64]}}},
                       {'service': 'http_status:404'}]}
        self.data = {
            '/zones/' + self.m['zone_id']: {'name': 'logiclab.fr', 'status': 'active'},
            self.base + '/access/organizations': {'auth_domain': 'dao-test.cloudflareaccess.com'},
            self.base + '/access/apps?per_page=100': [self.app],
            self.base + '/access/identity_providers': [{'id': 'otp', 'type': 'onetimepin'}],
            self.base + '/access/apps/' + self.app['id'] + '/policies?per_page=100': [self.policy],
            self.base + '/cfd_tunnel/' + self.m['tunnel_id']: {'config_src': 'cloudflare'},
            self.base + '/cfd_tunnel/' + self.m['tunnel_id'] + '/configurations': {'config': self.config},
            '/zones/' + self.m['zone_id'] + '/dns_records?name=' + cf.HOST + '&per_page=100':
                [{'type': 'CNAME', 'proxied': True, 'content': self.m['tunnel_id'] + '.cfargotunnel.com'}],
        }

    def audit(self):
        return cf.audit(self.m, self.data.__getitem__)

    def test_exact_configuration_accepts_without_claiming_owner_recipe(self):
        self.assertTrue(self.audit()['configuration_verified'])
        self.assertFalse(self.audit()['authenticated_owner_recipe_verified'])
        self.assertFalse(self.audit()['public_8080_changed'])

    def test_policy_bypass_wildcard_domain_and_extra_invitee_rejected(self):
        for bad in ({'everyone': {}}, {'email_domain': {'domain': 'example.test'}},
                    {'email': {'email': 'stranger@example.test'}},
                    {'email': {'email': '*@example.test'}}):
            with self.subTest(bad=bad):
                original = copy.deepcopy(self.policy)
                self.policy['include'].append(bad)
                with self.assertRaises(ValueError):
                    self.audit()
                self.policy.clear()
                self.policy.update(original)
        self.policy['decision'] = 'bypass'
        with self.assertRaises(ValueError):
            self.audit()

    def test_second_policy_or_path_app_rejected(self):
        key = self.base + '/access/apps/' + self.app['id'] + '/policies?per_page=100'
        self.data[key].append({'decision': 'bypass'})
        with self.assertRaises(ValueError):
            self.audit()
        self.data[key].pop()
        self.data[self.base + '/access/apps?per_page=100'].append(
            {'id': 'other', 'domain': cf.HOST + '/api'})
        with self.assertRaises(ValueError):
            self.audit()

    def test_missing_connector_jwt_guard_wrong_audience_or_extra_route_rejected(self):
        pristine = copy.deepcopy(self.config)
        for change in ('guard', 'audience', 'origin', 'fallback', 'warp', 'extra'):
            self.config.clear()
            self.config.update(copy.deepcopy(pristine))
            with self.subTest(change=change):
                if change == 'guard':
                    self.config['ingress'][0]['originRequest']['access']['required'] = False
                elif change == 'audience':
                    self.config['ingress'][0]['originRequest']['access']['audTag'] = ['d' * 64]
                elif change == 'origin':
                    self.config['ingress'][0]['service'] = 'http://dao-dev:3000'
                elif change == 'fallback':
                    self.config['ingress'][-1]['service'] = 'http://127.0.0.1:8080'
                elif change == 'warp':
                    self.config['warp-routing'] = {'enabled': True}
                else:
                    self.config['ingress'].append({'service': 'hello_world'})
                with self.assertRaises(ValueError):
                    self.audit()

    def test_dns_only_and_other_identity_provider_rejected(self):
        self.app['allowed_idps'].append('other')
        with self.assertRaises(ValueError):
            self.audit()
        self.app['allowed_idps'].pop()
        records = self.data['/zones/' + self.m['zone_id'] + '/dns_records?name=' + cf.HOST + '&per_page=100']
        records[0]['proxied'] = False
        with self.assertRaises(ValueError):
            self.audit()

    def test_manifest_rejects_wildcard_and_injected_team(self):
        for key, value in [('emails', ['*@example.test']), ('team_name', 'dao/evil'),
                           ('account_id', '../other')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                cf.validate_manifest({**self.m, key: value})

    def test_probe_requires_access_challenge_including_forged_assertion(self):
        def challenge(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 302, 'redirect',
                {'Location': 'https://dao-test.cloudflareaccess.com/cdn-cgi/access/login/test'}, None)
        with patch.object(cf.OPENER, 'open', side_effect=challenge) as mock:
            self.assertTrue(cf.probe('dao-test')['anonymous_challenged'])
            self.assertEqual(mock.call_count, 6)
            self.assertTrue(any(r.args[0].has_header('Cf-access-jwt-assertion') for r in mock.call_args_list))
        for location in ('https://evil.test/cdn-cgi/access/login/test',
                         'https://dao-test.cloudflareaccess.com/unrelated'):
            with patch.object(cf.OPENER, 'open', side_effect=urllib.error.HTTPError(
                    'https://' + cf.HOST, 302, 'redirect', {'Location': location}, None)):
                with self.assertRaises(ValueError):
                    cf.probe('dao-test')

    def test_modern_destinations_accept_exact_host_but_reject_public_path_override(self):
        self.app['destinations'] = [{'type': 'public', 'uri': cf.HOST}]
        self.assertTrue(self.audit()['configuration_verified'])
        self.app['destinations'][0]['overrides'] = [{'behavior': 'public', 'path_pattern': '/api/*'}]
        with self.assertRaises(ValueError):
            self.audit()
        self.app['destinations'][0].pop('overrides')
        self.data[self.base + '/access/apps?per_page=100'].append({
            'id': 'other', 'domain': 'unrelated.test',
            'destinations': [{'type': 'public', 'uri': cf.HOST + '/api'}]})
        with self.assertRaises(ValueError):
            self.audit()

    def test_no_redirect_following(self):
        self.assertIsNone(cf.RefuseRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.test'))


if __name__ == '__main__':
    unittest.main()
