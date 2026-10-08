#!/usr/bin/python3 -I
"""Install-time host qualification for the private D.A.O -> OCE gateway (#58).

Root-only. It never prints Compose environment values, OCE credentials, JWTs,
container IPs or response bodies.
"""

from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time

BASE = Path("/home/ubuntu/dao/OpenConstructionERP")
ENV_FILE = BASE / ".env"
BASE_FILES = (
    BASE / "docker-compose.quickstart.yml",
    BASE / "docker-compose.override.yml",
)
PRIVATE_DIR = Path("/etc/dao-oce/private")
ENV_BACKUP = PRIVATE_DIR / "compose.env.pre-gateway"
APP_CONTAINER = "openconstructionerp-app-1"
SOCKET_PATH = Path("/run/dao-oce-gateway/gateway.sock")
GATEWAY_SERVICE = "dao-oce-gateway.service"
GUARD_SERVICE = "dao-oce-egress-guard.service"
DOCKER = "/usr/bin/docker"
SYSTEMCTL = "/usr/bin/systemctl"
RUNUSER = "/usr/sbin/runuser"
CURL = "/usr/bin/curl"


class Halt(ValueError):
    pass


def run(args, *, timeout=30, input_bytes=None, check=True):
    result = subprocess.run(
        args,
        input=input_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=timeout,
    )
    if check and result.returncode:
        raise Halt("command failed")
    if len(result.stdout) > 1024 * 1024:
        raise Halt("response bound")
    return result


def require_root():
    if os.geteuid() != 0:
        raise Halt("root required")


def command_exists(path):
    return Path(path).is_file() and os.access(path, os.X_OK)


def health():
    conn = http.client.HTTPConnection("127.0.0.1", 8080, timeout=3)
    try:
        conn.request("GET", "/api/health")
        response = conn.getresponse()
        raw = response.read(65537)
        if response.status != 200 or len(raw) > 65536:
            return False
        data = json.loads(raw)
        return data.get("status") == "healthy" and data.get("database") == "ok"
    except Exception:
        return False
    finally:
        conn.close()


def demo_enabled():
    conn = http.client.HTTPConnection("127.0.0.1", 8080, timeout=3)
    try:
        conn.request("GET", "/api/v1/auth/first-run/")
        response = conn.getresponse()
        raw = response.read(65537)
        if response.status != 200 or len(raw) > 65536:
            return False
        data = json.loads(raw)
        return data.get("demo_enabled") is True
    except Exception:
        return False
    finally:
        conn.close()


def wait_health(seconds=75):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if health():
            return
        time.sleep(2)
    raise Halt("oce health timeout")


def env_meta():
    meta = ENV_FILE.lstat()
    dao = pwd.getpwnam("dao")
    if not stat.S_ISREG(meta.st_mode) or meta.st_size > 128 * 1024:
        raise Halt("compose env unsafe")
    if meta.st_uid == dao.pw_uid:
        raise Halt("compose env writable by dao")
    if meta.st_mode & 0o002:
        raise Halt("compose env world writable")
    if meta.st_gid == dao.pw_gid and meta.st_mode & 0o020:
        raise Halt("compose env writable by dao")
    return meta


def read_env():
    env_meta()
    raw = ENV_FILE.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise Halt("compose env encoding") from exc
    binds = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("OE_BIND="):
            binds.append(stripped.split("=", 1)[1])
    if len(binds) > 1:
        raise Halt("duplicate OE_BIND")
    return raw, (binds[0] if binds else None)


