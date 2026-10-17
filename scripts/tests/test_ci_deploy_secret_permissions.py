"""Regression checks for protected deployment payload handling.

The deployment workflow must not make environment payloads or repository tokens
world-readable on the runner. Run with:
    python3 -m unittest scripts.tests.test_ci_deploy_secret_permissions
"""
from pathlib import Path
import re
import unittest

WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml"


class DeploymentSecretPermissionsTest(unittest.TestCase):
    @staticmethod
    def workflow_step(workflow, name):
        match = re.search(
            rf"^      - name: {re.escape(name)}\n.*?(?=^      - name:|^  [a-zA-Z0-9_-]+:|\Z)",
            workflow,
            flags=re.MULTILINE | re.DOTALL,
        )
        if match is None:
            raise AssertionError(f"Missing workflow step: {name}")
        return match.group(0)

    def test_sensitive_files_are_not_made_world_readable(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        sensitive_names = ("dao-env.json", "github-read-token")
        for line in workflow.splitlines():
            if re.search(r"\bchmod\s+(?:0?644|a\+r|o\+r)\b", line):
                for filename in sensitive_names:
                    with self.subTest(filename=filename, line=line.strip()):
                        self.assertNotIn(
                            filename, line,
                            "Do not grant general read access to protected payloads",
                        )

    def test_scp_sources_do_not_include_credentials(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        for line in workflow.splitlines():
            if line.lstrip().startswith("source:"):
                with self.subTest(line=line.strip()):
                    self.assertNotIn("github-read-token", line)
                    self.assertNotIn("dao-env.json", line)

    def test_credentials_not_added_to_deploy_artifacts(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        for line in workflow.splitlines():
            if line.lstrip().startswith("path:") and "ops-incoming" in line:
                self.fail("Private deployment credentials must not enter artifacts")

    def test_dev_deploy_keeps_host_cleanup(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("Remove private DEV environment payload from host", workflow)
        self.assertIn("if: always()", workflow)

    def test_private_payload_is_created_only_on_host_with_private_modes(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        step = self.workflow_step(
            workflow, "Transfer protected DEV environment payload over SSH"
        )
        self.assertRegex(
            step, r"uses: appleboy/ssh-action@[0-9a-f]{40}(?:\s|$)"
        )
        self.assertIn(
            "envs: RESEND_API_KEY,DAO_EMAIL_FROM,DAO_REPO_READ_TOKEN", step
        )
        self.assertIn("umask 077", step)
        self.assertIn('test -O "$payload_parent"', step)
        self.assertIn('test -z "$(find "$payload_parent" -maxdepth 0 -perm /002', step)
        self.assertIn('test -O "$payload_root"', step)
        self.assertIn('stat -c \'%a\' "$payload_root"', step)
        self.assertIn("-mmin +1440 -regextype posix-extended", step)
        self.assertIn("-regex '.*/[0-9]+-[0-9]+'", step)
        self.assertIn('mkdir -m 0700 "$payload_dir"', step)
        self.assertIn("os.open(path, flags, 0o600)", step)
        self.assertIn("debug: false", step)
        self.assertIn("capture_stdout: false", step)

    def test_private_payload_transfer_does_not_log_secret_variables(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        step = self.workflow_step(
            workflow, "Transfer protected DEV environment payload over SSH"
        )
        self.assertNotRegex(step, r"\bset\s+-[^\n]*x")
        for variable in ("RESEND_API_KEY", "DAO_EMAIL_FROM", "DAO_REPO_READ_TOKEN"):
            with self.subTest(variable=variable):
                self.assertNotRegex(
                    step,
                    rf"\b(?:echo|printf)\b[^\n]*\${{{variable}}}|"
                    rf"\b(?:echo|printf)\b[^\n]*\${variable}\b",
                )


if __name__ == "__main__":
    unittest.main()
