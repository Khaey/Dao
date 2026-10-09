#!/usr/bin/python3 -I
"""Root-installed maintenance of a fixed catalog, admitted through GitHub #91.

No caller paths, shell, credentials, service restart or checkout execution.
Existing helpers/configuration are not installed or provisioned by this tool.
"""
import ast
from contextlib import ExitStack
from datetime import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import urllib.request

STATE = Path('/var/lib/dao-ops')
ANCHOR = Path('/')
OWNER = 0
API = 'https://api.github.com/repos/Khaey/Dao'
RAW = 'https://raw.githubusercontent.com/Khaey/Dao'
SHA = re.compile(r'[0-9a-f]{40}')
BUNDLE = re.compile(r'bootstrap|rev-[0-9a-f]{40}')
CATALOG = {
    'ops/dao-ops-admin.py': ('/usr/local/sbin/dao-ops-admin', None),
    'ops/dao-dev-admin.py': ('/usr/local/sbin/dao-dev-admin', None),
    'ops/dao-oce-private-admin.py': ('/usr/local/sbin/dao-oce-private-admin', 'dao-oce-cloudflared.service'),
    'ops/oce-cloudflare.py': ('/usr/local/libexec/dao-oce-cloudflare.py', 'dao-oce-cloudflared.service'),
    'ops/dao-oce-backup.py': ('/usr/local/sbin/dao-oce-backup', 'dao-oce-backup.service'),
    'ops/oce-v1-gateway-host.py': ('/usr/local/sbin/dao-oce-gateway-host', 'dao-oce-gateway.service'),
    'ops/oce-v1-gateway-qualify.py': ('/usr/local/sbin/dao-oce-gateway-qualify', 'dao-oce-gateway.service'),
    'ops/oce-v1-gateway.py': ('/usr/local/libexec/dao-oce-gateway', 'dao-oce-gateway.service'),
    'ops/oce-v1-egress-guard.py': ('/usr/local/libexec/dao-oce-egress-guard', 'dao-oce-egress-guard.service'),
}
LOCKS = ('/etc/dao/.admin.lock', '/etc/dao-oce-cloudflare/.lock', '/var/backups/dao-oce/.lock')
MAX_FILE = 512 * 1024


class Halt(Exception):
    """Only fixed codes cross the public log boundary."""


def require(condition, code):
    if not condition:
        raise Halt(code)


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe(path, directory=False, missing=False):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts
            and (path == ANCHOR or ANCHOR in path.parents), 'UNSAFE_PATH')
    chain = [path, *path.parents]
    for entry in chain:
        if entry == path and missing and not entry.exists() and not entry.is_symlink():
            continue
        meta = entry.lstat()
        require(meta.st_uid == OWNER and not meta.st_mode & 0o022
                and not stat.S_ISLNK(meta.st_mode), 'UNSAFE_OWNERSHIP')
        require(stat.S_ISDIR(meta.st_mode) if entry != path or directory
                else stat.S_ISREG(meta.st_mode), 'UNSAFE_FILE_TYPE')
        if entry == ANCHOR:
            break
    return path


