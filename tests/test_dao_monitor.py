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

    def test_pr_owner_title_disambiguates_incidental_references(self):
        pr = {"title": "OPS #91 — opérations", "body": "Ne touche pas #58 ou #83"}
        self.assertEqual(dm.pr_owner(pr, self.config), ("DAO OPT 20", 91))

    def test_pr_owner_explicit_refs(self):
        pr = {"title": "fix(artisan): profil", "body": "Hors #58. Refs #83."}
        self.assertEqual(dm.pr_owner(pr, self.config), ("DAO DEV 2", 83))

    def test_real_pr102_accented_refs_and_unrelated_oce(self):
        pr = {"title": "fix(ops): garder les helpers accessibles sans release active",
              "body": ("Aucun changement d'OCE #58. "
                       "Suivi : https://github.com/Khaey/Dao/issues/91#issuecomment-6077429398 "
                       "Réfs #91.")}
        self.assertEqual(dm.pr_owner(pr, self.config), ("DAO OPT 20", 91))

    def test_real_pr103_direct_issue_link_with_other_references(self):
        pr = {"title": "docs(ops): conserver la preuve live du transport de récupération",
              "body": ("Livré par #102, indépendant de #58. CI #423 et #424. "
                       "Preuves de reprise : [issue #91]"
                       "(https://github.com/Khaey/Dao/issues/91).")}
        self.assertEqual(dm.pr_owner(pr, self.config), ("DAO OPT 20", 91))

    def test_conflicting_canonical_issue_links_not_attributed(self):
        pr = {"title": "maintenance",
              "body": ("https://github.com/Khaey/Dao/issues/91 "
                       "https://github.com/Khaey/Dao/issues/58")}
        self.assertEqual(dm.pr_owner(pr, self.config), (None, None))

    def test_explicit_refs_disambiguates_other_issue_links(self):
        pr = {"title": "changes",
              "body": ("https://github.com/Khaey/Dao/issues/58. Réfs #91")}
        self.assertEqual(dm.pr_owner(pr, self.config), ("DAO OPT 20", 91))

    def test_ci_for_real_pr102_and_pr103(self):
        for number, sha, title, body in (
            (102, "5e551b0dea87a49977f170f3466d71088defe27c",
             "fix(ops): garder les helpers accessibles sans release active",
             "Réfs #91. Aucun changement d'OCE #58."),
            (103, "269b7018dc18f55a5c6f725246e1d4b4f5c7e580",
             "docs(ops): conserver la preuve live du transport de récupération",
             "[issue #91](https://github.com/Khaey/Dao/issues/91) #102 #58"),
        ):
            pr = {"number": number, "title": title, "body": body,
                  "merged_at": "2026-10-09T08:00:00Z",
                  "base": {"ref": "main"}, "merge_commit_sha": sha}
            matched = dm.associated_merged_pr([pr], sha)
            self.assertEqual(dm.owner_line(matched, self.config),
                             "👤 Agent : DAO OPT 20 — mission #91")

    def test_pr_owner_unique_body_reference(self):
        pr = {"title": "fix(monitor): secrets", "body": "Correction ciblée de #93"}
        self.assertEqual(dm.pr_owner(pr, self.config), ("DAO Pilot 3", 93))

    def test_pr_owner_ambiguous_falls_back(self):
        pr = {"title": "maintenance", "body": "Impacte #83 et #58"}
        self.assertEqual(dm.pr_owner(pr, self.config), (None, None))
        self.assertEqual(dm.owner_line(pr, self.config), "👤 Agent : non identifié")

    def test_pr_merged_shows_agent(self):
        event = {"action": "closed", "pull_request": {
            "merged": True, "number": 96, "base": {"ref": "main"},
            "title": "OPS #91 — opérations", "body": "Ne touche pas #58",
            "html_url": "https://github.com/Khaey/Dao/pull/96"}}
        self.assertIn("Agent : DAO OPT 20 — mission #91",
                      dm.classify("pull_request", event, self.config))

    def test_ci_exact_merge_sha_shows_owner(self):
        sha = "a" * 40
        pr = {"merged_at": "2026-10-09T05:00:00Z",
              "merge_commit_sha": sha, "base": {"ref": "main"},
              "title": "fix(artisan): profil", "body": "Refs #83"}
        self.assertEqual(dm.associated_merged_pr([pr], sha), pr)
        self.assertIsNone(dm.associated_merged_pr([pr], "b" * 40))
        event = {"action": "completed", "workflow_run": {
            "name": "DAO CI and DEV deploy", "head_branch": "main",
            "event": "push", "conclusion": "success", "run_number": 408,
            "html_url": "https://github.com/Khaey/Dao/actions/runs/123"}}
        self.assertIn("Agent : DAO DEV 2 — mission #83",
                      dm.classify("workflow_run", event, self.config, pr))
        self.assertIn("Agent : non identifié",
                      dm.classify("workflow_run", event, self.config))

    def test_ci_ambiguous_merge_is_not_attributed(self):
        sha = "b" * 40
        pr = {"merge_commit_sha": sha, "merged_at": "now",
              "base": {"ref": "main"}, "title": "OPS #91"}
        self.assertIsNone(dm.associated_merged_pr([pr, pr], sha))
        self.assertIsNone(dm.associated_merged_pr([pr], "invalid"))

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
