#!/usr/bin/env python3
"""Read-only capability metadata; no journal, environment or credential reads."""
import hashlib
import json
from pathlib import Path
import stat
import subprocess

HELPERS = {
    'dev': ('/usr/local/sbin/dao-dev-admin', ('log-summary', 'oce-gateway-plan')),
    'private_oce': ('/usr/local/sbin/dao-oce-private-admin', ('status',)),
    'maintenance': ('/usr/local/sbin/dao-ops-admin', ('status', 'preflight', 'upgrade', 'rollback', 'backup-status')),
}


def metadata(path):
    try:
        p = Path(path)
        entries = [p, *p.parents]
        safe = all(e.lstat().st_uid == 0 and not e.lstat().st_mode & 0o022
                   and not stat.S_ISLNK(e.lstat().st_mode) for e in entries)
        m = p.lstat()
        safe = safe and stat.S_ISREG(m.st_mode) and m.st_size <= 512 * 1024
        return {'installed': True, 'root_controlled': safe,
                'sha256': hashlib.sha256(p.read_bytes()).hexdigest() if safe else None}
    except OSError:
        return {'installed': False, 'root_controlled': False, 'sha256': None}


def grant(path, verb):
    try:
        return subprocess.run(['sudo', '-n', '-l', '--', path, verb],
                              capture_output=True, timeout=8).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def main():
    report = {}
    for name, (path, verbs) in HELPERS.items():
        row = metadata(path)
        row['grants'] = {verb: grant(path, verb) for verb in verbs}
        report[name] = row
    print(json.dumps({'ops_diagnostics': report, 'secrets_read': False,
                      'bootstrap_required': not (report['maintenance']['root_controlled']
                                                 and all(report['maintenance']['grants'].values()))}, sort_keys=True))


if __name__ == '__main__':
    main()
