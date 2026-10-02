#!/usr/bin/python3 -I
"""Installed root-owned: fixed D.A.O DEV operations, never an arbitrary shell."""
import grp
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile

ENV = Path('/etc/dao/dao-dev.env')
BACKUP = Path('/etc/dao/dao-dev.env.previous')
ALLOWED = {'RESEND_API_KEY', 'DAO_EMAIL_FROM', 'DAO_PUBLIC_URL'}


def rewrite_env(original, values):
    if not isinstance(values, dict) or not values or set(values) - ALLOWED:
        raise ValueError('unsupported or empty environment update')
    for key, value in values.items():
        if not isinstance(value, str) or not value or len(value) > 512 or any(c in value for c in '\r\n\x00'):
            raise ValueError('invalid environment value')
        if key == 'RESEND_API_KEY' and not re.fullmatch(r'[A-Za-z0-9_-]{8,256}', value):
            raise ValueError('invalid provider key format')
        if key == 'DAO_PUBLIC_URL' and value != 'https://dao-dev.logiclab.fr':
            raise ValueError('unexpected DEV URL')
        if key == 'DAO_EMAIL_FROM' and not re.fullmatch(r'[A-Za-z0-9 ._+@<>-]{3,254}', value):
            raise ValueError('invalid sender format')
        if key == 'DAO_EMAIL_FROM' and value.count('@') != 1:
            raise ValueError('invalid sender address')
    output, found = [], set()
    for line in original.splitlines():
        m = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=', line)
        if m and m[1] in values:
            if m[1] in found:
                raise ValueError('duplicate updated environment key')
            # Refuse unsupported multiline assignments rather than corrupting them.
            tokens = shlex.split(line, comments=True)
            if len(tokens) not in (1, 2) or (len(tokens) == 2 and tokens[0] != 'export'):
                raise ValueError('unsupported environment assignment')
            found.add(m[1])
            continue
        output.append(line)
    for key in sorted(values):
        output.append(key + '=' + shlex.quote(values[key]))
    return '\n'.join(output).rstrip() + '\n'


def atomic_write(path, text):
    fd, temp = tempfile.mkstemp(prefix='.dao-env-', dir=str(ENV.parent))
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o640)
            os.fchown(stream.fileno(), 0, grp.getgrnam('dao').gr_gid)
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise ValueError('requires installed sudo helper and one operation')
    directory = ENV.parent.stat()
    if directory.st_uid != 0 or directory.st_mode & 0o022:
        raise ValueError('unsafe environment directory')
    lock = os.open(str(ENV.parent / '.admin.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    operation = sys.argv[1]
    if operation == 'env-sync':
        # No arbitrary file path; fixed root-owned directory. No values in errors.
        directory = ENV.parent.stat()
        if directory.st_uid != 0 or directory.st_mode & 0o022 or ENV.is_symlink():
            raise ValueError('unsafe environment path ownership')
        raw = sys.stdin.read(8193)
        if len(raw) > 8192:
            raise ValueError('environment payload too large')
        values = json.loads(raw)
        original = ENV.read_text()
        updated = rewrite_env(original, values)
        if updated == original:
            print('ENV_SYNC unchanged')
            return
        atomic_write(BACKUP, original)
        atomic_write(ENV, updated)
        print('ENV_SYNC updated keys=' + ','.join(sorted(values)))
    elif operation == 'env-restore':
        if ENV.parent.stat().st_uid != 0 or ENV.parent.stat().st_mode & 0o022 or BACKUP.is_symlink():
            raise ValueError('unsafe environment backup path')
        atomic_write(ENV, BACKUP.read_text())
        print('ENV_RESTORE complete')
    elif operation == 'log-summary':
        p = subprocess.run(['/usr/bin/journalctl', '-u', 'dao-dev.service', '--since', '1 hour ago', '-n', '200', '-o', 'json', '--no-pager'], capture_output=True, text=True, timeout=15, check=True)
        counts = {}
        for line in p.stdout.splitlines():
            row = json.loads(line)
            priority = str(row.get('PRIORITY', 'unknown'))
            if priority not in [str(n) for n in range(8)]:
                priority = 'unknown'
            counts[priority] = counts.get(priority, 0) + 1
        print(json.dumps({'last_hour_max_200_entries_by_priority': counts, 'messages': 'withheld from public CI logs'}))
    else:
        raise ValueError('unsupported operation')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # JSON/parser/process exceptions can include secret values or log messages.
        print('D.A.O admin operation failed; no payload or log content disclosed', file=sys.stderr)
        sys.exit(1)
