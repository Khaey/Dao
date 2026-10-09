import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
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


if __name__ == '__main__':
    unittest.main()
