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


def _stat_bytes(value):
    match = re.fullmatch(r'\s*([0-9]+(?:\.[0-9]+)?)\s*(B|kB|KB|KiB|MB|MiB|GB|GiB|TB|TiB)\s*', str(value))
    if not match:
        raise ValueError('invalid Docker stat unit')
    number = float(match[1])
    unit = match[2]
    scale = {'B': 1, 'kB': 1000, 'KB': 1000, 'KiB': 1024,
             'MB': 1000 ** 2, 'MiB': 1024 ** 2, 'GB': 1000 ** 3,
             'GiB': 1024 ** 3, 'TB': 1000 ** 4, 'TiB': 1024 ** 4}[unit]
    return int(number * scale)


def _stat_pair(value):
    parts = str(value).split('/')
    if len(parts) != 2:
        raise ValueError('invalid Docker stat pair')
    return [_stat_bytes(part.strip()) for part in parts]


def _docker_stat_row(raw, alias):
    if not isinstance(raw, str) or len(raw) > 65536:
        raise ValueError('Docker stats response too large')
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    if len(rows) != 1 or not isinstance(rows[0], dict):
        raise ValueError('unexpected Docker stats response')
    row = rows[0]
    cpu = re.fullmatch(r'\s*([0-9]+(?:\.[0-9]+)?)%\s*', str(row.get('CPUPerc', '')))
    pids = row.get('PIDs')
    if not cpu or not re.fullmatch(r'[0-9]+', str(pids or '')):
        raise ValueError('invalid Docker stats fields')
    memory = _stat_pair(row.get('MemUsage', ''))
    block = _stat_pair(row.get('BlockIO', ''))
    network = _stat_pair(row.get('NetIO', ''))
    return {'alias': alias, 'cpu_percent': float(cpu[1]),
            'memory_used_bytes': memory[0], 'memory_limit_bytes': memory[1],
            'block_read_bytes': block[0], 'block_write_bytes': block[1],
            'network_rx_bytes': network[0], 'network_tx_bytes': network[1],
            'pids': int(pids)}


def _docker_resource_stats(docker, targets):
    """Query only inspected OCE/PostgreSQL IDs and emit numeric fields only."""
    result = []
    try:
        for target in targets:
            container_id = target.get('id')
            alias = target.get('alias')
            if not re.fullmatch(r'[0-9a-f]{64}', str(container_id or '')) or not re.fullmatch(
                    r'(?:oce_app|peer_[1-9][0-9]*)', str(alias or '')):
                raise ValueError('invalid Docker stats target')
            raw = _run_safe([docker, 'stats', '--no-stream', '--format', '{{json .}}', container_id], timeout=12)
            result.append(_docker_stat_row(raw, alias))
    except (OSError, subprocess.SubprocessError, ValueError, TypeError, json.JSONDecodeError):
        return {'status': 'unavailable', 'containers': []}
    return {'status': 'ok', 'containers': result}


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


def _oce_topology(app, containers, image, resource_targets=None):
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
    resource_targets = resource_targets if resource_targets is not None else []
    if (app.get('State') or {}).get('Running'):
        resource_targets.append({'alias': 'oce_app', 'id': app.get('Id')})
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
        if family == 'postgres' and (row.get('State') or {}).get('Running'):
            resource_targets.append({'alias': alias, 'id': row.get('Id')})
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


# Only literal gateway helper reasons may cross the public Actions boundary.
# This reports a helper assertion, not independent proof of rollback or service state.
GATEWAY_FAILURE_REASONS = frozenset({
    'app inspect shape',
    'app network identity',
    'command failed',
    'compose app image missing',
    'compose app image not immutable',
    'compose config invalid',
    'compose env backup unsafe',
    'compose env encoding',
    'compose env owned by dao',
    'compose env readable by dao',
    'compose env unsafe',
    'compose env world writable',
    'compose env writable by dao',
    'dao container bypass still reachable',
    'dao has docker socket access',
    'dao loopback bypass still reachable',
    'demo access unavailable',
    'docker socket unavailable',
    'duplicate OE_BIND',
    'egress guard inactive',
    'gateway activation failed and rollback incomplete',
    'gateway not installed',
    'gateway service not ready',
    'gateway service user missing',
    'internal_or_command_error',
    'invalid access probe',
    'loopback or pinned runtime verification failed',
    'nft unavailable',
    'oce health',
    'oce health or runtime digest pin unavailable',
    'oce health timeout',
    'operator OCE access or runtime pin unavailable',
    'pinned runtime not restored',
    'required command unavailable',
    'response bound',
    'root required',
    'runtime digest pin not active',
    'runtime pin changed during activation',
    'runtime pin unsafe',
})


