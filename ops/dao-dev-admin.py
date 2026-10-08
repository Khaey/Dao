#!/usr/bin/python3 -I
"""Installed root-owned: fixed D.A.O DEV operations, never an arbitrary shell."""
import grp
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import urllib.parse

ENV = Path('/etc/dao/dao-dev.env')
BACKUP = Path('/etc/dao/dao-dev.env.previous')
ALLOWED = {'RESEND_API_KEY', 'DAO_EMAIL_FROM', 'DAO_PUBLIC_URL'}


def _inventory_json(argv):
    raw = _run_safe(argv, timeout=12)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError('inventory response too large')
    return json.loads(raw)


def _db_hint(value, peers):
    """Classify a DSN in memory; never return any substring of it."""
    try:
        parsed = urllib.parse.urlsplit(value)
        scheme = parsed.scheme.split('+', 1)[0].lower()
        engine = {'sqlite': 'sqlite', 'postgres': 'postgresql',
                  'postgresql': 'postgresql', 'mysql': 'mysql',
                  'mariadb': 'mysql'}.get(scheme, 'unknown')
        if engine == 'sqlite':
            # SQLAlchemy SQLite DSNs use four slashes for absolute paths;
            # three slashes denote a path relative to the container workdir.
            absolute = parsed.path.startswith('//') and not parsed.netloc
            path = os.path.normpath(urllib.parse.unquote(parsed.path[1:])) if absolute else ''
            return {'engine': engine, 'location': 'data_mount' if path.startswith('/data/')
                    else 'other_or_memory'}
        host = parsed.hostname
        matches = [label for label, names in peers.items() if host and host in names]
        location = (matches[0] if len(matches) == 1 else
                    'container_loopback' if host in {'localhost', '127.0.0.1', '::1'} else
                    'unresolved')
        return {'engine': engine, 'location': location}
    except (ValueError, TypeError):
        return {'engine': 'unknown', 'location': 'unresolved'}


def _root_controlled_config(value):
    """Stat only: no Compose execution, env expansion, file read or path output."""
    if not isinstance(value, str) or len(value) > 4096 or not value.startswith('/'):
        return False
    path = Path(value)
    if '..' in path.parts or path.suffix not in {'.yml', '.yaml'}:
        return False
    try:
        import stat
        for entry in (path, *path.parents):
            meta = entry.lstat()
            if meta.st_uid != 0 or meta.st_mode & 0o022 or stat.S_ISLNK(meta.st_mode):
                return False
            if entry == path and not stat.S_ISREG(meta.st_mode):
                return False
        return True
    except OSError:
        return False


