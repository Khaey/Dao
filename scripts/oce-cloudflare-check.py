#!/usr/bin/env python3
"""Owner-only, runner-only Cloudflare GET checks. No VPS or credential writes."""
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import sys
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
TUNNEL_ID = '0a42e8b3-1f74-4b3b-8440-e54efe20145a'  # Owner-approved, public ID.
OPERATIONS = ('check', 'audit')
SECRET_NAMES = ('OCE_CLOUDFLARE_API_TOKEN', 'OCE_CLOUDFLARE_TUNNEL_TOKEN',
                'OCE_CLOUDFLARE_APPROVED_EMAILS')
SAFE_FLAGS = ('api_token_present', 'tunnel_token_present', 'approved_emails_present',
              'zone_read_verified', 'tunnel_token_binding_verified', 'tunnel_read_verified')
ERROR_BODY_LIMIT = 16384
# Closed public identifiers, never arbitrary provider text or numeric input.
ERROR_CODES = frozenset((6003, 6111, 9103, 9106, 9107, 9109, 10000))
ERROR_LABELS = {'Forbidden': 'FORBIDDEN', 'Authentication error': 'AUTHENTICATION_ERROR',
                'Invalid request headers': 'INVALID_REQUEST_HEADERS',
                'Invalid access token': 'INVALID_ACCESS_TOKEN',
                'Unauthorized to access requested resource': 'ACCESS_DENIED'}
ZONE_DOC = 'https://developers.cloudflare.com/api/resources/zones/methods/list'


class Rejected(Exception):
    def __init__(self, reason):
        self.reason = reason


def select(event_name, event, repository, ref, actor):
    if repository != 'Khaey/Dao' or ref != 'refs/heads/main' or actor != 'Khaey':
        raise Rejected('REQUEST_REJECTED')
    if event_name == 'workflow_dispatch':
        operation = event.get('inputs', {}).get('operation')
    elif event_name == 'issue_comment':
        issue, comment = event.get('issue', {}), event.get('comment', {})
        if (event.get('action') != 'created' or issue.get('number') != 58
                or 'pull_request' in issue or comment.get('user', {}).get('login') != 'Khaey'
                or comment.get('author_association') != 'OWNER'):
            raise Rejected('REQUEST_REJECTED')
        operation = {'/dao-oce ' + op: op for op in OPERATIONS}.get(comment.get('body'))
    else:
        raise Rejected('REQUEST_REJECTED')
    if operation not in OPERATIONS:
        raise Rejected('REQUEST_REJECTED')
    return operation


def stage(path):
    if path.startswith('/zones?'):
        return 'ZONE_LOOKUP'
    if '/dns_records?' in path:
        return 'DNS_RECORD'
    if path.startswith('/zones/'):
        return 'ZONE_STATE'
    for fragment, name in (('/access/organizations', 'ACCESS_ORGANIZATION'),
                           ('/access/identity_providers', 'OTP_PROVIDERS'),
                           ('/policies?', 'ACCESS_POLICY'),
                           ('/access/apps?', 'ACCESS_APPLICATION'),
                           ('/configurations', 'TUNNEL_CONFIGURATION'),
                           ('/cfd_tunnel/', 'TUNNEL_STATE')):
        if fragment in path:
            return name
    return 'API_READ'


def check(cf, operation, api_token, tunnel_token, approved_emails, get, progress):
    progress['stage'] = 'ENVIRONMENT_SECRETS'
    if not api_token or not tunnel_token:
        raise Rejected('REQUIRED_TOKEN_MISSING')
    cf.require(operation in OPERATIONS)
    cf.require(isinstance(api_token, str) and 0 < len(api_token) <= 4096
               and all(32 < ord(c) < 127 for c in api_token))
    cf.require(isinstance(tunnel_token, str) and 0 < len(tunnel_token) <= 4096)

    def read(path):
        progress.update(stage=stage(path), api_pending=True)
        result = get(path)
        progress['api_pending'] = False
        return result

    zones = read('/zones?name=logiclab.fr&per_page=50')
    cf.require(isinstance(zones, list) and len(zones) == 1)
    zone = zones[0]
    cf.require(zone['name'] == 'logiclab.fr' and zone['status'] == 'active')
    account, zone_id = zone['account']['id'], zone['id']
    cf.require(bool(re.fullmatch(r'[a-f0-9]{32}', account)))
    cf.require(bool(re.fullmatch(r'[a-f0-9]{32}', zone_id)))
    progress['zone_read_verified'] = True
    progress['stage'] = 'TUNNEL_TOKEN_BINDING'
    cf.validate_tunnel_token(tunnel_token, {'account_id': account, 'tunnel_id': TUNNEL_ID})
    progress['tunnel_token_binding_verified'] = True
    base = '/accounts/' + account
    tunnel = read(base + '/cfd_tunnel/' + TUNNEL_ID)
    cf.require(tunnel.get('id') == TUNNEL_ID and tunnel.get('config_src') == 'cloudflare'
               and not tunnel.get('deleted_at'))
    progress['tunnel_read_verified'] = True
    if operation == 'check':
        return {'scope': 'zone_and_tunnel', 'access_policy_verified': False,
                'configuration_verified': False}

    progress['stage'] = 'APPROVED_EMAIL_INPUT'
    if not approved_emails:
        raise Rejected('APPROVED_EMAILS_MISSING')
    cf.require(isinstance(approved_emails, str) and len(approved_emails) <= 16384)
    emails = [email.strip().lower() for email in approved_emails.split(',')]
    apps = read(base + '/access/apps?per_page=100')
    selected = [app for app in apps if app.get('domain') == cf.HOST]
    cf.require(len(selected) == 1)
    org = read(base + '/access/organizations')
    domain = org['auth_domain']
    cf.require(domain.endswith('.cloudflareaccess.com'))
    progress['stage'] = 'MANIFEST_VALIDATION'
    manifest = cf.validate_manifest({'account_id': account, 'zone_id': zone_id,
        'tunnel_id': TUNNEL_ID, 'application_id': selected[0]['id'],
        'team_name': domain.removesuffix('.cloudflareaccess.com'), 'emails': emails})
    result = cf.audit(manifest, read)  # Independent owner input, never live-policy inference.
    return dict(result, scope='access_dns_and_connector', access_policy_verified=True)


