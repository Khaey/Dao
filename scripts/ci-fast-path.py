#!/usr/bin/env python3
"""Fail-closed PR-only fast lane for pure OCE DROP FUNCTION housekeeping.

A fast PR still runs fresh Supabase migrations, ledger/schema checks and all
real DB integration tests. Full desktop/mobile browser E2E remains mandatory
on every push to protected main and for all other PR changes.
"""
import argparse
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = "dao-backend/tests/schema-contract.sql"
MIGRATION_RE = re.compile(r"dao-backend/supabase/migrations/(\d{14})_oce_[a-z0-9_]+\.sql\Z")
DROP_RE = re.compile(
    r"drop function if exists ((?:public|dao_private)\.oce_[a-z0-9_]+"
    r"\((?:(?:uuid|integer|text)(?:,(?:uuid|integer|text))*)\));\Z",
    re.IGNORECASE,
)


def safe_sql(sql):
    """Accept only BEGIN; one or more narrowly-scoped drops; COMMIT."""
    if "/*" in sql or "*/" in sql or "$$" in sql:
        return None
    lines = [line.strip() for line in sql.splitlines()
             if line.strip() and not line.lstrip().startswith("--")]
    if len(lines) < 3 or lines[0].lower() != "begin;" or lines[-1].lower() != "commit;":
        return None
    signatures = []
    for line in lines[1:-1]:
        match = DROP_RE.fullmatch(line)
        if not match:
            return None
        signatures.append(match.group(1).lower())
    return signatures if len(signatures) == len(set(signatures)) else None


def safe_contract(old, new, timestamp, signatures):
    """Old assertions must survive verbatim, with only new absence checks."""
    token = ",'" + timestamp + "'"
    if new.count(token) != 1:
        return False
    normalized = new.replace(token, "", 1)
    old_lines = old.splitlines()
    new_lines = normalized.splitlines()
    added = []
    old_index = 0
    for line in new_lines:
        if old_index < len(old_lines) and line == old_lines[old_index]:
            old_index += 1
        else:
            added.append(line.strip())
    if old_index != len(old_lines):
        return False
    if not added or len(added) > 12:
        return False
    if not any(line.startswith("RAISE EXCEPTION ") for line in added):
        return False
    for signature in signatures:
        if ("to_regprocedure('" + signature + "') IS NOT NULL") not in " ".join(added):
            return False
    # Reject inserts that could disable previous contract checks, or mutate DB.
    for line in added:
        upper = line.upper()
        if not (
            line.startswith("IF to_regprocedure(")
            or line.startswith("OR to_regprocedure(")
            or line.startswith("RAISE EXCEPTION '")
            or line == "END IF;"
            or not line
            or line.startswith("--")
        ):
            return False
        if any(word in upper for word in ("DROP ", "DELETE ", "UPDATE ", "ALTER ", "GRANT ", "REVOKE ", "RETURN;", "EXCEPTION WHEN")):
            return False
    return True


def classify_diff(changes, old_contract, new_contract, migrations):
    """Only one *new* OCE DROP FUNCTION migration + modified schema contract."""
    if len(changes) != 2 or (("M", CONTRACT) not in changes):
        return "full"
    newly_added = [path for status, path in changes if status == "A"]
    if len(newly_added) != 1:
        return "full"
    path = newly_added[0]
    matched = MIGRATION_RE.fullmatch(path)
    if not matched or path not in migrations:
        return "full"
    signatures = safe_sql(migrations[path])
    if not signatures:
        return "full"
    return "sql_cleanup" if safe_contract(old_contract, new_contract, matched.group(1), signatures) else "full"


# Other than the SQL case inherited from #324, only documentation or
# demonstrably static appearance changes qualify for a fast PR.
DOC_PATH = re.compile(r"(?:README\.md|CHANGELOG\.md|docs/[A-Za-z0-9_./-]+\.md)\Z")
VISUAL_PATH = re.compile(r"dao-frontend/(?:app|components)/[A-Za-z0-9_./\[\]-]+\.tsx\Z")
CSS_PATH = re.compile(r"dao-frontend/(?:app|components)/[A-Za-z0-9_./-]+\.css\Z")
CLASS_ATTR = re.compile(r"""(className\s*=\s*)(["'])([^"'\\\n\r{}]+)\2""")
PALETTE = re.compile(
    r"(?:bg|text|border)-(?:white|black|transparent|ink|teal|clay|sand|"
    r"red|green|blue|gray|slate|neutral)(?:-(?:50|100|200|300|400|500|600|700|800|900|950))?"
    r"(?:/\d{1,3})?\Z"
)
SHAPE = re.compile(r"(?:shadow-(?:none|sm|md|lg|xl|2xl)|rounded-(?:none|sm|md|lg|xl|2xl|3xl|full)|font-(?:normal|medium|semibold|bold))\Z")
CSS_DECL = re.compile(r"(?m)^(\s*(?:color|background-color|border-color|box-shadow)\s*:\s*)([^;{}\n]+)(;[ \t]*)$")
CSS_VALUE = re.compile(r"(?:#[0-9a-fA-F]{3,8}|transparent|currentColor|inherit|white|black|none|var\(--[a-zA-Z0-9_-]+\)|rgba?\([0-9.,% \t]+\)|hsla?\([0-9.,% \t]+\))\Z")


