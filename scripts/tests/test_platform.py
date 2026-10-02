import importlib.util
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
    def run_smoke(self, mode, target='http://127.0.0.1:3000'):
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            curl = tmp / 'curl'
            curl.write_text('''#!/usr/bin/env bash
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
            return subprocess.run(['bash', str(ROOT / 'scripts/validate-dev.sh'), target], env={**os.environ, 'PATH': directory + ':' + os.environ['PATH'], 'SMOKE_MOCK': mode}, capture_output=True, text=True, timeout=10)

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


class DeploymentTests(unittest.TestCase):
    def deploy(self, smoke_failure=False, stale=False):
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            app = tmp / 'app'
            app.mkdir()
            (app / 'releases/previous').mkdir(parents=True)
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
  (p/'scripts/validate-dev.sh').write_text('exit '+os.environ['MOCK_SMOKE']+'\\n')
  (p/'scripts/dev-status.sh').write_text('echo status-mock\\n')
'''
            commands = {
                'git': git,
                'node': '#!/bin/sh\ncase "$1" in --version) echo v22.1.0;; -p) echo linux-x64;; *) exit 0;; esac\n',
                'npm': '#!/bin/sh\nif [ "$1" = --version ]; then echo 10.0.0; else mkdir -p node_modules; fi\n',
                'sudo': '#!/bin/sh\nprintf "sudo-call\\n" >> "$MOCK_CALLS"\nexit 0\n',
            }
            for name, value in commands.items():
                (binary / name).write_text(value)
                (binary / name).chmod(0o755)
            script = (ROOT / 'ops/deploy-dev.sh').read_text().replace('APP_ROOT=/opt/dao', 'APP_ROOT=' + str(app)).replace('ENV_FILE=/etc/dao/dao-dev.env', 'ENV_FILE=' + str(env_file))
            path = tmp / 'deploy.sh'
            path.write_text(script)
            artifact = tmp / 'artifact'
            (artifact / '.next').mkdir(parents=True)
            (artifact / '.next/BUILD_ID').write_text('test-build')
            (artifact / '.dao-deploy-manifest.json').write_text('{}')
            calls = tmp / 'calls'
            result = subprocess.run(['bash', str(path), revision, '1', '1', str(artifact)], env={**os.environ, 'PATH': str(binary) + ':' + os.environ['PATH'], 'MOCK_MAIN': 'b' * 40 if stale else revision, 'MOCK_REV': revision, 'MOCK_SMOKE': '1' if smoke_failure else '0', 'MOCK_CALLS': str(calls)}, capture_output=True, text=True, timeout=15)
            return result, (app / 'current').resolve().name, calls.read_text().count('sudo-call') if calls.exists() else 0

    def test_success_activates_exact_revision(self):
        result, active, calls = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(active, 'a' * 40 + '-1-1')
        self.assertIn('DEPLOY_BUILD source=verified_ci_artifact', result.stdout)
        self.assertEqual(calls, 2)

    def test_http_failure_rolls_back(self):
        result, active, calls = self.deploy(smoke_failure=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(active, 'previous')
        self.assertEqual(calls, 3)

    def test_new_main_prevents_stale_activation(self):
        result, active, calls = self.deploy(stale=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('DEPLOY_SKIPPED reason=main_advanced', result.stdout)
        self.assertEqual(active, 'previous')
        self.assertEqual(calls, 0)


if __name__ == '__main__':
    unittest.main()