def write_env_loopback(original: bytes):
    meta = env_meta()
    text = original.decode("utf-8")
    lines = text.splitlines()
    output = []
    found = False
    for line in lines:
        if line.strip().startswith("OE_BIND="):
            if found:
                raise Halt("duplicate OE_BIND")
            output.append("OE_BIND=127.0.0.1")
            found = True
        else:
            output.append(line)
    if not found:
        output.append("OE_BIND=127.0.0.1")
    value = ("\n".join(output) + "\n").encode()
    fd, name = tempfile.mkstemp(prefix=".env.dao-oce-", dir=BASE)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), stat.S_IMODE(meta.st_mode))
            os.fchown(stream.fileno(), meta.st_uid, meta.st_gid)
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, ENV_FILE)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def restore_env(original: bytes, original_meta):
    fd, name = tempfile.mkstemp(prefix=".env.dao-oce-rollback-", dir=BASE)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), stat.S_IMODE(original_meta.st_mode))
            os.fchown(stream.fileno(), original_meta.st_uid, original_meta.st_gid)
            stream.write(original)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, ENV_FILE)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def backup_env(original: bytes):
    PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
    if not ENV_BACKUP.exists():
        fd, name = tempfile.mkstemp(prefix=".compose-env-backup-", dir=PRIVATE_DIR)
        try:
            with os.fdopen(fd, "wb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                os.fchown(stream.fileno(), 0, 0)
                stream.write(original)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, ENV_BACKUP)
        finally:
            if os.path.exists(name):
                os.unlink(name)
    meta = ENV_BACKUP.lstat()
    if not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or meta.st_mode & 0o077:
        raise Halt("compose env backup unsafe")


def compose_up_app():
    args = [DOCKER, "compose", "--project-directory", str(BASE)]
    for path in BASE_FILES:
        args.extend(["-f", str(path)])
    args.extend(["up", "-d", "--no-deps", "--no-build", "--pull", "never", "app"])
    run(args, timeout=120)


def app_inspect():
    result = run([DOCKER, "inspect", APP_CONTAINER], timeout=15)
    rows = json.loads(result.stdout)
    if not isinstance(rows, list) or len(rows) != 1:
        raise Halt("app inspect shape")
    return rows[0]


def loopback_only():
    row = app_inspect()
    ports = ((row.get("NetworkSettings") or {}).get("Ports") or {}).get("8080/tcp")
    if not isinstance(ports, list) or len(ports) != 1:
        return False
    bind = ports[0]
    return bind.get("HostIp") == "127.0.0.1" and bind.get("HostPort") == "8080"


def container_ip():
    row = app_inspect()
    networks = (row.get("NetworkSettings") or {}).get("Networks") or {}
    ips = sorted(
        {v.get("IPAddress") for v in networks.values() if isinstance(v, dict) and v.get("IPAddress")}
    )
    if len(ips) != 1:
        raise Halt("app network identity")
    return ips[0]


def service_active(name):
    result = run([SYSTEMCTL, "is-active", name], timeout=10, check=False)
    return result.returncode == 0 and result.stdout.decode().strip() == "active"


def socket_ready():
    if not SOCKET_PATH.exists():
        return False
    meta = SOCKET_PATH.lstat()
    dao_gid = pwd.getpwnam("dao").pw_gid
    return stat.S_ISSOCK(meta.st_mode) and meta.st_gid == dao_gid and stat.S_IMODE(meta.st_mode) == 0o660


def as_dao_curl(args, *, payload=None, timeout=10, check=True):
    command = [RUNUSER, "-u", "dao", "--", CURL] + args
    return run(
        command,
        timeout=timeout,
        input_bytes=(payload.encode() if payload is not None else None),
        check=check,
    )


def gateway_ready():
    result = as_dao_curl(
        [
            "--silent",
            "--show-error",
            "--fail",
            "--max-time",
            "5",
            "--unix-socket",
            str(SOCKET_PATH),
            "http://localhost/ready",
        ]
    )
    try:
        data = json.loads(result.stdout)
    except Exception:
        return False
    return data.get("ok") is True and data.get("identity") == "editor"


def dao_direct_denied(target):
    result = as_dao_curl(
        [
            "--silent",
            "--show-error",
            "--fail",
            "--max-time",
            "2",
            target,
        ],
        timeout=5,
        check=False,
    )
    return result.returncode != 0


