#!/usr/bin/python3 -I
"""Provision and qualify the dedicated OCE gateway identity for D.A.O #58.

This fixed root-only helper talks only to the local OCE instance. It preserves
OCE demo access, never prints passwords/JWTs, and stores the gateway credential
under a root-only directory for the later private gateway service.
"""
from __future__ import annotations

import fcntl
import http.client
import json
import os
from pathlib import Path
import secrets
import stat
import sys
import tempfile
import time

HOST = "127.0.0.1"
PORT = 8080
TECH_EMAIL = "dao-oce-gateway@logiclab.fr"
TECH_NAME = "D.A.O OCE Gateway"
TECH_ROLE = "editor"
DEMO_ADMIN_EMAIL = "demo@openconstructionerp.com"
SECRET_DIR = Path("/etc/dao-oce/private")
SECRET_FILE = SECRET_DIR / "gateway-credential.json"
PENDING_FILE = SECRET_DIR / ".gateway-credential.next.json"
LOCK_FILE = Path("/run/lock/dao-oce-identity.lock")
MAX_BODY = 512 * 1024


class Halt(ValueError):
    """Fixed safe failure reason. Never construct from remote bodies."""


def request(method: str, path: str, payload=None, token: str | None = None):
    body = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload, separators=(",", ":")).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    conn = http.client.HTTPConnection(HOST, PORT, timeout=5)
    try:
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        raw = response.read(MAX_BODY + 1)
        if len(raw) > MAX_BODY:
            raise Halt("OCE response too large")
        data = None
        if raw:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                data = None
        return response.status, data
    except Halt:
        raise
    except Exception as exc:
        raise Halt("local OCE request failed") from exc
    finally:
        conn.close()


def require_status(status: int, allowed: set[int], reason: str):
    if status not in allowed:
        raise Halt(reason)


def health():
    status, data = request("GET", "/api/health")
    if status != 200 or not isinstance(data, dict):
        raise Halt("OCE health unavailable")
    if data.get("status") != "healthy" or data.get("database") != "ok":
        raise Halt("OCE not healthy")


def first_run():
    status, data = request("GET", "/api/v1/auth/first-run/")
    require_status(status, {200}, "OCE first-run state unavailable")
    if not isinstance(data, dict):
        raise Halt("OCE first-run state invalid")
    return data


def demo_admin_token():
    state = first_run()
    if state.get("demo_enabled") is not True:
        raise Halt("demo access unavailable for local bootstrap")
    status, data = request(
        "POST",
        "/api/v1/users/auth/demo-login",
        {"email": DEMO_ADMIN_EMAIL},
    )
    require_status(status, {200}, "local demo admin login failed")
    if not isinstance(data, dict) or not isinstance(data.get("access_token"), str):
        raise Halt("local demo admin token missing")
    token = data["access_token"]
    status, me = request("GET", "/api/v1/users/me/", token=token)
    require_status(status, {200}, "local demo admin verification failed")
    if not isinstance(me, dict) or me.get("role") != "admin":
        raise Halt("local demo principal is not admin")
    return token


def list_technical(admin_token: str):
    status, data = request("GET", "/api/v1/users/?limit=500", token=admin_token)
    require_status(status, {200}, "OCE user inventory failed")
    if not isinstance(data, list):
        raise Halt("OCE user inventory invalid")
    matches = [row for row in data if isinstance(row, dict) and row.get("email") == TECH_EMAIL]
    if len(matches) > 1:
        raise Halt("duplicate technical identities")
    return matches[0] if matches else None


def generate_password():
    return "D" + secrets.token_urlsafe(48) + "7"


def validate_secret_dir():
    SECRET_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(SECRET_DIR, 0o700)
    meta = SECRET_DIR.lstat()
    if not stat.S_ISDIR(meta.st_mode) or meta.st_uid != 0 or meta.st_mode & 0o077:
        raise Halt("secret directory unsafe")


