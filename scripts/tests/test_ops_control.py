import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


admin = module('ops_admin_tests', 'ops/dao-ops-admin.py')
request = module('ops_request_tests', 'scripts/dao-ops-request.py')
generator = module('ops_release_tests', 'scripts/build-ops-release.py')


class RequestTests(unittest.TestCase):
    def event(self, body='/dao-ops status'):
        return {'action': 'created', 'issue': {'number': 91},
                'comment': {'user': {'login': 'Khaey'}, 'body': body}}

    def select(self, event, **kwargs):
        defaults = {'event_name': 'issue_comment', 'repository': 'Khaey/Dao', 'ref': 'refs/heads/main', 'actor': 'Khaey'}
        return request.select(event=event, **{**defaults, **kwargs})

    def test_exact_owner_signals_and_dispatch_share_vocabulary(self):
        for operation in request.OPERATIONS:
            with self.subTest(operation=operation):
                self.assertEqual(self.select(self.event('/dao-ops ' + operation)), operation)
                self.assertEqual(self.select({'inputs': {'operation': operation}}, event_name='workflow_dispatch'), operation)

    def test_reject_non_owner_pr_other_issue_ref_and_shell_text(self):
        bad = [self.event('/dao-ops status\nid'), self.event('/dao-ops status; id'),
               self.event('/dao-ops approve ' + 'a' * 40), self.event('/dao-ops status ')]
        other_issue, other_author, edited, pr = (self.event() for _ in range(4))
        other_issue['issue']['number'] = 58
        other_author['comment']['user']['login'] = 'other'
        edited['action'] = 'edited'
        pr['issue']['pull_request'] = {}
        for event in bad + [other_issue, other_author, edited, pr]:
            with self.subTest(event=event), self.assertRaises(ValueError):
                self.select(event)
        for kwargs in [{'actor': 'other'}, {'ref': 'refs/heads/chore/untrusted'},
                       {'repository': 'other/Dao'}, {'event_name': 'pull_request'}]:
            with self.assertRaises(ValueError):
                self.select(self.event(), **kwargs)


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state = self.root / 'state'
        self.state.mkdir(mode=0o700)
        installed = self.root / 'installed'
        installed.mkdir()
        sources = ('ops/dao-ops-admin.py', 'ops/dao-dev-admin.py', 'ops/oce-cloudflare.py')
        catalog = {s: (str(installed / Path(s).name), 'dao-oce-cloudflared.service' if 'cloudflare' in s else None) for s in sources}
        self.patcher = patch.multiple(admin, STATE=self.state, ANCHOR=self.root, OWNER=os.getuid(), CATALOG=catalog, LOCKS=())
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.old = {s: b'# fictional installed code\nvalue=1\n' for s in catalog}
        for source, data in self.old.items():
            path = Path(catalog[source][0])
            path.write_bytes(data)
            path.chmod(0o755)
        admin.bootstrap()
        self.ledger = admin.load_ledger()
        self.new = {**self.old, 'ops/dao-dev-admin.py': b'# fictional approved code\nvalue=2\n'}
        self.approval = {'sha': 'a' * 40, 'ci_run_id': 22, 'approval_comment_id': 33}

    @contextlib.contextmanager
    def candidate(self, data=None, verify=None):
        files = data or self.new
        def fetch(url, limit=0):
            if url.endswith('ops/ops-release.json'):
                return json.dumps(admin.manifest(files)).encode()
            return files[url.split('/' + self.approval['sha'] + '/', 1)[1]]
        with patch.object(admin, 'admission', return_value=self.approval), \
             patch.object(admin, 'fetch', side_effect=fetch), \
             patch.object(admin, 'main_sha', return_value=self.approval['sha']), \
             patch.object(admin, 'verify_controller', side_effect=verify), \
             patch.object(admin, 'service_idle') as idle:
            yield idle

    def test_upgrade_versions_permissions_and_rollback(self):
        with self.candidate():
            result = admin.upgrade(self.ledger)
        self.assertEqual(result['ops_upgrade'], 'complete')
        self.assertEqual(admin.installed_files(), self.new)
        ledger = admin.load_ledger()
        self.assertEqual(ledger['previous'], 'bootstrap')
        self.assertEqual(admin.load_snapshot('bootstrap'), self.old)
        for destination, _ in admin.CATALOG.values():
            self.assertEqual(stat.S_IMODE(Path(destination).stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE((self.state / 'state.json').stat().st_mode), 0o600)
        admin.rollback(ledger)
        self.assertEqual(admin.installed_files(), self.old)
        self.assertIsNone(admin.load_ledger()['previous'])
        self.assertFalse((self.state / 'transaction.json').exists())

    def test_unchanged_upgrade_creates_no_transaction(self):
        with self.candidate(self.old):
            self.assertEqual(admin.upgrade(self.ledger)['ops_upgrade'], 'unchanged')
        self.assertEqual(admin.load_ledger(), self.ledger)
        self.assertFalse((self.state / 'transaction.json').exists())

    def test_failed_post_install_validation_restores_every_file_and_state(self):
        def reject(_):
            raise admin.Halt('CONTROLLER_VALIDATION_FAILED')
        with self.candidate(verify=reject), self.assertRaisesRegex(admin.Halt, 'UPGRADE_ROLLED_BACK'):
            admin.upgrade(self.ledger)
        self.assertEqual(admin.installed_files(), self.old)
        self.assertEqual(admin.load_ledger(), self.ledger)
        self.assertFalse((self.state / 'transaction.json').exists())

    def test_interrupted_install_recovers_from_persisted_journal(self):
        def interrupted(files):
            source = 'ops/dao-dev-admin.py'
            admin.atomic(Path(admin.CATALOG[source][0]), files[source], 0o755)
            raise KeyboardInterrupt('simulated process loss')
        with self.candidate(), patch.object(admin, 'install_files', side_effect=interrupted), self.assertRaises(KeyboardInterrupt):
            admin.upgrade(self.ledger)
        self.assertTrue((self.state / 'transaction.json').exists())
        with patch.object(admin, 'service_idle'):
            result = admin.rollback(admin.load_ledger())
        self.assertTrue(result['recovered_transaction'])
        self.assertEqual(admin.installed_files(), self.old)
        self.assertEqual(admin.load_ledger(), self.ledger)

    def test_interrupted_snapshot_does_not_publish_a_partial_version(self):
        target = 'rev-' + 'a' * 40
        with patch.object(admin, 'atomic', side_effect=KeyboardInterrupt), self.assertRaises(KeyboardInterrupt):
            admin.save_snapshot(target, self.new)
        self.assertFalse((self.state / target).exists())
        admin.save_snapshot(target, self.new)
        self.assertEqual(admin.load_snapshot(target), self.new)

    def test_root_lock_contention_refuses_second_mutation(self):
        with contextlib.ExitStack() as first:
            admin.locked(first)
            with contextlib.ExitStack() as second, self.assertRaisesRegex(admin.Halt, 'OPS_LOCK_BUSY'):
                admin.locked(second)
            output = io.StringIO()
            with patch.object(admin.os, 'geteuid', return_value=0), \
                 patch.object(admin.sys, 'argv', ['dao-ops-admin', 'upgrade']), \
                 patch.object(admin.signal, 'signal'), patch.object(admin.signal, 'alarm'), \
                 contextlib.redirect_stderr(output):
                self.assertEqual(admin.main(), 1)
            self.assertEqual(json.loads(output.getvalue()), {'ops_error': 'OPS_LOCK_BUSY'})
        self.assertEqual(admin.installed_files(), self.old)
        self.assertEqual(admin.load_ledger(), self.ledger)
        self.assertFalse((self.state / 'transaction.json').exists())

    def test_external_drift_refused_before_network_or_overwrite(self):
        Path(admin.CATALOG['ops/oce-cloudflare.py'][0]).write_bytes(b'changed by DEV 20\n')
        with patch.object(admin, 'admission') as network, self.assertRaisesRegex(admin.Halt, 'INSTALLED_DRIFT'):
            admin.prepare(self.ledger)
        network.assert_not_called()
        self.assertFalse((self.state / 'transaction.json').exists())

    def test_hash_tamper_and_unsafe_paths_refused(self):
        version = self.state / 'bootstrap'
        (version / admin.blob_name('ops/dao-dev-admin.py')).write_bytes(b'tampered')
        with self.assertRaisesRegex(admin.Halt, 'SNAPSHOT_HASH_MISMATCH'):
            admin.load_snapshot('bootstrap')
        outside = self.root / 'outside'
        outside.write_bytes(b'unchanged')
        link = self.root / 'link'
        link.symlink_to(outside)
        with self.assertRaises(admin.Halt):
            admin.atomic(link, b'overwrite', 0o755)
        self.assertEqual(outside.read_bytes(), b'unchanged')
        for path in [self.root / '../escape', Path('/untrusted')]:
            with self.assertRaises(admin.Halt):
                admin.safe(path, missing=True)
        self.root.chmod(0o777)
        with self.assertRaises(admin.Halt):
            admin.load_ledger()
        self.root.chmod(0o700)

    def test_service_busy_or_main_advanced_creates_no_journal(self):
        data = {**self.new, 'ops/oce-cloudflare.py': b'value=3\n'}
        with self.candidate(data), patch.object(admin, 'service_idle', side_effect=admin.Halt('MANAGED_SERVICE_BUSY')):
            with self.assertRaisesRegex(admin.Halt, 'MANAGED_SERVICE_BUSY'):
                admin.upgrade(self.ledger)
        with self.candidate(), patch.object(admin, 'main_sha', return_value='b' * 40):
            with self.assertRaisesRegex(admin.Halt, 'MAIN_ADVANCED'):
                admin.upgrade(self.ledger)
        self.assertFalse((self.state / 'transaction.json').exists())
        self.assertEqual(admin.installed_files(), self.old)

    def test_release_hash_and_catalog_cannot_accept_arbitrary_destinations(self):
        malformed = admin.manifest(self.new)
        malformed['files']['ops/evil.py'] = {'sha256': 'f' * 64, 'size': 10}
        with self.assertRaises(admin.Halt):
            admin.validate_manifest(malformed)
        with self.candidate(), patch.object(admin, 'fetch', side_effect=[json.dumps(admin.manifest(self.new)).encode(), b'tampered']):
            with self.assertRaisesRegex(admin.Halt, 'RELEASE_HASH_MISMATCH'):
                admin.release_files(self.approval, self.old)
        with self.assertRaises(admin.Halt):
            admin.strict_json('{"schema":1,"schema":2}')
        with self.assertRaises(admin.Halt):
            admin.folder('../escape')


class RouterTests(unittest.TestCase):
    def test_fixed_privileged_calls_and_failed_env_sync_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app, commands = root / 'dao', root / 'commands'
            scripts = app / 'current/scripts'
            scripts.mkdir(parents=True)
            commands.mkdir()
            log = root / 'calls'
            for name in ('dev-status.sh', 'validate-dev.sh'):
                (scripts / name).write_text('echo "' + name + '" >> "$CALL_LOG"\n')
            sudo = commands / 'sudo'
            sudo.write_text('''#!/bin/bash
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$*" in
  *'env-sync') echo 'ENV_SYNC updated';;
  *'systemctl restart dao-dev.service')
    if [[ ! -e "$RESTART_MARKER" ]]; then touch "$RESTART_MARKER"; exit 1; fi;;
esac
''')
            sudo.chmod(0o755)
            router = root / 'router.sh'
            router.write_text((ROOT / 'scripts/dao-operations.sh').read_text().replace('/opt/dao', str(app)))
            environment = {**os.environ, 'PATH': str(commands) + ':' + os.environ['PATH'],
                           'CALL_LOG': str(log), 'RESTART_MARKER': str(root / 'restart')}
            def run(operation):
                return subprocess.run(['bash', str(router), operation, '22', '1'],
                                      env=environment, capture_output=True, text=True)
            self.assertEqual(run('ops-rollback').returncode, 0)
            self.assertIn('-n /usr/local/sbin/dao-ops-admin rollback', log.read_text())
            before = log.read_bytes()
            self.assertNotEqual(run('ops-rollback; id').returncode, 0)
            self.assertEqual(log.read_bytes(), before)
            payload = app / 'ops-incoming/22-1'
            payload.mkdir(parents=True)
            (payload / 'dao-env.json').write_text('{"fictional":"not-a-real-secret"}')
            self.assertNotEqual(run('env-sync').returncode, 0)
            calls = log.read_text()
            self.assertEqual(calls.count('systemctl restart dao-dev.service'), 2)
            self.assertIn('-n /usr/local/sbin/dao-dev-admin env-restore', calls)
            self.assertIn('validate-dev.sh', calls)
            self.assertFalse(payload.exists())


class RedactionTests(unittest.TestCase):
    def test_github_http_failure_exposes_only_a_bounded_status_code(self):
        url = admin.API + '/git/ref/heads/main'
        for code, expected in [(403, 'GITHUB_HTTP_403'), (429, 'GITHUB_HTTP_429'),
                               (503, 'GITHUB_HTTP_503'), (599, 'GITHUB_HTTP_ERROR')]:
            error = urllib.error.HTTPError(url + '?fictional-secret', code,
                                           'fictional-secret', {'private': 'fictional-secret'}, None)
            with self.subTest(code=code), patch.object(admin.urllib.request, 'build_opener') as opener:
                opener.return_value.open.side_effect = error
                with self.assertRaises(admin.Halt) as caught:
                    admin.fetch(url)
                self.assertEqual(str(caught.exception), expected)

    def test_transport_failure_is_redacted_and_redirect_refusal_is_preserved(self):
        for error, expected in [(urllib.error.URLError('fictional-secret'), 'GITHUB_NETWORK_UNAVAILABLE'),
                                (TimeoutError('fictional-secret'), 'GITHUB_NETWORK_UNAVAILABLE'),
                                (admin.Halt('GITHUB_REDIRECT_REJECTED'), 'GITHUB_REDIRECT_REJECTED')]:
            with self.subTest(error=type(error).__name__), patch.object(admin.urllib.request, 'build_opener') as opener:
                opener.return_value.open.side_effect = error
                with self.assertRaises(admin.Halt) as caught:
                    admin.fetch(admin.API + '/git/ref/heads/main')
                self.assertEqual(str(caught.exception), expected)

    def test_backup_status_accepts_only_bounded_public_values(self):
        value = {'id': 'a' * 32, 'phase': 'complete', 'backup_complete': True,
                 'restore_verified': True, 'live_resumed': True, 'cleanup_complete': True,
                 'credential': 'fictional-secret', 'targets': {'private': 'metadata'}}
        self.assertNotIn('fictional-secret', json.dumps(admin.backup_status(value)))
        for field, bad in [('id', 'fictional-secret'), ('phase', 'fictional-secret'),
                           ('backup_complete', 'fictional-secret')]:
            with self.subTest(field=field), self.assertRaises(admin.Halt):
                admin.backup_status({**value, field: bad})


class AdmissionTests(unittest.TestCase):
    def api_fixture(self):
        sha = 'a' * 40
        run = {'id': 22, 'head_sha': sha, 'head_branch': 'main', 'event': 'push',
               'workflow_id': 363309541, 'path': '.github/workflows/ci.yml',
               'repository': {'full_name': 'Khaey/Dao'}, 'status': 'completed',
               'conclusion': 'success', 'updated_at': '2026-10-09T03:00:00Z'}
        approval = {'id': 33, 'body': '/dao-ops approve ' + sha, 'author_association': 'OWNER',
                    'user': {'login': 'Khaey'}, 'created_at': '2026-10-09T03:01:00Z'}
        def fetch(path):
            if path == '/git/ref/heads/main': return {'object': {'sha': sha}}
            if path.startswith('/actions/runs?'): return {'workflow_runs': [run]}
            if path == '/issues/91': return {'comments': 1}
            return [approval]
        return run, approval, fetch

    def test_approved_exact_main_after_green_ci(self):
        _, _, fetch = self.api_fixture()
        with patch.object(admin, 'api', side_effect=fetch):
            self.assertEqual(admin.admission(), {'sha': 'a' * 40, 'ci_run_id': 22, 'approval_comment_id': 33})

    def test_no_fork_pr_wrong_workflow_failure_or_early_approval(self):
        for change in [{'event': 'pull_request'}, {'head_branch': 'untrusted'},
                       {'workflow_id': 1}, {'path': '.github/workflows/other.yml'},
                       {'conclusion': 'failure'}, {'status': 'in_progress'},
                       {'head_sha': 'b' * 40}, {'repository': {'full_name': 'attacker/Dao'}}]:
            run, _, fetch = self.api_fixture()
            run.update(change)
            with patch.object(admin, 'api', side_effect=fetch), self.assertRaises(admin.Halt):
                admin.admission()
        for change in [{'user': {'login': 'other'}}, {'author_association': 'NONE'},
                       {'body': '/dao-ops approve ' + 'b' * 40}, {'body': '/dao-ops approve ' + 'a' * 40 + '\nid'},
                       {'created_at': '2026-10-09T02:59:00Z'}]:
            _, approval, fetch = self.api_fixture()
            approval.update(change)
            with patch.object(admin, 'api', side_effect=fetch), self.assertRaises(admin.Halt):
                admin.admission()


class ManifestTests(unittest.TestCase):
    def test_catalog_hashes_match_current_repository(self):
        self.assertEqual(json.loads((ROOT / 'ops/ops-release.json').read_text()), generator.generate())


if __name__ == '__main__':
    unittest.main()