def validate_installed_files():
    required = (
        Path("/usr/local/libexec/dao-oce-gateway"),
        Path("/usr/local/libexec/dao-oce-egress-guard"),
        Path("/etc/systemd/system/dao-oce-gateway.service"),
        Path("/etc/systemd/system/dao-oce-egress-guard.service"),
    )
    if not all(path.exists() for path in required):
        raise Halt("gateway not installed")
    try:
        pwd.getpwnam("dao-oce-gateway")
        pwd.getpwnam("dao")
    except KeyError as exc:
        raise Halt("gateway service user missing") from exc
    for path in ("/usr/bin/systemctl", "/usr/bin/docker", "/usr/sbin/runuser", "/usr/bin/curl"):
        if not command_exists(path):
            raise Halt("required command unavailable")
    if not (command_exists("/usr/sbin/nft") or command_exists("/usr/bin/nft")):
        raise Halt("nft unavailable")


def plan():
    require_root()
    validate_installed_files()
    if not health():
        raise Halt("oce health")
    original, bind = read_env()
    _ = original
    print(
        json.dumps(
            {
                "gateway_host_plan_ready": True,
                "oce_healthy": True,
                "demo_access_preserved": demo_enabled(),
                "loopback_bind_required": bind != "127.0.0.1" or not loopback_only(),
                "gateway_service_active": service_active(GATEWAY_SERVICE),
                "egress_guard_active": service_active(GUARD_SERVICE),
                "gateway_socket_ready": socket_ready(),
            },
            sort_keys=True,
        )
    )


def apply():
    require_root()
    validate_installed_files()
    if not health():
        raise Halt("oce health")
    if not demo_enabled():
        raise Halt("demo access unavailable")

    original_meta = env_meta()
    original, bind = read_env()
    changed = bind != "127.0.0.1"
    if changed:
        backup_env(original)
        write_env_loopback(original)
        try:
            compose_up_app()
            wait_health()
            if not loopback_only():
                raise Halt("loopback bind ineffective")
        except Exception:
            restore_env(original, original_meta)
            compose_up_app()
            wait_health()
            raise
    elif not loopback_only():
        compose_up_app()
        wait_health()
        if not loopback_only():
            raise Halt("loopback bind ineffective")

    run([SYSTEMCTL, "enable", "--now", GUARD_SERVICE], timeout=30)
    if not service_active(GUARD_SERVICE):
        raise Halt("egress guard inactive")

    run([SYSTEMCTL, "enable", "--now", GATEWAY_SERVICE], timeout=30)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline and not (service_active(GATEWAY_SERVICE) and socket_ready()):
        time.sleep(1)
    if not service_active(GATEWAY_SERVICE) or not socket_ready() or not gateway_ready():
        raise Halt("gateway service not ready")

    ip = container_ip()
    if not dao_direct_denied("http://127.0.0.1:8080/api/health"):
        raise Halt("dao loopback bypass still reachable")
    if not dao_direct_denied("http://" + ip + ":8080/api/health"):
        raise Halt("dao container bypass still reachable")
    if not health() or not demo_enabled():
        raise Halt("operator OCE access unavailable")

    print(
        json.dumps(
            {
                "gateway_host": "complete",
                "oce_loopback_only": True,
                "dao_loopback_bypass_denied": True,
                "dao_container_bypass_denied": True,
                "gateway_socket_ready": True,
                "gateway_ready": True,
                "demo_access_preserved": True,
                "egress_guard_active": True,
            },
            sort_keys=True,
        )
    )


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in {"plan", "apply"}:
        raise Halt("usage")
    {"plan": plan, "apply": apply}[sys.argv[1]]()


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except Exception as exc:
        reason = str(exc) if isinstance(exc, Halt) else "internal_or_command_error"
        print(json.dumps({"oce_gateway_host_error": reason}, sort_keys=True), file=sys.stderr)
        sys.exit(1)
