"""Validate a trusted OpenSSH ED25519 SHA256 host fingerprint (no disclosure).

Accept the token or the full output of `ssh-keygen -lf ... -E sha256`.
The source remains the independently trusted VPS console, NOT ssh-keyscan.
"""
import os
import re
import sys


_PIN = re.compile(r"(?<![A-Za-z0-9+/])SHA256:[A-Za-z0-9+/]{43}(?![A-Za-z0-9+/])")


def normalize(value: str) -> str:
    matches = _PIN.findall(value or "")
    if len(matches) != 1:
        raise ValueError("Invalid or ambiguous trusted DEV host fingerprint format")
    return matches[0]


def main() -> None:
    try:
        pin = normalize(os.environ.get("DEV_SSH_HOST_FINGERPRINT", ""))
    except ValueError as exc:
        raise SystemExit(str(exc)) from None
    print(pin)


if __name__ == "__main__":
    main()
