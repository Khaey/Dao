import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


g = load("oce_gateway", "ops/oce-v1-gateway.py")
guard = load("oce_guard", "ops/oce-v1-egress-guard.py")
host = load("oce_gateway_host", "ops/oce-v1-gateway-host.py")


class GatewayContractTests(unittest.TestCase):
    def test_exact_body_rejects_extra_fields(self):
        with self.assertRaises(g.SafeError) as cm:
            g.exact_body({"a": 1, "extra": 2}, {"a"}, {"a"})
        self.assertEqual(cm.exception.status, 400)
        self.assertEqual(cm.exception.code, "extra_fields")

    def test_mapping_requires_exact_authorized_pair(self):
        p1 = "4efb6b4e-5d5f-4a7d-9d5d-2f1c7d3a8b11"
        l1 = "61c23382-4234-4fa0-9e7a-6f2a1a6c6711"
        l2 = "0aa5e722-8ef6-41e8-8c0d-40f51b5d1222"
        state = g.initial_state()
        state["mappings"][g.mapping_key(p1, l1)] = {
            "dao_project_id": p1,
            "dao_lot_id": l1,
            "authorized": True,
            "revoked": False,
        }
        _, row = g.mapping_for(state, {"dao_project_id": p1, "dao_lot_id": l1})
        self.assertEqual(row["dao_lot_id"], l1)
        with self.assertRaises(g.SafeError) as cm:
            g.mapping_for(state, {"dao_project_id": p1, "dao_lot_id": l2})
        self.assertEqual(cm.exception.status, 403)
        self.assertEqual(cm.exception.code, "mapping_not_authorized")

    def test_revoked_mapping_is_denied(self):
        p1 = "4efb6b4e-5d5f-4a7d-9d5d-2f1c7d3a8b11"
        l1 = "61c23382-4234-4fa0-9e7a-6f2a1a6c6711"
        state = g.initial_state()
        state["mappings"][g.mapping_key(p1, l1)] = {
            "dao_project_id": p1,
            "dao_lot_id": l1,
            "authorized": False,
            "revoked": True,
        }
        with self.assertRaises(g.SafeError) as cm:
            g.mapping_for(state, {"dao_project_id": p1, "dao_lot_id": l1})
        self.assertEqual(cm.exception.code, "mapping_not_authorized")

    def test_project_identity_is_stable_and_opaque(self):
        p = "4efb6b4e-5d5f-4a7d-9d5d-2f1c7d3a8b11"
        l = "61c23382-4234-4fa0-9e7a-6f2a1a6c6711"
        value = g.project_code(p, l)
        self.assertEqual(value, g.project_code(p, l))
        self.assertTrue(value.startswith("DAO-"))
        self.assertLessEqual(len(value), 50)
        self.assertNotIn(p, value)
        self.assertNotIn(l, value)

    def test_unknown_operation_is_closed(self):
        gateway = object.__new__(g.Gateway)
        with self.assertRaises(g.SafeError) as cm:
            gateway.handle("POST", "/v1/delete-project", {})
        self.assertEqual(cm.exception.status, 404)
        self.assertEqual(cm.exception.code, "operation_not_allowed")
        self.assertEqual(g.safe_operation_name("/v1/delete-project"), "denied")

    def test_activity_payload_requires_mapped_wbs(self):
        gateway = object.__new__(g.Gateway)
        row = {"wbs": {"LOT1": "wbs-id"}}
        body = {
            "activity_code": "A1",
            "name": "Task",
            "wbs_code": "LOT2",
            "start_date": "2026-10-01",
            "end_date": "2026-10-02",
        }
        with self.assertRaises(g.SafeError) as cm:
            gateway.activity_payload(row, body)
        self.assertEqual(cm.exception.code, "wbs_not_authorized")

    def test_activity_payload_is_strictly_bounded(self):
        gateway = object.__new__(g.Gateway)
        row = {"wbs": {"LOT1": "wbs-id"}}
        code, payload = gateway.activity_payload(
            row,
            {
                "activity_code": "A1",
                "name": "Task",
                "wbs_code": "LOT1",
                "start_date": "2026-10-01",
                "end_date": "2026-10-02",
                "progress_pct": 12.5,
                "status": "in_progress",
            },
        )
        self.assertEqual(code, "A1")
        self.assertEqual(payload["progress_pct"], 12.5)
        self.assertNotIn("schedule_id", payload)
        self.assertNotIn("dependencies", payload)
        self.assertNotIn("resources", payload)

    def test_planning_scope_rejects_unmapped_objects(self):
        gateway = object.__new__(g.Gateway)
        gateway.credential = {"user_id": "tech-user"}
        row = {
            "oce_project_id": "project-id",
            "schedule_id": "schedule-id",
            "activities": {"A1": "activity-1"},
            "relationships": {"A1->A2": "relationship-1"},
        }
        project = {"id": "project-id"}
        schedule = {"id": "schedule-id", "project_id": "project-id"}

        common = (
            patch.object(gateway, "oce_project", return_value=project),
            patch.object(gateway, "schedule", return_value=schedule),
            patch.object(
                gateway,
                "list_activities",
                return_value=[
                    {"id": "activity-1", "activity_code": "A1", "schedule_id": "schedule-id"}
                ],
            ),
            patch.object(
                gateway,
                "list_relationships",
                return_value=[
                    {
                        "id": "relationship-1",
                        "schedule_id": "schedule-id",
                        "predecessor_id": "activity-1",
                        "successor_id": "activity-1",
                    }
                ],
            ),
        )

        with common[0], common[1], common[2], common[3], patch.object(
            gateway,
            "list_schedules",
            return_value=[schedule, {"id": "foreign-schedule"}],
        ):
            with self.assertRaises(g.SafeError) as cm:
                gateway.verify_planning_scope(object(), row)
        self.assertEqual(cm.exception.code, "planning_scope_contains_unmapped_schedule")

        with patch.object(gateway, "oce_project", return_value=project), patch.object(
            gateway, "schedule", return_value=schedule
        ), patch.object(gateway, "list_schedules", return_value=[schedule]), patch.object(
            gateway,
            "list_activities",
            return_value=[
                {"id": "activity-1", "activity_code": "A1", "schedule_id": "schedule-id"},
                {"id": "foreign-activity", "activity_code": "X", "schedule_id": "schedule-id"},
            ],
        ):
            with self.assertRaises(g.SafeError) as cm:
                gateway.verify_planning_scope(object(), row)
        self.assertEqual(cm.exception.code, "planning_scope_contains_unmapped_activity")

        with patch.object(gateway, "oce_project", return_value=project), patch.object(
            gateway, "schedule", return_value=schedule
        ), patch.object(gateway, "list_schedules", return_value=[schedule]), patch.object(
            gateway,
            "list_activities",
            return_value=[
                {"id": "activity-1", "activity_code": "A1", "schedule_id": "schedule-id"}
            ],
        ), patch.object(
            gateway,
            "list_relationships",
            return_value=[],
        ):
            with self.assertRaises(g.SafeError) as cm:
                gateway.verify_planning_scope(object(), row)
        self.assertEqual(cm.exception.code, "planning_scope_contains_unmapped_dependency")

    def test_credential_projection_uses_systemd_directory_only_for_service(self):
        with patch.dict("os.environ", {"CREDENTIALS_DIRECTORY": "/run/cred"}, clear=False), patch.object(
            g.os, "geteuid", return_value=1234
        ):
            self.assertEqual(g.credential_path(), Path("/run/cred/oce-gateway"))
        with patch.dict("os.environ", {"CREDENTIALS_DIRECTORY": "/run/cred"}, clear=False), patch.object(
            g.os, "geteuid", return_value=0
        ):
            self.assertEqual(g.credential_path(), g.SECRET_FILE)



    def test_gateway_service_is_not_in_dao_secret_group(self):
        service = (ROOT / "ops/dao-oce-gateway.service").read_text()
        tmpfiles = (ROOT / "ops/dao-oce-gateway.tmpfiles").read_text()
        self.assertNotIn("SupplementaryGroups=dao", service)
        self.assertIn("LoadCredential=oce-gateway:", service)
        self.assertIn("2750 dao-oce-gateway dao", tmpfiles)

