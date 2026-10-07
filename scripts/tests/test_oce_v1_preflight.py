import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('preflight', Path(__file__).parents[2] / 'ops/oce-v1-preflight.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class PreflightTests(unittest.TestCase):
    def test_compose_redacts_values_commands_labels_and_variable_defaults(self):
        result = probe.compose_summary({'services': {'app': {
            'image': '${IMAGE:-secret-default}',
            'environment': {'PASSWORD': 'secret-password'},
            'labels': {'token': 'secret-label'},
            'command': ['echo', 'secret-command'],
            'healthcheck': {'test': 'secret-health'},
            'env_file': [{'path': './private.env'}],
            'volumes': [{'type': 'volume', 'source': '${VOL:-${OTHER}secret-nested}',
                         'target': '/data', 'read_only': False}],
        }}, 'volumes': {'data': {'driver_opts': {'password': 'secret-driver'}}}})
        self.assertNotIn('secret-', json.dumps(result))
        self.assertEqual(result['services'][0]['env_files'], ['./private.env'])
        self.assertTrue(result['services'][0]['command_override'])
        self.assertTrue(result['volumes'][0]['driver_options_present'])

    def test_size_probe_rejects_bind_and_escaped_paths_without_calling_sudo(self):
        with patch.object(probe, 'capture') as run:
            for mount in [
                {'Type': 'bind', 'Source': '/var/lib/docker/volumes/ok/_data'},
                {'Type': 'volume', 'Source': '/etc'},
                {'Type': 'volume', 'Source': '/var/lib/docker/volumes/../_data'},
                {'Type': 'volume', 'Source': '/var/lib/docker/volumes/../../etc/_data'},
            ]:
                self.assertEqual(probe.volume_size(mount)['size_status'], 'unsupported_storage')
            run.assert_not_called()

    def test_size_probe_uses_exact_read_commands_and_never_returns_source(self):
        source = '/var/lib/docker/volumes/private_data/_data'
        with patch.object(probe, 'capture', side_effect=['1024\t' + source + '\n', '4 4096\n']) as run:
            result = probe.volume_size({'Type': 'volume', 'Source': source})
        self.assertEqual(result, {'size_status': 'ok', 'allocated_bytes': 1024, 'available_bytes': 16384})
        self.assertEqual(run.call_args_list[0].args[0], ['sudo', '-n', '/usr/bin/du', '-sx', '-B1', '--', source])
        self.assertNotIn('private', json.dumps(result))

    def test_runtime_excludes_environment_and_bind_source(self):
        with patch.object(probe, 'volume_size', return_value={'size_status': 'unsupported_storage'}):
            result = probe.runtime_summary([{
                'Config': {'Image': 'postgres:17', 'Env': ['PASSWORD=secret-password'],
                           'Labels': {'com.docker.compose.service': 'db', 'private': 'secret-label'}},
                'Image': 'sha256:' + 'a' * 64,
                'Mounts': [{'Type': 'bind', 'Source': '/root/secret-source', 'Destination': '/data', 'RW': True}],
                'State': {'Running': True},
            }])
        self.assertNotIn('secret-', json.dumps(result))
        self.assertEqual(result[0]['image_reference'], 'postgres:17')

    def test_global_deadline_prevents_more_processes(self):
        with patch.object(probe, 'DEADLINE', 1), patch.object(probe.time, 'monotonic', return_value=2), \
                patch.object(probe.subprocess, 'run') as run:
            with self.assertRaises(TimeoutError):
                probe.capture(['unused'])
            run.assert_not_called()

    def test_root_invocation_refused_before_any_command(self):
        with patch.object(probe.os, 'geteuid', return_value=0), patch.object(probe, 'capture') as run:
            with self.assertRaises(ValueError):
                probe.main()
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
