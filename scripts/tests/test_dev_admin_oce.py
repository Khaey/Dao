import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "dao_dev_admin",
    Path(__file__).parents[2] / "ops" / "dao-dev-admin.py",
)
admin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admin)


class DevAdminOceAuditTests(unittest.TestCase):
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
