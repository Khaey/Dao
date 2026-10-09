"""Exercise CI's private staging and tar layout without secrets, Docker or SSH."""
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / '.github/workflows/ci.yml').read_text()
DEPLOY = WORKFLOW.split('\n  deploy-dev:\n', 1)[1].split('\n  ci-timing-summary:', 1)[0]
STEPS = dict(re.findall(r'^      - name: ([^\n]+)\n(.*?)(?=^      - name: |\Z)', DEPLOY, re.M | re.S))


def render(value, run='123', attempt='2'):
    for key, replacement in {'github.run_id': run, 'github.run_attempt': attempt, 'github.sha': 'a' * 40}.items():
        value = value.replace('${{ ' + key + ' }}', replacement)
    return value


def step_script(name, field='run'):
    # Read only the literal shell blocks under the named deployment step;
    # no optional YAML package is needed by the Ubuntu CI unit-test job.
    block = re.split(r'^ +'+field+r': \|\n', STEPS[name], maxsplit=1, flags=re.M)[1]
    return textwrap.dedent(block)


class DeployTransferTests(unittest.TestCase):
    def shell(self, script, cwd, **overrides):
        env = {**os.environ, 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2',
               'RESEND_API_KEY': 'fictional-key', 'DAO_EMAIL_FROM': 'Test <test@example.invalid>', **overrides}
        result = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', render(script)],
                                cwd=cwd, env=env, capture_output=True, text=True, timeout=10)
        self.assertNotIn('fictional-key', result.stdout + result.stderr)
        return result

    def prepare(self, runner):
        result = self.shell(step_script('Prepare protected DEV environment payload'), runner)
        self.assertEqual(result.returncode, 0, result.stderr)
        return runner / 'ops-incoming/123-2/dao-env.json'

    def test_private_creation_and_run_attempt_isolation(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = Path(directory)
            payload = self.prepare(runner)
            self.assertEqual(payload.stat().st_mode & 0o777, 0o600)
            self.assertEqual(set(json.loads(payload.read_text())), {'RESEND_API_KEY', 'DAO_EMAIL_FROM', 'DAO_PUBLIC_URL'})
            result = self.shell(step_script('Prepare protected DEV environment payload'), runner, GITHUB_RUN_ATTEMPT='3')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((runner / 'ops-incoming/123-3/dao-env.json').exists())
            self.assertFalse((runner / 'dao-env.json').exists())
            # Always-cleanup must remove only this attempt, including after a failed SCP.
            cleanup = STEPS['Remove private DEV environment payload from runner']
            self.assertIn('if: always()', cleanup)
            result = self.shell(cleanup.split('        run: ', 1)[1], runner)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(payload.parent.exists())
            self.assertTrue((runner / 'ops-incoming/123-3/dao-env.json').exists())

    def test_missing_configuration_creates_no_private_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = Path(directory)
            result = self.shell(step_script('Prepare protected DEV environment payload'), runner, RESEND_API_KEY='')
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(list(runner.rglob('dao-env.json')), [])

    def test_one_archive_preserves_package_bytes_and_both_host_destinations(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            runner, host = tmp / 'runner', tmp / 'host'
            runner.mkdir()
            host.mkdir()
            payload = self.prepare(runner)
            readable = self.shell(step_script('Make private environment payload readable to SCP container'), runner)
            self.assertEqual(readable.returncode, 0, readable.stderr)
            self.assertEqual(payload.stat().st_mode & 0o777, 0o644)
            self.assertTrue(all(parent.stat().st_mode & 0o111 == 0o111 for parent in [payload.parent, payload.parent.parent]))
            package = runner / 'dao-deploy-package-123-2.tar.gz'
            package.write_bytes(b'opaque verified build artifact\n')
            transfers = [block for block in STEPS.values() if 'uses: appleboy/scp-action@' in block]
            self.assertEqual(len(transfers), 1)
            transfer = transfers[0]
            self.assertIn('appleboy/scp-action@917f8b81dfc1ccd331fef9e2d61bdc6c8be94634', transfer)
            self.assertEqual(re.search(r'^          target: (.+)$', transfer, re.M)[1], '/opt/dao')
            sources = render(re.search(r'^          source: (.+)$', transfer, re.M)[1]).split(',')
            # drone-scp 1.6.14 uses these GNU tar operations, with no path stripping.
            archive = tmp / 'transport.tar.gz'
            subprocess.run(['tar', '-zcf', str(archive), *sources], cwd=runner, check=True, capture_output=True)
            with tarfile.open(archive) as stream:
                self.assertEqual(set(stream.getnames()), {package.name, 'ops-incoming/123-2/dao-env.json'})
            subprocess.run(['tar', '-zxf', str(archive), '--overwrite', '-C', str(host)], check=True, capture_output=True)
            self.assertEqual((host / package.name).read_bytes(), package.read_bytes())
            self.assertEqual((host / 'ops-incoming/123-2/dao-env.json').read_bytes(), payload.read_bytes())
            self.assertFalse((host / 'dao-env.json').exists())

    def test_partial_transfer_is_cleaned_without_release_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Path(directory)
            payload = host / 'ops-incoming/123-2/dao-env.json'
            payload.parent.mkdir(parents=True)
            payload.write_text('{}')
            # Missing build package: the real SSH block must fail and its trap
            # must delete the private JSON before any deployment is invoked.
            script = render(step_script('Deploy verified revision over SSH', 'script')).replace('/opt/dao', str(host))
            result = self.shell(script, host)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(payload.parent.exists())
            self.assertFalse((host / 'releases').exists())

    def test_host_always_cleanup_is_idempotent_after_a_transfer_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Path(directory)
            payload = host / 'ops-incoming/123-2/dao-env.json'
            payload.parent.mkdir(parents=True)
            payload.write_text('{}')
            other = host / 'ops-incoming/123-3/dao-env.json'
            other.parent.mkdir()
            other.write_text('{}')
            self.assertIn('if: always()', STEPS['Remove private DEV environment payload from host'])
            script = render(step_script('Remove private DEV environment payload from host', 'script')).replace('/opt/dao', str(host))
            for _ in range(2):
                result = self.shell(script, host)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(payload.parent.exists())
            self.assertTrue(other.exists())


if __name__ == '__main__':
    unittest.main()
