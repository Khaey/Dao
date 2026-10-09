#!/usr/bin/env python3
"""Root-installed fixed operations; no user-supplied config, token or shell."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time

ROOT = Path('/etc/dao-oce-cloudflare')
SERVICE = 'dao-oce-cloudflared.service'


def private_file(path):
    s = path.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077:
        raise ValueError('Unsafe private file')
    return path.read_text(encoding='utf-8').strip()


def systemctl(action, check=True):
    return subprocess.run(['/usr/bin/systemctl', action, SERVICE], check=check,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def deadline(signum, frame):
    raise TimeoutError("Bounded private operation deadline")


def main():
    try:
        if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in ('audit', 'probe', 'start', 'stop', 'status'):
            raise ValueError('Unsupported operation')
        signal.signal(signal.SIGALRM, deadline)
        signal.alarm(180)
        s = ROOT.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
            raise ValueError('Unsafe private directory')
        with open(ROOT / '.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            op = sys.argv[1]
            if op == 'stop':
                systemctl('stop')
                print('{"tunnel_stopped":true,"public_8080_changed":false}')
                return 0
            if op == 'status':
                print(json.dumps({'service_active': systemctl('is-active', False).returncode == 0,
                                  'public_8080_changed': False}))
                return 0
            spec = importlib.util.spec_from_file_location('oce_cf', '/usr/local/libexec/dao-oce-cloudflare.py')
            cf = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cf)
            m = cf.validate_manifest(json.loads(private_file(ROOT / 'approved.json')))
            if op == 'probe':
                # Run without cookies as the actual D.A.O Unix identity.
                subprocess.run(['/usr/sbin/runuser', '-u', 'dao', '--', '/usr/bin/python3',
                                '/usr/local/libexec/dao-oce-cloudflare.py', 'probe', m['team_name']], check=True, timeout=110)
                return 0
            token = private_file(ROOT / 'api-token')
            result = cf.audit(m, lambda p: cf.api_get(p, token))
            if op == 'start':
                # Local binding only; CF verifies the actual secret when connecting.
                cf.validate_tunnel_token(private_file(ROOT / 'tunnel-token'), m)
                systemctl('start')
                try:
                    ready = False
                    for _ in range(15):
                        try:
                            with cf.OPENER.open('http://127.0.0.1:49312/ready', timeout=2) as response:
                                ready = response.status == 200
                            if ready:
                                break
                        except Exception:
                            time.sleep(1)
                    cf.require(ready and systemctl('is-active', False).returncode == 0)
                    live = cf.api_get('/accounts/' + m['account_id'] + '/cfd_tunnel/' + m['tunnel_id'], token)
                    cf.require(live.get('status') == 'healthy')
                    cf.probe(m['team_name'])
                except Exception:
                    systemctl('stop', False)
                    raise
                result['tunnel_ready'] = True
            print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        if os.geteuid() == 0 and len(sys.argv) == 2 and sys.argv[1] == 'start':
            systemctl('stop', False)
        print('OCE_PRIVATE_OPERATION_FAILED (details withheld)', file=sys.stderr)
        return 1
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    sys.exit(main())