class GuardTests(unittest.TestCase):
    def test_guard_targets_only_dao_uid_and_tcp_8080(self):
        calls = []

        class Pwd:
            pw_uid = 4242

        def fake_run(args, input_text=None, check=True):
            calls.append((args, input_text, check))
            # list-table before create -> absent, after create -> present
            if len(calls) == 1:
                return 1
            return 0

        with patch.object(guard, "nft_path", return_value="/usr/sbin/nft"), patch.object(
            guard.pwd, "getpwnam", return_value=Pwd()
        ), patch.object(guard, "run", side_effect=fake_run), patch("builtins.print"):
            guard.start()
        rules = next(text for _args, text, _check in calls if text)
        self.assertIn("meta skuid 4242 tcp dport 8080 reject", rules)
        self.assertNotIn("policy drop", rules)


class HostEnvTests(unittest.TestCase):
    def test_loopback_edit_changes_only_oe_bind(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            env = base / ".env"
            env.write_text("POSTGRES_PASSWORD=secret\nJWT_SECRET=secret2\nOE_BIND=0.0.0.0\n")
            env.chmod(0o600)
            fake = type("User", (), {"pw_uid": 9999, "pw_gid": 9999})()
            with patch.object(host, "BASE", base), patch.object(host, "ENV_FILE", env), patch.object(
                host.pwd, "getpwnam", return_value=fake
            ):
                original, bind = host.read_env()
                self.assertEqual(bind, "0.0.0.0")
                host.write_env_loopback(original)
                text = env.read_text()
            self.assertIn("POSTGRES_PASSWORD=secret", text)
            self.assertIn("JWT_SECRET=secret2", text)
            self.assertIn("OE_BIND=127.0.0.1", text)
            self.assertNotIn("OE_BIND=0.0.0.0", text)

    def test_dao_readable_compose_env_is_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = Path(tmp) / ".env"
            env.write_text("OE_BIND=127.0.0.1\n")
            env.chmod(0o640)
            meta = env.lstat()
            result = type("Result", (), {"returncode": 0, "stdout": b""})()
            with patch.object(host, "ENV_FILE", env), patch.object(host, "run", return_value=result) as probe:
                self.assertTrue(host.env_readable_by_dao(meta))
            args = probe.call_args.args[0]
            self.assertIn("dao", args)
            self.assertIn("-r", args)
            self.assertIn(str(env), args)

    def test_docker_access_probe_uses_real_dao_write_check(self):
        fake_meta = type("Meta", (), {"st_mode": 0o140660})()
        result = type("Result", (), {"returncode": 0, "stdout": b""})()
        with patch.object(Path, "lstat", return_value=fake_meta), patch.object(
            host, "run", return_value=result
        ) as probe:
            self.assertTrue(host.dao_has_docker_socket_access())
        args = probe.call_args.args[0]
        self.assertIn("dao", args)
        self.assertIn("-w", args)
        self.assertIn("/var/run/docker.sock", args)

    def test_compose_recreate_keeps_runtime_pin_override(self):
        calls = []
        sources = (*host.BASE_FILES, host.PIN_FILE)
        image = "ghcr.io/datadrivenconstruction/openconstructionerp@sha256:" + "a" * 64
        with patch.object(host, "selected_compose_files", return_value=sources), patch.object(
            host, "configured_app_image", return_value=image
        ), patch.object(host, "run", side_effect=lambda args, **kwargs: calls.append(args)):
            host.compose_up_app(sources, image)
        self.assertEqual(len(calls), 1)
        args = calls[0]
        self.assertIn(str(host.PIN_FILE), args)
        self.assertEqual(args.count("-f"), 3)
        self.assertIn("--pull", args)
        self.assertIn("never", args)

    def test_compose_restore_uses_frozen_pin_when_live_container_is_missing(self):
        sources = (*host.BASE_FILES, host.PIN_FILE)
        digest = "ghcr.io/datadrivenconstruction/openconstructionerp@sha256:" + "a" * 64
        with patch.object(host, "selected_compose_files", return_value=sources), patch.object(
            host, "configured_app_image", return_value=digest
        ), patch.object(host, "run") as runner, patch.object(
            host, "require_active_digest_pin", side_effect=host.Halt("container absent")
        ) as live_probe:
            host.compose_up_app(sources, digest)
        runner.assert_called_once()
        live_probe.assert_not_called()

    def test_compose_recreate_rejects_pin_change_before_docker_command(self):
        sources = (*host.BASE_FILES, host.PIN_FILE)
        digest = "ghcr.io/datadrivenconstruction/openconstructionerp@sha256:" + "a" * 64
        with patch.object(host, "selected_compose_files", return_value=sources), patch.object(
            host, "configured_app_image", return_value=digest + "x"
        ), patch.object(host, "run") as docker:
            with self.assertRaisesRegex(host.Halt, "runtime pin changed"):
                host.compose_up_app(sources, digest)
        docker.assert_not_called()

    def test_rollback_attempts_env_restore_after_service_stop_failure(self):
        sources = host.BASE_FILES
        actual_calls = []
        def fake_run(args, **_kwargs):
            actual_calls.append(args)
            if args[-1] == host.GATEWAY_SERVICE:
                raise host.Halt("service unavailable")
        with patch.object(host, "run", side_effect=fake_run), patch.object(
            host, "restore_env"
        ) as env_restore, patch.object(host, "compose_up_app") as compose, patch.object(
            host, "wait_health"
        ), patch.object(host, "health", return_value=True), patch.object(
            host, "demo_enabled", return_value=True
        ), patch.object(host, "pinned_app_active", return_value=True), patch.object(
            host, "loopback_only", return_value=False
        ), patch.object(host, "service_active", return_value=False):
            result = host.rollback_activation(True, b"OE_BIND=0.0.0.0", object(),
                                              False, False, sources, "digest", False)
        self.assertEqual(result, "service_stop_failed")
        self.assertEqual(len(actual_calls), 2)
        env_restore.assert_called_once()
        compose.assert_called_once_with(sources, "digest", step="rb_compose_up")

    def test_failed_forward_compose_can_be_recovered_without_live_pin_check(self):
        sources = host.BASE_FILES
        restored = []
        def fake_compose(files, digest, step=None):
            restored.append((files, digest))
            if len(restored) == 1:
                raise host.Halt("command failed")
        with patch.object(host, "require_root"), patch.object(
            host, "validate_installed_files"
        ), patch.object(host, "require_active_digest_pin", return_value=sources
        ) as pin, patch.object(host, "configured_app_image", return_value="digest"), patch.object(
            host, "health", return_value=True
        ), patch.object(host, "pinned_app_active", return_value=True), patch.object(
            host, "demo_enabled", return_value=True
        ), patch.object(host, "dao_has_docker_socket_access", return_value=False), patch.object(
            host, "harden_env_permissions"
        ), patch.object(host, "env_meta", return_value=object()), patch.object(
            host, "read_env", return_value=(b"OE_BIND=0.0.0.0", "0.0.0.0")
        ), patch.object(host, "loopback_only", return_value=False), patch.object(
            host, "service_active", return_value=False
        ), patch.object(host, "backup_env"), patch.object(
            host, "write_env_loopback"
        ), patch.object(host, "restore_env") as restore, patch.object(
            host, "compose_up_app", side_effect=fake_compose
        ), patch.object(host, "run"), patch.object(host, "wait_health"):
            with self.assertRaises(host.ApplyFailure) as failure:
                host.apply()
        self.assertEqual((failure.exception.phase, failure.exception.rollback),
                         ("compose_recreate", "verified"))
        self.assertEqual(len(restored), 2)
        self.assertEqual(restored[0], restored[1])
        pin.assert_called_once()
        restore.assert_called_once()

    def _reset_trace(self):
        host.TRACE.clear()
        host.ROLLBACK_FAILURES.clear()

    def test_compose_up_outcome_is_classified_in_the_closed_trace(self):
        sources = (*host.BASE_FILES, host.PIN_FILE)
        image = "ghcr.io/datadrivenconstruction/openconstructionerp@sha256:" + "a" * 64
        cases = [(None, "ok"), (host.Halt("command failed"), "nonzero"),
                 (host.subprocess.TimeoutExpired("docker", 120), "timeout"), (OSError("x"), "error")]
        for failure, outcome in cases:
            self._reset_trace()
            with self.subTest(outcome=outcome), patch.object(host, "selected_compose_files", return_value=sources), patch.object(
                host, "configured_app_image", return_value=image
            ), patch.object(host, "run", side_effect=failure):
                if failure is None:
                    host.compose_up_app(sources, image)
                else:
                    with self.assertRaises(Exception):
                        host.compose_up_app(sources, image)
            self.assertEqual([(row[0], row[1]) for row in host.TRACE], [("compose_up", outcome)])

    def test_health_wait_records_timeout_and_success_with_bounded_buckets(self):
        self._reset_trace()
        with patch.object(host, "health", return_value=False):
            with self.assertRaisesRegex(host.Halt, "oce health timeout"):
                host.wait_health(0, "rb_health_wait")
        with patch.object(host, "health", return_value=True):
            host.wait_health(5)
        self.assertEqual([(r[0], r[1]) for r in host.TRACE], [("rb_health_wait", "timeout"), ("health_wait", "ok")])
        self.assertTrue(all(isinstance(r[2], int) and 0 <= r[2] <= 600 and r[2] % 5 == 0 for r in host.TRACE))

    def test_rollback_reports_each_failed_substep_not_only_an_aggregate(self):
        self._reset_trace()
        with patch.object(host, "run"), patch.object(host, "restore_env", side_effect=host.Halt("x")), patch.object(
            host, "compose_up_app"
        ), patch.object(host, "wait_health"), patch.object(host, "poll", return_value=False), patch.object(
            host, "pinned_app_active", return_value=True
        ), patch.object(host, "loopback_only", return_value=False), patch.object(host, "service_active", return_value=False):
            result = host.rollback_activation(True, b"OE_BIND=0.0.0.0", object(), False, False,
                                              host.BASE_FILES, "digest", False)
        self.assertEqual(result, "multiple_failed")
        self.assertEqual(host.ROLLBACK_FAILURES, ["env_restore_failed", "postcheck_failed"])
        steps = {row[0]: row[1] for row in host.TRACE}
        self.assertEqual(steps["rb_env_restore"], "failed")
        self.assertEqual(steps["post_health"], "failed")
        self.assertEqual(steps["post_demo"], "failed")
        self.assertEqual(steps["post_pin_active"], "ok")
        self.assertEqual(steps["post_loopback"], "ok")
        self.assertNotIn("rb_compose_up", steps, "no compose restore attempted without an env restore")

    def test_rollback_postcheck_waits_for_a_still_starting_app(self):
        self._reset_trace()
        answers = iter([False, False, True])
        with patch.object(host, "run"), patch.object(host, "restore_env"), patch.object(
            host, "compose_up_app"
        ), patch.object(host, "wait_health"), patch.object(host, "health", side_effect=lambda: next(answers)), patch.object(
            host, "demo_enabled", return_value=True
        ), patch.object(host, "pinned_app_active", return_value=True), patch.object(
            host, "loopback_only", return_value=False
        ), patch.object(host, "service_active", return_value=False), patch.object(host.time, "sleep"):
            result = host.rollback_activation(True, b"OE_BIND=0.0.0.0", object(), False, False,
                                              host.BASE_FILES, "digest", False)
        self.assertEqual(result, "verified")
        self.assertEqual(host.ROLLBACK_FAILURES, [])

    def test_failure_report_carries_only_the_closed_trace(self):
        self._reset_trace()
        host.mark("compose_up", "timeout")
        host.mark("not_a_step", "ok")
        host.mark("health_wait", "password=private")
        host.ROLLBACK_FAILURES[:] = ["compose_restore_failed"]
        report = host.failure_report(host.ApplyFailure("gateway activation failed and rollback incomplete",
                                                       "compose_recreate", "multiple_failed"))
        self.assertEqual(report["trace"], [["compose_up", "timeout", 0]])
        self.assertEqual(report["rollback_failures"], ["compose_restore_failed"])
        self.assertNotIn("private", json.dumps(report))
        self.assertEqual(host.failure_report(ValueError("password=private")), {"oce_gateway_host_error": "internal_or_command_error"})

    def test_app_diagnostics_are_closed_and_never_echo_container_content(self):
        row = {
            "RestartCount": 7,
            "Config": {"Env": ["JWT_SECRET=private-value"], "Labels": {"x": "private-value"}},
            "NetworkSettings": {"IPAddress": "172.18.0.9"},
            "State": {"Status": "running", "OOMKilled": False, "ExitCode": 0, "StartedAt": "2026-10-18T16:16:12.123456789Z",
                      "Health": {"Status": "starting", "Log": [{"Output": "private-value"}]}},
        }
        ok = type("R", (), {"returncode": 0, "stdout": b""})()
        with patch.object(host, "run", return_value=ok), patch.object(host, "health", return_value=False), patch.object(
            host, "app_inspect", return_value=row
        ):
            out = host.app_diagnostics()
        self.assertEqual(out["app_state"], "running")
        self.assertEqual(out["app_health_status"], "starting")
        self.assertEqual(out["app_restart_count"], 7)
        self.assertIs(out["docker_compose_available"], True)
        self.assertEqual(out["app_uptime_bucket_s"] % 60, 0)
        self.assertNotIn("private", json.dumps(out))
        self.assertNotIn("172.18", json.dumps(out))
        with patch.object(host, "run", side_effect=OSError("boom")), patch.object(host, "health", return_value=False), patch.object(
            host, "app_inspect", side_effect=host.Halt("absent")
        ):
            absent = host.app_diagnostics()
        self.assertEqual((absent["app_container_present"], absent["app_state"]), (False, "absent"))

    def test_direct_compose_digest_is_valid_active_pin(self):
        digest = "ghcr.io/datadrivenconstruction/openconstructionerp@sha256:" + "a" * 64
        row = {
            "Config": {
                "Image": digest,
                "Labels": {
                    "com.docker.compose.project.config_files": ",".join(str(p) for p in host.BASE_FILES)
                },
            }
        }
        with patch.object(Path, "exists", return_value=False), patch.object(
            host, "app_inspect", return_value=row
        ), patch.object(host, "configured_app_image", return_value=digest):
            files = host.require_active_digest_pin()
        self.assertEqual(files, host.BASE_FILES)

    def test_direct_compose_pin_rejects_live_config_mismatch(self):
        digest = "ghcr.io/datadrivenconstruction/openconstructionerp@sha256:" + "a" * 64
        other = "ghcr.io/datadrivenconstruction/openconstructionerp@sha256:" + "b" * 64
        row = {
            "Config": {
                "Image": digest,
                "Labels": {
                    "com.docker.compose.project.config_files": ",".join(str(p) for p in host.BASE_FILES)
                },
            }
        }
        with patch.object(Path, "exists", return_value=False), patch.object(
            host, "app_inspect", return_value=row
        ), patch.object(host, "configured_app_image", return_value=other):
            with self.assertRaisesRegex(host.Halt, "runtime digest pin not active"):
                host.require_active_digest_pin()

    def test_host_apply_requires_explicit_public_demo_access_ack(self):
        with patch.object(host.sys, "argv", ["dao-oce-gateway-host", "apply"]), patch.object(
            host, "apply"
        ) as activate:
            with self.assertRaisesRegex(host.Halt, "acknowledge-public-demo-link-closes"):
                host.main()
            activate.assert_not_called()

    def test_duplicate_bind_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = Path(tmp) / ".env"
            env.write_text("OE_BIND=0.0.0.0\nOE_BIND=127.0.0.1\n")
            env.chmod(0o600)
            fake = type("User", (), {"pw_uid": 9999, "pw_gid": 9999})()
            with patch.object(host, "ENV_FILE", env), patch.object(host.pwd, "getpwnam", return_value=fake):
                with self.assertRaisesRegex(ValueError, "duplicate OE_BIND"):
                    host.read_env()


if __name__ == "__main__":
    unittest.main()


class GatewaySessionReuseTests(unittest.TestCase):
    def make(self):
        gateway = g.Gateway.__new__(g.Gateway)
        gateway.credential = {"email": "x", "password": "y", "user_id": "u"}
        gateway._token, gateway._token_at = None, 0.0
        return gateway

    def test_login_happens_once_within_ttl(self):
        gateway = self.make()
        calls = []

        def fake_login(self):
            calls.append(1)
            self.token = "tok"

        with patch.object(g.OCEClient, "login", fake_login):
            first = gateway.client()
            second = gateway.client()
        self.assertEqual(len(calls), 1)
        self.assertEqual(second.token, first.token)

    def test_rejected_session_forces_new_login(self):
        gateway = self.make()
        calls = []

        def fake_login(self):
            calls.append(1)
            self.token = "tok"

        with patch.object(g.OCEClient, "login", fake_login):
            client = gateway.client()
            with patch.object(g.OCEClient, "request", return_value=(401, None)):
                with self.assertRaises(g.SafeError) as cm:
                    client.expect("GET", "/x", {200})
            self.assertEqual(cm.exception.code, "oce_session_rejected")
            gateway.client()
        self.assertEqual(len(calls), 2)

    def test_expired_session_logs_in_again(self):
        gateway = self.make()
        calls = []

        def fake_login(self):
            calls.append(1)
            self.token = "tok"

        with patch.object(g.OCEClient, "login", fake_login):
            gateway.client()
            gateway._token_at -= g.Gateway.SESSION_TTL_SECONDS + 1
            gateway.client()
        self.assertEqual(len(calls), 2)
