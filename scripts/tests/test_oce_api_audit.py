import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

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
        error = urllib.error.HTTPError(audit.BASES[0] + "/openapi.json", 308, "", {"Location": "/openapi.json/"}, None)
        client, calls = self.client([error, {"paths": {}}])
        self.assertEqual(client.request("/openapi.json"), (200, {"paths": {}}, "ok"))
        self.assertEqual(len(calls), 2)

    def test_block_off_origin_and_operation_redirects(self):
        for target in ("https://example.com/leak", "http://127.0.0.1:8000/api/v1/users/me/", "/api/v1/projects/", "/api/v1/users/me/?token=secret"):
            error = urllib.error.HTTPError("", 308, "", {"Location": target}, None)
            client, calls = self.client([error])
            self.assertEqual(client.request("/api/v1/users/me/", token="sentinel")[2], "redirect_blocked")
            self.assertEqual(len(calls), 1)

    def test_no_login_redirect_or_password_guess(self):
        error = urllib.error.HTTPError("", 307, "", {"Location": "/api/v1/users/auth/demo-login"}, None)
        client, calls = self.client([error])
        self.assertEqual(client.request(audit.LOGIN, demo_email="estimator@openconstructionerp.com")[2], "redirect_blocked")
        self.assertEqual(len(calls), 1)
        self.assertEqual(set(json.loads(calls[0].data)), {"email"})
        with self.assertRaises(ValueError):
            client.request(audit.LOGIN, demo_email="demo@openconstructionerp.com")

    def test_disallow_unreviewed_operations(self):
        client = audit.LocalClient(audit.BASES[0])
        for path in ("/api/v1/backup/", "/api/v1/bim-hub/models/a/geometry/", "/api/v1/users/auth/login/"):
            with self.assertRaises(ValueError):
                client.request(path)
        with self.assertRaises(ValueError):
            audit.LocalClient("http://example.com")

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

    def test_admin_role_stops_module_reads(self):
        calls = []
        def request(client, path, token=None, demo_email=None):
            calls.append((path, token, demo_email))
            if path == "/api/health":
                return 200, {"version": "17.7.0"}, "ok"
            if path == "/openapi.json":
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