def _oce_topology(app, containers, image):
    """Allowlisted metadata only; Docker inspection payloads are secret-bearing."""
    config = app.get('Config') or {}
    labels = config.get('Labels') or {}
    project = labels.get('com.docker.compose.project')
    networks = set((app.get('NetworkSettings') or {}).get('Networks') or {})
    mounts = app.get('Mounts') or []
    data = [m for m in mounts if m.get('Destination') == '/data']
    sources = {m.get('Source') for m in mounts if m.get('Source')}

    def shares_storage(row):
        # Include parent/child bind mounts as possible writers, not just equality.
        for mount in row.get('Mounts') or []:
            other = mount.get('Source')
            for source in sources:
                if (isinstance(other, str) and other.startswith('/') and source.startswith('/')
                        and os.path.commonpath([other, source]) in {other, source}):
                    return True
        return False

    related, names = [], {}
    for row in sorted(containers, key=lambda r: r.get('Id', '')):
        if row.get('Id') == app.get('Id'):
            continue
        cfg = row.get('Config') or {}
        nets = (row.get('NetworkSettings') or {}).get('Networks') or {}
        same_project = bool(project and (cfg.get('Labels') or {}).get('com.docker.compose.project') == project)
        shared = shares_storage(row)
        same_network = bool(networks.intersection(nets))
        if not (same_project or shared or same_network):
            continue
        alias = 'peer_' + str(len(related) + 1)
        aliases = {str(row.get('Name') or '').lstrip('/')}
        for network in nets.values():
            aliases.update(network.get('Aliases') or [])
            aliases.update(network.get('DNSNames') or [])
            aliases.add(network.get('IPAddress'))
        names[alias] = aliases
        image_name = str(cfg.get('Image') or '').rsplit('/', 1)[-1].split(':', 1)[0].split('@', 1)[0]
        family = image_name if image_name in {'postgres', 'mysql', 'mariadb', 'redis', 'caddy', 'nginx'} else 'other'
        related.append({'alias': alias, 'family': family,
                        'running': bool((row.get('State') or {}).get('Running')),
                        'same_compose_project': same_project, 'shared_storage': shared,
                        'shared_network': same_network})

    hints = []
    for item in config.get('Env') or []:
        key, sep, value = item.partition('=')
        if sep and key in {'DATABASE_URL', 'DATABASE_SYNC_URL', 'SQLALCHEMY_DATABASE_URL', 'SQLALCHEMY_DATABASE_URI'}:
            hints.append({'key': key, **_db_hint(value, names)})
    paths = labels.get('com.docker.compose.project.config_files', '').split(',')
    paths = [p for p in paths if p]
    if len(paths) > 8:
        raise ValueError('too many compose files')
    digest_pattern = r'ghcr\.io/datadrivenconstruction/openconstructionerp@sha256:[0-9a-f]{64}'
    digests = [d for d in image.get('RepoDigests') or []
               if isinstance(d, str) and re.fullmatch(digest_pattern, d)]
    published = []
    for port, bindings in ((app.get('NetworkSettings') or {}).get('Ports') or {}).items():
        if not re.fullmatch(r'[0-9]{1,5}/(?:tcp|udp)', port):
            continue
        for binding in bindings or []:
            host = binding.get('HostIp')
            scope = ('loopback' if host in {'127.0.0.1', '::1'} else
                     'wildcard' if host in {'0.0.0.0', '::', ''} else 'specific_interface')
            published.append({'container_port': port, 'scope': scope})
    return {
        'oce_integration_inventory': 'ok', 'schema_version': 1,
        'app_running': bool((app.get('State') or {}).get('Running')),
        'image_digests': sorted(set(digests)),
        'runtime_reference_is_digest': bool(re.fullmatch(digest_pattern, str(config.get('Image') or ''))),
        'compose': {'project_label_present': bool(project), 'config_file_count': len(paths),
                    'config_files_root_controlled': bool(paths) and all(_root_controlled_config(p) for p in paths),
                    'configuration_contents_read': False},
        'data_mount': {'count': len(data),
                       'named_volume': len(data) == 1 and data[0].get('Type') == 'volume' and bool(data[0].get('Name')),
                       'writable': len(data) == 1 and data[0].get('RW') is True},
        'database_hints': hints, 'related_containers': related, 'published_ports': published,
        'app_host_network': (app.get('HostConfig') or {}).get('NetworkMode') == 'host',
        'app_privileged': bool((app.get('HostConfig') or {}).get('Privileged')),
        'all_writers_identified': False, 'database_verified': False,
        'backup_restore_verified': False, 'gateway_bypass_tested': False,
    }


