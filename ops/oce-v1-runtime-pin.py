#!/usr/bin/python3 -I
"""Pin the validated OCE runtime to immutable registry digests.

Fixed operator-only operation for issue #58. It never pulls images and never
touches application data. The original two Compose files remain unchanged and
are the rollback configuration; a root-controlled final override carries only
the immutable image references.
"""
import copy
import fcntl
import http.client
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time

BASE = Path('/home/ubuntu/dao/OpenConstructionERP')
BASE_FILES = (
    BASE / 'docker-compose.quickstart.yml',
    BASE / 'docker-compose.override.yml',
)
PIN_FILE = Path('/etc/dao-oce/runtime-pin.yml')
LOCK_FILE = Path('/run/lock/dao-oce-runtime-pin.lock')
APP_CONTAINER = 'openconstructionerp-app-1'
PG_CONTAINER = 'openconstructionerp-postgres-1'
APP_IMAGE_ID = 'sha256:7621593064354a1df414f6598ae7f844bf8d12dc5977537f2297642fc4b523d3'
PG_IMAGE_ID = 'sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'
APP_REPOS = {'ghcr.io/datadrivenconstruction/openconstructionerp'}
PG_REPOS = {'postgres', 'docker.io/library/postgres'}
DOCKER = ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock']
BACKUP_STATE = Path('/var/backups/dao-oce/active.json')


class Halt(ValueError):
    """Fixed safe failure reason; never construct from runtime payloads."""


def run(args, timeout=30):
    result = subprocess.run(
        args, capture_output=True, stdin=subprocess.DEVNULL, timeout=timeout
    )
    if result.returncode:
        raise Halt('command failed')
    if len(result.stdout) > 8 * 1024 * 1024:
        raise Halt('response bound')
    return result.stdout.decode()


def docker(*args, timeout=30):
    return run(DOCKER + list(args), timeout)


def inspect_containers():
    rows = json.loads(docker(
        'inspect', '--type', 'container', APP_CONTAINER, PG_CONTAINER
    ))
    if len(rows) != 2:
        raise Halt('container inspection shape')
    by_name = {row.get('Name', '').lstrip('/'): row for row in rows}
    if set(by_name) != {APP_CONTAINER, PG_CONTAINER}:
        raise Halt('container identity')
    return by_name


def repo_digest(image_id, allowed_repos):
    rows = json.loads(docker('image', 'inspect', image_id))
    if len(rows) != 1 or rows[0].get('Id') != image_id:
        raise Halt('image identity')
    matches = []
    for value in rows[0].get('RepoDigests') or []:
        match = re.fullmatch(r'([^@]+)@(sha256:[0-9a-f]{64})', str(value))
        if match and match.group(1) in allowed_repos:
            matches.append(value)
    matches = sorted(set(matches))
    if len(matches) != 1:
        raise Halt('registry digest unavailable or ambiguous')
    return matches[0]


def compose_command(files, *tail):
    command = ['/usr/bin/docker', 'compose', '--project-directory', str(BASE)]
    for path in files:
        command.extend(['-f', str(path)])
    command.extend(tail)
    return command


def compose_config(files):
    return json.loads(run(compose_command(files, 'config', '--format', 'json'), 30))


def local_reference_matches(reference, expected_id):
    rows = json.loads(docker('image', 'inspect', reference))
    return len(rows) == 1 and rows[0].get('Id') == expected_id


def project_files(row):
    raw = ((row.get('Config') or {}).get('Labels') or {}).get(
        'com.docker.compose.project.config_files', ''
    )
    return {Path(value) for value in raw.split(',') if value}


def health():
    connection = http.client.HTTPConnection('127.0.0.1', 8080, timeout=3)
    try:
        connection.request('GET', '/api/health')
        response = connection.getresponse()
        body = response.read(65537)
        if response.status != 200 or len(body) > 65536:
            return False
        data = json.loads(body)
        return data.get('status') == 'healthy' and data.get('database') == 'ok'
    except Exception:
        return False
    finally:
        connection.close()


def wait_health(seconds=75):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if health():
            return
        time.sleep(2)
    raise Halt('health timeout')