def provider_failure(exc):
    """Bounded in-memory error parsing; only closed identifiers reach stdout."""
    result = {'provider_error_format': 'UNREADABLE'}

    def unique_object(pairs):
        value = dict(pairs)
        if len(value) != len(pairs):
            raise ValueError()
        return value

    try:
        raw = exc.read(ERROR_BODY_LIMIT + 1)
        if len(raw) > ERROR_BODY_LIMIT:
            return dict(result, provider_error_format='TOO_LARGE')
        result['provider_error_format'] = 'NON_JSON'
        body = json.loads(raw, object_pairs_hook=unique_object)
        result['provider_error_format'] = 'UNEXPECTED_JSON'
        if (not isinstance(body, dict) or body.get('success') is not False
                or not isinstance(body.get('errors'), list) or not 1 <= len(body['errors']) <= 16
                or not all(isinstance(error, dict) for error in body['errors'])):
            return result
        errors = body['errors']
        codes = {error['code'] for error in errors
                 if type(error.get('code')) is int and error['code'] in ERROR_CODES}
        labels = {ERROR_LABELS[error['message']] for error in errors
                  if isinstance(error.get('message'), str) and error['message'] in ERROR_LABELS}
        result.update(provider_error_format='CLOUDFLARE_JSON',
                      provider_error_codes=sorted(codes), provider_error_labels=sorted(labels),
                      provider_unrecognized_code=any(type(error.get('code')) is not int
                          or error['code'] not in ERROR_CODES for error in errors),
                      provider_zone_documentation=any(isinstance(error.get('documentation_url'), str)
                          and error['documentation_url'] in (ZONE_DOC, ZONE_DOC + '/') for error in errors))
    except Exception:
        pass  # Parsing/read failures never replace the original HTTP failure.
    finally:
        try:
            exc.close()
        except Exception:
            pass
    return result


def failure(exc, progress):
    reason = 'API_READ_FAILED' if progress.get('api_pending') else 'VALIDATION_FAILED'
    if isinstance(exc, Rejected):
        reason = exc.reason
    elif isinstance(exc, urllib.error.HTTPError):
        reason = 'HTTP_' + str(exc.code) if exc.code in (400, 401, 403, 404, 429, 500, 502, 503, 504) else 'HTTP_ERROR'
    elif isinstance(exc, (TimeoutError, urllib.error.URLError)):
        reason = 'NETWORK_OR_TIMEOUT'
    result = {'cloudflare_check': 'FAIL', 'stage': progress.get('stage', 'LOCAL_PREREQUISITE'),
              'reason': reason}
    if isinstance(exc, urllib.error.HTTPError) and exc.code in (401, 403) and progress.get('api_pending'):
        result.update(provider_failure(exc))
    return result


def deadline(signum, frame):
    raise TimeoutError()


def main():
    progress = {}
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in ('request', *OPERATIONS):
            raise Rejected('REQUEST_REJECTED')
        if sys.argv[1] == 'request':
            event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
            operation = select(os.environ['GITHUB_EVENT_NAME'], event,
                os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_REF'], os.environ['GITHUB_ACTOR'])
            print('OCE_REQUEST_ACCEPTED operation=' + operation)
            with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
                output.write('operation=' + operation + '\n')
            return 0
        signal.signal(signal.SIGALRM, deadline)
        signal.alarm(240)
        spec = importlib.util.spec_from_file_location('cf', ROOT / 'ops/oce-cloudflare.py')
        cf = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cf)
        api_token, tunnel_token, approved_emails = (os.environ.pop(name, '').strip() for name in SECRET_NAMES)
        progress.update(api_token_present=bool(api_token), tunnel_token_present=bool(tunnel_token),
                        approved_emails_present=bool(approved_emails))
        result = check(cf, sys.argv[1], api_token, tunnel_token, approved_emails,
                       lambda path: cf.api_get(path, api_token), progress)
        result['cloudflare_check'] = 'PASS'
        result['tunnel_secret_authenticated'] = False  # Offline binding is not a connection.
        result.update({key: bool(progress.get(key, False)) for key in SAFE_FLAGS})
        result.update(configuration_written=False, tunnel_started=False, vps_contacted=False)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as exc:
        result = failure(exc, progress)
        result.update({key: bool(progress.get(key, False)) for key in SAFE_FLAGS})
        result.update(configuration_written=False, tunnel_started=False, vps_contacted=False)
        print(json.dumps(result, sort_keys=True))
        return 1
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    sys.exit(main())