def oce_gateway_plan():
    """Run only the installed gateway host read-only plan operation."""
    helper = Path('/usr/local/sbin/dao-oce-gateway-host')
    if not helper.is_file() or not os.access(helper, os.X_OK):
        print(json.dumps({'oce_gateway_plan': 'bootstrap_required'}, sort_keys=True))
        return
    result = subprocess.run(
        [str(helper), 'plan'],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    stdout = result.stdout.strip()
    if result.returncode == 0:
        # The gateway helper emits one bounded JSON object with no credentials.
        try:
            data = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise ValueError('gateway plan output invalid') from exc
        if not isinstance(data, dict):
            raise ValueError('gateway plan output invalid')
        print(json.dumps(data, sort_keys=True))
        return
    # Keep failure sanitized; never forward stderr from a root helper.
    print(json.dumps({'oce_gateway_plan': 'failed'}, sort_keys=True))
    raise ValueError('gateway plan failed')


def oce_integration_inventory():
    """Fixed inspect-only command; no Docker exec, stop, compose or credentials."""
    docker = shutil.which('docker')
    if not docker:
        raise ValueError('docker missing')
    app_rows = _inventory_json([docker, 'inspect', '--type', 'container', 'openconstructionerp-app-1'])
    if not isinstance(app_rows, list) or len(app_rows) != 1:
        raise ValueError('unexpected OCE container')
    app = app_rows[0]
    image_id = app.get('Image', '')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', image_id):
        raise ValueError('unexpected image id')
    ids = _run_safe([docker, 'ps', '--all', '--no-trunc', '--quiet'], timeout=12).splitlines()
    if not 1 <= len(ids) <= 64 or any(not re.fullmatch(r'[0-9a-f]{64}', i) for i in ids):
        raise ValueError('unsupported container inventory')
    containers = _inventory_json([docker, 'inspect', '--type', 'container', *ids])
    if not isinstance(containers, list) or len(containers) != len(ids):
        raise ValueError('container inventory changed')
    current = [r for r in containers if r.get('Id') == app.get('Id')]
    if len(current) != 1 or current[0].get('Image') != image_id:
        raise ValueError('OCE changed during inventory')
    app = current[0]
    images = _inventory_json([docker, 'image', 'inspect', image_id])
    if not isinstance(images, list) or len(images) != 1:
        raise ValueError('unexpected image inventory')
    report = _oce_topology(app, containers, images[0])
    report['host_available_bytes'] = shutil.disk_usage('/').free
    print(json.dumps(report, sort_keys=True))


def _run_safe(argv, timeout=15):
    return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=True).stdout


def _select_oce_container(rows):
    """Pick the OCE API container from already-sanitized docker ps rows."""
    for row in rows:
        haystack = ' '.join(str(row.get(key, '')) for key in ('Image', 'Names')).lower()
        if 'openconstruction' in haystack or 'openestimate' in haystack:
            return row
    for row in rows:
        if '8080' in str(row.get('Ports', '')):
            return row
    return None


def _safe_container_meta(inspected):
    config = inspected.get('Config') or {}
    mounts = inspected.get('Mounts') or []
    env_keys = []
    for value in config.get('Env') or []:
        key = value.split('=', 1)[0] if '=' in value else ''
        if any(token in key for token in ('DEMO_', 'JWT_', 'DATABASE_', 'S3_', 'REDIS_', 'APP_ENV', 'SEED_DEMO')):
            env_keys.append(key)
    return {
        'name': str(inspected.get('Name') or '').lstrip('/')[:128],
        'image_ref': str(config.get('Image') or '')[:300],
        'image_id': str(inspected.get('Image') or '')[:160],
        'env_keys': sorted(set(env_keys)),
        'mounts': [
            {
                'type': str(item.get('Type') or '')[:32],
                'destination': str(item.get('Destination') or '')[:256],
                'named_volume': bool(item.get('Name')),
            }
            for item in mounts[:32]
        ],
    }


