import base64
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.error

import test_oce_cloudflare as fixture_module

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('cf_check', ROOT / 'scripts/oce-cloudflare-check.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
cf = fixture_module.cf


class RequestTests(unittest.TestCase):
    def setUp(self):
        self.event = {'action': 'created', 'issue': {'number': 58}, 'comment': {
            'body': '/dao-oce check', 'user': {'login': 'Khaey'}, 'author_association': 'OWNER'}}

    def select(self, event=None, name='issue_comment', ref='refs/heads/main', actor='Khaey', repo='Khaey/Dao'):
        return c.select(name, event or self.event, repo, ref, actor)

    def test_exact_owner_comment_and_dispatch(self):
        for operation in ('check', 'audit'):
            self.event['comment']['body'] = '/dao-oce ' + operation
            self.assertEqual(self.select(), operation)
            self.assertEqual(self.select({'inputs': {'operation': operation}}, name='workflow_dispatch'), operation)

    def test_untrusted_actor_ref_repository_and_event_rejected(self):
        for changes in ({'actor': 'other'}, {'ref': 'refs/heads/topic'}, {'repo': 'other/Dao'},
                        {'name': 'pull_request'}, {'name': 'push'}):
            with self.subTest(changes=changes), self.assertRaises(c.Rejected):
                self.select(**changes)

    def test_edited_comment_pr_wrong_issue_author_association_and_shell_text_rejected(self):
        for section, key, value in ((None, 'action', 'edited'), ('issue', 'number', 91),
                ('issue', 'pull_request', {}), ('comment', 'user', {'login': 'other'}),
                ('comment', 'author_association', 'COLLABORATOR'),
                ('comment', 'body', '/dao-oce check\nstart'),
                ('comment', 'body', '/dao-oce check; sudo bash'),
                ('comment', 'body', '/dao-oce start')):
            event = copy.deepcopy(self.event)
            (event[section] if section else event)[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(c.Rejected):
                self.select(event)


class CheckTests(unittest.TestCase):
    def setUp(self):
        fixture = fixture_module.PrivateDemoTests()
        fixture.setUp()
        self.m = fixture.m
        old_tunnel = self.m['tunnel_id']
        self.m['tunnel_id'] = c.TUNNEL_ID
        self.data = {key.replace(old_tunnel, c.TUNNEL_ID): value for key, value in fixture.data.items()}
        self.data['/zones?name=logiclab.fr&per_page=50'] = [{
            'name': 'logiclab.fr', 'status': 'active', 'id': self.m['zone_id'],
            'account': {'id': self.m['account_id']}}]
        self.tunnel_path = fixture.base + '/cfd_tunnel/' + c.TUNNEL_ID
        self.data[self.tunnel_path]['id'] = c.TUNNEL_ID
        records = self.data['/zones/' + self.m['zone_id'] + '/dns_records?name=' + cf.HOST + '&per_page=100']
        records[0]['content'] = c.TUNNEL_ID + '.cfargotunnel.com'
        self.token = base64.b64encode(json.dumps({'a': self.m['account_id'], 't': c.TUNNEL_ID,
            's': base64.b64encode(bytes(48)).decode()}).encode()).decode()
        self.progress = {}

    def check(self, operation='check', api_token='fake-api-token', tunnel_token=None, emails=None, get=None):
        return c.check(cf, operation, api_token, self.token if tunnel_token is None else tunnel_token,
                       ','.join(self.m['emails']) if emails is None else emails,
                       get or self.data.__getitem__, self.progress)

    def test_two_token_check_only_reads_zone_and_tunnel_without_claiming_access_audit(self):
        reads = []
        def get(path):
            reads.append(path)
            return self.data[path]
        result = self.check(emails='', get=get)
        self.assertEqual(reads, ['/zones?name=logiclab.fr&per_page=50', self.tunnel_path])
        self.assertFalse(result['configuration_verified'])
        self.assertFalse(result['access_policy_verified'])
        self.assertTrue(self.progress['tunnel_token_binding_verified'])

    def test_missing_token_or_header_injection_rejected_before_network(self):
        for api, tunnel in (('', self.token), ('fake-api-token', ''), ('bad\r\nheader', self.token)):
            with self.subTest(api=api), self.assertRaises((c.Rejected, ValueError)):
                self.check(api_token=api, tunnel_token=tunnel, get=lambda _: self.fail('network called'))

    def test_wrong_account_tunnel_and_alternate_endpoint_rejected_before_tunnel_read(self):
        payload = json.loads(base64.b64decode(self.token))
        for key, value in (('a', 'd' * 32), ('t', '33333333-3333-3333-3333-333333333333'), ('e', 'elsewhere')):
            bad = dict(payload, **{key: value})
            token = base64.b64encode(json.dumps(bad).encode()).decode()
            def get(path):
                self.assertNotEqual(path, self.tunnel_path)
                return self.data[path]
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.check(tunnel_token=token, get=get)
            self.assertEqual(self.progress['stage'], 'TUNNEL_TOKEN_BINDING')

    def test_inactive_zone_or_deleted_local_wrong_tunnel_rejected(self):
        pristine = copy.deepcopy(self.data)
        for change in ('zone', 'deleted', 'local', 'id'):
            self.data = copy.deepcopy(pristine)
            if change == 'zone':
                self.data['/zones?name=logiclab.fr&per_page=50'][0]['status'] = 'pending'
            else:
                key, value = {'deleted': ('deleted_at', 'date'), 'local': ('config_src', 'local'),
                              'id': ('id', 'other')}[change]
                self.data[self.tunnel_path][key] = value
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.check()

    def test_full_audit_preserves_independent_email_access_dns_and_connector_guards(self):
        result = self.check('audit')
        self.assertTrue(result['configuration_verified'])
        self.assertTrue(result['access_policy_verified'])
        self.assertFalse(result['authenticated_owner_recipe_verified'])
        with self.assertRaises(ValueError):
            self.check('audit', emails='stranger@example.test')
        config = self.data[self.tunnel_path + '/configurations']['config']
        config['ingress'][0]['originRequest']['access']['required'] = False
        with self.assertRaises(ValueError):
            self.check('audit')

    def test_missing_approved_emails_blocks_audit_without_deriving_live_policy(self):
        with self.assertRaises(c.Rejected) as caught:
            self.check('audit', emails='')
        self.assertEqual(caught.exception.reason, 'APPROVED_EMAILS_MISSING')
        self.assertEqual(self.progress['stage'], 'APPROVED_EMAIL_INPUT')

    def run_main(self, get, operation='check'):
        fake_spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module: None))
        with patch.object(c.importlib.util, 'spec_from_file_location', return_value=fake_spec), \
                patch.object(c.importlib.util, 'module_from_spec', return_value=cf), \
                patch.object(cf, 'api_get', side_effect=lambda path, token: get(path)), \
                patch.dict(os.environ, dict(zip(c.SECRET_NAMES, ('fake-api-token', self.token, ','.join(self.m['emails']))))), \
                patch('sys.argv', ['script', operation]), patch('sys.stdout', new_callable=io.StringIO) as output, \
                patch('builtins.open', side_effect=AssertionError('unexpected file operation')):
            code = c.main()
        return code, output.getvalue()

    def test_main_has_no_file_write_and_reports_partial_scope_and_no_tunnel_authentication(self):
        code, output = self.run_main(self.data.__getitem__)
        self.assertEqual(code, 0)
        result = json.loads(output)
        self.assertEqual(result['cloudflare_check'], 'PASS')
        self.assertTrue(result['api_token_present'])
        self.assertTrue(result['tunnel_token_present'])
        for key in ('vps_contacted', 'configuration_written', 'tunnel_started',
                    'tunnel_secret_authenticated', 'configuration_verified', 'access_policy_verified'):
            self.assertFalse(result[key])

    def test_http_403_only_reports_stage_code_never_token_body_headers_or_exception(self):
        leaked = 'fake-api-token ' + self.token + ' owner@example.test'
        def get(path):
            raise urllib.error.HTTPError('https://provider/' + leaked, 403, leaked,
                                        {'Authorization': leaked}, io.BytesIO(leaked.encode()))
        code, output = self.run_main(get)
        self.assertEqual(code, 1)
        result = json.loads(output)
        self.assertEqual((result['stage'], result['reason']), ('ZONE_LOOKUP', 'HTTP_403'))
        self.assertTrue(result['api_token_present'])
        self.assertTrue(result['tunnel_token_present'])
        for private in ('fake-api-token', self.token, 'owner@example.test', 'https://provider'):
            self.assertNotIn(private, output)

    def test_redirect_network_and_unexpected_http_are_redacted(self):
        for exc, reason in ((urllib.error.HTTPError('private', 302, 'private', {}, None), 'HTTP_ERROR'),
                            (urllib.error.URLError('private'), 'NETWORK_OR_TIMEOUT'),
                            (ValueError('private'), 'API_READ_FAILED')):
            with self.subTest(reason=reason):
                result = c.failure(exc, {'stage': 'ZONE_LOOKUP', 'api_pending': True})
                self.assertEqual(result['reason'], reason)
                self.assertNotIn('private', json.dumps(result))


class WorkflowBoundaryTests(unittest.TestCase):
    def test_secret_consumer_is_main_owner_dev_runner_only_without_pr_or_ssh_or_artifacts(self):
        workflow = (ROOT / '.github/workflows/oce-cloudflare-check.yml').read_text()
        for boundary in ("github.repository == 'Khaey/Dao'", "github.ref == 'refs/heads/main'",
                         "github.actor == 'Khaey'", 'github.event.issue.number == 58',
                         '!github.event.issue.pull_request', "github.event.comment.author_association == 'OWNER'",
                         'environment: dev', 'persist-credentials: false', 'python3 -I'):
            self.assertIn(boundary, workflow)
        for forbidden in ('pull_request:', 'ssh-action', 'scp-action', 'upload-artifact', 'sudo ', 'gateway-host'):
            self.assertNotIn(forbidden, workflow)
        for name in c.SECRET_NAMES:
            self.assertIn('${{ secrets.' + name + ' }}', workflow)


if __name__ == '__main__':
    unittest.main()
