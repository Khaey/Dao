#!/usr/bin/env python3
"""One-time trusted root/TTY provisioning. No CF writes, no tunnel start."""
import fcntl
import getpass
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import warnings

ROOT = Path('/etc/dao-oce-cloudflare')


def provision(cf, get, tunnel_id, emails, tunnel_token, token, root=ROOT):
    cf.require(bool(re.fullmatch(r'[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}', tunnel_id)))
    zones = get('/zones?name=logiclab.fr&per_page=100')
    cf.require(len(zones) == 1 and zones[0]['name'] == 'logiclab.fr')
    account = zones[0]['account']['id']
    cf.require(bool(re.fullmatch(r'[a-f0-9]{32}', account)))
    base = '/accounts/' + account
    apps = get(base + '/access/apps?per_page=100')
    selected = [app for app in apps if app.get('domain') == cf.HOST]
    cf.require(len(selected) == 1)
    org = get(base + '/access/organizations')
    domain = org['auth_domain']
    cf.require(domain.endswith('.cloudflareaccess.com'))
    manifest = cf.validate_manifest({'account_id': account, 'zone_id': zones[0]['id'],
                 'tunnel_id': tunnel_id, 'application_id': selected[0]['id'],
                 'team_name': domain.removesuffix('.cloudflareaccess.com'), 'emails': emails})
    cf.validate_tunnel_token(tunnel_token, manifest)
    cf.audit(manifest, get)  # Independent supplied email list must match live policy.
    names = ('approved.json', 'api-token', 'tunnel-token')
    cf.require(all(not (root / name).exists() and not (root / name).is_symlink() for name in names))
    data = (json.dumps(manifest), token, tunnel_token)
    created = []
    try:
        for name, value in zip(names, data):
            # O_EXCL + root-only directory: never overwrite an existing credential.
            fd = os.open(root / name, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            created.append(root / name)
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                f.write(value + '\n')
                f.flush()
                os.fsync(f.fileno())
    except Exception:
        for path in created:
            path.unlink(missing_ok=True)
        raise


def expired(signum, frame):
    raise TimeoutError('Provisioning deadline')


def main():
    try:
        if os.geteuid() != 0 or not sys.stdin.isatty() or len(sys.argv) != 1:
            raise ValueError('Trusted root terminal required')
        warnings.simplefilter('error', getpass.GetPassWarning)
        s = ROOT.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077:
            raise ValueError('Unsafe private directory')
        spec = importlib.util.spec_from_file_location('cf', '/usr/local/libexec/dao-oce-cloudflare.py')
        cf = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cf)
        with open(ROOT / '.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            cf.require(all(not (ROOT / n).exists() for n in ('approved.json', 'api-token', 'tunnel-token')))
            tunnel_id = input('ID du tunnel (pas son secret) : ').strip()
            emails = [e.strip().lower() for e in input('E-mails autorisés, séparés par des virgules : ').split(',')]
            token = getpass.getpass('Jeton API Cloudflare LECTURE SEULE (saisie masquée) : ').strip()
            tunnel_token = getpass.getpass('Jeton du tunnel uniquement, sans commande (saisie masquée) : ').strip()
            cf.require(0 < len(token) <= 4096 and not any(c in token for c in '\r\n'))
            signal.signal(signal.SIGALRM, expired)
            signal.alarm(180)
            provision(cf, lambda p: cf.api_get(p, token), tunnel_id, emails, tunnel_token, token)
        print('BOOTSTRAP_CONFIGURATION_READY — audit réussi, fichiers root 0600 ; tunnel non démarré.')
        return 0
    except Exception:
        print('BOOTSTRAP_CONFIGURATION_FAILED — aucun secret affiché ; ne pas élargir les permissions.', file=sys.stderr)
        return 1
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    sys.exit(main())