def qualified_backup():
    meta = BACKUP_STATE.lstat()
    if not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or meta.st_mode & 0o077:
        raise Halt('backup state unsafe')
    state = json.loads(BACKUP_STATE.read_text())
    if not (
        state.get('phase') == 'complete'
        and state.get('backup_complete') is True
        and state.get('restore_verified') is True
        and state.get('live_resumed') is True
        and state.get('cleanup_complete') is True
    ):
        raise Halt('qualified backup required')
    return state.get('id')


def verify_runtime(rows):
    app, pg = rows[APP_CONTAINER], rows[PG_CONTAINER]
    if not app.get('State', {}).get('Running') or not pg.get('State', {}).get('Running'):
        raise Halt('runtime stopped')
    if app.get('Image') != APP_IMAGE_ID or pg.get('Image') != PG_IMAGE_ID:
        raise Halt('runtime image drift')
    app_project = ((app.get('Config') or {}).get('Labels') or {}).get(
        'com.docker.compose.project'
    )
    pg_project = ((pg.get('Config') or {}).get('Labels') or {}).get(
        'com.docker.compose.project'
    )
    if not app_project or app_project != pg_project:
        raise Halt('compose project mismatch')
    allowed_sets = {frozenset(BASE_FILES), frozenset((*BASE_FILES, PIN_FILE))}
    if frozenset(project_files(app)) not in allowed_sets:
        raise Halt('app compose sources changed')
    if frozenset(project_files(pg)) not in allowed_sets:
        raise Halt('postgres compose sources changed')
    if not health():
        raise Halt('oce health')
    return app, pg


def pin_text(app_digest, pg_digest):
    return (
        '# Managed by D.A.O OCE runtime pin (#58). No secrets.\n'
        'services:\n'
        '  app:\n'
        f'    image: {app_digest}\n'
        '  postgres:\n'
        f'    image: {pg_digest}\n'
    )


def write_pin(content):
    PIN_FILE.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    parent = PIN_FILE.parent.lstat()
    if parent.st_uid != 0 or parent.st_mode & 0o022:
        raise Halt('pin directory unsafe')
    fd, name = tempfile.mkstemp(prefix='.oce-runtime-pin-', dir=PIN_FILE.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o644)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, PIN_FILE)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def verify_pin_file(expected):
    meta = PIN_FILE.lstat()
    if (
        not stat.S_ISREG(meta.st_mode)
        or meta.st_uid != 0
        or meta.st_mode & 0o022
        or PIN_FILE.read_text() != expected
    ):
        raise Halt('pin file unexpected')


def normalized_config(config):
    result = copy.deepcopy(config)
    services = result.get('services')
    if not isinstance(services, dict) or set(services) != {'app', 'postgres'}:
        raise Halt('compose service set changed')
    for name in ('app', 'postgres'):
        if not isinstance(services[name], dict):
            raise Halt('compose service shape')
        services[name]['image'] = '<image>'
    return result


def prepare_plan():
    backup_id = qualified_backup()
    rows = inspect_containers()
    app, pg = verify_runtime(rows)
    app_digest = repo_digest(APP_IMAGE_ID, APP_REPOS)
    pg_digest = repo_digest(PG_IMAGE_ID, PG_REPOS)

    base = compose_config(BASE_FILES)
    services = base.get('services') or {}
    if set(services) != {'app', 'postgres'}:
        raise Halt('compose service set changed')
    base_app = services['app'].get('image')
    base_pg = services['postgres'].get('image')
    if not isinstance(base_app, str) or not isinstance(base_pg, str):
        raise Halt('compose image reference missing')
    if not local_reference_matches(base_app, APP_IMAGE_ID):
        raise Halt('base app image not rollback-safe')
    if not local_reference_matches(base_pg, PG_IMAGE_ID):
        raise Halt('base postgres image not rollback-safe')

    expected = pin_text(app_digest, pg_digest)
    already = PIN_FILE.exists()
    if already:
        verify_pin_file(expected)
        candidate = compose_config((*BASE_FILES, PIN_FILE))
        if normalized_config(candidate) != normalized_config(base):
            raise Halt('pin override changes non-image configuration')
        if candidate['services']['app'].get('image') != app_digest:
            raise Halt('app digest not effective')
        if candidate['services']['postgres'].get('image') != pg_digest:
            raise Halt('postgres digest not effective')

    return {
        'backup_id': backup_id,
        'rows': rows,
        'app_container_id': app.get('Id'),
        'pg_container_id': pg.get('Id'),
        'app_digest': app_digest,
        'pg_digest': pg_digest,
        'base': base,
        'pin_content': expected,
        'already_configured': already,
    }


