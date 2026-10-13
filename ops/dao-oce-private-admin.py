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
TUNNEL_ID = '0a42e8b3-1f74-4b3b-8440-e54efe20145a'
MAX_PROVISION_PAYLOAD = 24 * 1024


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


def strict_json(raw):
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError('Duplicate JSON key')
            value[key] = item
        return value
    return json.loads(raw, object_pairs_hook=pairs)


def provision(cf):
    raw = sys.stdin.read(MAX_PROVISION_PAYLOAD + 1)
    cf.require(len(raw) <= MAX_PROVISION_PAYLOAD)
    values = strict_json(raw)
    cf.require(isinstance(values, dict) and set(values) == {
        'api_token', 'tunnel_token', 'approved_emails'})
    token = values['api_token']
    tunnel_token = values['tunnel_token']
    approved = values['approved_emails']
    cf.require(all(isinstance(value, str) for value in values.values()))
    cf.require(0 < len(token) <= 4096 and all(33 <= ord(char) <= 126 for char in token))
    cf.require(0 < len(tunnel_token) <= 4096 and 0 < len(approved) <= 16384)
    emails = [email.strip().lower() for email in approved.split(',')]

    zones = cf.api_get('/zones?name=logiclab.fr&per_page=50', token)
    cf.require(len(zones) == 1 and zones[0].get('name') == 'logiclab.fr')
    account = zones[0].get('account', {}).get('id')
    zone_id = zones[0].get('id')
    base = '/accounts/' + account
    apps = cf.api_get(base + '/access/apps?per_page=100', token)
    selected = [app for app in apps if app.get('domain') == cf.HOST]
    cf.require(len(selected) == 1)
    organization = cf.api_get(base + '/access/organizations', token)
    domain = organization.get('auth_domain')
    cf.require(isinstance(domain, str) and domain.endswith('.cloudflareaccess.com'))
    manifest = cf.validate_manifest({
        'account_id': account, 'zone_id': zone_id, 'tunnel_id': TUNNEL_ID,
        'application_id': selected[0].get('id'),
        'team_name': domain.removesuffix('.cloudflareaccess.com'), 'emails': emails,
    })
    cf.validate_tunnel_token(tunnel_token, manifest)
    result = cf.audit(manifest, lambda path: cf.api_get(path, token))

    names = ('approved.json', 'api-token', 'tunnel-token')
    cf.require(all(not (ROOT / name).exists() and not (ROOT / name).is_symlink() for name in names))
    created = []
    try:
        for name, value in zip(names, (json.dumps(manifest), token, tunnel_token)):
            fd = os.open(ROOT / name, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            created.append(ROOT / name)
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                stream.write(value + '\n')
                stream.flush()
                os.fsync(stream.fileno())
    except BaseException:
        for path in created:
            path.unlink(missing_ok=True)
        raise
    print(json.dumps({'provisioning': 'complete',
                      'configuration_verified': result.get('configuration_verified') is True,
                      'configuration_written': True, 'tunnel_started': False}, sort_keys=True))


def main():
    stage = 'entry'
    try:
        if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in ('provision', 'audit', 'probe', 'start', 'stop', 'status'):
            raise ValueError('Unsupported operation')
        signal.signal(signal.SIGALRM, deadline)
        signal.alarm(180)
        s = ROOT.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
            raise ValueError('Unsafe private directory')
        with open(ROOT / '.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            op = sys.argv[1]
            stage = op
            if op == 'stop':
                systemctl('stop')
                print('{"tunnel_stopped":true,"public_8080_changed":false}')
                return 0
            if op == 'status':
                print(json.dumps({'service_active': systemctl('is-active', False).returncode == 0,
                                  'public_8080_changed': False}))
                return 0
            stage = 'load_cloudflare_helper'
            spec = importlib.util.spec_from_file_location('oce_cf', '/usr/local/libexec/dao-oce-cloudflare.py')
            cf = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cf)
            if op == 'provision':
                stage = 'provision'
                provision(cf)
                return 0
            stage = 'manifest'
            m = cf.validate_manifest(json.loads(private_file(ROOT / 'approved.json')))
            if op == 'probe':
                # Run without cookies as the actual D.A.O Unix identity.
                stage = 'probe'
                subprocess.run(['/usr/sbin/runuser', '-u', 'dao', '--', '/usr/bin/python3',
                                '/usr/local/libexec/dao-oce-cloudflare.py', 'probe', m['team_name']], check=True, timeout=110)
                return 0
            stage = 'api_token'
            token = private_file(ROOT / 'api-token')
            stage = 'audit'
            result = cf.audit(m, lambda p: cf.api_get(p, token))
            if op == 'start':
                # Local binding only; CF verifies the actual secret when connecting.
                stage = 'tunnel_token'
                cf.validate_tunnel_token(private_file(ROOT / 'tunnel-token'), m)
                stage = 'systemctl_start'
                systemctl('start')
                try:
                    stage = 'ready'
                    ready = False
                    for _ in range(15):
                        try:
                            with cf.OPENER.open('http://127.0.0.1:49312/ready', timeout=2) as response:
                                ready = response.status == 200
                            if ready:
                                break
                        except Exception:
                            time.sleep(1)
                    stage = 'service_active'
                    cf.require(ready and systemctl('is-active', False).returncode == 0)
                    stage = 'tunnel_health'
                    live = cf.api_get('/accounts/' + m['account_id'] + '/cfd_tunnel/' + m['tunnel_id'], token)
                    cf.require(live.get('status') == 'healthy')
                    stage = 'access_probe'
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
        print(json.dumps({'error': 'OCE_PRIVATE_OPERATION_FAILED', 'stage': stage, 'public_8080_changed': False}, sort_keys=True), file=sys.stderr)
        return 1
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    sys.exit(main())
