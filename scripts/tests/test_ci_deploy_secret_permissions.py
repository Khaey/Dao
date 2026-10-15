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

    def test_dev_deploy_keeps_host_cleanup(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("Remove private DEV environment payload from host", workflow)
        self.assertIn("if: always()", workflow)


if __name__ == "__main__":
    unittest.main()
