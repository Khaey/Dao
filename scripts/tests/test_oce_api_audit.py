import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error
import uuid

spec = importlib.util.spec_from_file_location("audit", Path(__file__).parents[1] / "oce-api-readonly-audit.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class Response:
    status = 200

    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self, cap):
        return self.body[:cap]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class AuditTests(unittest.TestCase):
    def client(self, results):
        client = audit.LocalClient(audit.BASES[0])
        calls = []

        def open_request(req, timeout):
            calls.append(req)
            result = results.pop(0)
            if isinstance(result, Exception):
                raise result
            return Response(result)

        client.opener.open = open_request
        return client, calls

    def test_local_slash_redirect_308(self):
        error = urllib.error.HTTPError(
            audit.BASES[0] + "/openapi.json",
            308,
            "",
            {"Location": "/openapi.json/"},
            None,
        )
        client, calls = self.client([error, {"paths": {}}])
        self.assertEqual(client.request("/openapi.json"), (200, {"paths": {}}, "ok"))
        self.assertEqual(len(calls), 2)

    def test_block_off_origin_and_operation_redirects(self):
        for target in (
            "https://example.com/leak",
            "http://127.0.0.1:8000/api/v1/users/me/",
            "/api/v1/projects/",
            "/api/v1/users/me/?token=secret",
        ):
            error = urllib.error.HTTPError("", 308, "", {"Location": target}, None)
            client, calls = self.client([error])
            self.assertEqual(client.request("/api/v1/users/me/", token="sentinel")[2], "redirect_blocked")
            self.assertEqual(len(calls), 1)

    def test_no_login_redirect_or_password_guess(self):
        error = urllib.error.HTTPError(
            "",
            307,
            "",
            {"Location": "/api/v1/users/auth/demo-login"},
            None,
        )
        client, calls = self.client([error])
        self.assertEqual(
            client.request(
                audit.LOGIN,
                demo_email="estimator@openconstructionerp.com",
            )[2],
            "redirect_blocked",
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(set(json.loads(calls[0].data)), {"email"})
        with self.assertRaises(ValueError):
            client.request(audit.LOGIN, demo_email="demo@openconstructionerp.com")

    def test_disallow_unreviewed_operations(self):
        client = audit.LocalClient(audit.BASES[0])
        for path in (
            "/api/v1/backup/",
            "/api/v1/bim-hub/models/a/geometry/",
            "/api/v1/users/auth/login/",
        ):
            with self.assertRaises(ValueError):
                client.request(path)
        with self.assertRaises(ValueError):
            audit.LocalClient("http://example.com")

    def test_project_detail_allowlist_requires_uuid(self):
        project_id = str(uuid.uuid4())
        self.assertTrue(audit.allowed_get(f"/api/v1/projects/{project_id}"))
        self.assertTrue(audit.allowed_get(f"/api/v1/projects/{project_id}/"))
        self.assertFalse(audit.allowed_get("/api/v1/projects/not-a-uuid"))
        self.assertFalse(audit.allowed_get(f"/api/v1/projects/{project_id}/delete"))

    def test_no_sensitive_error_output(self):
        client, _ = self.client([RuntimeError("sentinel-token private-name")])
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            audit.read(client, "me", "/api/v1/users/me/", token="sentinel-token")
        self.assertNotIn("sentinel-token", output.getvalue())
        self.assertNotIn("private-name", output.getvalue())
        self.assertIn("transport_error", output.getvalue())

    def test_body_is_never_reported(self):
        client, _ = self.client([{"items": [{"id": "private-id", "name": "private-name"}]}])
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            audit.read(client, "projects", "/api/v1/projects/?limit=1")
        self.assertNotIn("private-", output.getvalue())
        self.assertIn('"count": 1', output.getvalue())

    def test_oversize_body_refused(self):
        client, _ = self.client([{"items": ["x" * 300000]}])
        self.assertEqual(client.request("/api/v1/projects/")[2], "oversize")

    def test_upstream_estimator_login_is_expected_editor_role(self):
        self.assertEqual(audit.EXPECTED_DEMO_ROLES["estimator"], "editor")
        self.assertEqual(audit.EXPECTED_DEMO_ROLES["manager"], "manager")

    def test_isolation_probe_uses_only_exclusive_ids_and_hides_them(self):
        estimator_id = str(uuid.uuid4())
        manager_id = str(uuid.uuid4())
        calls = []

        class FakeClient:
            def request(self, path, token=None, demo_email=None):
                calls.append((path, token))
                if estimator_id in path:
                    return (200, {}, "ok") if token == "estimator-token" else (404, None, "http_error")
                if manager_id in path:
                    return (200, {}, "ok") if token == "manager-token" else (404, None, "http_error")
                raise AssertionError(path)

        paths = {"/api/v1/projects/{project_id}": {"get": {}}}
        principals = {
            "estimator": {"token": "estimator-token", "project_ids": {estimator_id}},
            "manager": {"token": "manager-token", "project_ids": {manager_id}},
        }
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            audit.probe_isolation(FakeClient(), paths, principals)

        text = output.getvalue()
        self.assertIn('"attempted": 2', text)
        self.assertIn('"confirmed": 2', text)
        self.assertIn('"all_confirmed": true', text)
        self.assertNotIn(estimator_id, text)
        self.assertNotIn(manager_id, text)
        self.assertNotIn("estimator-token", text)
        self.assertNotIn("manager-token", text)
        self.assertEqual(len(calls), 4)

    def test_isolation_probe_without_exclusive_fixture_is_inconclusive(self):
        shared = str(uuid.uuid4())

        class FakeClient:
            def request(self, path, token=None, demo_email=None):
                raise AssertionError("no exact project request expected")

        paths = {"/api/v1/projects/{project_id}": {"get": {}}}
        principals = {
            "estimator": {"token": "a", "project_ids": {shared}},
            "manager": {"token": "b", "project_ids": {shared}},
        }
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            audit.probe_isolation(FakeClient(), paths, principals)
        self.assertIn("no_exclusive_existing_fixture", output.getvalue())
        self.assertIn('"denial_confirmed": false', output.getvalue())
        self.assertNotIn(shared, output.getvalue())


    def test_converter_audit_emits_only_safe_fields(self):
        class FakeClient:
            def request(self, path, token=None, demo_email=None):
                self.path = path
                self.token = token
                return 200, {
                    "converters": [
                        {
                            "id": "ifc",
                            "version": "1.0.0",
                            "installed": True,
                            "health": "healthy",
                            "path": "/root/private/converter",
                            "health_message": "private host detail",
                        }
                    ]
                }, "ok"

        client = FakeClient()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            audit.audit_converters(
                client,
                {audit.CONVERTERS: {"get": {}}},
                "sentinel-token",
            )
        text = output.getvalue()
        self.assertIn('"id": "ifc"', text)
        self.assertIn('"installed": true', text)
        self.assertIn('"health": "healthy"', text)
        self.assertIn('"verify_requested": true', text)
        self.assertNotIn("/root/private", text)
        self.assertNotIn("private host detail", text)
        self.assertNotIn("sentinel-token", text)
        self.assertEqual(client.path, audit.CONVERTERS + "?verify=true")

    def test_admin_role_stops_module_reads(self):
        calls = []

        def request(client, path, token=None, demo_email=None):
            calls.append((path, token, demo_email))
            if path == "/api/health":
                return 200, {"version": "17.7.0"}, "ok"
            if path == "/api/openapi.json":
                return 200, {"paths": {audit.LOGIN: {"post": {}}}}, "ok"
            if demo_email:
                return 200, {"access_token": "sentinel-token"}, "ok"
            if token:
                return 200, {"role": "admin", "email": "private-email"}, "ok"
            return 401, None, "http_error"

        output = io.StringIO()
        with patch.object(audit.LocalClient, "request", request), contextlib.redirect_stdout(output):
            audit.run()
        self.assertFalse(any(token and path != "/api/v1/users/me/" for path, token, _ in calls))
        self.assertNotIn("sentinel-token", output.getvalue())
        self.assertNotIn("private-email", output.getvalue())
        self.assertIn("stopped_unverified_nonadmin_role", output.getvalue())


if __name__ == "__main__":
    unittest.main()
