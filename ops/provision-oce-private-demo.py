#!/usr/bin/env python3
"""One-time trusted root/TTY provisioning. No CF writes, no tunnel start."""
import fcntl
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import urllib.error
import warnings

ROOT = Path('/etc/dao-oce-cloudflare')
MODULE = Path('/usr/local/libexec/dao-oce-cloudflare.py')
MAX_ATTEMPTS = 3
SESSION_SECONDS = 900


class SessionExpired(Exception):
    pass


def category(path):
    if path.startswith('/zones?'):
        return 'ZONE_LOOKUP'
    if '/dns_records?' in path:
        return 'DNS_RECORD'
    if path.startswith('/zones/'):
        return 'ZONE_STATE'
    if '/access/organizations' in path:
        return 'ACCESS_ORGANIZATION'
    if '/access/identity_providers' in path:
        return 'OTP_PROVIDERS'
    if '/policies?' in path:
        return 'ACCESS_POLICY'
    if '/access/apps?' in path:
        return 'ACCESS_APPLICATION'
    if path.endswith('/configurations'):
        return 'TUNNEL_CONFIGURATION'
    if '/cfd_tunnel/' in path:
        return 'TUNNEL_STATE'
    return 'API_READ'


def provision(cf, get, tunnel_id, emails, tunnel_token, token, root=ROOT, progress=None):
    progress = progress if progress is not None else {}
    progress.update(stage='INPUT_VALIDATION', api_pending=False)

    def read(path):
        progress.update(stage=category(path), api_pending=True)
        value = get(path)
        progress['api_pending'] = False
        return value

    cf.require(bool(re.fullmatch(r'[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}', tunnel_id)))
    zones = read('/zones?name=logiclab.fr&per_page=100')
    cf.require(len(zones) == 1 and zones[0]['name'] == 'logiclab.fr')
    account = zones[0]['account']['id']
    cf.require(bool(re.fullmatch(r'[a-f0-9]{32}', account)))
    base = '/accounts/' + account
    apps = read(base + '/access/apps?per_page=100')
    selected = [app for app in apps if app.get('domain') == cf.HOST]
    cf.require(len(selected) == 1)
    org = read(base + '/access/organizations')
    domain = org['auth_domain']
    cf.require(domain.endswith('.cloudflareaccess.com'))
    progress['stage'] = 'MANIFEST_VALIDATION'
    manifest = cf.validate_manifest({'account_id': account, 'zone_id': zones[0]['id'],
                 'tunnel_id': tunnel_id, 'application_id': selected[0]['id'],
                 'team_name': domain.removesuffix('.cloudflareaccess.com'), 'emails': emails})
    progress['stage'] = 'TUNNEL_TOKEN_BINDING'
    cf.validate_tunnel_token(tunnel_token, manifest)
    cf.audit(manifest, read)  # Independent supplied email list must match live policy.
    progress['stage'] = 'CONFIGURATION_DESTINATION'
    names = ('approved.json', 'api-token', 'tunnel-token')
    cf.require(all(not (root / name).exists() and not (root / name).is_symlink() for name in names))
    data = (json.dumps(manifest), token, tunnel_token)
    created = []
    progress['stage'] = 'CREDENTIAL_FILE_WRITE'
    try:
        for name, value in zip(names, data):
            # O_EXCL + root-only directory: never overwrite an existing credential.
            fd = os.open(root / name, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            created.append(root / name)
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                f.write(value + '\n')
                f.flush()
                os.fsync(f.fileno())
    except BaseException:
        for path in created:
            path.unlink(missing_ok=True)
        raise


def failure(exc, progress, cf=None, digest=None):
    reason = 'API_READ_FAILED' if progress.get('api_pending') else 'VALIDATION_FAILED'
    if isinstance(exc, SessionExpired):
        reason = 'SESSION_DEADLINE'
    elif isinstance(exc, urllib.error.HTTPError):
        reason = 'HTTP_' + str(exc.code) if exc.code in (400, 401, 403, 404, 429, 500, 502, 503, 504) else 'HTTP_ERROR'
    elif isinstance(exc, (TimeoutError, urllib.error.URLError)):
        reason = 'NETWORK_OR_TIMEOUT'
    elif progress.get('stage') == 'CREDENTIAL_FILE_WRITE':
        reason = 'CREDENTIAL_FILE_WRITE_FAILED'
    elif progress.get('stage') in ('TRUSTED_TERMINAL', 'ROOT_DIRECTORY', 'MODULE_TRUST', 'ROOT_LOCK', 'PRIVATE_INPUT', 'RETRY_WAIT'):
        reason = 'LOCAL_PREREQUISITE_FAILED'
    line = None
    tb = exc.__traceback__
    while tb:
        if (tb.tb_frame.f_code.co_filename == getattr(cf, '__file__', None)
                and tb.tb_frame.f_code.co_name != 'require'):
            line = tb.tb_lineno
        tb = tb.tb_next
    result = {'provisioning': 'FAIL', 'stage': progress.get('stage', 'LOCAL_PREREQUISITE'),
              'reason': reason, 'installed_module_line': line,
              'configuration_written': False, 'tunnel_started': False}
    if digest is not None:
        result['installed_module_sha256'] = digest
    return result


def run_session(cf, get, tunnel_id, emails, tunnel_token, token, root, digest, reply=input, emit=print):
    """Retry only after explicit operator input; credentials remain in memory."""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        progress = {}
        try:
            provision(cf, get, tunnel_id, emails, tunnel_token, token, root=root, progress=progress)
        except Exception as exc:
            result = failure(exc, progress, cf, digest)
            result['attempt'] = attempt
            emit('BOOTSTRAP_CONFIGURATION_FAILED — diagnostic expurgé ci-dessous.')
            emit(json.dumps(result, sort_keys=True))
            # Local input/custody failures cannot be fixed in the provider UI.
            if (isinstance(exc, SessionExpired) or attempt == MAX_ATTEMPTS or progress.get('stage') in
                    ('INPUT_VALIDATION', 'MANIFEST_VALIDATION', 'TUNNEL_TOKEN_BINDING',
                     'CONFIGURATION_DESTINATION', 'CREDENTIAL_FILE_WRITE')):
                return 1
            progress['stage'] = 'RETRY_WAIT'
            try:
                answer = reply('Après correction dans Cloudflare : Entrée pour recontrôler avec les mêmes jetons, q pour quitter : ')
            except SessionExpired as exc:
                emit(json.dumps(failure(exc, progress, cf, digest), sort_keys=True))
                return 1
            except (EOFError, KeyboardInterrupt):
                return 1
            if answer.strip():
                return 1
            continue
        emit('BOOTSTRAP_CONFIGURATION_READY — audit réussi, fichiers root 0600 ; tunnel non démarré.')
        return 0
    return 1


def load_installed():
    for path in (MODULE, *MODULE.parents):
        meta = path.lstat()
        if meta.st_uid != 0 or meta.st_mode & 0o022 or stat.S_ISLNK(meta.st_mode):
            raise ValueError('Untrusted installed module')
        if path == MODULE and not stat.S_ISREG(meta.st_mode):
            raise ValueError('Untrusted installed module')
    spec = importlib.util.spec_from_file_location('cf', MODULE)
    cf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cf)
    return cf, hashlib.sha256(MODULE.read_bytes()).hexdigest()


