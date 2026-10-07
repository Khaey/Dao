#!/usr/bin/python3 -I
"""Fixed OCE cold backup and isolated PostgreSQL restore. Installed root-only.

No caller-supplied paths, images, container names, SQL or restore target.
The systemd unit always runs recover after its worker, including on timeout.
"""
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import uuid

ROOT = Path('/var/backups/dao-oce')
INSTALLED = Path('/usr/local/sbin/dao-oce-backup')
UNIT = 'dao-oce-backup.service'
DOCKER = ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock']
APP_IMAGE = 'sha256:7621593064354a1df414f6598ae7f844bf8d12dc5977537f2297642fc4b523d3'
PG_IMAGE = 'sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'
PG_DEST = '/var/lib/postgresql/data'
LIMIT = 2 * 1024**3
RESERVE = 2 * 1024**3
MAX_ENTRIES = 100000
LABEL = 'com.dao.oce.restore'
class Halt(ValueError):
    '''A fixed, safe failure reason; never construct with runtime payloads.'''


PHASES = {'queued', 'checking', 'stopping', 'archiving', 'resuming',
          'restoring', 'complete', 'failed', 'recovery_failed'}
SQL = ('SELECT current_setting(\'server_version_num\')::int/10000, '
       '(SELECT count(*) FROM pg_class WHERE relkind IN (\'r\',\'p\')), '
       '(SELECT system_identifier FROM pg_control_system());')


def run(args, timeout=15):
    result = subprocess.run(args, capture_output=True, stdin=subprocess.DEVNULL,
                            timeout=timeout, check=True)
    if len(result.stdout) > 8 * 1024**2:
        raise Halt('response bound')
    return result.stdout.decode()


def docker(*args, timeout=15):
    return run(DOCKER + list(args), timeout)


def inspect(ids):
    rows = json.loads(docker('inspect', '--type', 'container', *ids))
    if len(rows) != len(ids):
        raise Halt('inspection shape')
    return rows


def env(row):
    pairs = [s.split('=', 1) for s in row['Config'].get('Env', []) if '=' in s]
    if len({p[0] for p in pairs}) != len(pairs):
        raise Halt('duplicate environment key')
    return dict(pairs)


def secure_directory(path, create=False):
    if create and not path.exists():
        path.mkdir(mode=0o700)
    for part in (path, *path.parents):
        meta = part.lstat()
        if not stat.S_ISDIR(meta.st_mode) or meta.st_uid != 0 or meta.st_mode & 0o022:
            raise Halt('unsafe directory')
    if path.stat().st_mode & 0o077:
        raise Halt('private directory required')


