import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import stat
from types import SimpleNamespace
import urllib.error
import unittest
from unittest.mock import patch
import test_oce_cloudflare as fixture_module
cf = fixture_module.cf

spec = importlib.util.spec_from_file_location('provision', Path(__file__).resolve().parents[2] / 'ops/provision-oce-private-demo.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class ProvisionTests(unittest.TestCase):
    def setUp(self):
        fixture = fixture_module.PrivateDemoTests()
        fixture.setUp()
        self.m, self.data = fixture.m, fixture.data
        self.data['/zones?name=logiclab.fr&per_page=100'] = [
            {'name': 'logiclab.fr', 'id': self.m['zone_id'], 'account': {'id': self.m['account_id']}}]
        self.token = base64.b64encode(json.dumps({'a': self.m['account_id'], 't': self.m['tunnel_id'],
                         's': base64.b64encode(bytes(32)).decode()}).encode()).decode()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def trusted_root_metadata(self, path):
        # The test runner owns its disposable directory; model root custody only
        # for main()'s reviewed destination. Do not weaken the production check.
        meta = os.lstat(path)
        return SimpleNamespace(st_uid=0, st_mode=meta.st_mode) if path == self.root else meta

    def run_provision(self, emails=None, get=None):
        p.provision(cf, get or self.data.__getitem__, self.m['tunnel_id'],
                    emails or self.m['emails'], self.token, 'fake-read-only-api-value', root=self.root)

    def test_discovers_ids_after_exact_policy_audit_and_writes_private_files_without_output(self):
        with patch('sys.stdout', new_callable=io.StringIO) as output:
            self.run_provision()
            self.assertEqual(output.getvalue(), '')
        manifest = json.loads((self.root / 'approved.json').read_text())
        self.assertEqual(manifest, self.m)
        for name in ('approved.json', 'api-token', 'tunnel-token'):
            self.assertEqual((self.root / name).stat().st_mode & 0o777, 0o600)

    def test_operator_email_list_must_match_independent_live_policy(self):
        with self.assertRaises(ValueError):
            self.run_provision(emails=['stranger@example.test'])
        self.assertEqual(list(self.root.iterdir()), [])

    def test_read_permission_failure_leaves_no_credentials(self):
        def denied(path):
            raise PermissionError('withheld')
        with self.assertRaises(PermissionError):
            self.run_provision(get=denied)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_existing_secret_and_symlink_are_never_overwritten(self):
        existing = self.root / 'api-token'
        existing.write_text('previous-private-fixture')
        with self.assertRaises(ValueError):
            self.run_provision()
        self.assertEqual(existing.read_text(), 'previous-private-fixture')
        existing.unlink()
        existing.symlink_to(self.root / 'not-present')
        with self.assertRaises(ValueError):
            self.run_provision()
        self.assertTrue(existing.is_symlink())

    def test_partial_write_failure_removes_only_created_files(self):
        real_open = os.open
        def failing(path, flags, mode=0o777):
            if Path(path).name == 'tunnel-token':
                raise OSError('simulated disk failure')
            return real_open(path, flags, mode)
        with patch.object(p.os, 'open', side_effect=failing), self.assertRaises(OSError):
            self.run_provision()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_longer_tunnel_secret_provisions_only_after_same_full_audit(self):
        self.token = base64.b64encode(json.dumps({
            'a': self.m['account_id'], 't': self.m['tunnel_id'],
            's': base64.b64encode(bytes(36)).decode()}).encode()).decode()
        self.run_provision()
        self.assertEqual((self.root / 'tunnel-token').read_text().strip(), self.token)
        self.assertEqual((self.root / 'tunnel-token').stat().st_mode & 0o777, 0o600)

    def session(self, get=None, reply=None):
        self.output = []
        return p.run_session(cf, get or self.data.__getitem__, self.m['tunnel_id'],
                             self.m['emails'], self.token, 'fake-read-only-api-value',
                             self.root, '0' * 64, reply=reply or (lambda _: 'q'), emit=self.output.append)

    def test_session_reports_read_permission_stage_without_api_body_or_private_values(self):
        def get(path):
            if path.endswith('/access/identity_providers'):
                raise urllib.error.HTTPError('https://private.example/secret-url', 403,
                                             'private-message', {}, io.BytesIO(b'private-body'))
            return self.data[path]
        self.assertEqual(self.session(get), 1)
        report = json.loads(self.output[1])
        self.assertEqual((report['stage'], report['reason']), ('OTP_PROVIDERS', 'HTTP_403'))
        self.assertEqual(list(self.root.iterdir()), [])
        for private in (self.token, 'fake-read-only-api-value', self.m['account_id'],
                        self.m['emails'][0], 'secret-url', 'private-message', 'private-body'):
            self.assertNotIn(private, '\n'.join(self.output))

    def test_policy_correction_reuses_same_credentials_and_requires_entire_audit_before_write(self):
        policy_path = '/accounts/' + self.m['account_id'] + '/access/apps/' + self.m['application_id'] + '/policies?per_page=100'
        self.data[policy_path][0]['include'] = [{'everyone': {}}]
        def reply(prompt):
            self.assertEqual(list(self.root.iterdir()), [])
            report = json.loads(self.output[1])
            self.assertEqual((report['stage'], report['reason']), ('ACCESS_POLICY', 'VALIDATION_FAILED'))
            self.assertIsInstance(report['installed_module_line'], int)
            self.data[policy_path][0]['include'] = [{'email': {'email': e}} for e in self.m['emails']]
            return ''
        with patch.object(p.getpass, 'getpass', side_effect=AssertionError('Must not reprompt')):
            self.assertEqual(self.session(reply=reply), 0)
        self.assertIn('BOOTSTRAP_CONFIGURATION_READY', self.output[-1])
        self.assertEqual((self.root / 'tunnel-token').read_text().strip(), self.token)
        self.assertEqual((self.root / 'api-token').read_text().strip(), 'fake-read-only-api-value')

    def test_session_never_automatically_retries_and_has_three_attempt_limit(self):
        calls = []
        def denied(path):
            calls.append(path)
            raise PermissionError('private-value')
        reply = unittest.mock.Mock(return_value='')
        self.assertEqual(self.session(denied, reply), 1)
        self.assertEqual(len(calls), 3)
        self.assertEqual(reply.call_count, 2)
        self.assertEqual([json.loads(line)['attempt'] for line in self.output if line.startswith('{')], [1, 2, 3])
        self.assertEqual(list(self.root.iterdir()), [])

    def test_local_binding_failure_stops_without_waiting_or_writing(self):
        self.token = base64.b64encode(json.dumps({'a': self.m['account_id'], 't': self.m['tunnel_id'],
                         's': base64.b64encode(bytes(31)).decode()}).encode()).decode()
        reply = unittest.mock.Mock(side_effect=AssertionError('No retry for local input'))
        self.assertEqual(self.session(reply=reply), 1)
        self.assertEqual(json.loads(self.output[1])['stage'], 'TUNNEL_TOKEN_BINDING')
        reply.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_session_deadline_during_api_or_wait_does_not_write_credentials(self):
        def expired_read(path):
            raise p.SessionExpired()
        self.assertEqual(self.session(expired_read), 1)
        self.assertEqual(json.loads(self.output[1])['reason'], 'SESSION_DEADLINE')
        def expired_reply(prompt):
            raise p.SessionExpired()
        self.assertEqual(self.session(lambda _: (_ for _ in ()).throw(PermissionError()), expired_reply), 1)
        report = json.loads(self.output[-1])
        self.assertEqual((report['stage'], report['reason']), ('RETRY_WAIT', 'SESSION_DEADLINE'))
        self.assertEqual(list(self.root.iterdir()), [])

    def test_interrupted_partial_write_removes_created_credentials(self):
        real_open = os.open
        def interrupted(path, flags, mode=0o777):
            if Path(path).name == 'tunnel-token':
                raise KeyboardInterrupt()
            return real_open(path, flags, mode)
        with patch.object(p.os, 'open', side_effect=interrupted), self.assertRaises(KeyboardInterrupt):
            self.run_provision()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_partial_write_session_is_fatal_and_does_not_reprompt(self):
        real_open = os.open
        def failing(path, flags, mode=0o777):
            if Path(path).name == 'tunnel-token':
                raise OSError('private-error')
            return real_open(path, flags, mode)
        reply = unittest.mock.Mock(side_effect=AssertionError('No retry for file writes'))
        with patch.object(p.os, 'open', side_effect=failing):
            self.assertEqual(self.session(reply=reply), 1)
        self.assertEqual(json.loads(self.output[1])['reason'], 'CREDENTIAL_FILE_WRITE_FAILED')
        reply.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_module_trust_refuses_non_root_writable_or_symlink_code_and_parents_before_import(self):
        module = Path('/trusted/dao-oce-cloudflare.py')
        for target, uid, mode in ((module, 1000, stat.S_IFREG | 0o755),
                                  (module, 0, stat.S_IFREG | 0o775),
                                  (module, 0, stat.S_IFLNK | 0o755),
                                  (module.parent, 0, stat.S_IFDIR | 0o777)):
            def meta(path):
                if path == target:
                    return SimpleNamespace(st_uid=uid, st_mode=mode)
                return SimpleNamespace(st_uid=0, st_mode=(stat.S_IFREG if path == module else stat.S_IFDIR) | 0o755)
            with self.subTest(target=target, uid=uid, mode=mode), patch.object(p, 'MODULE', module), \
                    patch.object(Path, 'lstat', autospec=True, side_effect=meta), \
                    patch.object(p.importlib.util, 'module_from_spec') as imported:
                with self.assertRaises(ValueError):
                    p.load_installed()
                imported.assert_not_called()

    def test_main_requires_root_and_tty_before_private_input(self):
        for uid, tty in ((1000, True), (0, False)):
            with self.subTest(uid=uid, tty=tty), patch.object(p.os, 'geteuid', return_value=uid), \
                    patch.object(p.sys.stdin, 'isatty', return_value=tty), \
                    patch.object(p.sys, 'argv', ['provision']), \
                    patch.object(p.getpass, 'getpass', side_effect=AssertionError('No prompt')), \
                    patch('sys.stdout', new_callable=io.StringIO) as output, \
                    patch('sys.stderr', new_callable=io.StringIO):
                self.assertEqual(p.main(), 1)
                self.assertEqual(json.loads(output.getvalue())['stage'], 'TRUSTED_TERMINAL')

    def test_main_collects_two_masked_secrets_once_across_manual_retry(self):
        calls = 0
        def get(path, token):
            nonlocal calls
            self.assertEqual(token, 'fake-read-only-api-value')
            calls += 1
            if calls == 1:
                raise urllib.error.HTTPError('https://private.example', 403, 'secret', {}, None)
            return self.data[path]
        with patch.object(p, 'ROOT', self.root), patch.object(p, 'load_installed', return_value=(cf, 'a' * 64)), \
                patch.object(Path, 'lstat', autospec=True, side_effect=self.trusted_root_metadata), \
                patch.object(p.os, 'geteuid', return_value=0), patch.object(p.sys.stdin, 'isatty', return_value=True), \
                patch.object(p.sys, 'argv', ['provision']), patch.object(p.signal, 'alarm') as alarm, \
                patch.object(p.signal, 'signal'), patch.object(cf, 'api_get', side_effect=get), \
                patch('builtins.input', side_effect=[self.m['tunnel_id'], ','.join(self.m['emails']), '']) as inputs, \
                patch.object(p.getpass, 'getpass', side_effect=['fake-read-only-api-value', self.token]) as masked, \
                patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(p.main(), 0)
            self.assertEqual(masked.call_count, 2)
            self.assertEqual(inputs.call_count, 3)
            self.assertEqual(alarm.call_args_list, [unittest.mock.call(p.SESSION_SECONDS), unittest.mock.call(0)])
            self.assertNotIn(self.token, output.getvalue())
            self.assertNotIn('fake-read-only-api-value', output.getvalue())

    def test_existing_configuration_prevents_secret_prompts_or_overwrite(self):
        (self.root / 'api-token').write_text('existing-private-value')
        with patch.object(p, 'ROOT', self.root), patch.object(p, 'load_installed', return_value=(cf, 'a' * 64)), \
                patch.object(Path, 'lstat', autospec=True, side_effect=self.trusted_root_metadata), \
                patch.object(p.os, 'geteuid', return_value=0), patch.object(p.sys.stdin, 'isatty', return_value=True), \
                patch.object(p.sys, 'argv', ['provision']), patch.object(p.signal, 'alarm'), \
                patch.object(p.signal, 'signal'), \
                patch.object(p.getpass, 'getpass', side_effect=AssertionError('No prompt')), \
                patch('sys.stdout', new_callable=io.StringIO) as output, patch('sys.stderr', new_callable=io.StringIO):
            self.assertEqual(p.main(), 1)
            self.assertEqual(json.loads(output.getvalue())['stage'], 'CONFIGURATION_DESTINATION')
        self.assertEqual((self.root / 'api-token').read_text(), 'existing-private-value')

    def test_main_refuses_non_root_private_directory_even_with_root_caller(self):
        with patch.object(p, 'ROOT', self.root), \
                patch.object(Path, 'lstat', return_value=SimpleNamespace(st_uid=1001, st_mode=stat.S_IFDIR | 0o700)), \
                patch.object(p.os, 'geteuid', return_value=0), patch.object(p.sys.stdin, 'isatty', return_value=True), \
                patch.object(p.sys, 'argv', ['provision']), patch.object(p.signal, 'alarm'), \
                patch.object(p.signal, 'signal'), \
                patch.object(p.getpass, 'getpass', side_effect=AssertionError('No prompt')), \
                patch('sys.stdout', new_callable=io.StringIO) as output, patch('sys.stderr', new_callable=io.StringIO):
            self.assertEqual(p.main(), 1)
            self.assertEqual(json.loads(output.getvalue())['stage'], 'ROOT_DIRECTORY')


if __name__ == '__main__':
    unittest.main()
