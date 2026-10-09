#!/usr/bin/env python3
"""Fixed, read-only Cloudflare audit and unauthenticated private-demo probe.

No API write, no redirects, no credential output. Host activation is separate.
"""
import base64
import fnmatch
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

HOST = 'oce-demo.logiclab.fr'
API = 'https://api.cloudflare.com/client/v4'


class RefuseRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), RefuseRedirect())


def require(condition):
    if not condition:
        raise ValueError('Private demo prerequisite failed')


def validate_manifest(m):
    require(set(m) == {'account_id', 'zone_id', 'tunnel_id', 'application_id',
                       'team_name', 'emails'})
    for key in ('account_id', 'zone_id'):
        require(bool(re.fullmatch(r'[a-f0-9]{32}', m[key])))
    for key in ('tunnel_id', 'application_id'):
        require(bool(re.fullmatch(r'[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}', m[key])))
    require(bool(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,61}[a-z0-9]', m['team_name'])))
    require(isinstance(m['emails'], list) and 0 < len(m['emails']) <= 50)
    require(len(set(m['emails'])) == len(m['emails']))
    require(all(isinstance(e, str) and re.fullmatch(r'[^\s@*]+@[^\s@*]+\.[^\s@*]+', e)
                and e == e.lower() for e in m['emails']))
    return m


def validate_tunnel_token(token, manifest):
    """Bind root-provisioned credentials; CF authenticates the secret on connect.

    This is structural binding, not offline signature/authentication verification.
    Never retrieve credentials using an API key with tunnel write permissions.
    """
    require(isinstance(token, str) and 0 < len(token) <= 4096)
    def unique_object(pairs):
        value = dict(pairs)
        require(len(value) == len(pairs))
        return value
    payload = json.loads(base64.b64decode(token, validate=True), object_pairs_hook=unique_object)
    require(isinstance(payload, dict) and {'a', 't', 's'} <= set(payload) <= {'a', 't', 's', 'e'})
    require(payload['a'] == manifest['account_id'] and payload['t'] == manifest['tunnel_id'])
    require(not payload.get('e'))  # No caller-controlled alternate edge endpoint.
    require(isinstance(payload['s'], str) and len(base64.b64decode(payload['s'], validate=True)) == 32)


def api_get(path, token):
    require(path.startswith('/') and not any(c in token for c in '\r\n'))
    req = urllib.request.Request(API + path, headers={'Authorization': 'Bearer ' + token})
    with OPENER.open(req, timeout=15) as response:
        raw = response.read(2_000_001)
    require(len(raw) <= 2_000_000)
    result = json.loads(raw)
    require(result.get('success') is True)
    pages = result.get('result_info', {}).get('total_pages', 1)
    require(pages <= 1 and not (isinstance(result['result'], list) and len(result['result']) >= 100))  # Never silently accept a truncated security inventory.
    return result['result']


def audit(m, get):
    validate_manifest(m)
    base = '/accounts/' + m['account_id']
    require(get('/zones/' + m['zone_id'])['name'] == 'logiclab.fr')
    require(get('/zones/' + m['zone_id'])['status'] == 'active')
    org = get(base + '/access/organizations')
    require(org['auth_domain'] == m['team_name'] + '.cloudflareaccess.com')
    apps = get(base + '/access/apps?per_page=100')
    selected = [a for a in apps if a['id'] == m['application_id']]
    require(len(selected) == 1)
    app = selected[0]
    require(app.get('type') == 'self_hosted' and app.get('domain') == HOST)
    # Modern Access destinations can override legacy domain fields and expose
    # public path overrides. Audit both representations, not only domain.
    require(not app.get('self_hosted_domains') or app['self_hosted_domains'] == [HOST])
    destinations = app.get('destinations') or []
    if destinations:
        require(len(destinations) == 1)
        dest = destinations[0]
        require(set(dest) <= {'type', 'uri', 'overrides'} and
                dest.get('type', 'public') == 'public' and dest.get('uri') == HOST and
                not dest.get('overrides'))
    # Fail closed for competing path/wildcard apps in either representation.
    for other in apps:
        if other['id'] == app['id']:
            continue
        domains = [other.get('domain', '')] + (other.get('self_hosted_domains') or [])
        domains += [d.get('uri', '') for d in (other.get('destinations') or [])]
        for domain in domains:
            require(not (domain.startswith(HOST + '/') or domain == HOST or
                         '*' in domain and fnmatch.fnmatchcase(HOST, domain.split('/')[0])))
    require(not app.get('service_auth_401_redirect'))
    require(not app.get('allow_authenticate_via_warp'))
    require(not app.get('options_preflight_bypass'))
    idps = get(base + '/access/identity_providers')
    otp = [i['id'] for i in idps if i.get('type') == 'onetimepin']
    require(len(otp) == 1 and app.get('allowed_idps') == otp)
    policies = get(base + '/access/apps/' + app['id'] + '/policies?per_page=100')
    require(len(policies) == 1)
    p = policies[0]
    require(p.get('decision') == 'allow' and not p.get('exclude') and not p.get('require'))
    entries = p.get('include', [])
    require(all(set(e) == {'email'} and set(e['email']) == {'email'} for e in entries))
    require(sorted(e['email']['email'].lower() for e in entries) == sorted(m['emails']))
    aud = app.get('aud')
    require(isinstance(aud, str) and bool(re.fullmatch(r'[a-f0-9]{64}', aud)))
    tunnel = get(base + '/cfd_tunnel/' + m['tunnel_id'])
    require(tunnel.get('config_src') == 'cloudflare' and not tunnel.get('deleted_at'))
    config = get(base + '/cfd_tunnel/' + m['tunnel_id'] + '/configurations')['config']
    expected = [{'hostname': HOST, 'service': 'http://127.0.0.1:8080',
                 'originRequest': {'access': {'required': True,
                                             'teamName': m['team_name'], 'audTag': [aud]}}},
                {'service': 'http_status:404'}]
    require(config.get('ingress') == expected)
    require(not config.get('warp-routing', {}).get('enabled'))
    require(not config.get('originRequest'))
    records = get('/zones/' + m['zone_id'] + '/dns_records?name=' + HOST + '&per_page=100')
    require(len(records) == 1 and records[0]['type'] == 'CNAME' and records[0]['proxied'] is True)
    require(records[0]['content'] == m['tunnel_id'] + '.cfargotunnel.com')
    return {'configuration_verified': True, 'access_required_at_connector': True,
            'public_8080_changed': False, 'authenticated_owner_recipe_verified': False}


def probe(team):
    require(bool(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,61}[a-z0-9]', team)))
    for path in ('/', '/dashboard', '/api/v1/health'):
        for forged in (False, True):
            headers = {'Cf-Access-Jwt-Assertion': 'invalid.jwt.signature'} if forged else {}
            req = urllib.request.Request('https://' + HOST + path, headers=headers)
            try:
                with OPENER.open(req, timeout=15) as response:
                    code, location = response.status, response.headers.get('Location', '')
            except urllib.error.HTTPError as exc:
                code, location = exc.code, exc.headers.get('Location', '')
                exc.close()
            dest = urllib.parse.urlsplit(location)
            require(code in (302, 303, 307) and dest.scheme == 'https' and
                    dest.netloc == team + '.cloudflareaccess.com' and
                    dest.path.startswith('/cdn-cgi/access/login/'))
    return {'anonymous_challenged': True, 'forged_assertion_challenged': True,
            'authenticated_owner_recipe_verified': False}


def main():
    try:
        require(len(sys.argv) == 3 and sys.argv[1] in ('audit', 'probe'))
        if sys.argv[1] == 'probe':
            result = probe(sys.argv[2])
        else:
            with open(sys.argv[2], encoding='utf-8') as f:
                manifest = validate_manifest(json.load(f))
            # Token read from stdin: never command arguments or workflow inputs.
            token = sys.stdin.read(4097).strip()
            require(0 < len(token) <= 4096)
            result = audit(manifest, lambda path: api_get(path, token))
        print(json.dumps(result, sort_keys=True))
    except Exception:
        print('OCE_PRIVATE_CHECK_FAILED (details and credentials withheld)', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
