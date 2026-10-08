#!/usr/bin/python3 -I
"""Root-only nftables guard blocking the D.A.O runtime from direct OCE TCP/8080."""

import json
import os
import pwd
import shutil
import subprocess
import sys

TABLE = "dao_oce_guard"


class Halt(ValueError):
    pass


def nft_path():
    for value in ("/usr/sbin/nft", "/usr/bin/nft"):
        if os.path.isfile(value) and os.access(value, os.X_OK):
            return value
    found = shutil.which("nft")
    if found:
        return found
    raise Halt("nft unavailable")


def run(args, *, input_text=None, check=True):
    result = subprocess.run(
        args,
        input=input_text.encode() if input_text is not None else None,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=10,
    )
    if check and result.returncode:
        raise Halt("nft command failed")
    return result.returncode


def table_exists(nft):
    return run([nft, "list", "table", "inet", TABLE], check=False) == 0


def start():
    nft = nft_path()
    uid = pwd.getpwnam("dao").pw_uid
    if table_exists(nft):
        run([nft, "delete", "table", "inet", TABLE])
    rules = f"""table inet {TABLE} {{
  chain output {{
    type filter hook output priority 0; policy accept;
    meta skuid {uid} tcp dport 8080 reject
  }}
}}
"""
    run([nft, "-f", "-"], input_text=rules)
    if not table_exists(nft):
        raise Halt("nft guard not active")
    print(json.dumps({"egress_guard": "active"}, sort_keys=True))


def stop():
    nft = nft_path()
    if table_exists(nft):
        run([nft, "delete", "table", "inet", TABLE])
    print(json.dumps({"egress_guard": "inactive"}, sort_keys=True))


def status():
    nft = nft_path()
    print(json.dumps({"egress_guard": "active" if table_exists(nft) else "inactive"}, sort_keys=True))


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in {"start", "stop", "status"}:
        raise Halt("usage")
    {"start": start, "stop": stop, "status": status}[sys.argv[1]]()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        reason = str(exc) if isinstance(exc, Halt) else "internal_or_command_error"
        print(json.dumps({"oce_egress_guard_error": reason}, sort_keys=True), file=sys.stderr)
        sys.exit(1)