def oce_audit():
    docker = shutil.which('docker')
    if not docker:
        print(json.dumps({'oce_root_audit': 'docker_missing'}))
        return

    rows = []
    for line in _run_safe([docker, 'ps', '--format', '{{json .}}']).splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    candidate = _select_oce_container(rows)
    if not candidate:
        print(json.dumps({'oce_root_audit': 'container_not_found', 'running_containers': len(rows)}))
        return

    container_id = str(candidate.get('ID') or '')
    if not re.fullmatch(r'[A-Fa-f0-9]{8,64}', container_id):
        raise ValueError('invalid container id')
    inspected_rows = json.loads(_run_safe([docker, 'inspect', container_id]))
    if not isinstance(inspected_rows, list) or len(inspected_rows) != 1 or not isinstance(inspected_rows[0], dict):
        raise ValueError('unexpected docker inspect shape')
    inspected = inspected_rows[0]
    meta = _safe_container_meta(inspected)

    image_id = meta['image_id']
    digests = []
    if image_id:
        image_rows = json.loads(_run_safe([docker, 'image', 'inspect', image_id]))
        if isinstance(image_rows, list) and len(image_rows) == 1 and isinstance(image_rows[0], dict):
            for digest in image_rows[0].get('RepoDigests') or []:
                if isinstance(digest, str) and len(digest) <= 500:
                    digests.append(digest)
    meta['repo_digests'] = sorted(set(digests))

    probe = (
        "import importlib,json,shutil;"
        "r={};"
        "[r.__setitem__(x,bool(shutil.which(x))) for x in ('IfcConvert','ifcconvert','ffmpeg','libreoffice')];"
        "mods={};"
        "exec(\"\\nfor x in ('ifcopenshell','pymupdf','fitz','lancedb','sentence_transformers'):\\n"
        " try:\\n  m=importlib.import_module(x); mods[x]=str(getattr(m,'__version__',True))[:80]\\n"
        " except Exception:\\n  mods[x]=False\");"
        "r['python_modules']=mods;print(json.dumps(r,sort_keys=True))"
    )
    try:
        converter_raw = _run_safe([docker, 'exec', container_id, 'python3', '-c', probe], timeout=20)
        converters = json.loads(converter_raw)
        if not isinstance(converters, dict):
            converters = {'status': 'unexpected_shape'}
    except Exception:
        converters = {'status': 'unavailable'}

    timer_output = _run_safe(['/usr/bin/systemctl', 'list-timers', '--all', '--no-legend', '--plain'])
    timer_count = sum(
        1 for line in timer_output.splitlines()
        if re.search(r'backup|openconstruction|openestimate|oce', line, re.I)
    )

    backup_times = []
    backup_sizes = []
    needles = ('openconstruction', 'openestimate', 'oce')
    for root in (Path('/var/backups'), Path('/opt'), Path('/srv'), Path('/root')):
        if not root.exists():
            continue
        for current, dirs, files in os.walk(root):
            try:
                depth = len(Path(current).relative_to(root).parts)
            except ValueError:
                continue
            if depth >= 5:
                dirs[:] = []
            lowered_dir = str(current).lower()
            for name in files:
                lowered = name.lower()
                if not (('backup' in lowered or 'dump' in lowered or 'snapshot' in lowered)
                        and any(n in lowered or n in lowered_dir for n in needles)):
                    continue
                try:
                    stat = (Path(current) / name).stat()
                except OSError:
                    continue
                backup_times.append(stat.st_mtime)
                backup_sizes.append(stat.st_size)
                if len(backup_times) >= 200:
                    break
            if len(backup_times) >= 200:
                break
        if len(backup_times) >= 200:
            break

    latest_age_hours = None
    if backup_times:
        import time
        latest_age_hours = round(max(0.0, time.time() - max(backup_times)) / 3600.0, 1)

    print(json.dumps({
        'oce_root_audit': 'ok',
        'container': meta,
        'converters': converters,
        'backup': {
            'timer_matches': timer_count,
            'file_matches': len(backup_times),
            'latest_age_hours': latest_age_hours,
            'matched_total_bytes': sum(backup_sizes),
            'restore_tested': False,
        },
    }, sort_keys=True))


