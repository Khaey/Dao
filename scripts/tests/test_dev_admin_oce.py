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

    def test_gateway_failed_phase_is_allowlisted_and_private_data_redacted(self):
        permitted = {
            "oce_gateway_host_error": "gateway activation failed and rollback incomplete",
            "phase": "compose_recreate", "rollback": "postcheck_failed",
        }
        self.assertEqual(admin.gateway_failure_report(json.dumps(permitted)), {
            "reason": permitted["oce_gateway_host_error"],
            "phase": "compose_recreate", "rollback": "postcheck_failed",
        })
        for extra in (
            {**permitted, "stderr": "private-value"},
            {**permitted, "phase": "password=private-value"},
            {**permitted, "rollback": "private-value"},
        ):
            self.assertEqual(admin.gateway_failure_report(json.dumps(extra)),
                             {"reason": "unclassified"})
        with patch.object(admin.Path, 'is_file', return_value=True), patch.object(
            admin.os, 'access', return_value=True
        ), patch.object(admin.subprocess, 'run',
                        return_value=types.SimpleNamespace(returncode=1, stdout="secret",
                                                          stderr=json.dumps(permitted))) as run, patch(
            'sys.stdout', new_callable=io.StringIO
        ) as output:
            with self.assertRaises(ValueError):
                admin.oce_gateway_apply()
        self.assertEqual(json.loads(output.getvalue()), {"oce_gateway_apply": "failed",
                                                       "reason": permitted["oce_gateway_host_error"],
                                                       "phase": "compose_recreate",
                                                       "rollback": "postcheck_failed"})
        self.assertEqual(run.call_args.kwargs["timeout"], 900)

    def test_gateway_failure_trace_is_closed_and_dropped_when_malformed(self):
        core = {"oce_gateway_host_error": "gateway activation failed and rollback incomplete",
                "phase": "compose_recreate", "rollback": "multiple_failed"}
        good = {**core, "rollback_failures": ["postcheck_failed", "env_restore_failed"],
                "trace": [["compose_up", "ok", 5], ["health_wait", "timeout", 180], ["post_health", "failed", 20]]}
        report = admin.gateway_failure_report(json.dumps(good))
        self.assertEqual(report["rollback_failures"], ["env_restore_failed", "postcheck_failed"])
        self.assertEqual(report["trace"], good["trace"])
        for bad_trace in ([["compose_up", "ok", 7]], [["private", "ok", 5]], [["compose_up", "private", 5]],
                          [["compose_up", "ok", 5, "x"]], [["compose_up", "ok", 601]], [["compose_up", "ok", True]],
                          "private-value", [["compose_up", "ok", 5]] * 41):
            with self.subTest(trace=str(bad_trace)[:40]):
                degraded = admin.gateway_failure_report(json.dumps({**good, "trace": bad_trace}))
                self.assertEqual(degraded, {"reason": core["oce_gateway_host_error"], "phase": "compose_recreate",
                                            "rollback": "multiple_failed"})
        degraded = admin.gateway_failure_report(json.dumps({**good, "rollback_failures": ["private-value"]}))
        self.assertNotIn("trace", degraded)
        self.assertEqual(admin.gateway_failure_report(json.dumps({**good, "extra": "private-value"})), {"reason": "unclassified"})

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


class DevAdminOceQualifyTests(unittest.TestCase):
    REPORT = {'gateway_qualification': 'complete', **{k: True for k in admin.QUALIFY_FLAGS}}

    def run_qualify(self, **result):
        out = io.StringIO()
        with patch.object(admin.Path, 'is_file', return_value=True), \
             patch.object(admin.os, 'access', return_value=True), \
             patch.object(admin.subprocess, 'run', return_value=types.SimpleNamespace(**result)) as run, \
             patch('sys.stdout', out):
            try:
                admin.oce_gateway_qualify()
                error = None
            except ValueError as exc:
                error = str(exc)
        return run, out.getvalue(), error

    def test_qualify_runs_fixed_helper_without_arguments_and_prints_closed_report(self):
        run, out, error = self.run_qualify(returncode=0, stdout=json.dumps(self.REPORT), stderr='secret')
        self.assertIsNone(error)
        self.assertEqual(run.call_args.args[0], ['/usr/local/sbin/dao-oce-gateway-qualify'])
        self.assertEqual(json.loads(out), self.REPORT)
        self.assertNotIn('secret', out)

    def test_qualify_rejects_false_flag_or_extra_key(self):
        for report in ({**self.REPORT, 'positive_flow_verified': False}, {**self.REPORT, 'extra': True}):
            _, out, error = self.run_qualify(returncode=0, stdout=json.dumps(report), stderr='')
            self.assertEqual(error, 'gateway qualification output invalid')
            self.assertEqual(out, '')

    def test_qualify_failure_exposes_only_sanitized_reason(self):
        stderr = json.dumps({'oce_gateway_qualification_error': 'container bypass reachable'})
        _, out, error = self.run_qualify(returncode=1, stdout='', stderr=stderr)
        self.assertEqual(error, 'gateway qualification failed')
        self.assertEqual(json.loads(out), {'oce_gateway_qualification': 'failed',
                                            'reason': 'container bypass reachable'})
        bad = json.dumps({'oce_gateway_qualification_error': 'Token=abc123!'})
        _, out, _ = self.run_qualify(returncode=1, stdout='', stderr=bad)
        self.assertEqual(json.loads(out)['reason'], 'internal_or_command_error')

    def test_dispatch_and_request_vocabulary_include_qualify(self):
        req = importlib.util.spec_from_file_location(
            'req', Path(__file__).parents[2] / 'scripts' / 'dao-ops-request.py')
        mod = importlib.util.module_from_spec(req)
        req.loader.exec_module(mod)
        self.assertIn('oce-gateway-qualify', mod.OPERATIONS)


class DevAdminOceRuntimeTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.env, self.backup = base / 'dao-dev.env', base / 'dao-dev.env.previous'
        self.env.write_text('RESEND_API_KEY=abc\n')
        self.patches = [
            patch.object(admin, 'ENV', self.env), patch.object(admin, 'BACKUP', self.backup),
            patch.object(admin, 'atomic_write', side_effect=lambda p, t: Path(p).write_text(t)),
            patch.object(admin.Path, 'stat', return_value=types.SimpleNamespace(st_uid=0, st_mode=0o40755)),
            patch.object(admin.Path, 'is_symlink', return_value=False),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def run_flag(self, enabled, *, gateway=True, restart_rc=0, app_active=True):
        out = io.StringIO()
        runs = []

        def fake_run(args, **kw):
            runs.append(args)
            return types.SimpleNamespace(returncode=restart_rc)

        with patch.object(admin, 'service_active', side_effect=lambda n: gateway if n == admin.GATEWAY_SERVICE else app_active), \
             patch.object(admin.Path, 'exists', return_value=True), \
             patch.object(admin, 'wait_active', return_value=app_active), \
             patch.object(admin.subprocess, 'run', side_effect=fake_run), patch('sys.stdout', out):
            try:
                admin.oce_set_dev_flag(enabled)
                err = None
            except ValueError as exc:
                err = str(exc)
        return err, out.getvalue(), runs

    def test_enable_writes_flag_backs_up_and_restarts_app(self):
        err, out, runs = self.run_flag(True)
        self.assertIsNone(err)
        self.assertIn('DAO_OCE_ENABLED=1', self.env.read_text())
        self.assertEqual(self.backup.read_text(), 'RESEND_API_KEY=abc\n')
        self.assertEqual(runs, [[admin.SYSTEMCTL, 'restart', admin.APP_SERVICE]])
        self.assertEqual(json.loads(out)['oce_dev_flag'], 'enabled')

    def test_enable_refused_when_gateway_not_ready(self):
        err, _, runs = self.run_flag(True, gateway=False)
        self.assertEqual(err, 'gateway not ready')
        self.assertEqual(runs, [])
        self.assertNotIn('DAO_OCE_ENABLED', self.env.read_text())

    def test_enable_reverts_env_if_app_does_not_return(self):
        err, out, _ = self.run_flag(True, app_active=False)
        self.assertEqual(err, 'application restart failed')
        self.assertEqual(self.env.read_text(), 'RESEND_API_KEY=abc\n')
        self.assertEqual(json.loads(out), {'oce_dev_flag': 'failed', 'reverted': True})

    def test_disable_removes_only_the_flag(self):
        self.env.write_text('RESEND_API_KEY=abc\nDAO_OCE_ENABLED=1\n')
        err, out, _ = self.run_flag(False)
        self.assertIsNone(err)
        self.assertEqual(self.env.read_text(), 'RESEND_API_KEY=abc\n')
        self.assertEqual(json.loads(out)['oce_dev_flag'], 'disabled')

    def test_flag_value_must_be_one_and_env_sync_cannot_set_it(self):
        with self.assertRaises(ValueError):
            admin.rewrite_env('', {'DAO_OCE_ENABLED': '0'}, {'DAO_OCE_ENABLED'})
        with self.assertRaises(ValueError):
            admin.rewrite_env('', {'DAO_OCE_ENABLED': '1'})

    def test_gateway_restart_requires_active_service_and_reports_ready(self):
        out = io.StringIO()
        with patch.object(admin, 'service_active', return_value=True), \
             patch.object(admin, 'wait_active', return_value=True), \
             patch.object(admin.Path, 'exists', return_value=True), \
             patch.object(admin.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0)) as run, \
             patch('sys.stdout', out):
            admin.oce_gateway_restart()
        self.assertEqual(run.call_args.args[0], [admin.SYSTEMCTL, 'restart', admin.GATEWAY_SERVICE])
        self.assertEqual(json.loads(out.getvalue())['oce_gateway_restart'], 'complete')
        with patch.object(admin, 'service_active', return_value=False):
            with self.assertRaises(ValueError):
                admin.oce_gateway_restart()