def write_secret(path: Path, data: dict):
    validate_secret_dir()
    fd, name = tempfile.mkstemp(prefix=".dao-oce-credential-", dir=SECRET_DIR)
    try:
        with os.fdopen(fd, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(data, stream, separators=(",", ":"), sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        meta = path.lstat()
        if not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or meta.st_mode & 0o077:
            raise Halt("credential file unsafe")
    finally:
        if os.path.exists(name):
            os.unlink(name)


def read_secret(path: Path):
    if not path.exists():
        return None
    meta = path.lstat()
    if not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or meta.st_mode & 0o077:
        raise Halt("credential file unsafe")
    try:
        data = json.loads(path.read_text())
    except Exception as exc:
        raise Halt("credential file invalid") from exc
    if (
        not isinstance(data, dict)
        or data.get("email") != TECH_EMAIL
        or not isinstance(data.get("password"), str)
        or len(data["password"]) < 12
        or not isinstance(data.get("user_id"), str)
    ):
        raise Halt("credential file shape invalid")
    return data


def login(password: str):
    status, data = request(
        "POST",
        "/api/v1/users/auth/login",
        {"email": TECH_EMAIL, "password": password},
    )
    if status != 200 or not isinstance(data, dict) or not isinstance(data.get("access_token"), str):
        return None
    token = data["access_token"]
    status, me = request("GET", "/api/v1/users/me/", token=token)
    if status != 200 or not isinstance(me, dict):
        return None
    if (
        me.get("email") != TECH_EMAIL
        or me.get("role") != TECH_ROLE
        or me.get("is_active") is not True
    ):
        raise Halt("technical identity contract mismatch")
    return token, me


def verify_record(row: dict, secret: dict | None = None):
    if row.get("role") != TECH_ROLE or row.get("is_active") is not True:
        raise Halt("technical identity role or state mismatch")
    if row.get("full_name") != TECH_NAME:
        raise Halt("technical identity name mismatch")
    if secret is not None and row.get("id") != secret.get("user_id"):
        raise Halt("technical identity id mismatch")


def recover_pending():
    pending = read_secret(PENDING_FILE)
    if pending is None:
        return
    current = read_secret(SECRET_FILE)
    if login(pending["password"]):
        os.replace(PENDING_FILE, SECRET_FILE)
        return
    if current is not None and login(current["password"]):
        PENDING_FILE.unlink()
        return
    raise Halt("pending credential requires operator recovery")


def plan():
    health()
    state = first_run()
    admin = demo_admin_token()
    row = list_technical(admin)
    secret = read_secret(SECRET_FILE)
    pending = PENDING_FILE.exists()
    if row is not None:
        verify_record(row, secret)
    if secret is not None and row is None:
        raise Halt("credential exists without technical identity")
    if row is not None and secret is not None and login(secret["password"]) is None:
        raise Halt("stored technical credential rejected")
    print(json.dumps({
        "identity_plan_ready": True,
        "demo_access_preserved": state.get("demo_enabled") is True,
        "technical_identity_present": row is not None,
        "protected_secret_present": secret is not None,
        "pending_rotation_present": pending,
        "role": TECH_ROLE,
    }, sort_keys=True))


def apply():
    health()
    recover_pending()
    admin = demo_admin_token()
    row = list_technical(admin)
    stored = read_secret(SECRET_FILE)
    if row is not None or stored is not None:
        if row is None or stored is None:
            raise Halt("technical identity partial state")
        verify_record(row, stored)
        if login(stored["password"]) is None:
            raise Halt("stored technical credential rejected")
        print(json.dumps({
            "identity": "complete",
            "created": False,
            "role": TECH_ROLE,
            "secret_protected": True,
            "demo_access_preserved": True,
            "qualified": stored.get("qualified") is True,
        }, sort_keys=True))
        return

    password = generate_password()
    payload = {
        "email": TECH_EMAIL,
        "password": password,
        "full_name": TECH_NAME,
        "role": TECH_ROLE,
        "locale": "fr",
        "is_active": True,
    }
    status, created = request("POST", "/api/v1/users/", payload, token=admin)
    require_status(status, {201}, "technical identity creation failed")
    if not isinstance(created, dict):
        raise Halt("technical identity response invalid")
    if (
        created.get("email") != TECH_EMAIL
        or created.get("role") != TECH_ROLE
        or created.get("is_active") is not True
        or not isinstance(created.get("id"), str)
    ):
        raise Halt("technical identity creation contract mismatch")
    stored = {
        "email": TECH_EMAIL,
        "password": password,
        "user_id": created["id"],
        "qualified": False,
    }
    try:
        write_secret(SECRET_FILE, stored)
    except Exception:
        # Fail closed if local custody failed: disable the newly-created account.
        request(
            "PATCH",
            f"/api/v1/users/{created['id']}",
            {"is_active": False},
            token=admin,
        )
        raise
    if login(password) is None:
        raise Halt("technical identity login verification failed")
    print(json.dumps({
        "identity": "complete",
        "created": True,
        "role": TECH_ROLE,
        "secret_protected": True,
        "demo_access_preserved": True,
        "qualified": False,
    }, sort_keys=True))


def qualify():
    health()
    recover_pending()
    admin = demo_admin_token()
    row = list_technical(admin)
    stored = read_secret(SECRET_FILE)
    if row is None or stored is None:
        raise Halt("technical identity must be provisioned first")
    verify_record(row, stored)
    current = login(stored["password"])
    if current is None:
        raise Halt("stored technical credential rejected")
    if stored.get("qualified") is True:
        print(json.dumps({
            "identity_qualification": "complete",
            "already_qualified": True,
            "rotation_verified": True,
            "deactivation_verified": True,
            "reactivation_verified": True,
            "demo_access_preserved": True,
        }, sort_keys=True))
        return

    old_token, _ = current
    new_password = generate_password()
    pending = dict(stored)
    pending["password"] = new_password
    pending["qualified"] = False
    write_secret(PENDING_FILE, pending)

    # OCE's password-change watermark is second-granularity. Ensure the old
    # token's iat is strictly before the change before asserting invalidation.
    time.sleep(1.1)
    status, changed = request(
        "POST",
        "/api/v1/users/me/change-password/",
        {"current_password": stored["password"], "new_password": new_password},
        token=old_token,
    )
    if status != 200 or not isinstance(changed, dict):
        PENDING_FILE.unlink(missing_ok=True)
        raise Halt("technical credential rotation failed")
    if login(new_password) is None:
        raise Halt("rotated technical credential rejected")
    os.replace(PENDING_FILE, SECRET_FILE)
    stored = read_secret(SECRET_FILE)

    status, _ = request("GET", "/api/v1/users/me/", token=old_token)
    if status != 401:
        raise Halt("old technical token survived password rotation")

    fresh = login(stored["password"])
    if fresh is None:
        raise Halt("rotated technical login unavailable")
    fresh_token, _ = fresh

    deactivated = False
    try:
        status, updated = request(
            "PATCH",
            f"/api/v1/users/{stored['user_id']}",
            {"is_active": False},
            token=admin,
        )
        require_status(status, {200}, "technical identity deactivation failed")
        deactivated = True
        if not isinstance(updated, dict) or updated.get("is_active") is not False:
            raise Halt("technical identity deactivation not effective")
        status, _ = request("GET", "/api/v1/users/me/", token=fresh_token)
        if status != 401:
            raise Halt("deactivated technical token still accepted")
        status, _ = request(
            "POST",
            "/api/v1/users/auth/login",
            {"email": TECH_EMAIL, "password": stored["password"]},
        )
        if status not in {400, 401, 403}:
            raise Halt("deactivated technical login still accepted")
    finally:
        if deactivated:
            status, updated = request(
                "PATCH",
                f"/api/v1/users/{stored['user_id']}",
                {"is_active": True},
                token=admin,
            )
            if status != 200 or not isinstance(updated, dict) or updated.get("is_active") is not True:
                raise Halt("technical identity reactivation failed")

    if login(stored["password"]) is None:
        raise Halt("reactivated technical credential rejected")
    stored["qualified"] = True
    write_secret(SECRET_FILE, stored)
    print(json.dumps({
        "identity_qualification": "complete",
        "already_qualified": False,
        "rotation_verified": True,
        "old_token_rejected": True,
        "deactivation_verified": True,
        "reactivation_verified": True,
        "secret_protected": True,
        "demo_access_preserved": True,
    }, sort_keys=True))


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in {"plan", "apply", "qualify"}:
        raise Halt("usage")
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(LOCK_FILE, "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        {"plan": plan, "apply": apply, "qualify": qualify}[sys.argv[1]]()


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except BlockingIOError:
        print(json.dumps({"oce_identity_error": "operation already active"}), file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        reason = str(exc) if isinstance(exc, Halt) else "internal_or_command_error"
        print(json.dumps({"oce_identity_error": reason}), file=sys.stderr)
        sys.exit(1)
