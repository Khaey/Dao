import base64
import copy
import importlib.util
import io
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch
import urllib.error
import test_oce_cloudflare as fixtures

spec = importlib.util.spec_from_file_location('diagnose', Path(__file__).resolve().parents[1] / 'oce-private-bootstrap-diagnose.py')
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        fixture = fixtures.PrivateDemoTests()
        fixture.setUp()
        self.cf, self.m, self.data = fixtures.cf, fixture.m, copy.deepcopy(fixture.data)
        self.data['/zones?name=logiclab.fr&per_page=100'] = [{
            'name': 'logiclab.fr', 'id': self.m['zone_id'], 'account': {'id': self.m['account_id']}}]
        self.tunnel_token = base64.b64encode(json.dumps({
            'a': self.m['account_id'], 't': self.m['tunnel_id'],
            's': base64.b64encode(bytes(32)).decode()}).encode()).decode()

    def run_diagnostic(self, get=None, token=None, emails=None):
        return diagnostic.diagnose(self.cf, get or self.data.__getitem__,
            self.m['tunnel_id'], emails or self.m['emails'], token or self.tunnel_token)

    def test_readonly_success_reuses_exact_installed_audit(self):
        called = []
        def get(path):
            called.append(path)
            return self.data[path]
        with patch('builtins.open', side_effect=AssertionError('No writes')), patch('sys.stdout', new_callable=io.StringIO) as output:
            result = self.run_diagnostic(get=get)
        self.assertEqual(output.getvalue(), '')
        self.assertEqual(result, {'diagnostic': 'PASS', 'configuration_written': False, 'tunnel_started': False})
        self.assertTrue(any('/policies?' in path for path in called))
        self.assertTrue(any('/dns_records?' in path for path in called))

    def test_http_failure_emits_only_allowlisted_status_and_stage(self):
        secret = 'fixture-sensitive-token-and-api-body'
        def denied(path):
            if '/identity_providers' in path:
                raise urllib.error.HTTPError('https://example.test/' + secret, 403, secret, {}, io.BytesIO(secret.encode()))
            return self.data[path]
        result = self.run_diagnostic(get=denied)
        self.assertEqual((result['stage'], result['reason']), ('OTP_PROVIDERS', 'HTTP_403'))
        self.assertNotIn(secret, json.dumps(result))
        self.assertNotIn(self.m['account_id'], json.dumps(result))

    def test_wrong_allowlist_fails_with_source_line_without_email_output(self):
        result = self.run_diagnostic(emails=['unexpected@example.test'])
        self.assertEqual(result['stage'], 'ACCESS_POLICY')
        self.assertEqual(result['reason'], 'VALIDATION_FAILED')
        self.assertIsInstance(result['installed_module_line'], int)
        self.assertNotIn('unexpected@example.test', json.dumps(result))

    def test_bad_ingress_is_located_without_origin_disclosure(self):
        for path, value in self.data.items():
            if path.endswith('/configurations'):
                value['config']['ingress'][0]['service'] = 'http://unapproved.example.test'
        result = self.run_diagnostic()
        self.assertEqual(result['stage'], 'TUNNEL_CONFIGURATION')
        self.assertNotIn('unapproved', json.dumps(result))

    def test_invalid_token_is_not_echoed_and_audit_is_not_reached(self):
        result = self.run_diagnostic(token='fixture-invalid-sensitive-token')
        self.assertEqual(result['stage'], 'TUNNEL_TOKEN_BINDING')
        self.assertNotIn('fixture-invalid-sensitive-token', json.dumps(result))

    def test_valid_minimum_secret_can_be_rejected_by_installed_exact_length_check(self):
        payload = {'a': self.m['account_id'], 't': self.m['tunnel_id'],
                   's': base64.b64encode(bytes(36)).decode()}
        token = base64.b64encode(json.dumps(payload).encode()).decode()
        result = self.run_diagnostic(token=token)
        self.assertEqual(result['token_check'], 'INSTALLED_EXACT_32_BYTE_CONSTRAINT')
        self.assertTrue(result['secret_minimum_32_bytes_met'])
        self.assertGreater(result['installed_module_line'], 29)
        self.assertNotIn(token, json.dumps(result))
        self.assertNotIn(payload['s'], json.dumps(result))

    def test_token_mismatch_and_endpoint_have_distinct_non_sensitive_codes(self):
        payload = {'a': self.m['account_id'], 't': self.m['tunnel_id'],
                   's': base64.b64encode(bytes(32)).decode()}
        for field, value, expected in (
                ('a', 'd' * 32, 'ACCOUNT_MISMATCH'),
                ('t', '33333333-3333-3333-3333-333333333333', 'TUNNEL_MISMATCH'),
                ('e', 'fixture-sensitive-endpoint.test', 'ALTERNATE_ENDPOINT'),
                ('s', 'fixture-sensitive-malformed-secret', 'SECRET_ENCODING')):
            with self.subTest(field=field):
                token = base64.b64encode(json.dumps({**payload, field: value}).encode()).decode()
                result = self.run_diagnostic(token=token)
                self.assertEqual(result['token_check'], expected)
                self.assertNotIn(value, json.dumps(result))
                self.assertNotIn(token, json.dumps(result))

    def test_short_secret_is_distinguished_from_exact_size_compatibility(self):
        payload = {'a': self.m['account_id'], 't': self.m['tunnel_id'],
                   's': base64.b64encode(bytes(16)).decode()}
        token = base64.b64encode(json.dumps(payload).encode()).decode()
        result = self.run_diagnostic(token=token)
        self.assertFalse(result['secret_minimum_32_bytes_met'])

    def test_api_schema_error_is_not_misreported_as_policy_mismatch(self):
        def malformed(path):
            raise ValueError('fixture-secret-provider-response')
        result = self.run_diagnostic(get=malformed)
        self.assertEqual(result['reason'], 'API_READ_FAILED')
        self.assertNotIn('fixture-secret', json.dumps(result))

    def test_noninteractive_execution_refuses_before_prompt(self):
        with patch.object(diagnostic.sys, 'argv', ['diagnose']), patch.object(diagnostic.sys.stdin, 'isatty', return_value=False), patch.object(diagnostic, 'load_installed') as load, patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(diagnostic.main(), 1)
        load.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())['stage'], 'TRUSTED_TERMINAL')

    def test_module_trust_refuses_symlink_or_nonroot_or_writable_code(self):
        for mode, uid in ((0o120755, 0), (0o100755, 1000), (0o100777, 0)):
            with self.subTest(mode=mode, uid=uid), patch.object(Path, 'lstat', return_value=types.SimpleNamespace(st_mode=mode, st_uid=uid)), self.assertRaises(ValueError):
                diagnostic.load_installed()


if __name__ == '__main__':
    unittest.main()
