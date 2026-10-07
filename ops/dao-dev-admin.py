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

ENV = Path('/etc/dao/dao-dev.env')
BACKUP = Path('/etc/dao/dao-dev.env.previous')
ALLOWED = {'RESEND_API_KEY', 'DAO_EMAIL_FROM', 'DAO_PUBLIC_URL'}


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
