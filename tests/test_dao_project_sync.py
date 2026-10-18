"""Offline classifications for DAO GitHub Projects sync; no PAT and no network."""
import importlib.util
from pathlib import Path
from datetime import datetime, timezone, timedelta
from unittest.mock import patch
import tempfile
import json
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
        now = datetime(2026, 10, 18, tzinfo=timezone.utc)
        recent = (now - timedelta(hours=2)).isoformat()
        stale = (now - timedelta(hours=100)).isoformat()
        pr = {"pull_request": True, "state": "open", "updated_at": recent}
        self.assertEqual(sync.status(pr, now=now), "In Progress")
        self.assertEqual(sync.status({**pr, "draft": True}, now=now), "Todo")
        self.assertEqual(sync.status({**pr, "updated_at": stale}, now=now), "Todo")
        self.assertEqual(sync.status({"pull_request": True, "state": "open"}, now=now), "Todo")
        self.assertEqual(sync.status({"pull_request": True, "state": "closed", "merged_at": "now"}, now=now), "Done")
        self.assertEqual(sync.status({"pull_request": True, "state": "closed"}, now=now), "Done")
        self.assertEqual(sync.status({"state": "closed"}, now=now), "Done")
        self.assertEqual(sync.status({"state": "open"}, True, now), "Todo")
        self.assertEqual(sync.status({"state": "open"}, False, now), "Todo")
        self.assertEqual(sync.status({"state": "open", "labels": ["dao:active"], "updated_at": recent}, now=now), "In Progress")
        self.assertEqual(sync.status({"state": "open", "labels": ["dao:active"], "updated_at": stale}, now=now), "Todo")
        self.assertEqual(sync.status({"state": "open", "labels": ["dao:active"], "updated_at": recent}, True, now), "Todo")
        self.assertIn("non attesté", sync.evidence({"pull_request": True, "state": "closed", "merged_at": "now"}))
        self.assertIn("non livrée", sync.evidence({"pull_request": True, "state": "closed"}))
        self.assertIn("non comptée deux fois", sync.evidence({"state": "open"}, True, 219))

    def test_sync_overwrites_stale_in_progress_card(self):
        class FakeGithub:
            def __init__(self):
                self.updates = []
            def paged(self, path):
                if "/pulls?" in path:
                    return iter([])
                return iter([{"number": 7, "state": "open", "title": "Idle", "node_id": "node7"}])
            def graphql(self, query, **kwargs):
                self.updates.append(kwargs["input"])
                return {"updateProjectV2ItemFieldValue": {"projectV2Item": {"id": "row"}}}

        g = FakeGithub()
        fields = {"Status": {"id": "statusfield", "options": [
            {"id": "todo", "name": "Todo"}, {"id": "progress", "name": "In Progress"},
            {"id": "done", "name": "Done"}]}}
        rows = {("issue", 7): {"id": "row", "s": {"name": "In Progress"}}}
        with tempfile.TemporaryDirectory() as folder:
            reg = Path(folder) / "registry.json"
            reg.write_text(json.dumps({"missions": []}), encoding="utf-8")
            with (patch.object(sync, "get_project", return_value=("project", fields)),
                  patch.object(sync, "create_fields"),
                  patch.object(sync, "read_items", return_value=rows)):
                sync.synchronize(g, "Khaey", 3, reg, False)
        self.assertEqual(len(g.updates), 1)
        self.assertEqual(g.updates[0]["value"], {"singleSelectOptionId": "todo"})

    def test_priority_and_domain_bounded(self):
        self.assertEqual(sync.priority({"title":"P1 — corriger la validation"}), "P1")
        self.assertEqual(sync.priority({"title":"Bug sans priorité"}), "Non définie")
        self.assertEqual(sync.domain({"title":"DAO Monitor Telegram"}), "Monitoring")
        self.assertEqual(sync.domain({"title":"Back-office Gestionnaire"}), "Gestionnaire")
        self.assertEqual(sync.domain({"title":"Divers"}), "Autre")

    def test_priority_from_issue_label(self):
        self.assertEqual(sync.priority({"title": "Work", "labels": [{"name": "P1"}]}), "P1")

    def test_known_agents_present(self):
        self.assertIn("DAO Chat 1", sync.OPTIONS["Agent"])
        self.assertIn("DAO Chat 20", sync.OPTIONS["Agent"])
        self.assertIn("DAO Pilot 5", sync.OPTIONS["Agent"])
        for name in ("DAO OPT 3", "DAO Chat 21", "DAO Pilot 6", "DAO CoPilot 1"):
            self.assertIn(name, sync.OPTIONS["Agent"])

    def test_registry_agents_are_all_supported(self):
        import json
        registry = Path(__file__).resolve().parents[1] / ".github/dao-monitor-agents.json"
        missions = json.loads(registry.read_text(encoding="utf-8"))["missions"]
        known = {name.casefold() for name in sync.OPTIONS["Agent"]}
        missing = sorted({m["agent"] for m in missions if m["agent"].casefold() not in known})
        self.assertEqual(missing, [])

    def test_missing_agent_option_is_reported(self):
        class NoCall:
            def graphql(self, *args, **kwargs):
                raise AssertionError("Unexpected GraphQL mutation")
        with self.assertRaisesRegex(RuntimeError, "missing option"):
            sync.set_field(NoCall(), "project", {"id": "item", "a": None},
                           {"Agent": {"id": "f", "options": []}},
                           "Agent", "DAO OPT 3", False)

    def test_field_options_update_preserves_existing_ids(self):
        class Recorder:
            def __init__(self):
                self.calls = []
            def graphql(self, query, **kwargs):
                self.calls.append((query, kwargs))
        g = Recorder()
        fields = {"Agent": {"id": "agent-field", "options": [
            {"id": "existing-id", "name": "DAO DEV 20", "color": "BLUE", "description": "DEV"}
        ]}, "État GitHub": {"id": "e"}}
        sync.create_fields(g, "project", fields)
        updates = [kwargs["input"] for query, kwargs in g.calls
                   if "updateProjectV2Field" in query]
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0]["singleSelectOptions"][0]["id"], "existing-id")
        self.assertIn("DAO Chat 21", [x["name"] for x in updates[0]["singleSelectOptions"]])

if __name__ == "__main__":
    unittest.main()