def write_json(path, data):
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.pending-')
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(data, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def load_state():
    path = ROOT / 'active.json'
    meta = path.lstat()
    if not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or meta.st_mode & 0o077:
        raise Halt('unsafe state')
    state = json.loads(path.read_text())
    if not re.fullmatch(r'[0-9a-f]{32}', state['id']) or state['phase'] not in PHASES:
        raise Halt('invalid state')
    return state


def save(state, **updates):
    state.update(updates)
    write_json(ROOT / 'active.json', state)
    write_json(ROOT / state['id'] / 'result.json', public_status(state))


def public_status(state):
    return {key: state.get(key) for key in (
        'id', 'phase', 'backup_complete', 'restore_verified', 'live_resumed',
        'cleanup_complete', 'logical_bytes', 'archive_bytes')}


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


def overlaps(a, b):
    return (isinstance(a, str) and isinstance(b, str) and a.startswith('/') and b.startswith('/')
            and os.path.commonpath([a, b]) in {a, b})


def topology(rows):
    """Pure selection/guards; full Docker rows never reach public output."""
    apps = [r for r in rows if r.get('Name') == '/openconstructionerp-app-1']
    if len(apps) != 1:
        raise Halt('app identity')
    app = apps[0]
    project = app['Config'].get('Labels', {}).get('com.docker.compose.project')
    if not project:
        raise Halt('project identity')
    group = [r for r in rows if r['Config'].get('Labels', {}).get('com.docker.compose.project') == project]
    databases = [r for r in group if r['Config'].get('Labels', {}).get('com.docker.compose.service') == 'postgres']
    if len(group) != 2 or len(databases) != 1:
        raise Halt('unsupported writer topology')
    pg = databases[0]
    targets = {'app': app, 'pg': pg}
    result = {}
    for role, row in targets.items():
        image = APP_IMAGE if role == 'app' else PG_IMAGE
        destination = '/data' if role == 'app' else PG_DEST
        if row.get('Image') != image or not row.get('State', {}).get('Running'):
            raise Halt('runtime changed or stopped')
        if row.get('HostConfig', {}).get('Privileged') or row.get('HostConfig', {}).get('NetworkMode') == 'host':
            raise Halt('unsupported container isolation')
        mounts = row.get('Mounts', [])
        if len(mounts) != 1:
            raise Halt('unsupported mount topology')
        mount = mounts[0]
        if (mount.get('Type') != 'volume' or mount.get('Destination') != destination or mount.get('RW') is not True
                or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', str(mount.get('Name')))
                or mount.get('Source') != '/var/lib/docker/volumes/' + mount['Name'] + '/_data'):
            raise Halt('unsupported volume')
        for other in rows:
            if other['Id'] == row['Id']:
                continue
            if any(overlaps(mount['Source'], m.get('Source')) for m in other.get('Mounts', [])):
                raise Halt('additional storage writer or reader')
        result[role] = {'id': row['Id'], 'image': image, 'volume': mount['Name'], 'source': mount['Source']}
    if any(pg.get('NetworkSettings', {}).get('Ports', {}).values()):
        raise Halt('published database')
    pg_env, app_env = env(pg), env(app)
    if pg_env.get('PGDATA', PG_DEST) != PG_DEST or pg_env.get('POSTGRES_PASSWORD_FILE'):
        raise Halt('unsupported database configuration')
    pg_names = {pg['Name'].lstrip('/')}
    for net in pg.get('NetworkSettings', {}).get('Networks', {}).values():
        pg_names.update(net.get('Aliases') or [])
        pg_names.add(net.get('IPAddress'))
    expected_db = pg_env.get('POSTGRES_DB') or pg_env.get('POSTGRES_USER') or 'postgres'
    for key in ('DATABASE_URL', 'DATABASE_SYNC_URL'):
        url = urllib.parse.urlsplit(app_env.get(key, ''))
        if (url.scheme.split('+')[0] not in {'postgres', 'postgresql'} or url.hostname not in pg_names
                or (url.port or 5432) != 5432 or urllib.parse.unquote(url.path[1:]) != expected_db):
            raise Halt('database target disagreement')
    # Clone-only file, never an argument or printed payload.
    result['pg_environment'] = {key: pg_env[key] for key in ('POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD') if key in pg_env}
    if any(any(c in value for c in '\r\n\x00') for value in result['pg_environment'].values()):
        raise Halt('unsupported environment encoding')
    return result


def discover():
    ids = docker('ps', '--all', '--no-trunc', '--quiet').splitlines()
    if not 1 <= len(ids) <= 64 or any(not re.fullmatch(r'[0-9a-f]{64}', i) for i in ids):
        raise Halt('container inventory bound')
    rows = inspect(ids)
    found = topology(rows)
    for role in ('app', 'pg'):
        target = found[role]
        volume = json.loads(docker('volume', 'inspect', target['volume']))[0]
        if volume['Driver'] != 'local' or volume.get('Options') or volume['Mountpoint'] != target['source']:
            raise Halt('unsupported volume driver')
        source = Path(target['source'])
        if source.resolve() != source or not source.is_dir():
            raise Halt('unsafe volume source')
        target['uid'], target['gid'] = source.stat().st_uid, source.stat().st_gid
    if found['pg']['uid'] == 0 or not health():
        raise Halt('database ownership or health')
    return found, rows


def entries(source, pg=False):
    result, logical = [], 0
    for current, dirs, files in os.walk(source, followlinks=False):
        dirs.sort()
        files.sort()
        paths = [Path(current)] + [Path(current) / n for n in files]
        paths += [Path(current) / n for n in dirs if (Path(current) / n).is_symlink()]
        for path in paths:
            meta = path.lstat()
            name = path.relative_to(source).as_posix()
            if not (stat.S_ISDIR(meta.st_mode) or stat.S_ISREG(meta.st_mode) or stat.S_ISLNK(meta.st_mode)):
                raise Halt('unsupported special file')
            if (pg and stat.S_ISLNK(meta.st_mode)) or meta.st_mode & (stat.S_ISUID | stat.S_ISGID):
                raise Halt('external storage or special permissions')
            logical += meta.st_size if stat.S_ISREG(meta.st_mode) else 0
            result.append((name, path, meta))
            if len(result) > MAX_ENTRIES or logical > LIMIT:
                raise Halt('backup size bound')
    return sorted(result), logical


def capacity(found):
    logical = sum(entries(Path(found[r]['source']), pg=r == 'pg')[1] for r in ('app', 'pg'))
    if logical > LIMIT or min(shutil.disk_usage(ROOT).free, *(shutil.disk_usage(found[r]['source']).free for r in ('app', 'pg'))) < 4 * logical + RESERVE:
        raise Halt('insufficient backup/restore reserve')
    return logical


class Reader:
    def __init__(self, stream, deadline):
        self.stream, self.deadline, self.digest = stream, deadline, hashlib.sha256()

    def read(self, size):
        if time.monotonic() > self.deadline:
            raise TimeoutError('quiescence budget')
        data = self.stream.read(size)
        self.digest.update(data)
        return data


def file_hash(path, deadline=None):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024**2), b''):
            if deadline is not None and time.monotonic() > deadline:
                raise TimeoutError('hash budget')
            digest.update(block)
    return digest.hexdigest()


