import importlib.util
import io
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "dao_dev_admin",
    Path(__file__).parents[2] / "ops" / "dao-dev-admin.py",
)
admin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admin)


class DevAdminOceAuditTests(unittest.TestCase):
    def test_gateway_apply_uses_fixed_acknowledgement_and_closed_output(self):
        report = {
            'gateway_host': 'complete', 'oce_loopback_only': True,
            'immutable_runtime_pin_preserved': True, 'dao_loopback_bypass_denied': True,
            'dao_container_bypass_denied': True, 'gateway_socket_ready': True,
            'gateway_ready': True, 'demo_access_preserved': True,
            'egress_guard_active': True, 'compose_env_not_readable_by_dao': True,
            'dao_docker_socket_access': False,
        }
        with patch.object(admin.Path, 'is_file', return_value=True), \
             patch.object(admin.os, 'access', return_value=True), \
             patch.object(admin.subprocess, 'run', return_value=types.SimpleNamespace(
                 returncode=0, stdout=json.dumps(report), stderr='private-value')) as run, \
             patch('sys.stdout', new_callable=io.StringIO) as output:
            admin.oce_gateway_apply()
        self.assertEqual(run.call_args.args[0], [
            '/usr/local/sbin/dao-oce-gateway-host', 'apply',
            '--acknowledge-public-demo-link-closes'])
        self.assertEqual(json.loads(output.getvalue()), report)
        self.assertNotIn('private-value', output.getvalue())

    def test_gateway_failure_reasons_are_closed_and_bounded(self):
        for reason in ('oce health timeout', 'gateway service not ready',
                       'gateway activation failed and rollback incomplete'):
            self.assertEqual(admin.gateway_failure_reason(json.dumps(
                {'oce_gateway_host_error': reason})), reason)
        for raw in (
            'private-value', 'x' * 4097, '', 'null', '[]',
            '{"oce_gateway_host_error": "private-value"}',
            '{"oce_gateway_host_error": ["private-value"]}',
            '{"oce_gateway_host_error": "oce health timeout", "secret": "private-value"}',
            '{"oce_gateway_host_error": "oce health timeout"} trailing-private-value',
        ):
            with self.subTest(raw=raw[:80]):
                self.assertEqual(admin.gateway_failure_reason(raw), 'unclassified')

    def test_gateway_failure_keeps_failure_and_never_forwards_raw_output(self):
        for operation in (admin.oce_gateway_plan, admin.oce_gateway_apply):
            for reason in ('oce health timeout', 'private-value'):
                with self.subTest(operation=operation.__name__, reason=reason), \
                     patch.object(admin.Path, 'is_file', return_value=True), \
                     patch.object(admin.os, 'access', return_value=True), \
                     patch.object(admin.subprocess, 'run', return_value=types.SimpleNamespace(
                         returncode=1, stdout='private-value', stderr=json.dumps(
                             {'oce_gateway_host_error': reason}))), \
                     patch('sys.stdout', new_callable=io.StringIO) as output:
                    with self.assertRaises(ValueError):
                        operation()
                report = json.loads(output.getvalue())
                self.assertEqual(report['reason'], reason if reason != 'private-value'
                                 else 'unclassified')
                self.assertIn('failed', report.values())
                self.assertNotIn('private-value', output.getvalue())

    def test_select_oce_container_prefers_named_match(self):
        rows = [
            {"ID": "aaaaaaaaaaaa", "Image": "other:latest", "Names": "proxy", "Ports": "0.0.0.0:8080->80/tcp"},
            {"ID": "bbbbbbbbbbbb", "Image": "openconstructionerp:17.7.0", "Names": "oce-backend", "Ports": "8000/tcp"},
        ]
        self.assertEqual(admin._select_oce_container(rows)["ID"], "bbbbbbbbbbbb")

    def test_select_oce_container_falls_back_to_8080(self):
        rows = [
            {"ID": "aaaaaaaaaaaa", "Image": "local-build", "Names": "api", "Ports": "0.0.0.0:8080->8000/tcp"},
        ]
        self.assertEqual(admin._select_oce_container(rows)["ID"], "aaaaaaaaaaaa")

    def test_safe_container_meta_never_exposes_env_values_or_bind_source(self):
        inspected = {
            "Name": "/oce-backend",
            "Image": "sha256:abc",
            "Config": {
                "Image": "oce:17.7.0",
                "Env": [
                    "JWT_SECRET=super-secret",
                    "DATABASE_URL=postgres://secret",
                    "S3_SECRET_KEY=secret",
                    "UNRELATED=private",
                ],
            },
            "Mounts": [
                {"Type": "bind", "Source": "/root/private/oce", "Destination": "/data", "Name": ""},
                {"Type": "volume", "Source": "/var/lib/docker/volumes/private", "Destination": "/db", "Name": "oce_db"},
            ],
        }
        meta = admin._safe_container_meta(inspected)
        rendered = repr(meta)
        self.assertIn("JWT_SECRET", meta["env_keys"])
        self.assertIn("DATABASE_URL", meta["env_keys"])
        self.assertNotIn("super-secret", rendered)
        self.assertNotIn("postgres://secret", rendered)
        self.assertNotIn("/root/private/oce", rendered)
        self.assertNotIn("/var/lib/docker/volumes/private", rendered)
        self.assertNotIn("oce_db", rendered)
        self.assertEqual(meta["mounts"][0]["destination"], "/data")
        self.assertFalse(meta["mounts"][0]["named_volume"])
        self.assertTrue(meta["mounts"][1]["named_volume"])


if __name__ == "__main__":
    unittest.main()
