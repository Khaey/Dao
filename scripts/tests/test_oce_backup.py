import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('oce_backup', Path(__file__).parents[2] / 'ops/dao-oce-backup.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def fixture():
    rows = []
    for service, identity, image, destination, volume in (
        ('app', 'a' * 64, b.APP_IMAGE, '/data', 'oce_app_data'),
        ('postgres', 'b' * 64, b.PG_IMAGE, b.PG_DEST, 'oce_pg_data'),
    ):
        rows.append({'Id': identity, 'Name': '/openconstructionerp-' + service + '-1', 'Image': image,
                     'Config': {'Labels': {'com.docker.compose.project': 'oce', 'com.docker.compose.service': service},
                                'Env': ['POSTGRES_USER=oce', 'POSTGRES_DB=oce', 'POSTGRES_PASSWORD=private-pass'] if service == 'postgres' else
                                ['DATABASE_URL=postgresql+asyncpg://oce:private-pass@postgres/oce',
                                 'DATABASE_SYNC_URL=postgresql://oce:private-pass@postgres/oce']},
                     'State': {'Running': True}, 'HostConfig': {'NetworkMode': 'oce_default'},
                     'NetworkSettings': {'Networks': {'oce_default': {'Aliases': [service]}}, 'Ports': {}},
                     'Mounts': [{'Type': 'volume', 'Name': volume,
                                 'Source': '/var/lib/docker/volumes/' + volume + '/_data',
                                 'Destination': destination, 'RW': True}]})
    return rows


class TopologyTests(unittest.TestCase):
    def test_expected_topology_preserves_private_restore_config(self):
        found = b.topology(fixture())
        self.assertEqual(found['pg_environment']['POSTGRES_PASSWORD'], 'private-pass')
        self.assertEqual(found['app']['image'], b.APP_IMAGE)
        public = b.public_status({'id': 'a' * 32, 'phase': 'checking', 'targets': found})
        self.assertNotIn('private-pass', json.dumps(public))

    def test_image_drift_database_exposure_and_target_mismatch_refused(self):
        for mutate in (
            lambda r: r[0].update(Image='sha256:' + 'f' * 64),
            lambda r: r[1]['NetworkSettings'].update(Ports={'5432/tcp': [{'HostPort': '5432'}]}),
            lambda r: r[0]['Config']['Env'].__setitem__(0, 'DATABASE_URL=postgresql://u:p@external/other'),
            lambda r: r[1]['Config']['Env'].append('PGDATA=/other'),
            lambda r: r[0]['HostConfig'].update(Privileged=True),
        ):
            rows = fixture()
            mutate(rows)
            with self.assertRaises(ValueError):
                b.topology(rows)

    def test_extra_writer_sharing_parent_bind_refused(self):
        rows = fixture()
        rows.append({'Id': 'c' * 64, 'Config': {'Labels': {}},
                     'Mounts': [{'Source': '/var/lib/docker/volumes'}]})
        with self.assertRaises(ValueError):
            b.topology(rows)

    def test_unknown_compose_service_and_bind_volume_refused(self):
        rows = fixture()
        extra = copy.deepcopy(rows[0])
        extra['Id'], extra['Name'] = 'c' * 64, '/worker'
        rows.append(extra)
        with self.assertRaises(ValueError):
            b.topology(rows)
        rows = fixture()
        rows[0]['Mounts'][0]['Type'] = 'bind'
        with self.assertRaises(ValueError):
            b.topology(rows)


class ArchiveTests(unittest.TestCase):
    def test_roundtrip_files_hardlinks_and_symlinks_without_following_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, target = root / 'source', root / 'target'
            source.mkdir()
            target.mkdir()
            (source / 'nested').mkdir()
            (source / 'nested/data').write_bytes(b'private\x00payload')
            os.link(source / 'nested/data', source / 'hardlink')
            outside = root / 'outside'
            outside.write_text('protected')
            (source / 'link').symlink_to(outside)
            archive = root / 'backup.tar'
            manifest = b.archive(source, archive, False, time.monotonic() + 5)
            b.restore_archive(archive, target, manifest)
            self.assertEqual((target / 'nested/data').read_bytes(), b'private\x00payload')
            self.assertEqual((target / 'hardlink').read_bytes(), b'private\x00payload')
            self.assertEqual(os.readlink(target / 'link'), str(outside))
            self.assertEqual(outside.read_text(), 'protected')
            self.assertEqual(archive.stat().st_mode & 0o777, 0o600)

    def test_postgres_external_wal_or_tablespaces_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'pg_wal').symlink_to('/elsewhere')
            with self.assertRaises(ValueError):
                b.entries(root, pg=True)

    def test_source_or_restore_target_boundaries(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            os.mkfifo(root / 'fifo')
            with self.assertRaises(ValueError):
                b.entries(root)
            (root / 'fifo').unlink()
            (root / 'live-data').write_text('keep')
            with self.assertRaises(ValueError):
                b.restore_archive(root / 'missing.tar', root, {})
            self.assertEqual((root / 'live-data').read_text(), 'keep')

    def test_archive_traversal_and_symlink_ancestor_refused(self):
        for names in (['../escape'], ['/escape'], ['link', 'link/escape']):
            with self.subTest(names=names), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                target = root / 'target'
                target.mkdir()
                manifest = {}
                archive = root / 'bad.tar'
                with tarfile.open(archive, 'w') as out:
                    for name in names:
                        info = tarfile.TarInfo(name)
                        info.uid, info.gid = os.getuid(), os.getgid()
                        if name == 'link':
                            info.type, info.linkname = tarfile.SYMTYPE, str(root)
                        out.addfile(info, io.BytesIO(b''))
                        manifest[name] = {'type': info.type.decode(), 'size': info.size, 'mode': info.mode,
                                          'uid': info.uid, 'gid': info.gid, 'digest': info.linkname}
                with self.assertRaises(ValueError):
                    b.restore_archive(archive, target, manifest)
                self.assertFalse((root / 'escape').exists())

    def test_checksum_and_deadline_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, target = root / 'source', root / 'target'
            source.mkdir()
            target.mkdir()
            (source / 'data').write_text('private')
            with self.assertRaises(TimeoutError):
                b.archive(source, root / 'timeout.tar', False, 0)
            manifest = b.archive(source, root / 'ok.tar', False, time.monotonic() + 5)
            manifest['data']['digest'] = 'incorrect'
            with self.assertRaises(ValueError):
                b.restore_archive(root / 'ok.tar', target, manifest)


class RecoveryTests(unittest.TestCase):
    def test_database_readiness_failure_still_attempts_app_start(self):
        found = b.topology(fixture())
        state = {'need_resume': True, 'targets': found}
        rows = fixture()
        def save(s, **updates): s.update(updates)
        with patch.object(b, 'save', side_effect=save), \
                patch.object(b, 'inspect', side_effect=[[rows[1]], [rows[0]]]), \
                patch.object(b, 'docker') as commands, \
                patch.object(b, 'wait_for', side_effect=TimeoutError):
            with self.assertRaises(TimeoutError):
                b.resume(state)
        self.assertEqual([c.args[:2] for c in commands.call_args_list], [('start', rows[1]['Id']), ('start', rows[0]['Id'])])
        self.assertTrue(state['need_resume'])

    def test_replaced_original_container_is_never_started(self):
        found = b.topology(fixture())
        row = fixture()[1]
        row['Image'] = 'sha256:' + 'e' * 64
        with patch.object(b, 'save'), patch.object(b, 'inspect', return_value=[row]), patch.object(b, 'docker') as run:
            with self.assertRaises(ValueError):
                b.resume({'need_resume': True, 'targets': found})
            run.assert_not_called()

    def test_archive_failure_always_resumes_original_containers(self):
        found = b.topology(fixture())
        for role in ('app', 'pg'):
            found[role].update(uid=os.getuid(), gid=os.getgid())
        state = {'id': 'a' * 32, 'phase': 'queued', 'need_resume': False}
        def save(s, **updates): s.update(updates)
        with tempfile.TemporaryDirectory() as tmp, patch.object(b, 'ROOT', Path(tmp)), \
                patch.object(b, 'load_state', return_value=state), patch.object(b, 'save', side_effect=save), \
                patch.object(b, 'discover', return_value=(found, fixture())), patch.object(b, 'capacity', return_value=123), \
                patch.object(b, 'write_json'), patch.object(b, 'docker', return_value='Database cluster state: shut down\n'), \
                patch.object(b, 'inspect', return_value=[{'State': {'Running': False, 'ExitCode': 0}}]), \
                patch.object(b, 'db_proof', return_value='16|42|123'), patch.object(b, 'archive', side_effect=OSError), \
                patch.object(b, 'resume') as resume, patch.object(b, 'isolated_restore') as restore:
            with self.assertRaises(OSError):
                b.worker()
            resume.assert_called_once_with(state)
            restore.assert_not_called()
            self.assertFalse(state.get('backup_complete', False))

    def test_sql_command_contains_no_interpolated_credentials(self):
        target = {'uid': 70, 'gid': 70}
        with patch.object(b, 'docker', return_value='16|42|123\n') as run:
            self.assertEqual(b.db_proof('container', target), '16|42|123')
        script = run.call_args.args[-1]
        self.assertIn('${POSTGRES_PASSWORD:-}', script)
        result = subprocess.run(['sh', '-n'], input=script, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