def docs_only(changes):
    return bool(changes) and all(status in ("A", "M", "D") and DOC_PATH.fullmatch(path)
                                 and ".." not in Path(path).parts for status, path in changes)


def purely_cosmetic(changes, old, new):
    """Only one modified TSX with static className colors/shapes, or one CSS
    file with values of narrowly whitelisted declarations changed. Refuse
    changes to markup, handlers, expressions, visibility, layout or behavior.
    """
    if len(changes) != 1 or changes[0][0] != "M" or old == new:
        return False
    path = changes[0][1]
    if VISUAL_PATH.fullmatch(path) and ".." not in Path(path).parts:
        def mask(match):
            return match.group(1) + match.group(2) + "@DAO_STATIC_CLASS@" + match.group(2)
        if CLASS_ATTR.sub(mask, old) != CLASS_ATTR.sub(mask, new):
            return False
        old_classes = [m.group(3).split() for m in CLASS_ATTR.finditer(old)]
        new_classes = [m.group(3).split() for m in CLASS_ATTR.finditer(new)]
        if len(old_classes) != len(new_classes):
            return False
        changed = False
        for before, after in zip(old_classes, new_classes):
            if before == after:
                continue
            changed = True
            for token in set(before).symmetric_difference(set(after)):
                prefix, _, cls = token.rpartition(":")
                if prefix not in ("", "hover", "focus-visible", "dark"):
                    return False
                if not (PALETTE.fullmatch(cls) or SHAPE.fullmatch(cls)):
                    return False
        return changed
    if CSS_PATH.fullmatch(path) and ".." not in Path(path).parts:
        def mask_css(match):
            return match.group(1) + "@DAO_COSMETIC_VALUE@" + match.group(3)
        if CSS_DECL.sub(mask_css, old) != CSS_DECL.sub(mask_css, new):
            return False
        old_values = [m.group(2).strip() for m in CSS_DECL.finditer(old)]
        new_values = [m.group(2).strip() for m in CSS_DECL.finditer(new)]
        return (len(old_values) == len(new_values) and old_values != new_values
                and all(CSS_VALUE.fullmatch(v) for v in old_values + new_values))
    return False


def classify_changes(changes, old_text="", new_text="", old_contract="", new_contract="", migrations=None):
    if docs_only(changes):
        return "docs"
    if purely_cosmetic(changes, old_text, new_text):
        return "cosmetic"
    return classify_diff(changes, old_contract, new_contract, migrations or {})


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=False, stderr=subprocess.DEVNULL)


def classify_repo(base, head):
    if not (re.fullmatch(r"[a-f0-9]{40}", base or "") and
            re.fullmatch(r"[a-f0-9]{40}", head or "")):
        return "full"
    try:
        # On PRs the checkout may contain a synthetic merge commit. Always
        # compare the two exact immutable SHAs from the pull_request event.
        for commit in (base, head):
            try:
                git("cat-file", "-e", commit + "^{commit}")
            except subprocess.CalledProcessError:
                git("fetch", "--no-tags", "--depth=1", "origin", commit)
        raw = git("diff", "--name-status", "-z", "--no-renames", base, head)
        fields = raw.decode("utf-8").split("\0")
        if fields[-1] != "":
            return "full"
        changes = list(zip(fields[0:-1:2], fields[1:-1:2]))
        if not changes or len(fields[:-1]) != 2 * len(changes):
            return "full"
        if any(status not in ("A", "M", "D") or ".." in Path(path).parts
               for status, path in changes):
            return "full"
        if docs_only(changes):
            return "docs"
        if len(changes) == 1 and changes[0][0] == "M":
            path = changes[0][1]
            if VISUAL_PATH.fullmatch(path) or CSS_PATH.fullmatch(path):
                old = git("show", base + ":" + path).decode("utf-8")
                new = git("show", head + ":" + path).decode("utf-8")
                if purely_cosmetic(changes, old, new):
                    return "cosmetic"
        if len(changes) != 2 or ("M", CONTRACT) not in changes:
            return "full"
        old_contract = git("show", base + ":" + CONTRACT).decode("utf-8")
        new_contract = git("show", head + ":" + CONTRACT).decode("utf-8")
        migrations = {
            path: git("show", head + ":" + path).decode("utf-8")
            for status, path in changes if status == "A"
        }
        return classify_diff(changes, old_contract, new_contract, migrations)
    except (OSError, UnicodeError, ValueError, subprocess.CalledProcessError, IndexError):
        return "full"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="")
    parser.add_argument("--head", default="")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    mode = classify_repo(args.base, args.head)
    with open(args.output, "a", encoding="utf-8") as target:
        target.write("mode=" + mode + "\n")
    print("DAO_CI_SCOPE=" + mode + " (main always runs full browser E2E)")


if __name__ == "__main__":
    main()
