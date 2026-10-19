"""Static regression tests for the GitHub issue-comment entrypoint.

These checks require no GitHub token or third-party YAML parser.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2] / ".github" / "workflows"
CHILDREN = (
    "dev-operations.yml",
    "oce-private-provision.yml",
    "oce-cloudflare-check.yml",
    "vps-oce-plan.yml",
    "dao-monitor.yml",
)


class CommentDispatchTests(unittest.TestCase):
    def test_one_issue_comment_listener(self):
        manifests = sorted(ROOT.glob("*.yml"))
        listeners = [path.name for path in manifests
                     if "\n  issue_comment:\n" in path.read_text(encoding="utf-8")]
        self.assertEqual(listeners, ["dao-comment-dispatcher.yml"])

    def test_reusable_children_preserve_manual_entrypoints(self):
        for filename in CHILDREN:
            with self.subTest(filename=filename):
                body = (ROOT / filename).read_text(encoding="utf-8")
                self.assertIn("\n  workflow_call:\n", body)
                self.assertNotIn("\n  issue_comment:\n", body)
        for filename in ("dev-operations.yml", "oce-cloudflare-check.yml"):
            self.assertIn("\n  workflow_dispatch:\n", (ROOT / filename).read_text(encoding="utf-8"))

    def test_exact_sensitive_routes_and_monitor_are_preserved(self):
        body = (ROOT / "dao-comment-dispatcher.yml").read_text(encoding="utf-8")
        for fragment in (
            "github.actor == 'Khaey'",
            "github.event.issue.pull_request == null",
            "github.event.comment.author_association == 'OWNER'",
            "github.event.comment.body == '/dao-oce provision'",
            "github.event.comment.body == '/dao-ops oce-gateway-plan'",
            "startsWith(github.event.comment.body, '/dao-ops ')",
            "contains(github.event.comment.body, 'DAO_MONITOR_V1')",
            "uses: ./.github/workflows/dao-monitor.yml",
            "uses: ./.github/workflows/dev-operations.yml",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, body)
        self.assertEqual(body.count("uses: ./.github/workflows/"), len(CHILDREN))
        self.assertEqual(body.count("secrets: inherit"), len(CHILDREN))


if __name__ == "__main__":
    unittest.main()
