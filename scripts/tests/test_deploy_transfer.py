"""Offline regression checks for SSH deployment boundaries."""
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[2]
CI = (ROOT / ".github/workflows/ci.yml").read_text()
DEPLOY = CI.split("\n  deploy-dev:\n", 1)[1].split("\n  ci-timing-summary:", 1)[0]
SETUP = (ROOT / "scripts/prepare-dev-ssh.sh").read_text()
STAGE = (ROOT / "scripts/stage-dev-private-dir.sh").read_text()
class DeployTransferTests(unittest.TestCase):
    def test_host_trust_precedes_secret_access(self):
        self.assertLess(DEPLOY.index('Verify DEV SSH identity before loading protected credentials'),
                        DEPLOY.index('Prepare private DEV payload locally at 0600'))
        self.assertIn('BatchMode yes', SETUP)
        self.assertIn('StrictHostKeyChecking yes', SETUP)
    def test_remote_staging_permissions_and_isolation(self):
        for key in ('install -d -m 0700 "$root"', 'test -O "$root"',
                    'test ! -L "$root"', 'mkdir -m 0700 "$dir"',
                    'test ! -e "$dir"', '-mmin +1440'):
            self.assertIn(key, STAGE)
    def test_private_files_never_go_to_scp_container(self):
        self.assertIn('create_private("dao-env.json"', DEPLOY)
        self.assertIn('create_private("github-read-token"', DEPLOY)
        self.assertIn('os.O_EXCL', DEPLOY)
        self.assertIn('tar -xzf -', DEPLOY)
        self.assertIn('--no-same-owner --no-same-permissions', DEPLOY)
        self.assertNotIn('appleboy/scp-action', DEPLOY)
    def test_cleanup_and_rollback_remain(self):
        self.assertIn('trap cleanup EXIT', DEPLOY)
        self.assertIn('bash "$payload/ops/deploy-dev.sh"', DEPLOY)
        self.assertIn('if: always()', DEPLOY)
        self.assertIn('rm -rf -- "$RUNNER_TEMP/dao-secure-ssh"', DEPLOY)
        script=(ROOT/'ops/deploy-dev.sh').read_text()
        self.assertIn('GIT_ASKPASS=', script)
        self.assertEqual(script.count('-c credential.helper='), 2)
        self.assertIn('rm -f -- "$GIT_ASKPASS_SCRIPT" "$REPO_READ_TOKEN_FILE"', script)
if __name__ == "__main__":
    unittest.main()