GATEWAY_APPLY_PHASES = frozenset({
    'bind_change', 'compose_recreate', 'post_compose_pin', 'guard_start',
    'gateway_start', 'gateway_ready', 'bypass_checks', 'final_health',
})
GATEWAY_ROLLBACK_OUTCOMES = frozenset({
    'verified', 'service_stop_failed', 'env_restore_failed',
    'compose_restore_failed', 'postcheck_failed', 'multiple_failed',
})


GATEWAY_TRACE_STEPS = frozenset({
    'env_backup', 'env_write', 'compose_up', 'health_wait', 'post_pin', 'guard_start', 'gateway_start',
    'gateway_ready', 'bypass_checks', 'final_health',
    'rb_gateway_stop', 'rb_guard_stop', 'rb_env_restore', 'rb_compose_up', 'rb_health_wait',
    'post_health', 'post_demo', 'post_pin_active', 'post_loopback', 'post_gateway_state', 'post_guard_state',
})
GATEWAY_TRACE_OUTCOMES = frozenset({'ok', 'failed', 'timeout', 'nonzero', 'error'})
GATEWAY_ROLLBACK_FAILURES = frozenset({
    'service_stop_failed', 'env_restore_failed', 'compose_restore_failed', 'postcheck_failed',
})


def gateway_trace(value):
    """Closed trace [[step, outcome, seconds multiple of 5]...]; anything else is dropped, never echoed."""
    if not isinstance(value, list) or len(value) > 40:
        return None
    out = []
    for row in value:
        if (not isinstance(row, list) or len(row) != 3 or not isinstance(row[0], str) or not isinstance(row[1], str)
                or row[0] not in GATEWAY_TRACE_STEPS or row[1] not in GATEWAY_TRACE_OUTCOMES
                or type(row[2]) is not int or not 0 <= row[2] <= 600 or row[2] % 5):
            return None
        out.append([row[0], row[1], row[2]])
    return out


def gateway_rollback_failures(value):
    if (not isinstance(value, list) or len(value) > 4
            or any(not isinstance(item, str) or item not in GATEWAY_ROLLBACK_FAILURES for item in value)):
        return None
    return sorted(set(value))


def gateway_failure_report(stderr):
    """Expose only allowlisted enum values; never pass untrusted stderr."""
    failed = {'reason': 'unclassified'}
    if not isinstance(stderr, str) or len(stderr) > 4096:
        return failed
    try:
        data = json.loads(stderr)
    except (ValueError, TypeError):
        return failed
    if not isinstance(data, dict):
        return failed
    keys = set(data)
    if keys not in ({'oce_gateway_host_error'},
                    {'oce_gateway_host_error', 'phase', 'rollback'},
                    {'oce_gateway_host_error', 'phase', 'rollback', 'rollback_failures', 'trace'}):
        return failed
    reason = data.get('oce_gateway_host_error')
    if not isinstance(reason, str) or reason not in GATEWAY_FAILURE_REASONS:
        return failed
    if 'phase' not in data:
        return {'reason': reason}
    if (not isinstance(data.get('phase'), str)
            or not isinstance(data.get('rollback'), str)
            or data['phase'] not in GATEWAY_APPLY_PHASES
            or data['rollback'] not in GATEWAY_ROLLBACK_OUTCOMES):
        return failed
    report = {'reason': reason, 'phase': data['phase'], 'rollback': data['rollback']}
    if 'trace' in data:
        # Detail is optional evidence: if it is malformed it is dropped without invalidating the closed core.
        trace = gateway_trace(data.get('trace'))
        failures = gateway_rollback_failures(data.get('rollback_failures'))
        if trace is not None and failures is not None:
            report['rollback_failures'] = failures
            report['trace'] = trace
    return report


def gateway_failure_reason(stderr):
    return gateway_failure_report(stderr)['reason']


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
    print(json.dumps({'oce_gateway_plan': 'failed',
                      'reason': gateway_failure_reason(result.stderr)}, sort_keys=True))
    raise ValueError('gateway plan failed')


