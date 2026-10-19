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


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=False, stderr=subprocess.DEVNULL)


def classify_repo(base, head):
    if not (re.fullmatch(r"[a-f0-9]{40}", base or "") and
            re.fullmatch(r"[a-f0-9]{40}", head or "")):
        return "full"
    try:
        # If the base is not locally available in the shallow checkout, obtain
        # *that exact commit*. Failure always means FULL, never a fast pass.
        try:
            git("cat-file", "-e", base + "^{commit}")
        except subprocess.CalledProcessError:
            git("fetch", "--no-tags", "--depth=1", "origin", base)
        raw = git("diff", "--name-status", "-z", "--no-renames", base, head)
        fields = raw.decode("utf-8").split("\0")
        if fields[-1] != "":
            return "full"
        pairs = list(zip(fields[0:-1:2], fields[1:-1:2]))
        if not pairs or len(fields[:-1]) != 2 * len(pairs):
            return "full"
        if any(Path(p).is_symlink() or not Path(p).is_file() for _, p in pairs):
            return "full"
        old = git("show", base + ":" + CONTRACT).decode("utf-8")
        new = (ROOT / CONTRACT).read_text(encoding="utf-8")
        migrations = {
            path: (ROOT / path).read_text(encoding="utf-8")
            for status, path in pairs if status == "A"
        }
        return classify_diff(pairs, old, new, migrations)
    except (OSError, UnicodeError, ValueError, subprocess.CalledProcessError):
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