def rewrite_env(original, values):
    if not isinstance(values, dict) or not values or set(values) - ALLOWED:
        raise ValueError('unsupported or empty environment update')
    for key, value in values.items():
        if not isinstance(value, str) or not value or len(value) > 512 or any(c in value for c in '\r\n\x00'):
            raise ValueError('invalid environment value')
        if key == 'RESEND_API_KEY' and not re.fullmatch(r'[A-Za-z0-9_-]{8,256}', value):
            raise ValueError('invalid provider key format')
        if key == 'DAO_PUBLIC_URL' and value != 'https://dao-dev.logiclab.fr':
            raise ValueError('unexpected DEV URL')
        if key == 'DAO_EMAIL_FROM' and not re.fullmatch(r'[A-Za-z0-9 ._+@<>-]{3,254}', value):
            raise ValueError('invalid sender format')
        if key == 'DAO_EMAIL_FROM' and value.count('@') != 1:
            raise ValueError('invalid sender address')
    output, found = [], set()
    for line in original.splitlines():
        m = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=', line)
        if m and m[1] in values:
            if m[1] in found:
                raise ValueError('duplicate updated environment key')
            # Refuse unsupported multiline assignments rather than corrupting them.
            tokens = shlex.split(line, comments=True)
            if len(tokens) not in (1, 2) or (len(tokens) == 2 and tokens[0] != 'export'):
                raise ValueError('unsupported environment assignment')
            found.add(m[1])
            continue
        output.append(line)
    for key in sorted(values):
        output.append(key + '=' + shlex.quote(values[key]))
    return '\n'.join(output).rstrip() + '\n'


def atomic_write(path, text):
    fd, temp = tempfile.mkstemp(prefix='.dao-env-', dir=str(ENV.parent))
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o640)
            os.fchown(stream.fileno(), 0, grp.getgrnam('dao').gr_gid)
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise ValueError('requires installed sudo helper and one operation')
    directory = ENV.parent.stat()
    if directory.st_uid != 0 or directory.st_mode & 0o022:
        raise ValueError('unsafe environment directory')
    lock = os.open(str(ENV.parent / '.admin.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    operation = sys.argv[1]
    if operation == 'env-sync':
        # No arbitrary file path; fixed root-owned directory. No values in errors.
        directory = ENV.parent.stat()
        if directory.st_uid != 0 or directory.st_mode & 0o022 or ENV.is_symlink():
            raise ValueError('unsafe environment path ownership')
        raw = sys.stdin.read(8193)
        if len(raw) > 8192:
            raise ValueError('environment payload too large')
        values = json.loads(raw)
        original = ENV.read_text()
        updated = rewrite_env(original, values)
        if updated == original:
            print('ENV_SYNC unchanged')
            return
        atomic_write(BACKUP, original)
        atomic_write(ENV, updated)
        print('ENV_SYNC updated keys=' + ','.join(sorted(values)))
    elif operation == 'env-restore':
        if ENV.parent.stat().st_uid != 0 or ENV.parent.stat().st_mode & 0o022 or BACKUP.is_symlink():
            raise ValueError('unsafe environment backup path')
        atomic_write(ENV, BACKUP.read_text())
        print('ENV_RESTORE complete')
    elif operation == 'oce-audit':
        oce_audit()
    elif operation == 'oce-integration-inventory':
        oce_integration_inventory()
    elif operation == 'oce-gateway-plan':
        oce_gateway_plan()
    elif operation == 'log-summary':
        p = subprocess.run(['/usr/bin/journalctl', '-u', 'dao-dev.service', '--since', '1 hour ago', '-n', '200', '-o', 'json', '--no-pager'], capture_output=True, text=True, timeout=15, check=True)
        counts = {}
        for line in p.stdout.splitlines():
            row = json.loads(line)
            priority = str(row.get('PRIORITY', 'unknown'))
            if priority not in [str(n) for n in range(8)]:
                priority = 'unknown'
            counts[priority] = counts.get(priority, 0) + 1
        print(json.dumps({'last_hour_max_200_entries_by_priority': counts, 'messages': 'withheld from public CI logs'}))
    else:
        raise ValueError('unsupported operation')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # JSON/parser/process exceptions can include secret values or log messages.
        print('D.A.O admin operation failed; no payload or log content disclosed', file=sys.stderr)
        sys.exit(1)