def oce_gateway_apply():
    """Run the fixed acknowledged gateway activation and expose only its closed report."""
    helper = Path('/usr/local/sbin/dao-oce-gateway-host')
    if not helper.is_file() or not os.access(helper, os.X_OK):
        raise ValueError('gateway helper missing')
    result = subprocess.run(
        [str(helper), 'apply', '--acknowledge-public-demo-link-closes'],
        capture_output=True, text=True, timeout=900, check=False,
    )
    if result.returncode != 0:
        print(json.dumps({'oce_gateway_apply': 'failed',
                          **gateway_failure_report(result.stderr)}, sort_keys=True))
        raise ValueError('gateway apply failed')
    data = json.loads(result.stdout)
    expected = {
        'gateway_host', 'oce_loopback_only', 'immutable_runtime_pin_preserved',
        'dao_loopback_bypass_denied', 'dao_container_bypass_denied',
        'gateway_socket_ready', 'gateway_ready', 'demo_access_preserved',
        'egress_guard_active', 'compose_env_not_readable_by_dao',
        'dao_docker_socket_access',
    }
    if (not isinstance(data, dict) or set(data) != expected
            or data.get('gateway_host') != 'complete'
            or any(type(data[key]) is not bool for key in expected - {'gateway_host'})):
        raise ValueError('gateway apply output invalid')
    print(json.dumps(data, sort_keys=True))


QUALIFY_FLAGS = (
    'positive_flow_verified', 'unknown_operation_rejected', 'extra_fields_rejected',
    'forged_mapping_rejected', 'cross_project_mapping_rejected',
    'mapping_revocation_verified', 'dao_loopback_bypass_denied',
    'dao_container_bypass_denied', 'demo_access_preserved',
)
QUALIFY_REASON = re.compile(r'[a-z0-9_ -]{1,96}')


def oce_gateway_qualify():
    """Run the fixed live qualification; expose only its closed boolean report."""
    helper = Path('/usr/local/sbin/dao-oce-gateway-qualify')
    if not helper.is_file() or not os.access(helper, os.X_OK):
        raise ValueError('gateway qualification helper missing')
    result = subprocess.run([str(helper)], capture_output=True, text=True, timeout=240, check=False)
    if result.returncode != 0:
        reason = 'internal_or_command_error'
        try:
            data = json.loads(result.stderr.strip().splitlines()[-1])
            candidate = data.get('oce_gateway_qualification_error')
            if isinstance(candidate, str) and QUALIFY_REASON.fullmatch(candidate):
                reason = candidate
        except (ValueError, IndexError, AttributeError):
            pass
        print(json.dumps({'oce_gateway_qualification': 'failed', 'reason': reason}, sort_keys=True))
        raise ValueError('gateway qualification failed')
    data = json.loads(result.stdout)
    expected = {'gateway_qualification', *QUALIFY_FLAGS}
    if (not isinstance(data, dict) or set(data) != expected
            or data.get('gateway_qualification') != 'complete'
            or any(data[key] is not True for key in QUALIFY_FLAGS)):
        raise ValueError('gateway qualification output invalid')
    print(json.dumps(data, sort_keys=True))


# Bounded recette admission (#58 / #301): ONE fixed synthetic project+lot pair, never a caller-supplied identifier.
# The synthetic rows are created by the protected DEV fixture workflow with exactly these ids.
RECETTE_GATEWAY = '/usr/local/libexec/dao-oce-gateway'
RECETTE_PROJECT = '5eed0301-0000-4000-8000-0000000000a1'
RECETTE_LOT = '5eed0301-0000-4000-8000-0000000000a2'


