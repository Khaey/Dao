#!/usr/bin/env bash
set -euo pipefail
# Safe metadata only; suitable for public Actions logs. Never source the env file.
python3 - <<'PY'
import json, pathlib, re, subprocess
root = pathlib.Path('/opt/dao')
current = root / 'current'
release = current.resolve()
valid = release.parent == root / 'releases' and re.fullmatch(r'[0-9a-f]{40}-[0-9]+-[0-9]+', release.name)
p = subprocess.run(['systemctl', 'is-active', 'dao-dev.service'], capture_output=True, text=True, timeout=10)
state = p.stdout.strip()
print(json.dumps({'service': state if state in ('active', 'inactive', 'failed', 'activating', 'deactivating') else 'unknown',
                  'release': release.name if valid else 'unverified',
                  'admin_helper_installed': pathlib.Path('/usr/local/sbin/dao-dev-admin').is_file()}))
keys = ['RESEND_API_KEY', 'DAO_EMAIL_FROM', 'DAO_PUBLIC_URL']
try:
    data = pathlib.Path('/etc/dao/dao-dev.env').read_text()
    for key in keys:
        matches = re.findall(r'^\s*(?:export\s+)?' + key + r'\s*=(.*)$', data, re.M)
        status = 'absent' if not matches else 'duplicate' if len(matches) > 1 else 'empty' if matches[0].strip() in ('', "''", '\"\"') else 'present'
        print(f'ENV {key}={status}')
except OSError:
    print('ENV presence=unavailable')
PY
