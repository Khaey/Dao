"""Offline tests for bounded, non-leaking DEV host fingerprint normalization."""
import importlib.util
from pathlib import Path
import unittest

FILE = Path(__file__).resolve().parents[1] / "normalize-dev-host-fingerprint.py"
SPEC = importlib.util.spec_from_file_location("dao_dev_host_pin", FILE)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class HostFingerprintNormalizationTests(unittest.TestCase):
    PIN = "SHA256:" + "a" * 43

    def test_canonical_pin(self):
        self.assertEqual(module.normalize(self.PIN), self.PIN)

    def test_full_ssh_keygen_line(self):
        self.assertEqual(module.normalize(f"256 {self.PIN} root@dao-dev (ED25519)"), self.PIN)

    def test_whitespace_and_shell_quotes_are_not_accepted_as_pin_contents(self):
        self.assertEqual(module.normalize(f"  '{self.PIN}'  "), self.PIN)

    def test_malformed_values_fail_closed(self):
        for value in ("", "SHA256:", "SHA256:" + "a" * 42,
                      "SHA256:" + "a" * 44, "SHA256:invalid!value",
                      self.PIN + "\n" + self.PIN):
            with self.subTest(value_type=len(value)):
                with self.assertRaises(ValueError):
                    module.normalize(value)


if __name__ == "__main__":
    unittest.main()
