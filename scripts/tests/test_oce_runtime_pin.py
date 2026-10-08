import copy
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'oce_runtime_pin',
    Path(__file__).parents[2] / 'ops/oce-v1-runtime-pin.py'
)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def row(name, image, config_image, files):
    return {
        'Id': ('a' if name == p.APP_CONTAINER else 'b') * 64,
        'Name': '/' + name,
        'Image': image,
        'Config': {
            'Image': config_image,
            'Labels': {
                'com.docker.compose.project': 'openconstructionerp',
                'com.docker.compose.project.config_files': ','.join(str(x) for x in files),
            },
        },
        'State': {'Running': True},
    }


class RuntimePinTests(unittest.TestCase):
    def test_repo_digest_requires_unique_allowed_registry_digest(self):
        payload = json.dumps([{
            'Id': p.APP_IMAGE_ID,
            'RepoDigests': [
                'ghcr.io/datadrivenconstruction/openconstructionerp@sha256:' + '1' * 64,
                'other.example/app@sha256:' + '2' * 64,
            ],
        }])
        with patch.object(p, 'docker', return_value=payload):
            value = p.repo_digest(p.APP_IMAGE_ID, p.APP_REPOS)
        self.assertEqual(
            value,
            'ghcr.io/datadrivenconstruction/openconstructionerp@sha256:' + '1' * 64,
        )

    def test_repo_digest_rejects_missing_or_ambiguous_match(self):
        for values in (
            [],
            [
                'ghcr.io/datadrivenconstruction/openconstructionerp@sha256:' + '1' * 64,
                'ghcr.io/datadrivenconstruction/openconstructionerp@sha256:' + '2' * 64,
            ],
        ):
            payload = json.dumps([{'Id': p.APP_IMAGE_ID, 'RepoDigests': values}])
            with self.subTest(values=values), patch.object(p, 'docker', return_value=payload):
                with self.assertRaisesRegex(ValueError, 'registry digest unavailable or ambiguous'):
                    p.repo_digest(p.APP_IMAGE_ID, p.APP_REPOS)

    def test_normalized_config_allows_only_image_changes(self):
        base = {
            'services': {
                'app': {'image': 'old-app', 'volumes': ['v:/data'], 'ports': ['8080:8080']},
                'postgres': {'image': 'old-pg', 'volumes': ['p:/var/lib/postgresql/data']},
            }
        }
        pinned = copy.deepcopy(base)
        pinned['services']['app']['image'] = 'new-app'
        pinned['services']['postgres']['image'] = 'new-pg'
        self.assertEqual(p.normalized_config(base), p.normalized_config(pinned))
        pinned['services']['app']['ports'] = ['127.0.0.1:8080:8080']
        self.assertNotEqual(p.normalized_config(base), p.normalized_config(pinned))

    def test_pin_text_contains_only_fixed_images_and_no_secret(self):
        app = 'ghcr.io/datadrivenconstruction/openconstructionerp@sha256:' + '1' * 64
        pg = 'postgres@sha256:' + '2' * 64
        value = p.pin_text(app, pg)
        self.assertIn(app, value)
        self.assertIn(pg, value)
        self.assertNotIn('password', value.lower())
        self.assertNotIn('environment', value.lower())

    def test_verify_runtime_requires_expected_images_and_health(self):
        files = p.BASE_FILES
        rows = {
            p.APP_CONTAINER: row(p.APP_CONTAINER, p.APP_IMAGE_ID, 'app:latest', files),
            p.PG_CONTAINER: row(p.PG_CONTAINER, p.PG_IMAGE_ID, 'postgres:16-alpine', files),
        }
        with patch.object(p, 'health', return_value=True):
            app, pg = p.verify_runtime(rows)
        self.assertEqual(app['Image'], p.APP_IMAGE_ID)
        self.assertEqual(pg['Image'], p.PG_IMAGE_ID)
        bad = copy.deepcopy(rows)
        bad[p.APP_CONTAINER]['Image'] = 'sha256:' + 'f' * 64
        with patch.object(p, 'health', return_value=True):
            with self.assertRaisesRegex(ValueError, 'runtime image drift'):
                p.verify_runtime(bad)

    def test_qualified_backup_requires_all_success_flags(self):
        good = {
            'id': 'job',
            'phase': 'complete',
            'backup_complete': True,
            'restore_verified': True,
            'live_resumed': True,
            'cleanup_complete': True,
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'active.json'
            path.write_text(json.dumps(good))
            os.chmod(path, 0o600)
            root_meta = type('Meta', (), {
                'st_mode': stat.S_IFREG | 0o600,
                'st_uid': 0,
            })()
            with patch.object(p, 'BACKUP_STATE', path), patch.object(Path, 'lstat', return_value=root_meta):
                self.assertEqual(p.qualified_backup(), 'job')
            bad = dict(good, restore_verified=False)
            path.write_text(json.dumps(bad))
            with patch.object(p, 'BACKUP_STATE', path), patch.object(Path, 'lstat', return_value=root_meta):
                with self.assertRaisesRegex(ValueError, 'qualified backup required'):
                    p.qualified_backup()

    def test_rollback_never_pulls_and_uses_original_compose_only(self):
        plan = {'base': {}}
        calls = []
        def fake_run(args, timeout=30):
            calls.append(args)
            return ''
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(p, 'PIN_FILE', Path(tmp) / 'pin.yml'), \
                patch.object(p, 'run', side_effect=fake_run), \
                patch.object(p, 'wait_health'), \
                patch.object(p, 'inspect_containers') as inspect, \
                patch.object(p, 'verify_runtime'):
            inspect.return_value = {
                p.APP_CONTAINER: {'Image': p.APP_IMAGE_ID},
                p.PG_CONTAINER: {'Image': p.PG_IMAGE_ID},
            }
            self.assertTrue(p.rollback(plan))
        command = calls[0]
        self.assertIn('--pull', command)
        self.assertIn('never', command)
        self.assertNotIn(str(p.PIN_FILE), command)


if __name__ == '__main__':
    unittest.main()
