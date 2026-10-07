#!/usr/bin/env python3
"""Disposable CI-only Docker exercise. No deployed host or product credentials."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import traceback
import uuid
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('backup_under_test', ROOT / 'ops/dao-oce-backup.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def main():
    if os.geteuid() != 0 or os.environ.get('GITHUB_ACTIONS') != 'true':
        raise ValueError('disposable CI root only')
    if b.docker('ps', '--all', '--quiet', '--filter', 'name=^/openconstructionerp-app-1$').strip():
        raise ValueError('fixture name already exists; refusing adoption')
    token = 'dao-backup-ci-' + uuid.uuid4().hex[:12]
    containers, volumes, network = [], [], False
    with tempfile.TemporaryDirectory(prefix='dao-backup-ci-') as temp:
        b.ROOT = Path(temp)
        try:
            for image in ('postgres:16-alpine', 'nginx:alpine'):
                b.docker('pull', image, timeout=180)
            b.PG_IMAGE = json.loads(b.docker('image', 'inspect', 'postgres:16-alpine'))[0]['Id']
            b.APP_IMAGE = json.loads(b.docker('image', 'inspect', 'nginx:alpine'))[0]['Id']
            b.docker('network', 'create', token)
            network = True
            for suffix in ('app', 'pg'):
                name = token + '-' + suffix
                b.docker('volume', 'create', name)
                volumes.append(name)
            app_source = Path(json.loads(b.docker('volume', 'inspect', volumes[0]))[0]['Mountpoint'])
            (app_source / 'fixture.txt').write_text('synthetic backup fixture\n')
            (app_source / 'nginx.conf').write_text('''pid /tmp/nginx.pid;
events {}
http { server { listen 8080; location = /api/health {
default_type application/json;
return 200 '{"status":"healthy","database":"ok"}';
} } }
''')
            labels = ['--label', 'com.docker.compose.project=' + token]
            pg = b.docker('create', '--name', token + '-pg', '--network', token, '--network-alias', 'postgres',
                          *labels, '--label', 'com.docker.compose.service=postgres',
                          '-e', 'POSTGRES_USER=oce', '-e', 'POSTGRES_DB=oce', '-e', 'POSTGRES_PASSWORD=ci-only',
                          '--mount', 'type=volume,source=' + volumes[1] + ',target=' + b.PG_DEST, b.PG_IMAGE).strip()
            containers.append(pg)
            b.docker('start', pg)
            b.wait_for(lambda: b.docker('exec', pg, 'pg_isready', '-U', 'oce', '-d', 'oce'), 60)
            b.docker('exec', pg, 'psql', '-U', 'oce', '-d', 'oce', '-v', 'ON_ERROR_STOP=1', '-c',
                     "CREATE TABLE backup_fixture (id integer PRIMARY KEY, value text); INSERT INTO backup_fixture VALUES (1, 'synthetic');")
            app = b.docker('create', '--name', 'openconstructionerp-app-1', '--network', token,
                           *labels, '--label', 'com.docker.compose.service=app',
                           '-e', 'DATABASE_URL=postgresql://oce:ci-only@postgres/oce',
                           '-e', 'DATABASE_SYNC_URL=postgresql://oce:ci-only@postgres/oce',
                           '--mount', 'type=volume,source=' + volumes[0] + ',target=/data',
                           '-p', '127.0.0.1:8080:8080', '--entrypoint', 'nginx', b.APP_IMAGE,
                           '-c', '/data/nginx.conf', '-g', 'daemon off;').strip()
            containers.append(app)
            b.docker('start', app)
            b.wait_for(b.health, 30)
            print('OCE_BACKUP_CI fixture_ready')

            def queue():
                job = uuid.uuid4().hex
                (b.ROOT / job).mkdir(mode=0o700)
                state = {'id': job, 'phase': 'queued', 'need_resume': False,
                         'backup_complete': False, 'restore_verified': False, 'live_resumed': True}
                b.save(state)
                return state

            first = queue()
            b.worker()
            result = b.load_state()
            if not all(result.get(k) for k in ('backup_complete', 'restore_verified', 'live_resumed', 'cleanup_complete')) or result['phase'] != 'complete':
                raise ValueError('real restore proof failed')
            if (app_source / 'fixture.txt').read_text() != 'synthetic backup fixture\n':
                raise ValueError('live app data changed')
            if b.docker('exec', pg, 'psql', '-U', 'oce', '-d', 'oce', '-At', '-c', 'SELECT count(*) FROM backup_fixture;').strip() != '1':
                raise ValueError('live database changed')
            b.recover()  # Same hook systemd executes after successful completion.
            print('OCE_BACKUP_CI full_snapshot_isolated_restore_live_preserved=PASS')

            queue()
            try:
                with patch.object(b, 'archive', side_effect=OSError('injected archive failure')):
                    b.worker()
            except OSError:
                pass
            else:
                raise ValueError('injected failure did not propagate')
            b.recover()
            result = b.load_state()
            if result['phase'] != 'failed' or result.get('backup_complete') or not result.get('live_resumed') or not b.health():
                raise ValueError('failure recovery did not preserve availability')
            print('OCE_BACKUP_CI archive_failure_resumes_originals=PASS')
        finally:
            if (b.ROOT / 'active.json').exists():
                b.cleanup(b.load_state())
            for container in reversed(containers):
                b.docker('rm', '-f', container, timeout=30)
            for volume in volumes:
                b.docker('volume', 'rm', volume)
            if network:
                b.docker('network', 'rm', token)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as exc:
        frame = traceback.extract_tb(exc.__traceback__)[-1]
        reason = str(exc) if isinstance(exc, b.Halt) else 'withheld'
        print(json.dumps({'OCE_BACKUP_CI': 'failed', 'type': type(exc).__name__,
                          'file': Path(frame.filename).name, 'line': frame.lineno, 'safe_reason': reason}))
        raise SystemExit(1)
