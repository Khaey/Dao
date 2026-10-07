"""Privilege-boundary tests using Docker fixtures, never a live daemon."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('inventory_admin', Path(__file__).parents[2] / 'ops/dao-dev-admin.py')
admin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admin)
APP_ID = 'a' * 64
PEER_ID = 'b' * 64
IMAGE_ID = 'sha256:' + 'c' * 64
DIGEST = 'ghcr.io/datadrivenconstruction/openconstructionerp@sha256:' + 'd' * 64


def fixtures():
    app = {
        'Id': APP_ID, 'Name': '/openconstructionerp-app-1', 'Image': IMAGE_ID,
        'State': {'Running': True},
        'Config': {'Image': 'ghcr.io/datadrivenconstruction/openconstructionerp:latest',
                   'Env': ['DATABASE_URL=postgresql+asyncpg://secret-user:secret-pass@private-db/private-name?token=secret-query',
                           'JWT_SECRET=secret-jwt', 'OTHER=secret-other'],
                   'Labels': {'com.docker.compose.project': 'private-project',
                              'com.docker.compose.project.config_files': '/private-directory/docker-compose.yml',
                              'private-label': 'secret-label'}},
        'Mounts': [{'Type': 'volume', 'Source': '/private-volume/data', 'Name': 'private-volume-name',
                    'Destination': '/data', 'RW': True}],
        'NetworkSettings': {'Networks': {'private-network': {}},
                            'Ports': {'8080/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '8080'}]}},
        'HostConfig': {'Privileged': False, 'NetworkMode': 'private-network'},
    }
    peer = {
        'Id': PEER_ID, 'Name': '/private-db', 'Image': IMAGE_ID,
        'State': {'Running': True},
        'Config': {'Image': 'postgres:17', 'Env': ['POSTGRES_PASSWORD=secret-password'],
                   'Labels': {'com.docker.compose.project': 'private-project'}},
        'NetworkSettings': {'Networks': {'private-network': {'Aliases': ['private-db'], 'IPAddress': '172.20.0.3'}}},
    }
    return app, peer


class TopologyTests(unittest.TestCase):
    def report(self, app, peers):
        with patch.object(admin, '_root_controlled_config', return_value=True):
            return admin._oce_topology(app, [app, *peers], {'RepoDigests': [DIGEST, 'private-registry/secret-image:latest']})

    def test_dsn_resolves_to_anonymous_peer_without_leaking_inspection(self):
        app, peer = fixtures()
        result = self.report(app, [peer])
        serialized = json.dumps(result)
        for secret in ('secret-', 'private-', '172.20', APP_ID, PEER_ID, IMAGE_ID):
            self.assertNotIn(secret, serialized)
        self.assertEqual(result['database_hints'], [{'key': 'DATABASE_URL', 'engine': 'postgresql', 'location': 'peer_1'}])
        self.assertEqual(result['image_digests'], [DIGEST])
        self.assertFalse(result['runtime_reference_is_digest'])
        self.assertEqual(result['published_ports'], [{'container_port': '8080/tcp', 'scope': 'wildcard'}])
        self.assertFalse(result['all_writers_identified'])
        self.assertFalse(result['database_verified'])
        self.assertFalse(result['backup_restore_verified'])
        self.assertFalse(result['gateway_bypass_tested'])

    def test_sqlite_normalizes_traversal_and_unknown_dsn_stays_unknown(self):
        for dsn, engine, location in [
            ('sqlite:////data/secret.db', 'sqlite', 'data_mount'),
            ('sqlite:///data/relative.db', 'sqlite', 'other_or_memory'),
            ('sqlite+aiosqlite:////data/../root/secret.db', 'sqlite', 'other_or_memory'),
            ('sqlite:////data/%2e%2e/root/secret.db', 'sqlite', 'other_or_memory'),
            ('sqlite:///:memory:', 'sqlite', 'other_or_memory'),
            ('unrecognized://private-host/secret', 'unknown', 'unresolved'),
            ('postgres://user:pass@[broken', 'unknown', 'unresolved'),
            ('postgres://user:pass@127.0.0.1/db', 'postgresql', 'container_loopback'),
        ]:
            with self.subTest(engine=engine, location=location):
                self.assertEqual(admin._db_hint(dsn, {}), {'engine': engine, 'location': location})

    def test_missing_hints_and_missing_compose_are_not_guessed(self):
        app, _ = fixtures()
        app['Config'] = {}
        result = self.report(app, [])
        self.assertEqual(result['database_hints'], [])
        self.assertEqual(result['compose']['config_file_count'], 0)
        self.assertFalse(result['compose']['config_files_root_controlled'])

    def test_peer_with_parent_bind_is_possible_writer_even_outside_compose(self):
        app, peer = fixtures()
        peer['Config']['Labels'] = {}
        peer['NetworkSettings'] = {}
        peer['Mounts'] = [{'Source': '/private-volume', 'RW': True}]
        result = self.report(app, [peer])
        self.assertTrue(result['related_containers'][0]['shared_storage'])
        self.assertFalse(result['related_containers'][0]['same_compose_project'])

    def test_ambiguous_network_alias_not_claimed_as_database_target(self):
        app, peer = fixtures()
        other = copy.deepcopy(peer)
        other['Id'] = 'e' * 64
        result = self.report(app, [peer, other])
        self.assertEqual(result['database_hints'][0]['location'], 'unresolved')

    def test_unrelated_container_omitted(self):
        app, peer = fixtures()
        peer['Config']['Labels'] = {}
        peer['NetworkSettings'] = {}
        self.assertEqual(self.report(app, [peer])['related_containers'], [])

    def test_compose_source_requires_root_owned_nonwritable_ancestry(self):
        def meta(path):
            mode = stat.S_IFREG | 0o644 if str(path).endswith('.yml') else stat.S_IFDIR | 0o755
            return SimpleNamespace(st_uid=0, st_mode=mode)
        with patch.object(Path, 'lstat', autospec=True, side_effect=meta):
            self.assertTrue(admin._root_controlled_config('/root/oce/compose.yml'))
            self.assertFalse(admin._root_controlled_config('/root/../tmp/compose.yml'))
            self.assertFalse(admin._root_controlled_config('compose.yml'))
        for mode, uid in [(stat.S_IFLNK | 0o777, 0), (stat.S_IFREG | 0o664, 0), (stat.S_IFREG | 0o644, 1000)]:
            with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_uid=uid, st_mode=mode)):
                self.assertFalse(admin._root_controlled_config('/root/oce/compose.yml'))


class CommandBoundaryTests(unittest.TestCase):
    def invoke(self, *, too_many=False, app_changed=False):
        app, peer = fixtures()
        current = copy.deepcopy(app)
        if app_changed:
            current['Id'] = 'e' * 64
        commands = []
        def run(argv, timeout=15):
            commands.append(argv)
            self.assertEqual(timeout, 12)
            if argv == ['/usr/bin/docker', 'inspect', '--type', 'container', 'openconstructionerp-app-1']:
                return json.dumps([app])
            if argv == ['/usr/bin/docker', 'ps', '--all', '--no-trunc', '--quiet']:
                return '\n'.join([APP_ID] * 65 if too_many else [APP_ID, PEER_ID])
            if argv == ['/usr/bin/docker', 'inspect', '--type', 'container', APP_ID, PEER_ID]:
                return json.dumps([current, peer])
            if argv == ['/usr/bin/docker', 'image', 'inspect', IMAGE_ID]:
                return json.dumps([{'RepoDigests': [DIGEST]}])
            self.fail('Unexpected privileged command')
        output = io.StringIO()
        with patch.object(admin.shutil, 'which', return_value='/usr/bin/docker'), \
                patch.object(admin, '_run_safe', side_effect=run), \
                patch.object(admin, '_root_controlled_config', return_value=True), \
                contextlib.redirect_stdout(output):
            if too_many or app_changed:
                with self.assertRaises(ValueError):
                    admin.oce_integration_inventory()
                self.assertEqual(output.getvalue(), '')
            else:
                admin.oce_integration_inventory()
        return commands, output.getvalue()

    def test_only_four_fixed_read_commands_and_redacted_output(self):
        commands, output = self.invoke()
        self.assertEqual(len(commands), 4)
        self.assertNotIn('secret-', output)
        self.assertNotIn('private-', output)
        self.assertEqual(json.loads(output)['oce_integration_inventory'], 'ok')

    def test_container_cap_fails_before_bulk_inspect(self):
        commands, _ = self.invoke(too_many=True)
        self.assertEqual(len(commands), 2)

    def test_container_replacement_fails_without_partial_report(self):
        self.invoke(app_changed=True)

    def test_oversized_json_is_rejected(self):
        with patch.object(admin, '_run_safe', return_value=' ' * (8 * 1024 * 1024 + 1)):
            with self.assertRaises(ValueError):
                admin._inventory_json(['/usr/bin/docker', 'inspect'])


if __name__ == '__main__':
    unittest.main()
