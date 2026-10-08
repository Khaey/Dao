import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "oce_identity",
    Path(__file__).parents[2] / "ops/oce-v1-identity.py",
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class OceIdentityTests(unittest.TestCase):
    def test_generated_password_meets_oce_policy(self):
        value = m.generate_password()
        self.assertGreaterEqual(len(value), 12)
        self.assertTrue(any(c.isalpha() for c in value))
        self.assertTrue(any(c.isdigit() for c in value))

    def test_secret_round_trip_is_root_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            secret_dir = Path(tmp) / "private"
            secret_file = secret_dir / "gateway.json"
            payload = {
                "email": m.TECH_EMAIL,
                "password": "D" + "a" * 20 + "7",
                "user_id": "11111111-1111-1111-1111-111111111111",
                "qualified": False,
            }
            with patch.object(m, "SECRET_DIR", secret_dir):
                m.write_secret(secret_file, payload)
                loaded = m.read_secret(secret_file)
            self.assertEqual(loaded, payload)
            mode = stat.S_IMODE(secret_file.stat().st_mode)
            self.assertEqual(mode, 0o600)

    def test_read_secret_rejects_wrong_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "credential.json"
            path.write_text(json.dumps({
                "email": "other@example.com",
                "password": "Dabcdefghijklm7",
                "user_id": "11111111-1111-1111-1111-111111111111",
            }))
            os.chmod(path, 0o600)
            with self.assertRaisesRegex(ValueError, "credential file shape invalid"):
                m.read_secret(path)

    def test_verify_record_requires_editor_active_and_name(self):
        row = {
            "id": "u1",
            "email": m.TECH_EMAIL,
            "role": m.TECH_ROLE,
            "is_active": True,
            "full_name": m.TECH_NAME,
        }
        m.verify_record(row)
        with self.assertRaisesRegex(ValueError, "role or state mismatch"):
            m.verify_record(dict(row, role="admin"))
        with self.assertRaisesRegex(ValueError, "role or state mismatch"):
            m.verify_record(dict(row, is_active=False))
        with self.assertRaisesRegex(ValueError, "name mismatch"):
            m.verify_record(dict(row, full_name="Someone else"))

    def test_demo_admin_token_requires_admin_and_never_returns_body(self):
        calls = []

        def fake_request(method, path, payload=None, token=None):
            calls.append((method, path, payload, token))
            if path == "/api/v1/auth/first-run/":
                return 200, {"demo_enabled": True}
            if path == "/api/v1/users/auth/demo-login":
                return 200, {"access_token": "secret-token"}
            if path == "/api/v1/users/me/":
                return 200, {"role": "admin"}
            raise AssertionError(path)

        with patch.object(m, "request", side_effect=fake_request):
            token = m.demo_admin_token()
        self.assertEqual(token, "secret-token")
        self.assertEqual(calls[1][2], {"email": m.DEMO_ADMIN_EMAIL})

    def test_demo_admin_token_rejects_non_admin(self):
        def fake_request(method, path, payload=None, token=None):
            if path == "/api/v1/auth/first-run/":
                return 200, {"demo_enabled": True}
            if path == "/api/v1/users/auth/demo-login":
                return 200, {"access_token": "secret-token"}
            if path == "/api/v1/users/me/":
                return 200, {"role": "manager"}
            raise AssertionError(path)

        with patch.object(m, "request", side_effect=fake_request):
            with self.assertRaisesRegex(ValueError, "not admin"):
                m.demo_admin_token()

    def test_plan_output_is_sanitized(self):
        row = {
            "id": "u1",
            "email": m.TECH_EMAIL,
            "role": m.TECH_ROLE,
            "is_active": True,
            "full_name": m.TECH_NAME,
        }
        secret = {
            "email": m.TECH_EMAIL,
            "password": "SuperSecret123456",
            "user_id": "u1",
            "qualified": False,
        }
        out = io.StringIO()
        with (
            patch.object(m, "health"),
            patch.object(m, "first_run", return_value={"demo_enabled": True}),
            patch.object(m, "demo_admin_token", return_value="admin-token"),
            patch.object(m, "list_technical", return_value=row),
            patch.object(m, "read_secret", return_value=secret),
            patch.object(m.PENDING_FILE, "exists", return_value=False),
            patch.object(m, "login", return_value=("tech-token", row)),
            patch("sys.stdout", out),
        ):
            m.plan()
        text = out.getvalue()
        self.assertNotIn("SuperSecret", text)
        self.assertNotIn("admin-token", text)
        self.assertNotIn("tech-token", text)
        data = json.loads(text)
        self.assertTrue(data["identity_plan_ready"])
        self.assertTrue(data["demo_access_preserved"])

    def test_apply_existing_is_idempotent_and_sanitized(self):
        row = {
            "id": "u1",
            "email": m.TECH_EMAIL,
            "role": m.TECH_ROLE,
            "is_active": True,
            "full_name": m.TECH_NAME,
        }
        secret = {
            "email": m.TECH_EMAIL,
            "password": "SuperSecret123456",
            "user_id": "u1",
            "qualified": True,
        }
        out = io.StringIO()
        with (
            patch.object(m, "health"),
            patch.object(m, "recover_pending"),
            patch.object(m, "demo_admin_token", return_value="admin-token"),
            patch.object(m, "list_technical", return_value=row),
            patch.object(m, "read_secret", return_value=secret),
            patch.object(m, "login", return_value=("tech-token", row)),
            patch("sys.stdout", out),
        ):
            m.apply()
        text = out.getvalue()
        self.assertNotIn("SuperSecret", text)
        self.assertTrue(json.loads(text)["qualified"])

    def test_qualify_already_qualified_does_not_rotate_again(self):
        row = {
            "id": "u1",
            "email": m.TECH_EMAIL,
            "role": m.TECH_ROLE,
            "is_active": True,
            "full_name": m.TECH_NAME,
        }
        secret = {
            "email": m.TECH_EMAIL,
            "password": "SuperSecret123456",
            "user_id": "u1",
            "qualified": True,
        }
        out = io.StringIO()
        with (
            patch.object(m, "health"),
            patch.object(m, "recover_pending"),
            patch.object(m, "demo_admin_token", return_value="admin-token"),
            patch.object(m, "list_technical", return_value=row),
            patch.object(m, "read_secret", return_value=secret),
            patch.object(m, "login", return_value=("tech-token", row)),
            patch("sys.stdout", out),
        ):
            m.qualify()
        data = json.loads(out.getvalue())
        self.assertTrue(data["already_qualified"])
        self.assertTrue(data["demo_access_preserved"])


if __name__ == "__main__":
    unittest.main()