def archive(source, path, pg, deadline):
    manifest = {}
    rows, _ = entries(source, pg)
    with open(path, 'xb') as raw:
        os.fchmod(raw.fileno(), 0o600)
        with tarfile.open(fileobj=raw, mode='w', format=tarfile.PAX_FORMAT) as output:
            for name, item, meta in rows:
                if time.monotonic() > deadline:
                    raise TimeoutError('quiescence budget')
                member = output.gettarinfo(str(item), arcname=name)
                member.mode = stat.S_IMODE(member.mode)
                # Store every regular file, including hardlinks, independently.
                if stat.S_ISREG(meta.st_mode):
                    member.type, member.linkname, member.size = tarfile.REGTYPE, '', meta.st_size
                    with open(item, 'rb') as stream:
                        reader = Reader(stream, deadline)
                        output.addfile(member, reader)
                    after = item.stat()
                    if (meta.st_size, meta.st_mtime_ns, meta.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                        raise Halt('source changed')
                    digest = reader.digest.hexdigest()
                else:
                    output.addfile(member)
                    digest = member.linkname if member.issym() else None
                manifest[name] = {'type': member.type.decode(), 'size': member.size, 'mode': member.mode,
                                  'uid': member.uid, 'gid': member.gid, 'digest': digest}
        raw.flush()
        os.fsync(raw.fileno())
    return manifest


def restore_archive(path, destination, manifest):
    """Fresh clone volume only. No extractall, hardlinks or symlink traversal."""
    if destination.is_symlink() or not destination.is_dir() or any(destination.iterdir()):
        raise Halt('restore target must be empty')
    with tarfile.open(path, 'r:') as source:
        members = source.getmembers()
        if len(members) > MAX_ENTRIES or len({m.name for m in members}) != len(members):
            raise Halt('archive member bound or duplicates')
        if any(m.size < 0 for m in members) or sum(m.size for m in members if m.isfile()) > LIMIT:
            raise Halt('archive size bound')
        if {m.name for m in members} != set(manifest):
            raise Halt('manifest membership')
        symlinks = {m.name for m in members if m.issym()}
        for member in members:
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or not (member.isdir() or member.isfile() or member.issym()):
                raise Halt('unsafe archive entry')
            if any(p.as_posix() in symlinks for p in name.parents):
                raise Halt('symlink ancestor')
            expected = manifest[member.name]
            if any(expected[k] != value for k, value in (
                ('type', member.type.decode()), ('size', member.size), ('mode', member.mode),
                ('uid', member.uid), ('gid', member.gid))):
                raise Halt('archive metadata mismatch')
            if member.mode & (stat.S_ISUID | stat.S_ISGID):
                raise Halt('special permissions')
        # Directories and files precede all symlinks. No write follows a link.
        ordered = sorted(members, key=lambda m: (2 if m.issym() else 0 if m.isdir() else 1, len(PurePosixPath(m.name).parts)))
        for member in ordered:
            target = destination / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, 'wb') as output, source.extractfile(member) as stream:
                    shutil.copyfileobj(stream, output, 1024**2)
                if file_hash(target) != manifest[member.name]['digest']:
                    raise Halt('restored content mismatch')
            else:
                if member.linkname != manifest[member.name]['digest']:
                    raise Halt('link mismatch')
                os.symlink(member.linkname, target)
        for member in reversed(ordered):
            target = destination / member.name
            os.chown(target, member.uid, member.gid, follow_symlinks=False)
            if not member.issym():
                os.chmod(target, member.mode)


