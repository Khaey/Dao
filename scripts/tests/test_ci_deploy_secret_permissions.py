"""Fail-closed security checks for native DEV OpenSSH deployments."""
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[2]
CI = (ROOT / ".github/workflows/ci.yml").read_text()
DEPLOY = CI.split("\n  deploy-dev:\n", 1)[1].split("\n  ci-timing-summary:", 1)[0]
SETUP = (ROOT / "scripts/prepare-dev-ssh.sh").read_text()
STAGE = (ROOT / "scripts/stage-dev-private-dir.sh").read_text()
class DeploymentSecretPermissionsTest(unittest.TestCase):
    def test_verified_host_key_is_mandatory(self):
        self.assertIn('DEV_SSH_HOST_FINGERPRINT:?', SETUP)
        self.assertIn('"$observed" != "$trusted_pin"', SETUP)
        self.assertIn('scripts/normalize-dev-host-fingerprint.py', SETUP)
        self.assertIn('StrictHostKeyChecking yes', SETUP)
        self.assertIn('UserKnownHostsFile', SETUP)
        self.assertNotIn('StrictHostKeyChecking no', SETUP + DEPLOY)
        self.assertIn('secrets.DEV_SSH_HOST_FINGERPRINT', DEPLOY)
    def test_no_runtime_third_party_client(self):
        self.assertNotIn('appleboy/', DEPLOY)
        self.assertNotIn('drone-ssh', DEPLOY)
        self.assertIn('ssh -F', DEPLOY)
    def test_owner_only_protected_values(self):
        self.assertIn('os.open(root / name, flags, 0o600)', DEPLOY)
        self.assertIn('mkdir -m 0700 "$DAO_PRIVATE_STAGING"', DEPLOY)
        self.assertIn('test -O "$parent"', STAGE)
        self.assertIn('test ! -L "$parent"', STAGE)
        self.assertIn('mkdir -m 0700 "$dir"', STAGE)
        self.assertNotIn('chmod 0644', DEPLOY)
        self.assertNotIn('set -x', DEPLOY)
        self.assertIn('Remove runner private credentials and payload', DEPLOY)
    def test_deploy_and_rollback_are_retained(self):
        self.assertIn('bash "$payload/ops/deploy-dev.sh"', DEPLOY)
        self.assertIn('trap cleanup EXIT', DEPLOY)
        self.assertIn('Remove private DEV environment payload from host', DEPLOY)
if __name__ == "__main__":
    unittest.main()