def public_plan(plan):
    return {
        'pin_plan_ready': True,
        'backup_qualified': True,
        'app_registry_digest': plan['app_digest'],
        'postgres_registry_digest': plan['pg_digest'],
        'pin_file_present': plan['already_configured'],
        'app_recreate_required': not (
            plan['already_configured']
            and ((plan['rows'][APP_CONTAINER].get('Config') or {}).get('Image')
                 == plan['app_digest'])
        ),
        'postgres_restart_required': False,
        'pull_required': False,
    }


def rollback(plan):
    try:
        if PIN_FILE.exists():
            PIN_FILE.unlink()
        run(compose_command(
            BASE_FILES, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'app'
        ), 90)
        wait_health(75)
        rows = inspect_containers()
        verify_runtime(rows)
        if rows[APP_CONTAINER].get('Image') != APP_IMAGE_ID:
            raise Halt('rollback image mismatch')
        return True
    except Exception:
        return False


def apply():
    plan = prepare_plan()
    app = plan['rows'][APP_CONTAINER]
    if (
        plan['already_configured']
        and ((app.get('Config') or {}).get('Image') == plan['app_digest'])
        and frozenset(project_files(app)) == frozenset((*BASE_FILES, PIN_FILE))
    ):
        print(json.dumps({
            'runtime_pin': 'complete',
            'app_registry_digest': plan['app_digest'],
            'postgres_registry_digest': plan['pg_digest'],
            'app_recreated': False,
            'postgres_restarted': False,
            'health_verified': True,
            'rollback_configuration_preserved': True,
        }, sort_keys=True))
        return

    if plan['already_configured']:
        raise Halt('pin exists but runtime not pinned')

    write_pin(plan['pin_content'])
    try:
        candidate = compose_config((*BASE_FILES, PIN_FILE))
        if normalized_config(candidate) != normalized_config(plan['base']):
            raise Halt('pin override changes non-image configuration')
        if candidate['services']['app'].get('image') != plan['app_digest']:
            raise Halt('app digest not effective')
        if candidate['services']['postgres'].get('image') != plan['pg_digest']:
            raise Halt('postgres digest not effective')

        run(compose_command(
            (*BASE_FILES, PIN_FILE),
            'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'app'
        ), 90)
        wait_health(75)
        after = inspect_containers()
        verify_runtime(after)
        app_after, pg_after = after[APP_CONTAINER], after[PG_CONTAINER]
        if ((app_after.get('Config') or {}).get('Image')) != plan['app_digest']:
            raise Halt('app runtime reference not pinned')
        if frozenset(project_files(app_after)) != frozenset((*BASE_FILES, PIN_FILE)):
            raise Halt('pinned compose sources not active')
        if pg_after.get('Id') != plan['pg_container_id']:
            raise Halt('postgres was unexpectedly recreated')
        verify_pin_file(plan['pin_content'])
    except Exception:
        if rollback(plan):
            raise Halt('pin apply failed; rollback restored')
        raise Halt('pin apply failed; rollback failed')

    print(json.dumps({
        'runtime_pin': 'complete',
        'app_registry_digest': plan['app_digest'],
        'postgres_registry_digest': plan['pg_digest'],
        'app_recreated': app_after.get('Id') != plan['app_container_id'],
        'postgres_restarted': False,
        'health_verified': True,
        'rollback_configuration_preserved': True,
    }, sort_keys=True))


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in {'plan', 'apply'}:
        raise Halt('usage')
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(LOCK_FILE, 'a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if sys.argv[1] == 'plan':
            print(json.dumps(public_plan(prepare_plan()), sort_keys=True))
        else:
            apply()


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except BlockingIOError:
        print(json.dumps({'oce_runtime_pin_error': 'operation already active'}), file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        reason = str(exc) if isinstance(exc, Halt) else 'internal_or_command_error'
        print(json.dumps({'oce_runtime_pin_error': reason}), file=sys.stderr)
        sys.exit(1)
