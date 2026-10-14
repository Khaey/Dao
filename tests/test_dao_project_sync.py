"""Offline classifications for DAO GitHub Projects sync; no PAT and no network."""
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / "scripts/dao_project_sync.py"
spec = importlib.util.spec_from_file_location("dao_project_sync", path)
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

class ProjectSyncTests(unittest.TestCase):
    def test_owner_ref_requires_explicit_line(self):
        self.assertEqual(sync.owner_issue("Owner issue: #161\nRefs #137"), 161)
        self.assertIsNone(sync.owner_issue("Refs #161\nOwner: CHAT 20"))
        self.assertIsNone(sync.owner_issue(""))

    def test_repository_status_not_equal_dev_deploy(self):
        self.assertEqual(sync.status({"pull_request":True,"state":"closed","merged_at":"now"}), "Done")
        self.assertEqual(sync.status({"pull_request":True,"state":"open"}), "In Progress")
        self.assertIsNone(sync.status({"pull_request":True,"state":"closed","merged_at":None}))
        self.assertEqual(sync.status({"state":"closed"}), "Done")
        self.assertEqual(sync.status({"state":"open"}, True), "In Progress")
        self.assertIsNone(sync.status({"state":"open"}, False))
        self.assertIn("non attesté", sync.evidence({"pull_request":True,"state":"closed","merged_at":"now"}))
        self.assertIn("non livrée", sync.evidence({"pull_request":True,"state":"closed"}))

    def test_priority_and_domain_bounded(self):
        self.assertEqual(sync.priority({"title":"P1 — corriger la validation"}), "P1")
        self.assertIsNone(sync.priority({"title":"Bug sans priorité"}))
        self.assertEqual(sync.domain({"title":"DAO Monitor Telegram"}), "Monitoring")
        self.assertEqual(sync.domain({"title":"Back-office Gestionnaire"}), "Gestionnaire")
        self.assertIsNone(sync.domain({"title":"Divers"}))

    def test_known_agents_present(self):
        self.assertIn("DAO Chat 1", sync.OPTIONS["Agent"])
        self.assertIn("DAO Chat 20", sync.OPTIONS["Agent"])
        self.assertIn("DAO Pilot 5", sync.OPTIONS["Agent"])

if __name__ == "__main__":
    unittest.main()
