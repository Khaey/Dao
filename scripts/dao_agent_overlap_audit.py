#!/usr/bin/env python3
"""Read-only, offline audit of D.A.O mission ownership and open PR overlap.

Inputs are REDACTED current snapshots, never credentials or raw logs. Registry:
{"missions": [{"issue": 226, "agent": "DAO DEV 20"}]}. Issue/PR exports may
be arrays or {"issues": [...]} / {"pull_requests": [...]} ("prs" also works).
Records require positive integer "number" (or "issue_number") and "state"
("open" / "closed"). Optional "agent" / "agents" are explicit AI assignments;
GitHub human assignees are never interpreted as agents. An issue is active only
with "active": true or a dao:active / dao:in-progress label, not merely open.

PR ownership uses "owner_issue" or a standalone `Owner issue: #N` body line.
Explicit replacements use "replaces": [N] or standalone Replaces:/Supersedes:/
Remplace: #N lines (also `This PR replaces #N` / `Cette PR remplace #N`). Mere
references, titles, quoted text and fenced examples do not establish ownership.
Optional "files" contains relative filenames or GitHub {"filename": ...}
objects; previous_filename is included for renames. Missing lists stay unknown.

Output includes only IDs, registry agent labels, relative file paths and logical
source positions (issues[file_index][record_index], etc.), never titles, bodies,
URLs, input paths or unknown agent names. No network, subprocess or file writes.
Exit: 0 no confirmed conflict (warnings possible), 1 confirmed conflict,
2 invalid/unreadable data. JSON is stable (no timestamps); Markdown is a table.

Example:
  python3 scripts/dao_agent_overlap_audit.py --issues issues.json --prs prs.json
  python3 scripts/dao_agent_overlap_audit.py --prs prs.json --format markdown
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path, PurePosixPath
import re
import sys

MAX_BYTES = 8 * 1024 * 1024
OWNER = re.compile(r"Owner issue:[ \t]*#([1-9][0-9]*)[ \t]*", re.I)
REPLACEMENT = re.compile(r"(?:Replaces|Supersedes|Remplace):[ \t]*(#[1-9][0-9]*(?:[ ,\t]+#[1-9][0-9]*)*)[ \t]*", re.I)
REPLACEMENT_SENTENCE = re.compile(r"(?:This PR replaces|Cette PR remplace) #([1-9][0-9]*)\b.*", re.I)
SENSITIVE = re.compile(r"github_pat_|gh[pousr]_|-----BEGIN|eyJ[A-Za-z0-9_-]{12,}|\bsk-[A-Za-z0-9]{12,}", re.I)
MESSAGES = {
    "multiple_agents": "The same issue has multiple explicit agent assignments.",
    "parallel_prs": "Multiple open PR candidates share one owner issue.",
    "replacement_cycle": "Replacement declarations form a cycle; none is accepted as a successor.",
    "declared_replacement": "Explicit replacement declaration; not a conflict by itself or a verified handoff.",
    "replacement_owner_mismatch": "The replacement target has a different or unknown owner issue.",
    "unknown_agent": "An explicit agent name is absent from the registry; its value is withheld.",
    "missing_registry_agent": "A registry mission has no agent.",
    "unassigned_active_issue": "An explicitly active open issue has no explicit or registry assignment.",
    "missing_pr_owner": "An open PR has no canonical owner issue.",
    "ambiguous_pr_owner": "An open PR declares multiple owner issues; no owner is selected.",
    "file_collision": "Shared file paths are a potential integration risk, not a confirmed duplicate.",
}


class InvalidData(ValueError):
    """Only fixed error codes and generated source positions may be emitted."""

    def __init__(self, code, source):
        self.code, self.source = code, source


def require(condition, code, source):
    if not condition:
        raise InvalidData(code, source)


def number(value, source):
    require(type(value) is int and 0 < value <= 2**53 - 1, "invalid_number", source)
    return value


def reference(value, source):
    require(len(value) <= 16, "invalid_number", source)
    return number(int(value), source)


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "duplicate_json_key", "input")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError("nonstandard_json_constant")


def load_json(path, source):
    try:
        with Path(path).open("rb") as stream:
            raw = stream.read(MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES, "input_too_large", source)
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=reject_constant)
    except InvalidData as exc:
        raise InvalidData(exc.code, source) from None
    except (OSError, ValueError, RecursionError):
        raise InvalidData("unreadable_or_invalid_json", source) from None


def records(documents, kind):
    for file_index, document in enumerate(documents):
        source = f"{kind}[{file_index}]"
        if isinstance(document, dict):
            key = "issues" if kind == "issues" else "pull_requests"
            document = document.get(key, document.get("prs") if kind == "prs" else None)
        require(isinstance(document, list), "invalid_collection", source)
        for index, row in enumerate(document):
            position = f"{source}[{index}]"
            require(isinstance(row, dict), "invalid_record", position)
            yield row, position


def identity(row, source):
    value = number(row.get("number", row.get("issue_number")), source)
    if "issue_number" in row:
        require(number(row["issue_number"], source) == value, "inconsistent_number", source)
    require(row.get("state") in ("open", "closed"), "invalid_state", source)
    return value


def agent_names(row, source):
    result = row.get("agents", [])
    require(isinstance(result, list), "invalid_agents", source)
    result = list(result)
    if row.get("agent") not in (None, ""):
        result.append(row["agent"])
    for name in result:
        require(isinstance(name, str) and 0 < len(name) <= 80
                and not any(ord(c) < 32 for c in name), "invalid_agent", source)
    return {" ".join(name.split()).casefold(): " ".join(name.split())
            for name in result if name.strip()}


def plain_lines(body, source):
    require(body is None or isinstance(body, str), "invalid_body", source)
    fence, comment = None, False
    for line in (body or "").splitlines():
        stripped = line.lstrip()
        marker = re.match(r"(`{3,}|~{3,})(.*)", stripped)
        if marker:
            if fence is None:
                fence = marker[1]
            elif (marker[1][0] == fence[0] and len(marker[1]) >= len(fence)
                  and not marker[2].strip()):
                fence = None
            continue
        if fence is not None:
            continue
        if comment or "<!--" in stripped:
            comment = "-->" not in stripped
            continue
        if fence is None and len(line) - len(stripped) < 4 and not stripped.startswith(">"):
            yield stripped


def pr_metadata(row, source):
    owners, replaces = set(), set()
    if "owner_issue" in row and row["owner_issue"] is not None:
        owners.add(number(row["owner_issue"], source))
    declared = row.get("replaces", [])
    require(isinstance(declared, list), "invalid_replaces", source)
    replaces.update(number(item, source) for item in declared)
    for line in plain_lines(row.get("body"), source):
        match = OWNER.fullmatch(line)
        if match:
            owners.add(reference(match[1], source))
        match = REPLACEMENT.fullmatch(line)
        if match:
            replaces.update(reference(item, source) for item in re.findall(r"#([0-9]+)", match[1]))
        match = REPLACEMENT_SENTENCE.fullmatch(line)
        if match:
            replaces.add(reference(match[1], source))
    return owners, replaces


def file_paths(row, source):
    if "files" not in row:
        return None
    require(isinstance(row["files"], list), "invalid_files", source)
    result = set()
    for item in row["files"]:
        require(isinstance(item, (str, dict)), "invalid_file", source)
        paths = [item] if isinstance(item, str) else [item.get("filename")]
        if isinstance(item, dict) and "previous_filename" in item:
            paths.append(item["previous_filename"])
        for path in paths:
            require(isinstance(path, str) and 0 < len(path) <= 1024
                    and not any(ord(char) < 32 or 127 <= ord(char) <= 159
                                or 0xD800 <= ord(char) <= 0xDFFF
                                or (char.isspace() and char != " ") for char in path)
                    and "\\" not in path
                    and not PurePosixPath(path).is_absolute()
                    and all(part not in ("", ".", "..") for part in path.split("/"))
                    and not SENSITIVE.search(path), "invalid_file_path", source)
            result.add(path)
    return result


def has_cycle(nodes, edges):
    incoming = dict.fromkeys(nodes, 0)
    for targets in edges.values():
        for target in targets:
            incoming[target] += 1
    ready = [node for node, count in incoming.items() if count == 0]
    visited = 0
    while ready:
        node = ready.pop()
        visited += 1
        for target in edges.get(node, ()):
            incoming[target] -= 1
            if incoming[target] == 0:
                ready.append(target)
    return visited != len(nodes)


def audit(registry, issue_exports=(), pr_exports=()):
    """Return a deterministic, redacted report; exports are sequences of documents."""
    require(isinstance(registry, dict) and isinstance(registry.get("missions"), list),
            "invalid_registry", "registry")
    findings, known, unknown = [], {}, {}
    assignments = defaultdict(lambda: defaultdict(set))

    def note(code, severity="warning", issue=None, prs=(), agents=(), files=(), sources=()):
        findings.append(dict(code=code, message=MESSAGES[code], severity=severity, issue=issue,
                             prs=sorted(set(prs)), agents=sorted(set(agents)),
                             files=sorted(set(files)), sources=sorted(set(sources))))

    for index, mission in enumerate(registry["missions"]):
        source = f"registry.missions[{index}]"
        require(isinstance(mission, dict), "invalid_mission", source)
        issue = number(mission.get("issue"), source)
        names = agent_names(mission, source)
        for key, name in names.items():
            require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}", name) is not None
                    and not SENSITIVE.search(name), "invalid_registry_agent", source)
            known.setdefault(key, name)
            assignments[issue][key].add(source)
        if not names:
            note("missing_registry_agent", issue=issue, sources=[source])

    def add_agents(row, source, issue, prs=()):
        for key in sorted(agent_names(row, source)):
            if key not in known:
                unknown.setdefault(key, f"unregistered-agent-{len(unknown) + 1}")
                note("unknown_agent", issue=issue, prs=prs,
                     agents=[unknown[key]], sources=[source])
            if issue is not None:
                assignments[issue][key].add(source)

    active, issue_ids = defaultdict(set), set()
    for row, source in records(issue_exports, "issues"):
        if "pull_request" in row:  # GitHub's issues endpoint also includes PRs.
            continue
        issue = identity(row, source)
        issue_ids.add(issue)
        require("active" not in row or type(row["active"]) is bool, "invalid_active", source)
        labels = row.get("labels", [])
        require(isinstance(labels, list), "invalid_labels", source)
        label_names = set()
        for label in labels:
            name = label.get("name") if isinstance(label, dict) else label
            require(isinstance(name, str), "invalid_label", source)
            label_names.add(name)
        if row["state"] == "open" and (row.get("active") is True or
                label_names & {"dao:active", "dao:in-progress"}):
            active[issue].add(source)
        add_agents(row, source, issue)

    prs = {}
    for row, source in records(pr_exports, "prs"):
        pr = identity(row, source)
        owners, replaces = pr_metadata(row, source)
        require(pr not in replaces, "self_replacement", source)
        paths = file_paths(row, source)
        value = dict(state=row["state"], owners=owners, replaces=replaces, files=paths)
        if pr in prs:
            require(all(prs[pr][key] == item for key, item in value.items()),
                    "inconsistent_pr_snapshot", source)
            prs[pr]["sources"].add(source)
        else:
            prs[pr] = {**value, "sources": {source}}
        owner = next(iter(owners)) if len(owners) == 1 else None
        if row["state"] == "open":
            add_agents(row, source, owner, [pr])

    for issue, by_agent in sorted(assignments.items()):
        if len(by_agent) > 1:
            note("multiple_agents", "confirmed", issue=issue,
                 agents=[known.get(key, unknown.get(key)) for key in by_agent],
                 sources=[source for refs in by_agent.values() for source in refs])
    for issue, sources in sorted(active.items()):
        if not assignments[issue]:
            note("unassigned_active_issue", issue=issue, sources=sources)

    groups, paths_to_prs = defaultdict(set), defaultdict(set)
    for pr, value in sorted(prs.items()):
        if value["state"] != "open":
            continue
        owners = value["owners"]
        owner = next(iter(owners)) if len(owners) == 1 else None
        if owner is None:
            note("ambiguous_pr_owner" if owners else "missing_pr_owner",
                 prs=[pr], sources=value["sources"])
        else:
            groups[owner].add(pr)
        for old in sorted(value["replaces"]):
            note("declared_replacement", issue=owner, prs=[pr, old], sources=value["sources"])
            if old in prs and (owner is None or prs[old]["owners"] != {owner}):
                note("replacement_owner_mismatch", issue=owner, prs=[pr, old],
                     sources=value["sources"] | prs[old]["sources"])
        for path in value["files"] or ():
            paths_to_prs[path].add(pr)

    for issue, members in sorted(groups.items()):
        edges = {pr: prs[pr]["replaces"] & members for pr in members}
        sources = {source for pr in members for source in prs[pr]["sources"]}
        cycle = has_cycle(members, edges)
        if cycle:
            note("replacement_cycle", issue=issue, prs=members, sources=sources)
        superseded = set().union(*edges.values())
        if cycle or len(members - superseded) > 1:
            note("parallel_prs", "confirmed", issue=issue, prs=members, sources=sources)

    collisions = defaultdict(list)
    for path, members in paths_to_prs.items():
        if len(members) > 1:
            collisions[tuple(sorted(members))].append(path)
    for members, paths in sorted(collisions.items()):
        note("file_collision", prs=members, files=paths,
             sources=[source for pr in members for source in prs[pr]["sources"]])
    findings.sort(key=lambda row: (row["severity"], row["code"], row["issue"] or 0,
                                   row["prs"], row["sources"], row["agents"]))
    counts = {level: sum(row["severity"] == level for row in findings)
              for level in ("confirmed", "warning")}
    open_prs = sorted(pr for pr in prs if prs[pr]["state"] == "open")
    return dict(schema_version=1, result="conflict" if counts["confirmed"] else "no_confirmed_conflict",
                counts=counts, coverage=dict(issues=len(issue_ids), open_prs=len(open_prs),
                    file_lists_provided=[pr for pr in open_prs if prs[pr]["files"] is not None],
                    file_lists_missing=[pr for pr in open_prs if prs[pr]["files"] is None]), findings=findings)


def markdown(report):
    if report["result"] == "invalid":
        return "| Result | Error | Source |\n| --- | --- | --- |\n| invalid | {code} | {source} |".format(**report["error"])
    lines = [f"Confirmed: {report['counts']['confirmed']}; warnings: {report['counts']['warning']}.",
             "", "| Severity | Finding | Issue | PRs | Agents | Files | Sources |",
             "| --- | --- | --- | --- | --- | --- | --- |"]
    for row in report["findings"]:
        # Code spans keep filenames inert, including Next.js [id] paths and
        # Markdown punctuation. Escape pipes for the surrounding table.
        paths = []
        for path in row["files"]:
            ticks = "`" * (max((len(m[0]) for m in re.finditer(r"`+", path)), default=0) + 1)
            paths.append(ticks + " " + path.replace("|", "\\|") + " " + ticks)
        cells = [row["severity"], row["code"] + ": " + row["message"], f"#{row['issue']}" if row["issue"] else "-",
                 ", ".join(f"#{pr}" for pr in row["prs"]) or "-",
                 ", ".join(row["agents"]) or "-", ", ".join(paths) or "-",
                 ", ".join(row["sources"])]
        lines.append("| " + " | ".join(cells) + " |")
    if not report["findings"]:
        lines.append("| - | No confirmed conflict in supplied snapshots | - | - | - | - | - |")
    missing = ", ".join(f"#{pr}" for pr in report["coverage"]["file_lists_missing"]) or "none"
    lines.extend(["", f"PR file lists missing: {missing}. Shared paths are warnings, not proven duplicate work."])
    return "\n".join(lines)


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise InvalidData("invalid_arguments", "arguments")


def main(argv=None):
    args = None
    try:
        parser = Parser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
        parser.add_argument("--registry", default=".github/dao-monitor-agents.json")
        parser.add_argument("--issues", action="append", default=[], help="Redacted issue export; repeatable")
        parser.add_argument("--prs", action="append", default=[], help="Redacted PR export; repeatable")
        parser.add_argument("--format", choices=("json", "markdown"), default="json")
        args = parser.parse_args(argv)
        registry = load_json(args.registry, "registry")
        issues = [load_json(path, f"issues[{i}]") for i, path in enumerate(args.issues)]
        prs = [load_json(path, f"prs[{i}]") for i, path in enumerate(args.prs)]
        report = audit(registry, issues, prs)
        status = 1 if report["counts"]["confirmed"] else 0
    except InvalidData as exc:
        report = dict(schema_version=1, result="invalid", error=dict(code=exc.code, source=exc.source))
        status = 2
    print(markdown(report) if args is not None and args.format == "markdown"
          else json.dumps(report, ensure_ascii=True, indent=2, sort_keys=True))
    return status


if __name__ == "__main__":
    sys.exit(main())
