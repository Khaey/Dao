"""Synthetic snapshots only: this suite never contacts GitHub or shared DEV."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/dao_agent_overlap_audit.py"
spec = importlib.util.spec_from_file_location("agent_overlap_audit", SCRIPT)
overlap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlap)


def registry():
    return {"missions": [{"issue": 11, "agent": "DAO Alpha"},
                         {"issue": 12, "agent": "DAO Beta"}]}


def issue(number=11, **extra):
    return {"number": number, "state": "open", **extra}


def pr(number=101, owner=11, **extra):
    return {"number": number, "state": "open", "body": f"Owner issue: #{owner}", **extra}


def report(issues=(), prs=(), missions=None):
    return overlap.audit(registry() if missions is None else missions, [list(issues)], [list(prs)])


def findings(result, code):
    return [row for row in result["findings"] if row["code"] == code]


class OwnershipTests(unittest.TestCase):
    def test_clean_snapshot_and_deterministic_json(self):
        result = report([issue(active=True)], [pr(files=["scripts/alpha.py"])])
        self.assertEqual(result["counts"], {"confirmed": 0, "warning": 0})
        self.assertEqual(result["coverage"]["file_lists_provided"], [101])
        self.assertEqual(result, report([issue(active=True)], [pr(files=["scripts/alpha.py"])]))

    def test_registry_conflict_cites_both_sources(self):
        missions = registry()
        missions["missions"].append({"issue": 11, "agent": "DAO Beta"})
        result = report(missions=missions)
        conflict, = findings(result, "multiple_agents")
        self.assertEqual(conflict["severity"], "confirmed")
        self.assertEqual(conflict["agents"], ["DAO Alpha", "DAO Beta"])
        self.assertEqual(conflict["sources"], ["registry.missions[0]", "registry.missions[2]"])

    def test_conflict_between_registry_and_export_with_multiple_agents(self):
        result = report([issue(agents=["DAO Alpha", "DAO Beta"])])
        conflict, = findings(result, "multiple_agents")
        self.assertEqual(conflict["issue"], 11)
        self.assertIn("issues[0][0]", conflict["sources"])

    def test_assignments_across_exports_and_prs_are_explicit(self):
        result = overlap.audit(registry(), [[issue(agent="DAO Alpha")], [issue(agent="DAO Beta")]],
                               [[pr(agent="DAO Beta")]])
        conflict, = findings(result, "multiple_agents")
        self.assertIn("issues[1][0]", conflict["sources"])
        self.assertIn("prs[0][0]", conflict["sources"])

    def test_same_agent_case_and_spaces_do_not_create_conflict(self):
        result = report([issue(agent="  dao   ALPHA  ")])
        self.assertFalse(result["findings"])

    def test_unknown_agent_value_is_withheld_but_distinct_unknowns_conflict(self):
        result = report([issue(77, agents=["PRIVATE_VALUE_ONE", "PRIVATE_VALUE_TWO"])])
        self.assertEqual(len(findings(result, "unknown_agent")), 2)
        self.assertEqual(len(findings(result, "multiple_agents")), 1)
        rendered = json.dumps(result) + overlap.markdown(result)
        self.assertNotIn("PRIVATE_VALUE", rendered)
        self.assertIn("unregistered-agent-1", rendered)

    def test_active_unassigned_warns_without_inventing_agent(self):
        result = report([issue(77, active=True)])
        warning, = findings(result, "unassigned_active_issue")
        self.assertEqual(warning["agents"], [])
        self.assertEqual(result["counts"]["confirmed"], 0)

    def test_registry_assignment_is_sufficient_for_active_issue(self):
        self.assertFalse(report([issue(active=True)])["findings"])

    def test_active_labels_supported_but_closed_and_open_backlog_not_inferred(self):
        result = report([issue(71), issue(72, active=True, state="closed"),
                         issue(73, labels=[{"name": "dao:active"}]),
                         issue(74, labels=["dao:in-progress"])])
        self.assertEqual([row["issue"] for row in findings(result, "unassigned_active_issue")], [73, 74])

    def test_missing_registry_agent_is_reported(self):
        result = report(missions={"missions": [{"issue": 11}]})
        self.assertEqual(len(findings(result, "missing_registry_agent")), 1)

    def test_human_assignees_and_prs_from_issues_endpoint_are_not_missions(self):
        result = report([issue(77, active=True, assignees=[{"login": "DAO Alpha"}]),
                         issue(78, active=True, pull_request={})])
        self.assertEqual(result["coverage"]["issues"], 1)
        self.assertEqual(findings(result, "unassigned_active_issue")[0]["issue"], 77)


class PullRequestTests(unittest.TestCase):
    def test_multiple_open_prs_same_owner_are_confirmed_including_drafts(self):
        result = report(prs=[pr(102, draft=True), pr(101), pr(103, state="closed")])
        conflict, = findings(result, "parallel_prs")
        self.assertEqual(conflict["prs"], [101, 102])
        self.assertEqual(conflict["severity"], "confirmed")

    def test_explicit_replacement_is_warning_not_conflict(self):
        for body in ("Owner issue: #11\nReplaces: #101", "Owner issue: #11\nSupersedes: #101",
                     "Owner issue: #11\nRemplace: #101", "Owner issue: #11\nCette PR remplace #101 (historique).",
                     "Owner issue: #11\nThis PR replaces #101."):
            with self.subTest(body=body):
                result = report(prs=[pr(101), pr(102, body=body)])
                self.assertEqual(result["counts"]["confirmed"], 0)
                self.assertEqual(len(findings(result, "declared_replacement")), 1)

    def test_closed_or_omitted_historical_target_does_not_block_successor(self):
        for old in ([], [pr(101, state="closed")]):
            with self.subTest(included=bool(old)):
                result = report(prs=[*old, pr(102, replaces=[101])])
                self.assertEqual(result["counts"]["confirmed"], 0)
                self.assertEqual(findings(result, "declared_replacement")[0]["prs"], [101, 102])

    def test_replacement_chain_and_two_competing_successors(self):
        result = report(prs=[pr(101), pr(102, replaces=[101]), pr(103, replaces=[102])])
        self.assertEqual(result["counts"]["confirmed"], 0)
        result = report(prs=[pr(101), pr(102, replaces=[101]), pr(103, replaces=[101])])
        self.assertEqual(len(findings(result, "parallel_prs")), 1)

    def test_cycle_never_hides_parallel_prs(self):
        result = report(prs=[pr(101, replaces=[102]), pr(102, replaces=[101])])
        self.assertEqual(len(findings(result, "replacement_cycle")), 1)
        self.assertEqual(len(findings(result, "parallel_prs")), 1)

    def test_replacement_target_with_different_owner_is_not_a_handoff(self):
        result = report(prs=[pr(101, owner=12), pr(102, replaces=[101]), pr(103)])
        self.assertEqual(len(findings(result, "replacement_owner_mismatch")), 1)
        self.assertEqual(len(findings(result, "parallel_prs")), 1)

    def test_canonical_owner_only_and_examples_ignored(self):
        body = ("Refs #99\n> Owner issue: #98\n    Owner issue: #97\n"
                "````text\n```\nOwner issue: #96\n````\n"
                "~~~text\nOwner issue: #95\n~~~\n"
                "<!--\nOwner issue: #94\n-->\nOwner issue: #11\n")
        result = report(prs=[pr(101, body=body), pr(102)])
        conflict, = findings(result, "parallel_prs")
        self.assertEqual(conflict["issue"], 11)

    def test_mentions_and_title_do_not_silently_supersede_a_pr(self):
        result = report(prs=[pr(101), pr(102, title="replaces #101", body="Owner issue: #11\nSee #101")])
        self.assertEqual(len(findings(result, "parallel_prs")), 1)

    def test_missing_and_ambiguous_owner_warn_without_choosing(self):
        result = report(prs=[pr(101, body="Fixes #11"),
                             pr(102, body="Owner issue: #11\nOwner issue: #12"),
                             pr(103, owner_issue=12)])
        self.assertEqual(len(findings(result, "missing_pr_owner")), 1)
        self.assertEqual(len(findings(result, "ambiguous_pr_owner")), 2)
        self.assertFalse(findings(result, "parallel_prs"))

    def test_normalized_owner_and_export_wrappers(self):
        result = overlap.audit(registry(), [{"issues": [issue(issue_number=11)]}],
                               [{"pull_requests": [pr(body=None, owner_issue=11)]}])
        self.assertEqual(result["counts"], {"confirmed": 0, "warning": 0})
        result = overlap.audit(registry(), [], [{"prs": [pr(body=None, owner_issue=11)]}])
        self.assertEqual(result["coverage"]["open_prs"], 1)

    def test_same_pr_in_multiple_exports_is_not_two_prs(self):
        result = overlap.audit(registry(), [], [[pr()], [pr()]])
        self.assertEqual(result["coverage"]["open_prs"], 1)
        self.assertFalse(findings(result, "parallel_prs"))


class FileCollisionTests(unittest.TestCase):
    def test_paths_are_only_potential_risks_and_only_for_open_prs(self):
        result = report(prs=[pr(101, files=["scripts/shared.py"]),
                             pr(102, owner=12, files=[{"filename": "scripts/shared.py"}]),
                             pr(103, files=["scripts/shared.py"], state="closed")])
        collision, = findings(result, "file_collision")
        self.assertEqual(collision["severity"], "warning")
        self.assertEqual(collision["prs"], [101, 102])
        self.assertEqual(collision["files"], ["scripts/shared.py"])
        self.assertEqual(result["counts"]["confirmed"], 0)

    def test_missing_lists_are_unknown_and_empty_lists_are_known(self):
        result = report(prs=[pr(101), pr(102, owner=12, files=[])])
        self.assertEqual(result["coverage"]["file_lists_missing"], [101])
        self.assertEqual(result["coverage"]["file_lists_provided"], [102])
        self.assertFalse(findings(result, "file_collision"))

    def test_renames_and_duplicate_paths(self):
        result = report(prs=[pr(101, files=[{"filename": "new.py", "previous_filename": "old.py"}]),
                             pr(102, owner=12, files=["old.py", "old.py"])])
        collision, = findings(result, "file_collision")
        self.assertEqual(collision["files"], ["old.py"])

    def test_nextjs_unicode_and_markdown_punctuation_in_paths(self):
        paths = ["app/[id]/page.tsx", "docs/équipe.md", "docs/a|b`c.md"]
        result = report(prs=[pr(101, files=paths), pr(102, owner=12, files=paths)])
        self.assertEqual(findings(result, "file_collision")[0]["files"], sorted(paths))
        table = overlap.markdown(result)
        self.assertIn("` app/[id]/page.tsx `", table)
        self.assertIn("`` docs/a\\|b`c.md ``", table)


class ValidationAndCliTests(unittest.TestCase):
    def test_invalid_shapes_ids_and_paths_fail_closed(self):
        cases = [
            (None, [], []), ({"missions": {}}, [], []),
            ({"missions": [{"issue": True}]}, [], []),
            ({"missions": [{"issue": 0}]}, [], []),
            ({"missions": [{"issue": 11, "agent": "a|b"}]}, [], []),
            (registry(), [[issue(number=True)]], []),
            (registry(), [[issue(number=2**53)]], []),
            (registry(), [[issue(state="unknown")]], []),
            (registry(), [[issue(active="yes")]], []),
            (registry(), [[issue(labels=[{}])]], []),
            (registry(), [[issue(agents="DAO Alpha")]], []),
            (registry(), [[issue(agent="name\nSECRET")]], []),
            (registry(), [{"issues": "wrong"}], []),
            (registry(), [], [[pr(body=42)]]),
            (registry(), [], [[pr(body="Owner issue: #" + "9" * 5000)]]),
            (registry(), [], [[pr(replaces=[101])]]),
            (registry(), [], [[pr(replaces="#99")]]),
            (registry(), [], [[pr(files={})]]),
            (registry(), [], [[pr(files=[123])]]),
            (registry(), [], [[pr(files=["../secret"])]]),
            (registry(), [], [[pr(files=["/private/key"])]]),
            (registry(), [], [[pr(files=["a\nb"])]]),
            (registry(), [], [[pr(files=["keys/github_pat_PRIVATE"])]]),
            (registry(), [], [[pr(files=[{"filename": "a.py", "previous_filename": "../b.py"}])]]),
            (registry(), [], [[pr(), pr(state="closed")]]),
        ]
        for index, (missions, issues, prs) in enumerate(cases):
            with self.subTest(case=index), self.assertRaises(overlap.InvalidData):
                overlap.audit(missions, issues, prs)

    def cli(self, issues=(), prs=(), fmt="json", invalid=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = {"registry.json": json.dumps(registry()), "issues.json": json.dumps(list(issues)),
                      "prs.json": json.dumps(list(prs))}
            if invalid is not None:
                inputs["issues.json"] = invalid
            for name, content in inputs.items():
                (root / name).write_text(content)
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            result = subprocess.run([sys.executable, str(SCRIPT), "--registry", str(root / "registry.json"),
                                     "--issues", str(root / "issues.json"), "--prs", str(root / "prs.json"),
                                     "--format", fmt], capture_output=True, text=True, cwd=root)
            self.assertEqual({p.name: p.read_bytes() for p in root.iterdir()}, before)
            self.assertEqual(result.stderr, "")
            return result

    def test_exit_codes_json_and_markdown(self):
        for fmt in ("json", "markdown"):
            with self.subTest(fmt=fmt):
                self.assertEqual(self.cli(prs=[pr()], fmt=fmt).returncode, 0)
                self.assertEqual(self.cli(prs=[pr(), pr(102)], fmt=fmt).returncode, 1)
                result = self.cli(fmt=fmt, invalid="not JSON PRIVATE_VALUE")
                self.assertEqual(result.returncode, 2)
                self.assertNotIn("PRIVATE_VALUE", result.stdout)
                self.assertNotIn("Traceback", result.stdout)
                if fmt == "markdown":
                    self.assertIn("| invalid |", result.stdout)

    def test_warning_only_exit_zero_and_no_sensitive_free_text(self):
        secret = "DO_NOT_PUBLISH_THIS_VALUE"
        for fmt in ("json", "markdown"):
            with self.subTest(fmt=fmt):
                result = self.cli(issues=[issue(77, active=True, agent=secret, title=secret, source=secret,
                                                html_url="https://example.invalid/" + secret)],
                                  prs=[pr(body="Owner issue: #11\n" + secret, title=secret)], fmt=fmt)
                self.assertEqual(result.returncode, 0)
                self.assertNotIn(secret, result.stdout + result.stderr)
                self.assertIn("unknown_agent", result.stdout)
                self.assertNotIn("https://", result.stdout)

    def test_non_renderable_filename_is_invalid_data_in_both_formats(self):
        for path in ("bad\ud800.py", "bad\u2028.py", "bad\u0085.py"):
            for fmt in ("json", "markdown"):
                with self.subTest(path=ascii(path), fmt=fmt):
                    result = self.cli(prs=[pr(files=[path])], fmt=fmt)
                    self.assertEqual(result.returncode, 2)
                    self.assertIn("invalid_file_path", result.stdout)
                    self.assertNotIn("Traceback", result.stdout)

    def test_strict_json_duplicate_keys_constants_and_unreadable_input(self):
        for raw in ('{"issues": [], "issues": []}', '[NaN]', '[Infinity]'):
            with self.subTest(raw=raw):
                result = self.cli(invalid=raw)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(json.loads(result.stdout)["result"], "invalid")
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            status = overlap.main(["--registry", "/missing/PRIVATE_PATH.json"])
        self.assertEqual(status, 2)
        self.assertNotIn("PRIVATE_PATH", output.getvalue())

    def test_bad_arguments_do_not_echo_untrusted_values(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            status = overlap.main(["--PRIVATE_VALUE"])
        self.assertEqual(status, 2)
        self.assertNotIn("PRIVATE_VALUE", output.getvalue())

    def test_stable_output_and_no_network_or_processes_from_audit(self):
        with patch("socket.socket", side_effect=AssertionError("no network")), \
             patch("subprocess.run", side_effect=AssertionError("no subprocess")):
            result = report(prs=[pr(), pr(102)])
            self.assertEqual(result["result"], "conflict")
        first = self.cli(prs=[pr(), pr(102)])
        second = self.cli(prs=[pr(), pr(102)])
        self.assertEqual(first.stdout, second.stdout)


if __name__ == "__main__":
    unittest.main()
