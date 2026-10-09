import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


admin = module('admin', 'ops/dao-dev-admin.py')
preflight = module('preflight', 'scripts/dao_task_check.py')


class EnvironmentTests(unittest.TestCase):
    def test_preserve_unrelated_and_idempotent_sender(self):
        original = '# keep\nDAO_SUPABASE_SECRET_KEY=unchanged\nRESEND_API_KEY=old_key_value\n'
        values = {'RESEND_API_KEY': 'new_key_value', 'DAO_EMAIL_FROM': 'D.A.O <test@example.invalid>'}
        updated = admin.rewrite_env(original, values)
        self.assertIn('DAO_SUPABASE_SECRET_KEY=unchanged', updated)
        self.assertIn("DAO_EMAIL_FROM='D.A.O <test@example.invalid>'", updated)
        self.assertNotIn('old_key_value', updated)
        self.assertEqual(updated, admin.rewrite_env(updated, values))

    def test_reject_unsupported_or_malicious_updates(self):
        for values in [{}, {'DAO_SUPABASE_SECRET_KEY': 'changed'}, {'DAO_EMAIL_FROM': '$(id)@example.invalid'}, {'DAO_EMAIL_FROM': 'a@b\nEVIL=yes'}, {'DAO_PUBLIC_URL': 'https://other.invalid'}, {'RESEND_API_KEY': 'a\x00b'}, [], {'RESEND_API_KEY': None}]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                admin.rewrite_env('', values)

    def test_reject_duplicate_and_multiline_keys(self):
        for original in ['RESEND_API_KEY=abc\nRESEND_API_KEY=def\n', "RESEND_API_KEY='unfinished\nline'\n"]:
            with self.assertRaises(ValueError):
                admin.rewrite_env(original, {'RESEND_API_KEY': 'new_key_value'})


class ImpactTests(unittest.TestCase):
    def test_docs_need_no_application_build(self):
        result = preflight.impact(['AGENTS.md', 'docs/platform-operations.md'])
        self.assertEqual(result['kind'], 'docs')
        self.assertFalse(any('npm' in c for c in result['checks']))

    def test_mixed_change_keeps_full_gate(self):
        result = preflight.impact(['docs/a.md', 'dao-frontend/app/page.tsx', 'dao-backend/src/a.ts', '.github/workflows/ci.yml'])
        self.assertTrue(any('unittest' in c for c in result['checks']))
        self.assertTrue(any('npm test' in c for c in result['checks']))
        self.assertTrue(any('tsc' in c for c in result['checks']))
        self.assertIn('all existing required CI checks on final PR head', result['checks'])


class SmokeTests(unittest.TestCase):
    def run_smoke(self, mode, target='http://127.0.0.1:3000', *options):
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            curl = tmp / 'curl'
            curl.write_text('''#!/usr/bin/env bash
echo curl-call >> "$SMOKE_CALLS"
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then shift; body="$1"; fi
  shift
done
case "$SMOKE_MOCK" in
 good) printf '<html><script src="/_next/static/a.js"></script></html>' > "$body"; printf 200 ;;
 wrong) printf 'upstream error secret content' > "$body"; printf 200 ;;
 failed) printf 'private error' > "$body"; printf 503 ;;
esac
''')
            curl.chmod(0o755)
            (tmp / 'sleep').write_text('#!/bin/sh\nexit 0\n')
            (tmp / 'sleep').chmod(0o755)
            result = subprocess.run(['bash', str(ROOT / 'scripts/validate-dev.sh'), target, *options], env={**os.environ, 'PATH': directory + ':' + os.environ['PATH'], 'SMOKE_MOCK': mode, 'SMOKE_CALLS': str(tmp / 'calls')}, capture_output=True, text=True, timeout=10)
            result.http_calls = len((tmp / 'calls').read_text().splitlines()) if (tmp / 'calls').exists() else 0
            return result

    def test_all_routes_pass(self):
        result = self.run_smoke('good')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.count('SMOKE PASS'), 3)

    def test_http_200_is_not_enough(self):
        result = self.run_smoke('wrong')
        self.assertEqual(result.returncode, 1)
        self.assertNotIn('secret content', result.stdout + result.stderr)

    def test_failure_is_bounded_and_private(self):
        result = self.run_smoke('failed')
        self.assertEqual(result.returncode, 1)
        self.assertNotIn('private error', result.stdout + result.stderr)

    def test_arbitrary_target_rejected(self):
        self.assertEqual(self.run_smoke('good', 'https://production.invalid').returncode, 2)

    def test_one_pass_does_not_poll_or_print_failure_body(self):
        failed = self.run_smoke('failed', 'http://127.0.0.1:3000', '--once')
        self.assertEqual(failed.returncode, 1)
        self.assertEqual(failed.http_calls, 1)
        self.assertNotIn('private error', failed.stdout + failed.stderr)
        ready = self.run_smoke('good', 'http://127.0.0.1:3000', '--once')
        self.assertEqual(ready.returncode, 0)
        self.assertEqual(ready.http_calls, 3)
        self.assertEqual(self.run_smoke('failed').http_calls, 15)

    def test_unknown_smoke_mode_or_extra_arguments_are_rejected_before_http(self):
        for options in [('--unknown',), ('--once', 'extra')]:
            result = self.run_smoke('good', 'http://127.0.0.1:3000', *options)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.http_calls, 0)


