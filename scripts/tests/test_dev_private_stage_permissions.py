"""Regression tests for the DEV private staging transition from legacy OPS 0755.

These tests only exercise an isolated local directory, never /opt/dao.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

SOURCE = (Path(__file__).resolve().parents[2] / "scripts/stage-dev-private-dir.sh").read_text()


class DevPrivateStagePermissionsTests(unittest.TestCase):
    def run_stage(self, parent, run="123", attempt="2"):
        script = SOURCE.replace("/opt/dao", str(parent))
        return subprocess.run(
            ["bash", "-e", "-c", script, "stage-dev-private-dir.sh", run, attempt],
            capture_output=True, text=True, timeout=10,
        )

    def test_legacy_0755_ops_directory_is_restricted_before_private_staging(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            parent.chmod(0o755)
            shared = parent / "ops-incoming"
            shared.mkdir(mode=0o755)
            shared.chmod(0o755)
            existing = shared / "another-ops-run"
            existing.mkdir(mode=0o755)
            result = self.run_stage(parent)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(shared.stat().st_mode & 0o777, 0o700)
            self.assertEqual((shared / "123-2").stat().st_mode & 0o777, 0o700)
            self.assertTrue(existing.is_dir(), "Existing OPS in-flight state must survive")

    def test_symlink_is_rejected_without_changing_target_permissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            parent.chmod(0o755)
            outside = parent / "unrelated"
            outside.mkdir(mode=0o755)
            (parent / "ops-incoming").symlink_to(outside, target_is_directory=True)
            result = self.run_stage(parent)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("reason=directory_type", result.stderr)
            self.assertEqual(outside.stat().st_mode & 0o777, 0o755)

    def test_world_writable_parent_is_rejected_without_creating_payload(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            parent.chmod(0o707)
            result = self.run_stage(parent)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((parent / "ops-incoming").exists())

    def test_active_attempt_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            parent.chmod(0o755)
            shared = parent / "ops-incoming"
            private = shared / "123-2"
            private.mkdir(parents=True, mode=0o700)
            private.chmod(0o700)
            sentinel = private / "private-not-to-delete"
            sentinel.write_text("synthetic value only")
            result = self.run_stage(parent)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(sentinel.read_text(), "synthetic value only")

    def test_old_numeric_attempt_is_removed_but_other_ops_data_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            parent.chmod(0o755)
            shared = parent / "ops-incoming"
            legacy = shared / "100-1"
            unrelated = shared / "recover-manually"
            legacy.mkdir(parents=True)
            unrelated.mkdir()
            age = time.time() - 26 * 3600
            os.utime(legacy, (age, age))
            result = self.run_stage(parent)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(legacy.exists())
            self.assertTrue(unrelated.exists())


if __name__ == "__main__":
    unittest.main()
