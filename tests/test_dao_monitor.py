"""Offline unit tests: no network and no Telegram token required."""
import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import dao_monitor as dm


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.config = dm.configuration()
        self.mission = dm.mission_for(58, self.config)
        self.active = {"id": 123, "created_at": "2026-10-09T00:00:00Z",
                       "user": {"login": "Khaey"},
                       "body": "DAO_MONITOR_V1\nagent: DAO DEV 20\n"
                               "status: ACTIVE\nsummary: développement"}

    def comment_event(self, body, user="Khaey", issue=58):
        return {"action": "created", "issue": {"number": issue},
                "comment": {"user": {"login": user}, "body": body,
                            "html_url": "https://github.com/Khaey/Dao/issues/58#issuecomment-123"}}

    def test_strict_checkpoint(self):
        self.assertIsNone(dm.checkpoint("Je suis bloqué depuis 1h"))
        self.assertIsNone(dm.checkpoint("DAO_MONITOR_V1\nagent: A\nstatus: DONE"))
        self.assertIsNone(dm.checkpoint("DAO_MONITOR_V1\nagent: A\nstatus: DONE\nsummary: x\npassword:secret"))
        self.assertIsNone(dm.checkpoint("DAO_MONITOR_V1\nagent: A\nstatus: DONE\nstatus: BLOCKED\nsummary: x"))
        self.assertEqual(dm.checkpoint("DAO_MONITOR_V1\nagent: DAO DEV 20\nstatus: DONE\nsummary: livré")["status"], "DONE")

    def test_blocked_notification(self):
        event = self.comment_event("DAO_MONITOR_V1\nagent: DAO DEV 20\nstatus: BLOCKED\nsummary: autorisation manquante")
        self.assertIn("⛔ DAO DEV 20", dm.classify("issue_comment", event, self.config))

    def test_decision_pilot(self):
        event = self.comment_event("DAO_MONITOR_V1\nagent: DAO Pilot 3\nstatus: DECISION\nsummary: arbitrage", issue=89)
        result = dm.classify("issue_comment", event, self.config)
        self.assertIn("DAO Pilot 3", result)

    def test_reject_unknown_author(self):
        event = self.comment_event("DAO_MONITOR_V1\nagent: DAO DEV 20\nstatus: BLOCKED\nsummary: bloque", user="outside")
        self.assertIsNone(dm.classify("issue_comment", event, self.config))

    def test_reject_agent_spoof_wrong_issue(self):
        event = self.comment_event("DAO_MONITOR_V1\nagent: DAO Pilot 3\nstatus: DONE\nsummary: livre", issue=58)
        self.assertIsNone(dm.classify("issue_comment", event, self.config))

    def test_ignore_ordinary_and_active(self):
        self.assertIsNone(dm.classify("issue_comment", self.comment_event("routine report"), self.config))
        event = self.comment_event("DAO_MONITOR_V1\nagent: DAO DEV 20\nstatus: ACTIVE\nsummary: debut")
        self.assertIsNone(dm.classify("issue_comment", event, self.config))

    def test_ignore_pr_comment(self):
        event = self.comment_event("DAO_MONITOR_V1\nagent: DAO DEV 20\nstatus: BLOCKED\nsummary: x")
        event["issue"]["pull_request"] = {"url": "anything"}
        self.assertIsNone(dm.classify("issue_comment", event, self.config))

    def test_pr_merged(self):
        event = {"action": "closed", "pull_request": {
            "merged": True, "number": 92, "base": {"ref": "main"},
            "title": "One transfer", "html_url": "https://github.com/Khaey/Dao/pull/92"}}
        self.assertIn("PR #92", dm.classify("pull_request", event, self.config))
        event["pull_request"]["merged"] = False
        self.assertIsNone(dm.classify("pull_request", event, self.config))

    def test_ci_only_main_push(self):
        event = {"action": "completed", "workflow_run": {
            "name": "DAO CI and DEV deploy", "head_branch": "main", "event": "push",
            "conclusion": "success", "run_number": 397,
            "html_url": "https://github.com/Khaey/Dao/actions/runs/37879231749"}}
        self.assertIn("réussis", dm.classify("workflow_run", event, self.config))
        event["workflow_run"]["event"] = "pull_request"
        self.assertIsNone(dm.classify("workflow_run", event, self.config))

    def test_silence_after_90m(self):
        now = dt.datetime(2026, 10, 9, 1, 31, tzinfo=dt.timezone.utc)
        self.assertEqual(dm.silence_candidate([self.active], self.mission, ["Khaey"], now)[0],
                         "DAO_MONITOR_SILENCE_V1:123")

    def test_not_silent_before_90m(self):
        now = dt.datetime(2026, 10, 9, 1, 29, tzinfo=dt.timezone.utc)
        self.assertIsNone(dm.silence_candidate([self.active], self.mission, ["Khaey"], now))

    def test_pause_disables_watchdog(self):
        paused = dict(self.active, id=124,
                      body="DAO_MONITOR_V1\nagent: DAO DEV 20\nstatus: PAUSED_QUOTA\nsummary: arret")
        now = dt.datetime(2026, 10, 9, 5, tzinfo=dt.timezone.utc)
        self.assertIsNone(dm.silence_candidate([self.active, paused], self.mission, ["Khaey"], now))

    def test_no_duplicate_silence(self):
        now = dt.datetime(2026, 10, 9, 5, tzinfo=dt.timezone.utc)
        already = {"body": "DAO_MONITOR_SILENCE_V1:123", "user": {"login": "github-actions[bot]"}}
        self.assertIsNone(dm.silence_candidate([self.active, already], self.mission, ["Khaey"], now))

    def test_no_false_pilot_watchdog(self):
        pilot = dm.mission_for(89, self.config)
        self.assertFalse(pilot["watchdog"])

    def test_no_secrets_in_normalized_summary(self):
        data = dm.checkpoint("DAO_MONITOR_V1\nagent: DAO DEV 20\nstatus: DONE\nsummary: fine\n")
        self.assertEqual(data["summary"], "fine")


if __name__ == "__main__":
    unittest.main()