def expired(signum, frame):
    raise SessionExpired()


def main():
    progress = {'stage': 'TRUSTED_TERMINAL'}
    cf = digest = None
    try:
        if os.geteuid() != 0 or not sys.stdin.isatty() or len(sys.argv) != 1:
            raise ValueError('Trusted root terminal required')
        warnings.simplefilter('error', getpass.GetPassWarning)
        signal.signal(signal.SIGALRM, expired)
        signal.alarm(SESSION_SECONDS)
        progress['stage'] = 'ROOT_DIRECTORY'
        s = ROOT.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077:
            raise ValueError('Unsafe private directory')
        progress['stage'] = 'MODULE_TRUST'
        cf, digest = load_installed()
        progress['stage'] = 'ROOT_LOCK'
        if (ROOT / '.lock').is_symlink():
            raise ValueError('Unsafe private lock')
        with open(ROOT / '.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            progress['stage'] = 'CONFIGURATION_DESTINATION'
            cf.require(all(not (ROOT / n).exists() and not (ROOT / n).is_symlink()
                           for n in ('approved.json', 'api-token', 'tunnel-token')))
            progress['stage'] = 'PRIVATE_INPUT'
            tunnel_id = input('ID du tunnel (pas son secret) : ').strip()
            emails = [e.strip().lower() for e in input('E-mails autorisés, séparés par des virgules : ').split(',')]
            token = getpass.getpass('Jeton API Cloudflare LECTURE SEULE (saisie masquée) : ').strip()
            tunnel_token = getpass.getpass('Jeton du tunnel uniquement, sans commande (saisie masquée) : ').strip()
            cf.require(0 < len(token) <= 4096 and not any(c in token for c in '\r\n'))
            print('SESSION_PRIVEE — trois contrôles au maximum, 15 minutes, jetons en mémoire uniquement.')
            return run_session(cf, lambda p: cf.api_get(p, token), tunnel_id, emails, tunnel_token, token,
                               ROOT, digest, reply=input)
    except (KeyboardInterrupt, EOFError):
        print('BOOTSTRAP_CONFIGURATION_CANCELLED — aucun secret affiché.', file=sys.stderr)
        return 1
    except Exception as exc:
        print('BOOTSTRAP_CONFIGURATION_FAILED — diagnostic expurgé ci-dessous.', file=sys.stderr)
        print(json.dumps(failure(exc, progress, cf, digest), sort_keys=True))
        return 1
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    sys.exit(main())