def read_file(path):
    path = safe(path)
    require(path.stat().st_size <= MAX_FILE, 'FILE_TOO_LARGE')
    return path.read_bytes()


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic(path, data, mode):
    path = safe(path, missing=True)
    fd, temporary = tempfile.mkstemp(prefix='.ops-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_json(path, value):
    atomic(path, (json.dumps(value, sort_keys=True) + '\n').encode(), 0o600)


def manifest(files):
    return {'schema': 1, 'files': {source: {'sha256': digest(data), 'size': len(data)}
                                 for source, data in sorted(files.items())}}


def validate_manifest(value, complete=True):
    require(isinstance(value, dict) and set(value) == {'schema', 'files'}
            and value['schema'] == 1 and isinstance(value['files'], dict), 'INVALID_MANIFEST')
    names = set(value['files'])
    require(names == set(CATALOG) if complete else bool(names) and names <= set(CATALOG), 'INVALID_CATALOG')
    for source, row in value['files'].items():
        require(isinstance(row, dict) and set(row) == {'sha256', 'size'}
                and isinstance(row['sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', row['sha256'])
                and type(row['size']) is int and 0 < row['size'] <= MAX_FILE, 'INVALID_MANIFEST')
    return value


def folder(bundle):
    require(isinstance(bundle, str) and BUNDLE.fullmatch(bundle), 'INVALID_VERSION')
    return safe(STATE / bundle, directory=True)


def blob_name(source):
    require(source in CATALOG, 'INVALID_CATALOG')
    return source.replace('/', '__')


def load_snapshot(bundle):
    directory = folder(bundle)
    value = validate_manifest(strict_json(read_file(directory / 'manifest.json')), complete=False)
    result = {}
    for source, row in value['files'].items():
        data = read_file(directory / blob_name(source))
        require(len(data) == row['size'] and digest(data) == row['sha256'], 'SNAPSHOT_HASH_MISMATCH')
        result[source] = data
    return result


def load_ledger():
    value = strict_json(read_file(STATE / 'state.json'))
    require(isinstance(value, dict) and set(value) == {'schema', 'current', 'previous'}
            and value['schema'] == 1 and isinstance(value['current'], str)
            and BUNDLE.fullmatch(value['current']) and
            (value['previous'] is None or isinstance(value['previous'], str) and BUNDLE.fullmatch(value['previous'])), 'INVALID_STATE')
    return value


def installed_files():
    result = {}
    for source, (name, _) in CATALOG.items():
        path = Path(name)
        if not path.exists() and not path.is_symlink():
            continue
        data = read_file(path)
        require(stat.S_IMODE(path.stat().st_mode) == 0o755, 'INVALID_INSTALLED_MODE')
        result[source] = data
    require('ops/dao-ops-admin.py' in result and 'ops/dao-dev-admin.py' in result, 'BASE_HELPER_MISSING')
    return result


def save_snapshot(bundle, files):
    validate_manifest(manifest(files), complete=False)
    target = STATE / bundle
    require(BUNDLE.fullmatch(bundle) and not target.exists() and not target.is_symlink(), 'VERSION_ALREADY_EXISTS')
    target.mkdir(mode=0o700)
    for source, data in files.items():
        atomic(target / blob_name(source), data, 0o600)
    write_json(target / 'manifest.json', manifest(files))
    sync_directory(STATE)


def check_current(ledger):
    current = load_snapshot(ledger['current'])
    require(installed_files() == current, 'INSTALLED_DRIFT')
    return current


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Halt('GITHUB_REDIRECT_REJECTED')


def fetch(url, limit=2 * 1024 * 1024):
    require(url.startswith(API + '/') or url.startswith(RAW + '/'), 'UNTRUSTED_SOURCE')
    request = urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'DAO-OPS/1'})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
        require(response.status == 200, 'GITHUB_UNAVAILABLE')
        data = response.read(limit + 1)
    require(len(data) <= limit, 'RESPONSE_TOO_LARGE')
    return data


def api(path):
    return strict_json(fetch(API + path))


def main_sha():
    value = api('/git/ref/heads/main')
    sha = value.get('object', {}).get('sha')
    require(isinstance(sha, str) and SHA.fullmatch(sha), 'MAIN_UNVERIFIED')
    return sha


