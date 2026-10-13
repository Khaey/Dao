"""Offline unit tests: no network and no Telegram token required."""
import base64
import datetime as dt
import copy
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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

    def trusted_pr(self, pr):
        if pr is None:
            return None
        return dict(pr, user={"login": "Khaey"},
                    head={"repo": {"full_name": dm.REPO}},
                    base=dict(pr.get("base", {}), repo={"full_name": dm.REPO}))

    def owner(self, pr, config):
        return dm.pr_owner(self.trusted_pr(pr), config)

    def owner_line(self, pr, config):
        return dm.owner_line(self.trusted_pr(pr), config)

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
        event = self.comment_event("DAO_MONITOR_V1\nagent: DAO Pilot 4\nstatus: DECISION\nsummary: arbitrage", issue=89)
        result = dm.classify("issue_comment", event, self.config)
        self.assertIn("DAO Pilot 4", result)

    def test_reject_unknown_author(self):
        event = self.comment_event("DAO_MONITOR_V1\nagent: DAO DEV 20\nstatus: BLOCKED\nsummary: bloque", user="outside")
        self.assertIsNone(dm.classify("issue_comment", event, self.config))

    def test_reject_agent_spoof_wrong_issue(self):
        event = self.comment_event("DAO_MONITOR_V1\nagent: DAO Pilot 4\nstatus: DONE\nsummary: livre", issue=58)
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
        self.assertEqual(self.owner(pr, self.config), ("DAO OPT 20", 91))

    def test_pr_owner_explicit_refs(self):
        pr = {"title": "fix(artisan): profil", "body": "Hors #58. Refs #83."}
        self.assertEqual(self.owner(pr, self.config), ("DAO DEV 2", 83))

    def test_real_pr104_title_pr_numbers_do_not_hide_owner(self):
        pr = {"title": "fix(monitor): identifier OPT 20 sur les PR #102/#103 et CI",
              "body": "Corrige les notifications PR #102/#103 et CI #422/#424. Refs #93"}
        self.assertEqual(self.owner(pr, self.config), ("DAO Pilot 4", 93))
        sha = "e0b2dbe7be35ad4b40720f9761caa97336b64f6e"
        merged = dict(pr, merge_commit_sha=sha, merged_at="2026-10-09T09:25:09Z",
                      base={"ref": "main"})
        self.assertEqual(self.owner_line(dm.associated_merged_pr([merged], sha), self.config),
                         "👤 Agent : DAO Pilot 4 — mission #93")

    def test_unregistered_title_allows_canonical_owner_link(self):
        pr = {"title": "docs: preuve PR #103 CI #424",
              "body": "https://github.com/Khaey/Dao/issues/91"}
        self.assertEqual(self.owner(pr, self.config), ("DAO OPT 20", 91))

    def test_pr104_quoted_refs_are_examples_not_owners(self):
        pr = {"title": "fix(monitor): identifier OPT 20 sur les PR #102/#103 et CI",
              "body": ("Corrige la régression de DAO Monitor #93 montrée par les notifications "
                       "Telegram de PR #102/#103 et CI #422/#424 : le responsable est "
                       "**DAO OPT 20 (#91)**, mais le parseur ignorait `Réfs #91` et les liens "
                       "directs vers l'issue `.../issues/91`.\n\n"
                       "- Reconnaît `Refs #N` **et** `Réfs #N` (français).\n"
                       "- Ajoute 5 tests de régression, priorité de `Réfs #91`.\n\nRefs #93")}
        self.assertEqual(self.owner(pr, self.config), ("DAO Pilot 4", 93))

    def test_fenced_example_does_not_override_real_owner(self):
        pr = {"body": "```text\nRefs #91\nhttps://github.com/Khaey/Dao/issues/58\n```\nRefs #93"}
        self.assertEqual(self.owner(pr, self.config), ("DAO Pilot 4", 93))

    def test_example_alone_cannot_assign_owner(self):
        self.assertEqual(self.owner({"body": "Example: `Refs #91`"}, self.config), (None, None))

    def test_real_conflicting_refs_remain_ambiguous_after_example(self):
        self.assertEqual(self.owner({"body": "`Refs #83`\nRefs #91\nRefs #58"}, self.config),
                         (None, None))

    def test_conflicting_registered_title_is_not_overridden(self):
        pr = {"title": "Corrections #58 et #91", "body": "Refs #93"}
        self.assertEqual(self.owner(pr, self.config), (None, None))

    def test_unregistered_title_without_owner_stays_unknown(self):
        pr = {"title": "Corriger PR #102 et CI #424", "body": "", "user": {"login": "Khaey"}}
        self.assertEqual(self.owner(pr, self.config), (None, None))

    def test_real_pr102_accented_refs_and_unrelated_oce(self):
        pr = {"title": "fix(ops): garder les helpers accessibles sans release active",
              "body": ("Aucun changement d'OCE #58. "
                       "Suivi : https://github.com/Khaey/Dao/issues/91#issuecomment-6077429398 "
                       "Réfs #91.")}
        self.assertEqual(self.owner(pr, self.config), ("DAO OPT 20", 91))

    def test_real_pr103_direct_issue_link_with_other_references(self):
        pr = {"title": "docs(ops): conserver la preuve live du transport de récupération",
              "body": ("Livré par #102, indépendant de #58. CI #423 et #424. "
                       "Preuves de reprise : [issue #91]"
                       "(https://github.com/Khaey/Dao/issues/91).")}
        self.assertEqual(self.owner(pr, self.config), ("DAO OPT 20", 91))

    def test_conflicting_canonical_issue_links_not_attributed(self):
        pr = {"title": "maintenance",
              "body": ("https://github.com/Khaey/Dao/issues/91 "
                       "https://github.com/Khaey/Dao/issues/58")}
        self.assertEqual(self.owner(pr, self.config), (None, None))

    def test_explicit_refs_disambiguates_other_issue_links(self):
        pr = {"title": "changes",
              "body": ("https://github.com/Khaey/Dao/issues/58. Réfs #91")}
        self.assertEqual(self.owner(pr, self.config), ("DAO OPT 20", 91))

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
            self.assertEqual(self.owner_line(matched, self.config),
                             "👤 Agent : DAO OPT 20 — mission #91")

    def test_pr_owner_unique_body_reference(self):
        pr = {"title": "fix(monitor): secrets", "body": "Correction ciblée de #93"}
        self.assertEqual(self.owner(pr, self.config), ("DAO Pilot 4", 93))

    def test_pr_owner_ambiguous_falls_back(self):
        pr = {"title": "maintenance", "body": "Impacte #83 et #58"}
        self.assertEqual(self.owner(pr, self.config), (None, None))
        self.assertEqual(self.owner_line(pr, self.config), "👤 Attribution à confirmer")

    def test_pr_merged_shows_agent(self):
        event = {"action": "closed", "pull_request": {
            "merged": True, "number": 96, "base": {"ref": "main"},
            "title": "OPS #91 — opérations", "body": "Ne touche pas #58",
            "html_url": "https://github.com/Khaey/Dao/pull/96"}}
        event["pull_request"] = self.trusted_pr(event["pull_request"])
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
            "event": "push", "conclusion": "success", "run_number": 408, "head_sha": sha,
            "html_url": "https://github.com/Khaey/Dao/actions/runs/123"}}
        self.assertIn("Agent : DAO DEV 2 — mission #83",
                      dm.classify("workflow_run", event, self.config, self.trusted_pr(pr)))
        self.assertIn("Attribution à confirmer",
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
        already = {"body": "DAO_MONITOR_SILENCE_V1:123", "user": {"login": "github-actions[bot]", "type": "Bot"}}
        self.assertIsNone(dm.silence_candidate([self.active, already], self.mission, ["Khaey"], now))

    def test_untrusted_marker_cannot_suppress_silence(self):
        now = dt.datetime(2026, 10, 9, 5, tzinfo=dt.timezone.utc)
        for user in ({"login": "outside", "type": "User"},
                     {"login": "Khaey", "type": "User"},
                     {"login": "other[bot]", "type": "Bot"},
                     {"login": "github-actions[bot]", "type": "User"}):
            with self.subTest(user=user):
                forged = {"body": "DAO_MONITOR_SILENCE_V1:123", "user": user}
                self.assertIsNotNone(dm.silence_candidate(
                    [self.active, forged], self.mission, ["Khaey"], now))

    def test_different_or_quoted_marker_cannot_suppress_silence(self):
        now = dt.datetime(2026, 10, 9, 5, tzinfo=dt.timezone.utc)
        for body in ("DAO_MONITOR_SILENCE_V1:1234", "DAO_MONITOR_SILENCE_V1:12",
                     "Quoted marker\nDAO_MONITOR_SILENCE_V1:123",
                     "DAO_MONITOR_SILENCE_V1:123 extra"):
            with self.subTest(body=body):
                other = {"body": body, "user": {"login": "github-actions[bot]", "type": "Bot"}}
                self.assertIsNotNone(dm.silence_candidate(
                    [self.active, other], self.mission, ["Khaey"], now))

    def test_machine_acknowledgement_matches_written_format(self):
        now = dt.datetime(2026, 10, 9, 5, tzinfo=dt.timezone.utc)
        delivered = {"body": "DAO_MONITOR_SILENCE_V1:123\nAlerte de silence DAO Monitor émise. "
                             "Ne constitue pas un diagnostic de crash.",
                     "user": {"login": "github-actions[bot]", "type": "Bot"}}
        self.assertIsNone(dm.silence_candidate(
            [self.active, delivered], self.mission, ["Khaey"], now))

    def test_new_active_checkpoint_is_not_hidden_by_previous_ack(self):
        now = dt.datetime(2026, 10, 9, 5, tzinfo=dt.timezone.utc)
        delivered = {"body": "DAO_MONITOR_SILENCE_V1:123",
                     "user": {"login": "github-actions[bot]", "type": "Bot"}}
        resumed = dict(self.active, id=1234, created_at="2026-10-09T03:00:00Z")
        result = dm.silence_candidate(
            [self.active, delivered, resumed], self.mission, ["Khaey"], now)
        self.assertEqual(result[0], "DAO_MONITOR_SILENCE_V1:1234")

    def test_no_false_pilot_watchdog(self):
        pilot = dm.mission_for(89, self.config)
        self.assertFalse(pilot["watchdog"])

    def test_no_secrets_in_normalized_summary(self):
        data = dm.checkpoint("DAO_MONITOR_V1\nagent: DAO DEV 20\nstatus: DONE\nsummary: fine\n")
        self.assertEqual(data["summary"], "fine")


class AttributionTests(unittest.TestCase):
    def setUp(self):
        self.config = dm.configuration()
        data = json.loads((Path(__file__).parent / "fixtures" / "dao_monitor_real_prs.json").read_text())
        self.prs = {pr["number"]: pr for pr in data["pull_requests"]}
        self.runs = data["workflow_events"]
        network = patch("urllib.request.urlopen", side_effect=AssertionError("Offline tests only"))
        network.start()
        self.addCleanup(network.stop)

    def pr(self, body, **changes):
        pr = copy.deepcopy(self.prs[117])
        pr.update(number=121, title="Monitor", body=body)
        pr.update(changes)
        return pr

    def test_registered_canonical_owners_and_unique_issues(self):
        expected = {112: "DAO OPT 20", 115: "OPT", 116: "DAO DEV 2",
                    61: "DAO DEV 1", 120: "DAO OPT 20", 85: "OPT"}
        issues = [m["issue"] for m in self.config["missions"]]
        self.assertEqual(len(issues), len(set(issues)))
        self.assertEqual(self.config["allowed_comment_authors"], ["Khaey"])
        for issue, agent in expected.items():
            with self.subTest(issue=issue):
                self.assertEqual(dm.mission_for(issue, self.config)["agent"], agent)
                self.assertFalse(dm.mission_for(issue, self.config)["watchdog"])
                self.assertEqual(dm.pr_owner(self.pr(f"Owner issue: #{issue}"), self.config),
                                 (agent, issue))

    def test_complete_real_pr_bodies_preserve_107_108_and_repair_117(self):
        expected = {107: ("DAO Pilot 4", 93), 108: ("DAO Pilot 4", 93),
                    117: ("DAO OPT 20", 112), 118: (None, None), 119: (None, None)}
        for number, owner in expected.items():
            with self.subTest(pr=number):
                self.assertEqual(dm.pr_owner(self.prs[number], self.config), owner)

    def test_transversal_real_bodies_need_explicit_pilot_declaration(self):
        for number in (118, 119):
            with self.subTest(pr=number):
                pr = copy.deepcopy(self.prs[number])
                pr["body"] = "Owner issue: #89\n\n" + pr["body"]
                self.assertEqual(dm.pr_owner(pr, self.config), ("DAO Pilot 4", 89))

    def test_unknown_and_conflicting_declarations_fail_closed(self):
        for body in ("Owner issue: #999", "Owner issue: #999\nRefs #120",
                     "Owner issue: #0\nRefs #120",
                     "Owner issue: #120\nOwner issue: #89",
                     "Owner issue: #120\nRefs #89", "Refs #120, #89",
                     "Refs #120 and #999", "Owner issue: #120\nCloses #58"):
            with self.subTest(body=body):
                self.assertEqual(dm.pr_owner(self.pr(body), self.config), (None, None))

    def test_repeated_matching_declarations_are_not_a_conflict(self):
        self.assertEqual(dm.pr_owner(self.pr("Owner issue: #120\nOwner issue: #120\nRéfs #120"),
                                     self.config), ("DAO OPT 20", 120))

    def test_conflicting_legacy_title_and_refs_remain_ambiguous(self):
        self.assertEqual(dm.pr_owner(self.pr("Refs #58", title="OPS #91"), self.config),
                         (None, None))

    def test_context_links_and_title_do_not_override_explicit_owner(self):
        pr = self.pr("Owner issue: #89\nContext: https://github.com/Khaey/Dao/issues/115 "
                     "https://github.com/Khaey/Dao/issues/116", title="Docs #115 / #116")
        self.assertEqual(dm.pr_owner(pr, self.config), ("DAO Pilot 4", 89))

    def test_markdown_examples_cannot_inject_an_owner(self):
        for example in ("`Owner issue: #58`", "``Refs #58``", "```text\nOwner issue: #58\n```",
                        "`multiline\nOwner issue: #58\n`",
                        "~~~~text\nOwner issue: #58\n~~~~", "    Owner issue: #58",
                        "> Owner issue: #58", "<!--\nOwner issue: #58\n-->"):
            with self.subTest(example=example):
                self.assertEqual(dm.pr_owner(self.pr(example + "\nOwner issue: #120"), self.config),
                                 ("DAO OPT 20", 120))

    def test_unclosed_code_fences_do_not_assign_owners(self):
        for body in ("```text\nOwner issue: #120", "~~~\nRefs #120"):
            with self.subTest(body=body):
                self.assertEqual(dm.pr_owner(self.pr(body), self.config), (None, None))

    def test_title_code_example_is_not_a_mission(self):
        self.assertEqual(dm.pr_owner(self.pr("Documentation", title="Example `Refs #58`"),
                                     self.config), (None, None))

    def test_untrusted_pr_author_cannot_claim_a_registered_owner(self):
        pr = self.pr("Owner issue: #120", user={"login": "outside"})
        self.assertEqual(dm.pr_owner(pr, self.config), (None, None))
        pr.update(merged_by={"login": "Khaey"}, author_association="OWNER")
        self.assertEqual(dm.pr_owner(pr, self.config), (None, None))

    def test_external_or_missing_repository_metadata_is_not_trusted(self):
        for field, value in (("head", {"repo": {"full_name": "outside/Dao"}}),
                             ("base", {"ref": "main", "repo": {"full_name": "outside/Dao"}}),
                             ("head", {"repo": None}), ("user", None), ("base", None)):
            with self.subTest(field=field, value=value):
                pr = self.pr("Owner issue: #120", **{field: value})
                self.assertEqual(dm.pr_owner(pr, self.config), (None, None))

    def test_agent_name_branch_and_shared_author_are_not_owner_evidence(self):
        pr = self.pr("Owner: DAO OPT 20\nAgent: DAO DEV 20", title="Documentation")
        pr["head"]["ref"] = "feat/dev2-messages-116"
        self.assertEqual(dm.pr_owner(pr, self.config), (None, None))
        pr["body"] = "Owner issue: #120\nAgent: invented"
        self.assertEqual(dm.pr_owner(pr, self.config), ("DAO OPT 20", 120))

    def test_real_ci_events_use_only_exact_merged_pr(self):
        for event in self.runs:
            sha = event["workflow_run"]["head_sha"]
            pr = dm.associated_merged_pr(list(self.prs.values()), sha)
            with self.subTest(sha=sha):
                self.assertIsNotNone(pr)
                message = dm.classify("workflow_run", event, self.config, pr)
                expected = ("Agent : DAO OPT 20 — mission #112" if pr["number"] == 117
                            else f"Attribution à confirmer — PR #{pr['number']}")
                self.assertIn(expected, message)
                mismatch = copy.deepcopy(event)
                mismatch["workflow_run"]["head_sha"] = "f" * 40
                self.assertIn("Attribution à confirmer",
                              dm.classify("workflow_run", mismatch, self.config, pr))

    def test_unmerged_pr_is_not_ci_owner_or_merge_notification(self):
        pr = copy.deepcopy(self.prs[117])
        pr.update(merged=False, merged_at=None)
        self.assertIsNone(dm.associated_merged_pr([pr], pr["merge_commit_sha"]))
        self.assertIsNone(dm.classify("pull_request", {"action": "closed", "pull_request": pr},
                                     self.config))
        self.assertIn("Attribution à confirmer", dm.classify("workflow_run", self.runs[0],
                                                             self.config, pr))

    def test_unknown_alert_names_the_pr_without_inventing_an_agent(self):
        message = dm.classify("pull_request", {"action": "closed", "pull_request": self.prs[118]},
                              self.config)
        self.assertIn("Attribution à confirmer — PR #118", message)
        self.assertNotIn("Agent :", message)

    def test_main_logs_only_attribution_metadata_and_mocked_delivery(self):
        event = {"action": "closed", "pull_request": self.prs[117]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "event.json"
            path.write_text(json.dumps(event))
            output = io.StringIO()
            with (patch.dict(os.environ, {"GITHUB_EVENT_NAME": "pull_request",
                                         "GITHUB_EVENT_PATH": str(path), "GITHUB_RUN_ATTEMPT": "1"},
                            clear=True), patch.object(dm, "telegram", return_value=True) as delivery,
                    contextlib.redirect_stdout(output)):
                dm.main()
            self.assertEqual(delivery.call_count, 1)
            self.assertIn("Agent : DAO OPT 20 — mission #112", delivery.call_args.args[0])
            self.assertIn("Agent : DAO OPT 20 — mission #112", output.getvalue())
            self.assertNotIn(self.prs[117]["body"], output.getvalue())



class AgentOnboardingTests(unittest.TestCase):
    def test_new_agent_and_transfer_are_announced_once(self):
        before = {"missions": [{"issue": 64, "agent": "DAO DEV 1"},
                               {"issue": 58, "agent": "DAO DEV 20"}]}
        after = {"missions": [{"issue": 64, "agent": "DAO Chat 20"},
                              {"issue": 58, "agent": "DAO DEV 20"},
                              {"issue": 125, "agent": "DAO DEV 2"}]}
        message = dm.registration_alert(before, after)
        self.assertIn("DAO Chat 20 — missions #64", message)
        self.assertIn("DAO DEV 2 — missions #125", message)
        self.assertNotIn("DAO DEV 20 — missions", message)
        self.assertIsNone(dm.registration_alert(after, after))

    def test_renamed_pilot_and_passive_missions(self):
        old = {"missions": [{"issue": 89, "agent": "DAO Pilot 3"}]}
        new = {"missions": [{"issue": 89, "agent": "DAO Pilot 4"},
                            {"issue": 93, "agent": "DAO Pilot 4"}]}
        alert = dm.registration_alert(old, new)
        self.assertIn("DAO Pilot 4 — missions #89, #93", alert)

    def test_onboarding_reads_exact_commits_no_telegram_secrets(self):
        sha_before, sha_after = "1" * 40, "2" * 40
        old = {"missions": [{"issue": 58, "agent": "DAO DEV 20"}]}
        new = {"missions": [{"issue": 58, "agent": "DAO DEV 20"},
                            {"issue": 64, "agent": "DAO Chat 20"}]}
        def read_registry(method, endpoint, body=None):
            self.assertEqual(method, "GET")
            self.assertTrue(endpoint.endswith("?ref=" + sha_before)
                            or endpoint.endswith("?ref=" + sha_after))
            data = old if endpoint.endswith(sha_before) else new
            return {"encoding": "base64",
                    "content": base64.b64encode(json.dumps(data).encode()).decode()}
        with (patch.object(dm, "github_api", side_effect=read_registry),
              patch.object(dm, "telegram", return_value=True) as send):
            dm.onboarding_push({"ref": "refs/heads/main", "before": sha_before,
                                "after": sha_after, "deleted": False})
            send.assert_called_once()
            self.assertIn("DAO Chat 20", send.call_args.args[0])

    def test_untrusted_branch_or_deleted_push_never_qualifies(self):
        with (patch.object(dm, "github_api") as github,
              patch.object(dm, "telegram") as send):
            dm.onboarding_push({"ref": "refs/heads/feature", "before": "1" * 40,
                                "after": "2" * 40})
            dm.onboarding_push({"ref": "refs/heads/main", "before": "1" * 40,
                                "after": "2" * 40, "deleted": True})
            dm.onboarding_push({"ref": "refs/heads/main", "before": "1" * 40,
                                "after": "1" * 40})
            github.assert_not_called()
            send.assert_not_called()

    def test_invalid_registry_entries_do_not_publish_untrusted_fields(self):
        data = {"missions": [{"issue": 0, "agent": "bad"},
                             {"issue": 64, "agent": "<script>"},
                             {"issue": 125, "agent": "DAO DEV 2"}]}
        message = dm.registration_alert({"missions": []}, data)
        self.assertNotIn("<script>", message)
        self.assertIn("#125", message)

    def test_current_active_assignments_are_registered(self):
        config = dm.configuration()
        expected = {64: "DAO Chat 20", 124: "DAO OPT 20",
                    125: "DAO DEV 2", 89: "DAO Pilot 4", 93: "DAO Pilot 4"}
        for issue, name in expected.items():
            with self.subTest(issue=issue):
                self.assertEqual(dm.mission_for(issue, config)["agent"], name)


if __name__ == "__main__":
    unittest.main()

