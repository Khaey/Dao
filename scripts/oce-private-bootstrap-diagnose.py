#!/usr/bin/env python3
"""Read-only TTY diagnostic; no credentials persisted or raw errors emitted."""
import getpass
import hashlib
import importlib.util
import json
from pathlib import Path
import signal
import stat
import sys
import urllib.error
import warnings

MODULE = Path('/usr/local/libexec/dao-oce-cloudflare.py')


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


def diagnose(cf, get, tunnel_id, emails, tunnel_token):
    stage = 'INPUT_VALIDATION'
    api_pending = False

    def read(path):
        nonlocal stage, api_pending
        stage = category(path)
        api_pending = True
        result = get(path)
        api_pending = False
        return result

    try:
        # Same discovery and strict validation as the reviewed provisioner.
        cf.require(isinstance(tunnel_id, str) and isinstance(emails, list))
        zones = read('/zones?name=logiclab.fr&per_page=100')
        cf.require(len(zones) == 1 and zones[0]['name'] == 'logiclab.fr')
        account = zones[0]['account']['id']
        apps = read('/accounts/' + account + '/access/apps?per_page=100')
        selected = [app for app in apps if app.get('domain') == cf.HOST]
        cf.require(len(selected) == 1)
        org = read('/accounts/' + account + '/access/organizations')
        domain = org['auth_domain']
        cf.require(domain.endswith('.cloudflareaccess.com'))
        stage = 'MANIFEST_VALIDATION'
        manifest = cf.validate_manifest({
            'account_id': account, 'zone_id': zones[0]['id'],
            'tunnel_id': tunnel_id, 'application_id': selected[0]['id'],
            'team_name': domain.removesuffix('.cloudflareaccess.com'), 'emails': emails,
        })
        stage = 'TUNNEL_TOKEN_BINDING'
        cf.validate_tunnel_token(tunnel_token, manifest)
        cf.audit(manifest, read)
        return {'diagnostic': 'PASS', 'configuration_written': False,
                'tunnel_started': False}
    except Exception as exc:
        # Never stringify exception, URL, HTTP body, request or supplied input.
        error = 'API_READ_FAILED' if api_pending else 'VALIDATION_FAILED'
        if isinstance(exc, urllib.error.HTTPError):
            error = 'HTTP_' + str(exc.code) if exc.code in (400, 401, 403, 404, 429, 500, 502, 503, 504) else 'HTTP_ERROR'
        elif isinstance(exc, (TimeoutError, urllib.error.URLError)):
            error = 'NETWORK_OR_TIMEOUT'
        line = None
        tb = exc.__traceback__
        while tb:
            if tb.tb_frame.f_code.co_filename == getattr(cf, '__file__', None):
                line = tb.tb_lineno
            tb = tb.tb_next
        return {'diagnostic': 'FAIL', 'stage': stage, 'reason': error,
                'installed_module_line': line,
                'configuration_written': False, 'tunnel_started': False}


def load_installed():
    # Only the fixed root-installed implementation is imported, never a caller path.
    for path in (MODULE, *MODULE.parents):
        meta = path.lstat()
        if meta.st_uid != 0 or meta.st_mode & 0o022 or stat.S_ISLNK(meta.st_mode):
            raise ValueError('Untrusted installed module')
        if path == MODULE and not stat.S_ISREG(meta.st_mode):
            raise ValueError('Untrusted installed module')
    spec = importlib.util.spec_from_file_location('installed_oce_cf', MODULE)
    cf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cf)
    return cf, hashlib.sha256(MODULE.read_bytes()).hexdigest()


def expired(signum, frame):
    raise TimeoutError('Diagnostic deadline')


def main():
    stage = 'TRUSTED_TERMINAL'
    try:
        if len(sys.argv) != 1 or not sys.stdin.isatty():
            raise ValueError('Interactive terminal required')
        warnings.simplefilter('error', getpass.GetPassWarning)
        stage = 'MODULE_TRUST'
        cf, digest = load_installed()
        stage = 'PRIVATE_INPUT'
        tunnel_id = input('ID du tunnel (pas son secret) : ').strip()
        emails = [e.strip().lower() for e in input('E-mails autorisés, séparés par des virgules : ').split(',')]
        token = getpass.getpass('Jeton API LECTURE SEULE (saisie masquée) : ').strip()
        tunnel_token = getpass.getpass('Jeton du tunnel uniquement (saisie masquée) : ').strip()
        cf.require(0 < len(token) <= 4096 and not any(c in token for c in '\r\n'))
        signal.signal(signal.SIGALRM, expired)
        signal.alarm(180)
        result = diagnose(cf, lambda path: cf.api_get(path, token), tunnel_id, emails, tunnel_token)
        result['installed_module_sha256'] = digest
        print(json.dumps(result, sort_keys=True))
        return 0 if result['diagnostic'] == 'PASS' else 1
    except Exception:
        print(json.dumps({'diagnostic': 'FAIL', 'stage': stage,
                          'reason': 'LOCAL_PREREQUISITE_FAILED',
                          'configuration_written': False, 'tunnel_started': False}, sort_keys=True))
        return 1
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    sys.exit(main())