def db_proof(container, target, clone=False):
    host = '/tmp' if clone else '/var/run/postgresql'
    script = ('export PGHOST=' + host + ' PGPORT=5432; '
              'export PGUSER="${POSTGRES_USER:-postgres}" PGDATABASE="${POSTGRES_DB:-${POSTGRES_USER:-postgres}}"; '
              'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; '
              'exec psql -X -qAt -v ON_ERROR_STOP=1 -c ' + "'" + SQL.replace("'", "'\\''") + "'")
    raw = docker('exec', '--user', f"{target['uid']}:{target['gid']}", container, '/bin/sh', '-ec', script, timeout=6).strip()
    if not re.fullmatch(r'16\|[1-9][0-9]*\|[0-9]+', raw):
        raise Halt('database proof')
    return raw


def wait_for(test, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            result = test()
            if result:
                return result
        except Exception:
            pass
        time.sleep(2)
    raise TimeoutError('readiness')


def validate_identity(target, row):
    if row.get('Id') != target['id'] or row.get('Image') != target['image']:
        raise Halt('original container changed')
    if not any(m.get('Name') == target['volume'] and m.get('Source') == target['source'] for m in row.get('Mounts', [])):
        raise Halt('original volume changed')


def resume(state):
    if not state.get('need_resume'):
        return
    save(state, phase='resuming')
    targets = state['targets']
    for role in ('pg', 'app'):
        validate_identity(targets[role], inspect([targets[role]['id']])[0])
    docker('start', targets['pg']['id'], timeout=25)
    try:
        wait_for(lambda: db_proof(targets['pg']['id'], targets['pg']), 45)
    finally:
        docker('start', targets['app']['id'], timeout=25)
    wait_for(health, 60)
    save(state, need_resume=False, live_resumed=True)


def clone_names(state):
    token = state['id']
    return 'dao-oce-restore-' + token, {r: 'dao_oce_restore_' + token + '_' + r for r in ('app', 'pg')}


def cleanup(state):
    name, volumes = clone_names(state)
    ok = True
    for candidate in (name, name + '-check'):
        try:
            rows = json.loads(docker('ps', '--all', '--no-trunc', '--format', '{{json .}}', '--filter', 'name=^/' + candidate + '$') or 'null')
            if rows:
                obj = inspect([rows['ID']])[0]
                if obj['Config'].get('Labels', {}).get(LABEL) != state['id'] or obj.get('Image') != PG_IMAGE:
                    raise Halt('foreign restore container')
                docker('rm', '-f', rows['ID'], timeout=20)
        except Exception:
            ok = False
    for name in volumes.values():
        try:
            found = docker('volume', 'ls', '--quiet').splitlines()
            if name in found:
                obj = json.loads(docker('volume', 'inspect', name))[0]
                if obj.get('Labels', {}).get(LABEL) != state['id'] or obj['Name'] != name:
                    raise Halt('foreign restore volume')
                docker('volume', 'rm', name)
        except Exception:
            ok = False
    save(state, cleanup_complete=ok)
    return ok


def isolated_restore(state, manifests, proof):
    name, volumes = clone_names(state)
    folder = ROOT / state['id']
    required = sum(m['size'] for items in manifests.values() for m in items.values() if m['type'] == '0')
    if shutil.disk_usage(ROOT).free < required + RESERVE:
        raise Halt('restore reserve changed')
    for role, volume in volumes.items():
        # Never adopt/reuse an existing volume, even with a matching label.
        if volume in docker('volume', 'ls', '--quiet').splitlines():
            raise Halt('restore target exists')
        docker('volume', 'create', '--label', LABEL + '=' + state['id'], volume)
        obj = json.loads(docker('volume', 'inspect', volume))[0]
        destination = Path('/var/lib/docker/volumes') / volume / '_data'
        if (obj['Name'] != volume or obj['Mountpoint'] != str(destination) or obj['Driver'] != 'local'
                or obj.get('Options') or destination.resolve() != destination
                or obj.get('Labels', {}).get(LABEL) != state['id']):
            raise Halt('restore storage')
        if str(destination) in {state['targets'][r]['source'] for r in ('app', 'pg')}:
            raise Halt('live restore target')
        path = folder / (role + '.tar')
        if file_hash(path) != state['archive_hashes'][role]:
            raise Halt('archive changed')
        restore_archive(path, destination, manifests[role])
    private_env = folder / 'restore.env'
    with open(private_env, 'x') as stream:
        os.fchmod(stream.fileno(), 0o600)
        for key, value in state['targets']['pg_environment'].items():
            stream.write(key + '=' + value + '\n')
    pg = state['targets']['pg']
    docker('create', '--name', name, '--label', LABEL + '=' + state['id'], '--pull', 'never',
           '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
           '--memory', '512m', '--cpus', '1', '--pids-limit', '128', '--user', f"{pg['uid']}:{pg['gid']}",
           '--tmpfs', '/tmp:rw,nosuid,nodev,size=16m,mode=1777', '--env-file', str(private_env),
           '--mount', 'type=volume,source=' + volumes['pg'] + ',target=' + PG_DEST,
           '--entrypoint', 'postgres', PG_IMAGE, '-D', PG_DEST,
           '-c', 'listen_addresses=', '-c', 'unix_socket_directories=/tmp',
           '-c', 'shared_preload_libraries=', '-c', 'autovacuum=off', '-c', 'archive_mode=off',
           '-c', 'ssl=off', '-c', 'max_worker_processes=0')
    private_env.unlink()
    obj = inspect([name])[0]
    if obj['Image'] != PG_IMAGE or obj['HostConfig']['NetworkMode'] != 'none' or obj['HostConfig'].get('PortBindings'):
        raise Halt('restore isolation')
    mounts = obj.get('Mounts', [])
    if len(mounts) != 1 or mounts[0].get('Name') != volumes['pg']:
        raise Halt('restore mount isolation')
    docker('start', name)
    actual = wait_for(lambda: db_proof(name, pg, clone=True), 60)
    if actual != proof:
        raise Halt('restored database identity/schema mismatch')
    save(state, restore_verified=True)


def worker():
    state = load_state()
    if state['phase'] != 'queued':
        raise Halt('job already consumed')
    folder = ROOT / state['id']
    save(state, phase='checking')
    found, rows = discover()
    logical = capacity(found)
    # Metadata may contain credentials; retained only in the private backup.
    selected_ids = {found[r]['id'] for r in ('app', 'pg')}
    write_json(folder / 'runtime-private.json', [r for r in rows if r['Id'] in selected_ids])
    save(state, targets=found, logical_bytes=logical, phase='stopping', need_resume=True, live_resumed=False)
    manifests = {}
    try:
        docker('stop', '--time', '30', found['app']['id'], timeout=40)
        app_state = inspect([found['app']['id']])[0]['State']
        if app_state['Running'] or app_state.get('ExitCode') not in (0, 130, 143):
            raise Halt('unclean application stop')
        proof = db_proof(found['pg']['id'], found['pg'])
        docker('stop', '--time', '30', found['pg']['id'], timeout=40)
        pg_state = inspect([found['pg']['id']])[0]['State']
        if pg_state['Running'] or pg_state.get('ExitCode') != 0:
            raise Halt('unclean database stop')
        check_name = clone_names(state)[0] + '-check'
        control = docker('run', '--rm', '--name', check_name, '--label', LABEL + '=' + state['id'],
                         '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                         '--env', 'LC_ALL=C',
                         '--security-opt', 'no-new-privileges', '--user', f"{found['pg']['uid']}:{found['pg']['gid']}",
                         '--mount', 'type=volume,source=' + found['pg']['volume'] + ',target=' + PG_DEST + ',readonly',
                         '--entrypoint', 'pg_controldata', PG_IMAGE, PG_DEST)
        if not re.search(r'^Database cluster state:\s+shut down\s*$', control, re.M):
            raise Halt('database not cleanly shut down')
        save(state, phase='archiving')
        deadline = time.monotonic() + 120
        for role in ('app', 'pg'):
            manifests[role] = archive(Path(found[role]['source']), folder / (role + '.tar'), role == 'pg', deadline)
        write_json(folder / 'file-manifest-private.json', manifests)
        hashes = {r: file_hash(folder / (r + '.tar'), deadline) for r in ('app', 'pg')}
        for role in ('app', 'pg'):
            current = inspect([found[role]['id']])[0]
            validate_identity(found[role], current)
            if current['State']['Running']:
                raise Halt('writer restarted during archive')
        save(state, backup_complete=True, archive_hashes=hashes,
             archive_bytes=sum((folder / (r + '.tar')).stat().st_size for r in ('app', 'pg')))
    finally:
        resume(state)
    save(state, phase='restoring')
    try:
        isolated_restore(state, manifests, proof)
    finally:
        cleanup(state)
    if not state.get('cleanup_complete'):
        raise Halt('restore cleanup incomplete')
    save(state, phase='complete')


def recover():
    if not (ROOT / 'active.json').exists():
        return
    state = load_state()
    complete = state['phase'] == 'complete'
    try:
        resume(state)
    except Exception:
        save(state, phase='recovery_failed')
        raise
    finally:
        clean = cleanup(state)
    if not clean:
        save(state, phase='failed')
        raise Halt('recovery cleanup incomplete')
    if not complete:
        save(state, phase='failed')
    print(json.dumps(public_status(state)))


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in {'plan', 'start', 'status', 'worker', 'recover'}:
        raise Halt('installed root command required')
    if Path(__file__).resolve() != INSTALLED:
        raise Halt('install the reviewed helper first')
    meta = INSTALLED.lstat()
    if meta.st_uid != 0 or meta.st_mode & 0o022:
        raise Halt('unsafe executable')
    secure_directory(ROOT, create=True)
    operation = sys.argv[1]
    if operation == 'status':
        print(json.dumps(public_status(load_state())))
        return
    lock = os.open(ROOT / '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    # Worker may start before the scheduling command has released its lock.
    flags = fcntl.LOCK_EX | (fcntl.LOCK_NB if operation in {'plan', 'start'} else 0)
    fcntl.flock(lock, flags)
    if operation in {'plan', 'start'}:
        active = subprocess.run(['/usr/bin/systemctl', 'is-active', UNIT], capture_output=True, text=True, timeout=5).stdout.strip()
        if active in {'active', 'activating', 'deactivating', 'reloading'}:
            raise Halt('operation already active')
        if (ROOT / 'active.json').exists():
            previous = load_state()
            if previous.get('need_resume') or not previous.get('cleanup_complete'):
                raise Halt('recover previous job first')
        found, _ = discover()
        logical = capacity(found)
        if operation == 'plan':
            print(json.dumps({'plan_ready': True, 'logical_bytes': logical,
                              'temporary_oce_outage_required': True, 'production_restore': False}))
            return
        token = uuid.uuid4().hex
        (ROOT / token).mkdir(mode=0o700)
        state = {'id': token, 'phase': 'queued', 'need_resume': False, 'backup_complete': False,
                 'restore_verified': False, 'live_resumed': True, 'cleanup_complete': False,
                 'logical_bytes': logical, 'targets': found}
        save(state)
        run(['/usr/bin/systemctl', 'reset-failed', UNIT])
        run(['/usr/bin/systemctl', 'start', '--no-block', UNIT])
        print(json.dumps(public_status(state)))
    elif operation == 'worker':
        worker()
    else:
        recover()


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as exc:
        reason = str(exc) if isinstance(exc, Halt) else 'internal_or_command_error'
        print(json.dumps({'oce_backup_error': reason, 'recovery': 'attached_to_service'}), file=sys.stderr)
        sys.exit(1)
