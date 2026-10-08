import importlib.util
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
        fake_stat = type("S", (), {"st_mode": 0o100600, "st_uid": 0, "st_size": 200})()
        with patch.object(host.PIN_FILE, "lstat", return_value=fake_stat), patch.object(
            host, "run", side_effect=lambda args, **kwargs: calls.append(args)
        ):
            host.compose_up_app()
        self.assertEqual(len(calls), 1)
        args = calls[0]
        self.assertIn(str(host.PIN_FILE), args)
        self.assertEqual(args.count("-f"), 3)
        self.assertIn("--pull", args)
        self.assertIn("never", args)

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