def admission():
    """A standalone owner comment approves one SHA AFTER its main CI passed."""
    sha = main_sha()
    runs = api('/actions/runs?branch=main&event=push&head_sha=' + sha + '&per_page=100').get('workflow_runs', [])
    candidates = [r for r in runs if r.get('head_sha') == sha and r.get('head_branch') == 'main'
                  and r.get('event') == 'push' and r.get('workflow_id') == 363309541
                  and r.get('path') == '.github/workflows/ci.yml'
                  and r.get('repository', {}).get('full_name') == 'Khaey/Dao']
    require(bool(candidates), 'MAIN_CI_MISSING')
    run = max(candidates, key=lambda r: r['id'])
    require(run.get('status') == 'completed' and run.get('conclusion') == 'success', 'MAIN_CI_NOT_SUCCESS')
    issue = api('/issues/91')
    count = issue.get('comments')
    require(type(count) is int and 0 <= count <= 100000, 'APPROVAL_UNVERIFIED')
    # Inspect at most the last two pages; an old forgotten approval is not an admission.
    last = max(1, (count + 99) // 100)
    comments = []
    for page in range(max(1, last - 1), last + 1):
        result = api('/issues/91/comments?per_page=100&page=' + str(page))
        require(isinstance(result, list), 'APPROVAL_UNVERIFIED')
        comments.extend(result)
    approvals = [c for c in comments if c.get('user', {}).get('login') == 'Khaey'
                 and c.get('author_association') == 'OWNER'
                 and c.get('body') == '/dao-ops approve ' + sha]
    require(bool(approvals), 'RELEASE_NOT_ADMITTED')
    approval = max(approvals, key=lambda c: c['id'])
    require(datetime.fromisoformat(approval['created_at'].replace('Z', '+00:00')) >=
            datetime.fromisoformat(run['updated_at'].replace('Z', '+00:00')), 'APPROVAL_BEFORE_CI')
    return {'sha': sha, 'ci_run_id': run['id'], 'approval_comment_id': approval['id']}


def release_files(approval, active):
    base = RAW + '/' + approval['sha'] + '/'
    value = validate_manifest(strict_json(fetch(base + 'ops/ops-release.json')))
    files = {}
    for source in active:
        data = fetch(base + source, MAX_FILE)
        row = value['files'][source]
        require(len(data) == row['size'] and digest(data) == row['sha256'], 'RELEASE_HASH_MISMATCH')
        ast.parse(data, filename=source)  # Parse only; never execute downloaded code.
        files[source] = data
    return files


def service_idle(service):
    result = subprocess.run(['/usr/bin/systemctl', 'show', '--property=ActiveState', '--value', service],
                            capture_output=True, text=True, timeout=10)
    require(result.returncode == 0 and result.stdout.strip() in {'inactive', 'failed'}, 'MANAGED_SERVICE_BUSY')


def prepare(ledger):
    require(not (STATE / 'transaction.json').exists(), 'RECOVERY_REQUIRED')
    old = check_current(ledger)
    approval = admission()
    new = release_files(approval, old)
    changed = [s for s in old if old[s] != new[s]]
    for service in {CATALOG[s][1] for s in changed} - {None}:
        service_idle(service)
    require(main_sha() == approval['sha'], 'MAIN_ADVANCED')
    return old, new, {**approval, 'changed': sorted(changed), 'not_installed': sorted(set(CATALOG) - set(old))}


def install_files(files):
    for source, data in files.items():
        atomic(Path(CATALOG[source][0]), data, 0o755)


def verify_controller(expected):
    result = subprocess.run(['/usr/bin/python3', '-I', CATALOG['ops/dao-ops-admin.py'][0], 'status'],
                            capture_output=True, text=True, timeout=15)
    require(result.returncode == 0, 'CONTROLLER_VALIDATION_FAILED')
    row = strict_json(result.stdout)
    require(row.get('ops_schema') == 1 and row.get('current') == expected
            and row.get('installed_match') is True, 'CONTROLLER_VALIDATION_FAILED')


def remove_journal():
    (STATE / 'transaction.json').unlink()
    sync_directory(STATE)


def upgrade(ledger):
    old, new, report = prepare(ledger)
    if not report['changed']:
        return {'ops_upgrade': 'unchanged', **report}
    target = 'rev-' + report['sha']
    if (STATE / target).exists():
        require(load_snapshot(target) == new, 'VERSION_HASH_MISMATCH')
    else:
        save_snapshot(target, new)
    write_json(STATE / 'transaction.json', {'schema': 1, 'before': ledger, 'target': target})
    try:
        install_files(new)
        write_json(STATE / 'state.json', {'schema': 1, 'current': target, 'previous': ledger['current']})
        verify_controller(target)
        remove_journal()
    except Exception:
        # The running old process retains rollback authority even after self replacement.
        install_files(old)
        write_json(STATE / 'state.json', ledger)
        remove_journal()
        raise Halt('UPGRADE_ROLLED_BACK')
    return {'ops_upgrade': 'complete', **report}


def rollback(ledger):
    journal = STATE / 'transaction.json'
    recovery = journal.exists()
    if recovery:
        row = strict_json(read_file(journal))
        require(isinstance(row, dict) and set(row) == {'schema', 'before', 'target'}
                and row['schema'] == 1 and isinstance(row['before'], dict), 'INVALID_TRANSACTION')
        before = row['before']
        require(set(before) == {'schema', 'current', 'previous'} and before['schema'] == 1, 'INVALID_TRANSACTION')
        target = before['current']
        old, new = load_snapshot(target), load_snapshot(row['target'])
        installed = installed_files()
        require(set(installed) == set(old) == set(new) and
                all(installed[s] in (old[s], new[s]) for s in old), 'INSTALLED_DRIFT')
        next_state = before
    else:
        check_current(ledger)
        target = ledger['previous']
        require(target is not None, 'NO_PREVIOUS_VERSION')
        old = load_snapshot(target)
        next_state = {'schema': 1, 'current': target, 'previous': None}
    for service in {CATALOG[s][1] for s in old if read_file(CATALOG[s][0]) != old[s]} - {None}:
        service_idle(service)
    if not recovery:
        write_json(journal, {'schema': 1, 'before': next_state, 'target': ledger['current']})
    install_files(old)
    write_json(STATE / 'state.json', next_state)
    require(installed_files() == old, 'ROLLBACK_VALIDATION_FAILED')
    remove_journal()
    return {'ops_rollback': 'complete', 'current': target, 'recovered_transaction': recovery}


def status():
    ledger = load_ledger()
    current = load_snapshot(ledger['current'])
    live = installed_files()
    return {'ops_schema': 1, 'current': ledger['current'], 'previous': ledger['previous'],
            'installed_match': live == current, 'managed_files': sorted(current),
            'pending_transaction': (STATE / 'transaction.json').exists(), 'secrets_read': False}


def bootstrap():
    """Root installer only, never granted by sudoers; adopt actual installed code."""
    require(not (STATE / 'state.json').exists(), 'ALREADY_BOOTSTRAPPED')
    files = installed_files()
    save_snapshot('bootstrap', files)
    write_json(STATE / 'state.json', {'schema': 1, 'current': 'bootstrap', 'previous': None})
    return {'ops_bootstrap': 'complete', 'files_adopted': len(files), 'services_changed': False}


def locked(stack):
    safe(STATE, directory=True)
    require(stat.S_IMODE(STATE.stat().st_mode) == 0o700, 'INVALID_STATE_MODE')
    for name in (str(STATE / '.lock'), *LOCKS):
        path = Path(name)
        if path.parent != STATE and not path.parent.exists():
            continue
        safe(path, missing=True)
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        stack.callback(os.close, fd)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def timeout(signum, frame):
    raise Halt('OPERATION_TIMEOUT')


def main():
    try:
        require(os.geteuid() == 0 and len(sys.argv) == 2, 'ROOT_OPERATION_REQUIRED')
        operation = sys.argv[1]
        require(operation in {'status', 'preflight', 'upgrade', 'rollback', 'backup-status', 'bootstrap'}, 'UNSUPPORTED_OPERATION')
        signal.signal(signal.SIGALRM, timeout)
        signal.alarm(240)
        if operation == 'status':
            report = status()
        elif operation == 'backup-status':
            safe(CATALOG['ops/dao-oce-backup.py'][0])
            result = subprocess.run(['/usr/bin/python3', '-I', CATALOG['ops/dao-oce-backup.py'][0], 'status'],
                                    capture_output=True, text=True, timeout=20, check=True)
            data = strict_json(result.stdout)
            allowed = {'id', 'phase', 'backup_complete', 'restore_verified', 'live_resumed', 'cleanup_complete'}
            require(isinstance(data, dict), 'INVALID_BACKUP_STATUS')
            report = {'backup_status': {k: v for k, v in data.items() if k in allowed}}
        else:
            with ExitStack() as stack:
                locked(stack)
                if operation == 'bootstrap':
                    report = bootstrap()
                else:
                    ledger = load_ledger()
                    if operation == 'preflight':
                        _, _, report = prepare(ledger)
                    elif operation == 'upgrade':
                        report = upgrade(ledger)
                    else:
                        report = rollback(ledger)
        print(json.dumps(report, sort_keys=True))
        return 0
    except Halt as exc:
        print(json.dumps({'ops_error': str(exc)}), file=sys.stderr)
        return 1
    except Exception:
        print('{"ops_error":"OPERATION_FAILED","details":"withheld"}', file=sys.stderr)
        return 1
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    sys.exit(main())
