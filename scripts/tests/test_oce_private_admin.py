import base64
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('private_admin', ROOT / 'ops/dao-oce-private-admin.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


class Lock:
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass
    def fileno(self):
        return 123


class AdminBoundaries(unittest.TestCase):
    def invoke(self, operation, foreign=False, probe_fails=False, healthy=True):
        cf_spec = importlib.util.spec_from_file_location('test_cf', ROOT / 'ops/oce-cloudflare.py')
        cf = importlib.util.module_from_spec(cf_spec)
        cf_spec.loader.exec_module(cf)
        manifest = {'account_id': 'a' * 32, 'zone_id': 'b' * 32,
                    'tunnel_id': '11111111-1111-1111-1111-111111111111',
                    'application_id': '22222222-2222-2222-2222-222222222222',
                    'team_name': 'dao-test', 'emails': ['owner@example.test']}
        payload = {'a': manifest['account_id'], 't': manifest['tunnel_id'],
                   's': base64.b64encode(bytes(32)).decode()}
        if foreign:
            payload['t'] = '33333333-3333-3333-3333-333333333333'
        test_token = base64.b64encode(json.dumps(payload).encode()).decode()
        def read(path):
            if path.name == 'approved.json':
                return json.dumps(manifest)
            return test_token if path.name == 'tunnel-token' else 'read-only-api-test-value'

        def readonly_get(path, token):
            if path == '/accounts/' + manifest['account_id'] + '/cfd_tunnel/' + manifest['tunnel_id']:
                return {'status': 'healthy' if healthy else 'inactive'}
            raise AssertionError('Unexpected credential API request')
        class Response:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
        with patch.object(a.os, 'geteuid', return_value=0), \
             patch.object(a.sys, 'argv', ['admin', operation]), \
             patch.object(a.Path, 'lstat', return_value=types.SimpleNamespace(st_mode=0o40700, st_uid=0)), \
             patch('builtins.open', return_value=Lock()), \
             patch.object(a.fcntl, 'flock'), \
             patch.object(a, 'private_file', side_effect=read), \
             patch.object(a.importlib.util, 'module_from_spec', return_value=cf), \
             patch.object(a.importlib.util, 'spec_from_file_location',
                          return_value=types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=lambda module: None))), \
             patch.object(cf, 'audit', return_value={'configuration_verified': True}), \
             patch.object(cf, 'api_get', side_effect=readonly_get), \
             patch.object(cf.OPENER, 'open', return_value=Response()), \
             patch.object(cf, 'probe', side_effect=ValueError('private') if probe_fails else None), \
             patch.object(a, 'systemctl', return_value=types.SimpleNamespace(returncode=0)) as ctl, \
             patch('builtins.print') as output:
            result = a.main()
            return result, ctl.call_args_list, str(output.call_args_list)

    def test_wrong_tunnel_token_never_starts_service_and_is_redacted(self):
        result, commands, output = self.invoke('start', foreign=True)
        self.assertEqual(result, 1)
        self.assertTrue(all(c.args[0] == 'stop' for c in commands))
        self.assertNotIn('foreign-secret-token', output)
        self.assertNotIn('approved-token', output)

    def test_start_never_requests_write_permission_credential_endpoint(self):
        result, commands, output = self.invoke('start')
        self.assertEqual(result, 0)
        self.assertEqual(commands[0].args, ('start',))
        self.assertNotIn('read-only-api-test-value', output)

    def test_failed_edge_probe_stops_only_private_tunnel(self):
        result, commands, output = self.invoke('start', probe_fails=True)
        self.assertEqual(result, 1)
        self.assertEqual(commands[0].args, ('start',))
        self.assertEqual(commands[-1].args, ('stop', False))
        self.assertNotIn('approved-token', output)

    def test_local_ready_without_authenticated_cf_tunnel_stops_service(self):
        result, commands, _ = self.invoke('start', healthy=False)
        self.assertEqual(result, 1)
        self.assertEqual(commands[-1].args, ('stop', False))

    def test_audit_does_not_mutate_service(self):
        result, commands, _ = self.invoke('audit')
        self.assertEqual(result, 0)
        self.assertEqual(commands, [])

    def test_unsafe_private_file_is_refused_before_read(self):
        for mode, uid in ((0o100644, 0), (0o120600, 0), (0o100600, 1000)):
            with self.subTest(mode=mode, uid=uid), \
                 patch.object(a.Path, 'lstat', return_value=types.SimpleNamespace(st_mode=mode, st_uid=uid)), \
                 patch.object(a.Path, 'read_text') as read:
                with self.assertRaises(ValueError):
                    a.private_file(Path('/unused'))
                read.assert_not_called()

    def test_probe_executes_under_actual_dao_uid_without_secret_arguments(self):
        with patch.object(a.subprocess, 'run') as run:
            result, commands, output = self.invoke('probe')
            self.assertEqual(result, 0)
            self.assertEqual(commands, [])
            self.assertEqual(run.call_args.args[0], [
                '/usr/sbin/runuser', '-u', 'dao', '--', '/usr/bin/python3',
                '/usr/local/libexec/dao-oce-cloudflare.py', 'probe', 'dao-test'])
            self.assertNotIn('approved-token', str(run.call_args))


if __name__ == '__main__':
    unittest.main()
