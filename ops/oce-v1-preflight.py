#!/usr/bin/env python3
"""Operator-run, read-only OCE preflight. Run as ubuntu, NEVER as root.

Compose is rendered without interpolation or service env-file resolution under
the ordinary login identity. Only fixed Docker inspection and named-volume size
commands use existing sudo access. No installation, writes or service changes.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

BASE = Path('/home/ubuntu/dao/OpenConstructionERP')
BASE_FILES = (BASE / 'docker-compose.quickstart.yml', BASE / 'docker-compose.override.yml')
PIN_FILE = Path('/etc/dao/oce-runtime-pin.yml')
DOCKER = ['sudo', '-n', '/usr/bin/docker', '--host', 'unix:///var/run/docker.sock']
DEADLINE = None


def capture(args, timeout=20):
    if DEADLINE is not None:
        timeout = min(timeout, DEADLINE - time.monotonic())
        if timeout <= 0:
            raise TimeoutError('preflight budget exhausted')
    proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout,
                          stdin=subprocess.DEVNULL)
    if proc.returncode or len(proc.stdout) > 8 * 1024 * 1024:
        raise ValueError('command failed')
    return proc.stdout


def metadata(value):
    """Do not expose variable defaults, inline secrets or multiline values."""
    if not isinstance(value, str) or len(value) > 4096 or any(c in value for c in '\r\n\x00'):
        return 'withheld'
    return '<interpolation>' if '${' in value else value


def image_reference(value):
    if isinstance(value, str) and re.fullmatch(
        r'(?:ghcr\.io/datadrivenconstruction/openconstructionerp|(?:docker\.io/library/)?postgres)'
        r'(?::[A-Za-z0-9_.-]+|@sha256:[0-9a-f]{64})?', value
    ):
        return value
    return 'other_or_interpolated'


def compose_summary(config):
    services = []
    for name, service in config.get('services', {}).items():
        env_files = service.get('env_file') or []
        if isinstance(env_files, str):
            env_files = [env_files]
        services.append({
            'service': metadata(name), 'image': image_reference(service.get('image')),
            'build_present': 'build' in service,
            'command_override': service.get('command') is not None,
            'entrypoint_override': service.get('entrypoint') is not None,
            'env_files': [metadata(e.get('path') if isinstance(e, dict) else e) for e in env_files],
            'mounts': [
                {key: metadata(m[key]) if isinstance(m.get(key), str) else m.get(key)
                 for key in ('type', 'source', 'target', 'read_only')}
                for m in service.get('volumes', []) if isinstance(m, dict)
            ],
            'port_count': len(service.get('ports') or []),
            'network_mode': metadata(service.get('network_mode', 'bridge')),
            'secrets_count': len(service.get('secrets') or []),
            'configs_count': len(service.get('configs') or []),
        })
    return {
        'services': services,
        'volumes': [{'name': metadata(name), 'external': bool(v.get('external')),
                     'driver': 'local' if v.get('driver', 'local') == 'local' else 'other',
                     'driver_options_present': bool(v.get('driver_opts'))}
                    for name, value in config.get('volumes', {}).items() for v in [value or {}]],
        'networks': [{'name': metadata(name), 'internal': bool(v.get('internal')),
                      'external': bool(v.get('external'))}
                     for name, value in config.get('networks', {}).items() for v in [value or {}]],
    }


def volume_size(mount):
    source = mount.get('Source', '')
    # Refuse bind mounts or a caller/Compose supplied host path.
    if mount.get('Type') != 'volume' or not re.fullmatch(r'/var/lib/docker/volumes/[A-Za-z0-9][A-Za-z0-9_.-]*/_data', source):
        return {'size_status': 'unsupported_storage'}
    try:
        raw = capture(['sudo', '-n', '/usr/bin/du', '-sx', '-B1', '--', source])
        size = int(raw.split()[0])
        raw = capture(['sudo', '-n', '/usr/bin/stat', '-f', '--format=%a %S', '--', source])
        available, block_size = map(int, raw.split())
        if min(size, available, block_size) < 0:
            raise ValueError('invalid size')
        return {'size_status': 'ok', 'allocated_bytes': size, 'available_bytes': available * block_size}
    except Exception:
        return {'size_status': 'unavailable'}


def runtime_summary(rows):
    result = []
    for row in rows:
        config = row.get('Config') or {}
        mounts = row.get('Mounts') or []
        result.append({
            'service': metadata((config.get('Labels') or {}).get('com.docker.compose.service')),
            'image_reference': image_reference(config.get('Image')),
            'image_id': row.get('Image') if re.fullmatch(r'sha256:[0-9a-f]{64}', str(row.get('Image'))) else 'unknown',
            'running': bool((row.get('State') or {}).get('Running')),
            'restart_policy': metadata((row.get('HostConfig') or {}).get('RestartPolicy', {}).get('Name')),
            'mounts': [{'type': metadata(m.get('Type')), 'destination': metadata(m.get('Destination')),
                        'writable': m.get('RW') is True, **volume_size(m)} for m in mounts[:8]],
        })
    return result


def main():
    global DEADLINE
    DEADLINE = time.monotonic() + 55
    if os.geteuid() == 0 or len(sys.argv) != 1:
        raise ValueError('run as the normal ubuntu login without arguments')
    files = BASE_FILES + ((PIN_FILE,) if PIN_FILE.exists() else ())
    command = ['/usr/bin/docker', 'compose', '--project-directory', str(BASE)]
    for path in files:
        command.extend(['-f', str(path)])
    command.extend(['config', '--format', 'json', '--no-interpolate', '--no-env-resolution'])
    report = {'schema_version': 1, 'read_only': True}
    try:
        version = capture(['/usr/bin/docker', 'compose', 'version', '--short']).strip()
        report['compose_version'] = version if re.fullmatch(r'v?[0-9]+\.[0-9]+\.[0-9]+', version) else 'other'
    except Exception:
        report['compose_version'] = 'unavailable'
    try:
        report['compose'] = compose_summary(json.loads(capture(command)))
        report['compose_status'] = 'ok'
    except Exception:
        report['compose_status'] = 'unavailable_no_raw_error_disclosed'
    app = json.loads(capture(DOCKER + ['inspect', '--type', 'container', 'openconstructionerp-app-1']))[0]
    labels = (app.get('Config') or {}).get('Labels') or {}
    # Confirm these are still the same authoritative sources before using the report.
    if set(labels.get('com.docker.compose.project.config_files', '').split(',')) != {str(path) for path in files}:
        raise ValueError('compose sources changed')
    project = labels.get('com.docker.compose.project', '')
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', project):
        raise ValueError('unexpected project')
    ids = capture(DOCKER + ['ps', '--all', '--no-trunc', '--quiet', '--filter', 'label=com.docker.compose.project=' + project]).splitlines()
    if not 1 <= len(ids) <= 8 or any(not re.fullmatch(r'[0-9a-f]{64}', i) for i in ids):
        raise ValueError('unsupported project inventory')
    rows = json.loads(capture(DOCKER + ['inspect', '--type', 'container', *ids]))
    if len(rows) != len(ids) or not any(r.get('Id') == app.get('Id') and r.get('Image') == app.get('Image') for r in rows):
        raise ValueError('container changed during inspection')
    report['runtime'] = runtime_summary(rows)
    env_file = BASE / '.env'
    report['dotenv_present'] = env_file.exists()
    report['database_connection_tested'] = False
    report['all_writers_verified'] = False
    report['restart_performed'] = False
    print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('OCE preflight unavailable; no configuration or error payload disclosed', file=sys.stderr)
        sys.exit(1)