class DeploymentTests(unittest.TestCase):
    def deploy(self, smoke_failure=False, stale=False, env_sync=False, env_sync_failure=False, gateway_plan_grant=True, gateway_plan_failure=False, recovery_failure=None, previous=True, primary_status=1):
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            app = tmp / 'app'
            app.mkdir()
            if previous:
                (app / 'releases/previous/scripts').mkdir(parents=True)
                (app / 'releases/previous/scripts/validate-dev.sh').write_text('echo old-verifier-used >> "$MOCK_CALLS"\nexit 88\n')
                (app / 'current').symlink_to(app / 'releases/previous')
            env_file = tmp / 'dev.env'
            env_file.write_text('NEXT_PUBLIC_SUPABASE_URL=https://test.invalid\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy\nDAO_SUPABASE_SECRET_KEY=dummy\n')
            binary = tmp / 'bin'
            binary.mkdir()
            revision = 'a' * 40
            git = '''#!/usr/bin/env python3
import os, pathlib, sys
a=sys.argv[1:]
if a[0]=='init': pathlib.Path(a[1]).mkdir(parents=True)
elif a[0]=='ls-remote': print(os.environ['MOCK_MAIN'] + '\\trefs/heads/main')
elif a[:1]==['-C']:
 p=pathlib.Path(a[1]); command=a[2]
 if command=='rev-parse': print(os.environ['MOCK_REV'])
 if command=='checkout':
  for package in ['dao-backend','dao-frontend']:
   (p/package).mkdir(exist_ok=True)
   for name in ['package.json','package-lock.json']: (p/package/name).write_text('{}')
  (p/'scripts').mkdir()
  (p/'scripts/validate-dev.sh').write_text('if [ "${2:-}" = --once ]; then echo "recovery-check $*" >> "$MOCK_CALLS"; echo fictional-secret >&2; exit '+os.environ['MOCK_RECOVERY_SMOKE']+'; fi\\nexit '+os.environ['MOCK_SMOKE']+'\\n')
  (p/'scripts/dev-status.sh').write_text('echo status-mock\\n')
'''
            commands = {
                'git': git,
                'node': '#!/bin/sh\ncase "$1" in --version) echo v22.1.0;; -p) echo linux-x64;; *) exit 0;; esac\n',
                'npm': '#!/bin/sh\nif [ "$1" = --version ]; then echo 10.0.0; else mkdir -p node_modules; fi\n',
                'sudo': '''#!/usr/bin/env python3
import os, pathlib, sys
a=sys.argv[1:]
with open(os.environ['MOCK_CALLS'],'a') as log: log.write('sudo-call '+' '.join(a)+'\\n')
fault=os.environ['MOCK_RECOVERY_FAILURE']
if a[-1]=='env-restore' and fault=='env':
 print('fictional-secret',file=sys.stderr); sys.exit(6)
if a[-2:]==['restart','dao-dev.service']:
 counter=pathlib.Path(os.environ['MOCK_RESTARTS'])
 count=int(counter.read_text())+1 if counter.exists() else 1
 counter.write_text(str(count))
 if count>1 and fault=='restart':
  print('fictional-secret',file=sys.stderr); sys.exit(8)
if len(a)>1 and a[1]=='-l': sys.exit(0 if os.environ['MOCK_PLAN_GRANT']=='1' else 1)
if a[-1]=='oce-gateway-plan':
 if os.environ['MOCK_PLAN_FAILURE']=='1': sys.exit(1)
 print('{"oce_gateway_host_plan_ready":true}')
if a[-1]=='env-sync':
 if os.environ['MOCK_ENV_SYNC_FAILURE']=='1': sys.exit(5)
 print('ENV_SYNC updated keys=DAO_EMAIL_FROM,DAO_PUBLIC_URL,RESEND_API_KEY')
''',
            }
            for name, fault in [('ln','link_create'), ('mv','link'), ('rm','cleanup')]:
                commands[name] = '''#!/usr/bin/env python3
import os, pathlib, sys
a=sys.argv[1:]
target=any('.current-rollback-' in p for p in a) if sys.argv[0].endswith(('ln','mv')) else any(pathlib.Path(p).name==os.environ['MOCK_REV']+'-1-1' for p in a)
if os.environ['MOCK_RECOVERY_FAILURE']==''' + repr(fault) + ''' and target:
 print('fictional-secret',file=sys.stderr); sys.exit(9)
os.execv('/usr/bin/''' + name + "', ['" + name + "', *a])\n"
            for name, value in commands.items():
                (binary / name).write_text(value)
                (binary / name).chmod(0o755)
            script = (ROOT / 'ops/deploy-dev.sh').read_text().replace('APP_ROOT=/opt/dao', 'APP_ROOT=' + str(app)).replace('ENV_FILE=/etc/dao/dao-dev.env', 'ENV_FILE=' + str(env_file)).replace('/usr/local/sbin/dao-dev-admin', '"$MOCK_ADMIN"')
            path = tmp / 'deploy.sh'
            path.write_text(script)
            artifact = tmp / 'artifact'
            (artifact / '.next').mkdir(parents=True)
            (artifact / '.next/BUILD_ID').write_text('test-build')
            (artifact / '.dao-deploy-manifest.json').write_text('{}')
            payload = app / 'ops-incoming' / 'test-run' / 'dao-env.json'
            if env_sync:
                payload.parent.mkdir(parents=True)
                payload.write_text('{"RESEND_API_KEY":"new_key_value","DAO_EMAIL_FROM":"D.A.O <test@example.invalid>","DAO_PUBLIC_URL":"https://dao-dev.logiclab.fr"}\n')
            admin_path = tmp / 'dao-dev-admin'
            admin_path.write_text('#!/bin/sh\nexit 0\n')
            admin_path.chmod(0o755)
            calls = tmp / 'calls'
            args = ['bash', str(path), revision, '1', '1', str(artifact)]
            if env_sync:
                args.append(str(payload))
            result = subprocess.run(args, env={**os.environ, 'PATH': str(binary) + ':' + os.environ['PATH'], 'MOCK_ADMIN': str(admin_path), 'MOCK_MAIN': 'b' * 40 if stale else revision, 'MOCK_REV': revision, 'MOCK_SMOKE': str(primary_status) if smoke_failure else '0', 'MOCK_RECOVERY_SMOKE': '7' if recovery_failure=='http' else '0', 'MOCK_RECOVERY_FAILURE': recovery_failure or '', 'MOCK_RESTARTS': str(tmp / 'restarts'), 'MOCK_ENV_SYNC_FAILURE': '1' if env_sync_failure else '0', 'MOCK_PLAN_GRANT': '1' if gateway_plan_grant else '0', 'MOCK_PLAN_FAILURE': '1' if gateway_plan_failure else '0', 'MOCK_CALLS': str(calls)}, capture_output=True, text=True, timeout=15)
            result.resource_state = {'current_exists': (app / 'current').exists(),
                                     'candidate_exists': (app / 'releases' / (revision+'-1-1')).exists(),
                                     'rollback_link_exists': (app / '.current-rollback-1-1').is_symlink()}
            call_log = calls.read_text() if calls.exists() else ''
            return result, (app / 'current').resolve().name, call_log.count('sudo-call'), call_log

    def test_success_activates_exact_revision(self):
        result, active, calls, log = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(active, 'a' * 40 + '-1-1')
        self.assertIn('DEPLOY_BUILD source=verified_ci_artifact', result.stdout)
        self.assertIn('oce_gateway_host_plan_ready', result.stdout)
        self.assertIn('oce-gateway-plan', log)
        self.assertEqual(calls, 4)

    def test_post_deploy_plan_needs_no_repetitive_root_command(self):
        result, active, calls, log = self.deploy(gateway_plan_grant=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(active, 'a' * 40 + '-1-1')
        self.assertIn('bootstrap_required', result.stdout)
        self.assertNotIn('sudo-call -n "', log)
        self.assertEqual(calls, 3)

    def test_post_deploy_monitor_failure_does_not_break_healthy_release(self):
        result, active, calls, log = self.deploy(gateway_plan_failure=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(active, 'a' * 40 + '-1-1')
        self.assertIn('"check_failed"', result.stdout)
        self.assertIn('"non_blocking":true', result.stdout)
        self.assertEqual(calls, 4)

    def test_http_failure_rolls_back(self):
        result, active, calls, _ = self.deploy(smoke_failure=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(active, 'previous')
        self.assertEqual(calls, 3)
        self.assertEqual(self.recovery(result), {'deploy_recovery': 'complete', 'original_status': 1,
                         'release': 'restored', 'environment': 'unchanged', 'restart': 'complete',
                         'readiness': 'passed', 'cleanup': 'complete'})

    def test_new_main_prevents_stale_activation(self):
        result, active, calls, _ = self.deploy(stale=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('DEPLOY_SKIPPED reason=main_advanced', result.stdout)
        self.assertEqual(active, 'previous')
        self.assertEqual(calls, 0)

    def test_environment_sync_rolls_back_with_failed_readiness(self):
        result, active, calls, call_log = self.deploy(smoke_failure=True, env_sync=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(active, 'previous')
        self.assertIn('DEPLOY_ENV_SYNC result=updated keys=DAO_EMAIL_FROM,DAO_PUBLIC_URL,RESEND_API_KEY', result.stdout)
        self.assertIn('dao-dev-admin env-restore', call_log)
        self.assertEqual(calls, 5)

    def test_environment_sync_failure_does_not_leave_prepared_release(self):
        result, active, calls, _ = self.deploy(env_sync=True, env_sync_failure=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(active, 'previous')
        self.assertEqual(calls, 1)
        self.assertEqual(self.recovery(result)['environment'], 'unverified')
        self.assertEqual(self.recovery(result)['deploy_recovery'], 'incomplete')

    def recovery(self, result):
        rows = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{"deploy_recovery":')]
        self.assertEqual(len(rows), 1, result.stdout + result.stderr)
        self.assertNotIn('fictional-secret', result.stdout + result.stderr)
        return rows[0]

    def test_recovery_faults_preserve_original_failure_and_report_incomplete(self):
        for fault, failed_field in [('link_create','release'), ('link','release'), ('env','environment'),
                                    ('restart','restart'), ('http','readiness')]:
            with self.subTest(fault=fault):
                result, active, calls, log = self.deploy(smoke_failure=True, env_sync=True,
                                                        recovery_failure=fault, primary_status=17)
                row = self.recovery(result)
                self.assertEqual(result.returncode, 17)
                self.assertEqual(row['original_status'], 17)
                self.assertEqual(row['deploy_recovery'], 'incomplete')
                self.assertEqual(row[failed_field], 'failed')
                self.assertIn('env-restore', log)  # Even a failed link step cannot abort the later steps.
                self.assertEqual(log.count('restart dao-dev.service'), 2)
                self.assertEqual(active, 'a'*40+'-1-1' if fault.startswith('link') else 'previous')
                self.assertTrue(result.resource_state['candidate_exists'])
                self.assertFalse(result.resource_state['rollback_link_exists'])
                self.assertNotIn('old-verifier-used', log)
                if fault in ('link_create','link','env','restart'):
                    self.assertEqual(row['readiness'], 'not_checked')

    def test_no_previous_release_is_not_reported_as_recovered(self):
        result, active, calls, log = self.deploy(smoke_failure=True, previous=False)
        row = self.recovery(result)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(row['release'], 'no_previous')
        self.assertEqual(row['deploy_recovery'], 'incomplete')
        self.assertEqual(row['readiness'], 'not_checked')
        self.assertFalse(result.resource_state['current_exists'])
        self.assertTrue(result.resource_state['candidate_exists'])
        self.assertEqual(log.count('restart dao-dev.service'), 1)

    def test_failed_cleanup_is_reported_without_replacing_original_error(self):
        result, active, calls, log = self.deploy(env_sync=True, env_sync_failure=True, recovery_failure='cleanup')
        row = self.recovery(result)
        self.assertEqual(result.returncode, 5)
        self.assertEqual(row['original_status'], 5)
        self.assertEqual(row['cleanup'], 'failed')
        self.assertEqual(row['environment'], 'unverified')
        self.assertEqual(row['deploy_recovery'], 'incomplete')
        self.assertEqual(active, 'previous')
        self.assertTrue(result.resource_state['candidate_exists'])
        self.assertNotIn('env-restore', log)



class VpsOwnerPlanWorkflowTests(unittest.TestCase):
    def test_read_only_plan_requires_exact_owner_and_issue_comment(self):
        workflow = (ROOT / '.github/workflows/vps-oce-plan.yml').read_text()
        self.assertIn('issue_comment:', workflow)
        self.assertIn('types: [created]', workflow)
        self.assertIn('github.event.issue.number == 58', workflow)
        self.assertIn('github.event.issue.pull_request == null', workflow)
        self.assertIn("github.actor == 'Khaey'", workflow)
        self.assertIn("github.event.comment.body == '/dao-ops oce-gateway-plan'", workflow)
        self.assertIn('environment: dev', workflow)
        self.assertIn('group: dao-dev-operations', workflow)
        self.assertIn('secrets.DEV_SSH_KEY', workflow)
        self.assertIn('sudo -n /usr/local/sbin/dao-dev-admin oce-gateway-plan', workflow)
        self.assertNotIn('gateway-host apply', workflow)
        self.assertNotIn('sudo -n bash', workflow)
        self.assertNotIn('github.event.comment.body }', workflow)



if __name__ == '__main__':
    unittest.main()