def oce_recette_admission(action):
    """Authorize or revoke the single synthetic recette pair on the private gateway; closed boolean report only."""
    if action not in ('authorize', 'revoke'):
        raise ValueError('recette action invalid')
    gateway = Path(RECETTE_GATEWAY)
    if not gateway.is_file() or not os.access(gateway, os.X_OK):
        raise ValueError('gateway admin helper missing')
    result = subprocess.run([str(gateway), action, RECETTE_PROJECT, RECETTE_LOT], capture_output=True, text=True, timeout=20, check=False)
    key = 'mapping_authorized' if action == 'authorize' else 'mapping_revoked'
    try:
        data = json.loads(result.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        data = None
    if result.returncode != 0 or not isinstance(data, dict) or data.get(key) is not True:
        print(json.dumps({'oce_recette_admission': 'failed', 'action': action}, sort_keys=True))
        raise ValueError('recette admission failed')
    print(json.dumps({'oce_recette_admission': action, 'synthetic_pair': True}, sort_keys=True))


GATEWAY_SERVICE = 'dao-oce-gateway.service'
GATEWAY_SOCKET = Path('/run/dao-oce-gateway/gateway.sock')
APP_SERVICE = 'dao-dev.service'
SYSTEMCTL = '/usr/bin/systemctl'
OCE_FLAG = 'DAO_OCE_ENABLED'


def service_active(name):
    result = subprocess.run([SYSTEMCTL, 'is-active', '--quiet', name], timeout=10, check=False)
    return result.returncode == 0


def wait_active(name, seconds, socket_path=None):
    import time
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if service_active(name) and (socket_path is None or socket_path.exists()):
            return True
        time.sleep(1)
    return False


def oce_gateway_restart():
    """Restart only the fixed gateway unit (after a reviewed gateway file install)."""
    if not service_active(GATEWAY_SERVICE):
        raise ValueError('gateway service not active')
    result = subprocess.run([SYSTEMCTL, 'restart', GATEWAY_SERVICE], timeout=60, check=False)
    ready = result.returncode == 0 and wait_active(GATEWAY_SERVICE, 30, GATEWAY_SOCKET)
    print(json.dumps({'oce_gateway_restart': 'complete' if ready else 'failed',
                      'service_active': service_active(GATEWAY_SERVICE),
                      'socket_ready': GATEWAY_SOCKET.exists()}, sort_keys=True))
    if not ready:
        raise ValueError('gateway restart failed')


def drop_env_key(original, key):
    kept = [line for line in original.splitlines()
            if not re.match(r'^\s*(?:export\s+)?' + re.escape(key) + r'\s*=', line)]
    return '\n'.join(kept).rstrip() + '\n'


def oce_set_dev_flag(enabled):
    """Enable/disable the server-side OCE adapter flag; revert the file if the app does not come back."""
    if ENV.parent.stat().st_uid != 0 or ENV.parent.stat().st_mode & 0o022 or ENV.is_symlink():
        raise ValueError('unsafe environment path ownership')
    if enabled and not (service_active(GATEWAY_SERVICE) and GATEWAY_SOCKET.exists()):
        raise ValueError('gateway not ready')
    original = ENV.read_text()
    updated = rewrite_env(original, {OCE_FLAG: '1'}, {OCE_FLAG}) if enabled else drop_env_key(original, OCE_FLAG)
    changed = updated != original
    if changed:
        atomic_write(BACKUP, original)
        atomic_write(ENV, updated)
    restart = subprocess.run([SYSTEMCTL, 'restart', APP_SERVICE], timeout=60, check=False)
    healthy = restart.returncode == 0 and wait_active(APP_SERVICE, 60)
    if not healthy:
        if changed:
            atomic_write(ENV, original)
            subprocess.run([SYSTEMCTL, 'restart', APP_SERVICE], timeout=60, check=False)
        print(json.dumps({'oce_dev_flag': 'failed', 'reverted': changed}, sort_keys=True))
        raise ValueError('application restart failed')
    print(json.dumps({'oce_dev_flag': 'enabled' if enabled else 'disabled', 'changed': changed,
                      'app_active': True, 'gateway_active': service_active(GATEWAY_SERVICE)}, sort_keys=True))


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
    targets = []
    report = _oce_topology(app, containers, images[0], targets)
    report['container_resources'] = _docker_resource_stats(docker, targets)
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


def rewrite_env(original, values, allowed=ALLOWED):
    if not isinstance(values, dict) or not values or set(values) - allowed:
        raise ValueError('unsupported or empty environment update')
    for key, value in values.items():
        if not isinstance(value, str) or not value or len(value) > 512 or any(c in value for c in '\r\n\x00'):
            raise ValueError('invalid environment value')
        if key == 'RESEND_API_KEY' and not re.fullmatch(r'[A-Za-z0-9_-]{8,256}', value):
            raise ValueError('invalid provider key format')
        if key == 'DAO_OCE_ENABLED' and value != '1':
            raise ValueError('unsupported OCE flag value')
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
    elif operation == 'oce-gateway-apply':
        oce_gateway_apply()
    elif operation == 'oce-gateway-qualify':
        oce_gateway_qualify()
    elif operation == 'oce-gateway-restart':
        oce_gateway_restart()
    elif operation == 'oce-recette-admit':
        oce_recette_admission('authorize')
    elif operation == 'oce-recette-revoke':
        oce_recette_admission('revoke')
    elif operation == 'oce-enable-dev':
        oce_set_dev_flag(True)
    elif operation == 'oce-disable-dev':
        oce_set_dev_flag(False)
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
