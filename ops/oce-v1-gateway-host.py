#!/usr/bin/python3 -I
"""Install-time host qualification for the private D.A.O -> OCE gateway (#58).

Root-only. It never prints Compose environment values, OCE credentials, JWTs,
container IPs or response bodies.
"""

from __future__ import annotations

import datetime
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
PIN_FILE = Path("/etc/dao-oce/runtime-pin.yml")
APP_CONTAINER = "openconstructionerp-app-1"
SOCKET_PATH = Path("/run/dao-oce-gateway/gateway.sock")
GATEWAY_SERVICE = "dao-oce-gateway.service"
GUARD_SERVICE = "dao-oce-egress-guard.service"
DOCKER = "/usr/bin/docker"
SYSTEMCTL = "/usr/bin/systemctl"
RUNUSER = "/usr/sbin/runuser"
CURL = "/usr/bin/curl"

# Time budget (seconds). Worst case = forward (up 120 + health 180) + rollback (stops 60 + up 120 + health 180 +
# post-checks 2 x 20) = 700 s, inside the helper cap of 900 s (dao-dev-admin), SSH 17 min and job 20 min. The first
# attempts ended after ~180 s with the old 75 s waits: OCE can need well over a minute to answer /api/health after a
# recreate, and the old rollback then judged a still-starting container as failed.
COMPOSE_UP_TIMEOUT = 120
HEALTH_WAIT_APPLY = 180
HEALTH_WAIT_ROLLBACK = 180
POSTCHECK_WAIT = 20

# Closed-vocabulary trace of what happened; never command output, paths, values or addresses.
TRACE_STEPS = frozenset({
    "env_backup", "env_write", "compose_up", "health_wait", "post_pin", "guard_start", "gateway_start", "gateway_ready",
    "bypass_checks", "final_health",
    "rb_gateway_stop", "rb_guard_stop", "rb_env_restore", "rb_compose_up", "rb_health_wait",
    "post_health", "post_demo", "post_pin_active", "post_loopback", "post_gateway_state", "post_guard_state",
})
TRACE_OUTCOMES = frozenset({"ok", "failed", "timeout", "nonzero", "error"})
TRACE = []
ROLLBACK_FAILURES = []


def mark(step, outcome, started=None):
    """Record one bounded trace entry: [step, outcome, elapsed seconds rounded down to 5 s, max 600]."""
    if step in TRACE_STEPS and outcome in TRACE_OUTCOMES and len(TRACE) < 40:
        seconds = 0 if started is None else max(0, int(time.monotonic() - started))
        TRACE.append([step, outcome, min(600, seconds // 5 * 5)])


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


def wait_health(seconds=HEALTH_WAIT_APPLY, step="health_wait"):
    started = time.monotonic()
    deadline = started + seconds
    while time.monotonic() < deadline:
        if health():
            mark(step, "ok", started)
            return
        time.sleep(2)
    mark(step, "timeout", started)
    raise Halt("oce health timeout")


def poll(check, seconds):
    """True as soon as check() is true, waiting at most `seconds`; never raises."""
    deadline = time.monotonic() + seconds
    while True:
        try:
            if check():
                return True
        except Exception:
            pass
        if time.monotonic() >= deadline:
            return False
        time.sleep(2)


def env_meta():
    meta = ENV_FILE.lstat()
    dao = pwd.getpwnam("dao")
    if not stat.S_ISREG(meta.st_mode) or meta.st_size > 128 * 1024:
        raise Halt("compose env unsafe")
    if meta.st_uid == dao.pw_uid:
        raise Halt("compose env owned by dao")
    if meta.st_mode & 0o002:
        raise Halt("compose env world writable")
    if meta.st_gid == dao.pw_gid and meta.st_mode & 0o020:
        raise Halt("compose env writable by dao")
    return meta


def dao_path_access(path: Path, flag: str) -> bool:
    if flag not in {"-r", "-w"}:
        raise Halt("invalid access probe")
    result = run(
        [RUNUSER, "-u", "dao", "--", "/usr/bin/test", flag, str(path)],
        timeout=5,
        check=False,
    )
    return result.returncode == 0


def env_readable_by_dao(meta):
    _ = meta
    return dao_path_access(ENV_FILE, "-r")


def harden_env_permissions():
    meta = env_meta()
    if env_readable_by_dao(meta) or stat.S_IMODE(meta.st_mode) != 0o600:
        os.chmod(ENV_FILE, 0o600)
    meta = env_meta()
    if env_readable_by_dao(meta):
        raise Halt("compose env readable by dao")
    return meta


def dao_has_docker_socket_access():
    path = Path("/var/run/docker.sock")
    meta = path.lstat()
    if not stat.S_ISSOCK(meta.st_mode):
        raise Halt("docker socket unavailable")
    return dao_path_access(path, "-w")


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
            if os.geteuid() == 0:
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
            if os.geteuid() == 0:
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


def selected_compose_files():
    """Return the exact authoritative Compose sources for the running pin.

    A root-owned runtime-pin override is preferred when present. If it is
    absent, the two repository Compose files are acceptable only when their
    rendered app image is already an immutable digest that exactly matches the
    currently-running container.
    """
    if PIN_FILE.exists():
        meta = PIN_FILE.lstat()
        if (
            not stat.S_ISREG(meta.st_mode)
            or meta.st_uid != 0
            or meta.st_mode & 0o022
            or meta.st_size > 8192
        ):
            raise Halt("runtime pin unsafe")
        return (*BASE_FILES, PIN_FILE)
    return BASE_FILES


def configured_app_image(files):
    args = [DOCKER, "compose", "--project-directory", str(BASE)]
    for path in files:
        args.extend(["-f", str(path)])
    args.extend(["config", "--format", "json"])
    result = run(args, timeout=30)
    try:
        data = json.loads(result.stdout)
        image = ((data.get("services") or {}).get("app") or {}).get("image")
    except Exception as exc:
        raise Halt("compose config invalid") from exc
    if not isinstance(image, str):
        raise Halt("compose app image missing")
    if not (
        image.startswith("ghcr.io/datadrivenconstruction/openconstructionerp@sha256:")
        and len(image.rsplit("@sha256:", 1)[-1]) == 64
    ):
        raise Halt("compose app image not immutable")
    return image


def require_active_digest_pin():
    files = selected_compose_files()
    row = app_inspect()
    live_image = ((row.get("Config") or {}).get("Image") or "")
    labels = ((row.get("Config") or {}).get("Labels") or {})
    sources = labels.get("com.docker.compose.project.config_files", "")
    active_sources = {part.strip() for part in sources.split(",") if part.strip()}
    expected_sources = {str(path) for path in files}
    configured = configured_app_image(files)
    if (
        live_image != configured
        or active_sources != expected_sources
    ):
        raise Halt("runtime digest pin not active")
    return files


def compose_up_app(pinned_sources, pinned_image, step="compose_up"):
    """Recreate from the pinned preflight snapshot, including during rollback.

    The running container may be absent or incomplete after a failed recreate.
    Requiring its *current* labels/digest before recovery prevents restoration.
    The effective Compose image and source list must still match the frozen pin.
    """
    if tuple(pinned_sources) != selected_compose_files() or configured_app_image(pinned_sources) != pinned_image:
        raise Halt("runtime pin changed during activation")
    args = [DOCKER, "compose", "--project-directory", str(BASE)]
    for path in pinned_sources:
        args.extend(["-f", str(path)])
    args.extend(["up", "-d", "--no-deps", "--no-build", "--pull", "never", "app"])
    started = time.monotonic()
    try:
        run(args, timeout=COMPOSE_UP_TIMEOUT)
    except subprocess.TimeoutExpired:
        mark(step, "timeout", started)
        raise Halt("command failed")
    except Halt:
        mark(step, "nonzero", started)
        raise
    except Exception:
        mark(step, "error", started)
        raise
    mark(step, "ok", started)


def app_inspect():
    result = run([DOCKER, "inspect", APP_CONTAINER], timeout=15)
    rows = json.loads(result.stdout)
    if not isinstance(rows, list) or len(rows) != 1:
        raise Halt("app inspect shape")
    return rows[0]


def pinned_app_active():
    try:
        require_active_digest_pin()
    except Halt:
        return False
    return True


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
    command = [RUNUSER, "-u", "dao", "--", CURL, "--noproxy", "*"] + args
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


APP_STATES = frozenset({"created", "running", "paused", "restarting", "removing", "exited", "dead"})
APP_HEALTH = frozenset({"starting", "healthy", "unhealthy"})


def app_diagnostics():
    """Read-only, closed-vocabulary state of the OCE app container. Never raises, never prints raw Docker output,
    labels, environment, addresses or health-check logs."""
    out = {
        "docker_compose_available": False,
        "app_container_present": False,
        "app_state": "absent",
        "app_health_status": "none",
        "app_restart_count": 0,
        "app_oom_killed": False,
        "app_exit_code": None,
        "app_uptime_bucket_s": None,
        "health_latency_bucket_ms": None,
    }
    try:
        out["docker_compose_available"] = run([DOCKER, "compose", "version"], timeout=15, check=False).returncode == 0
    except Exception:
        pass
    try:
        started = time.monotonic()
        health()
        out["health_latency_bucket_ms"] = min(3000, int((time.monotonic() - started) * 1000) // 100 * 100)
    except Exception:
        pass
    try:
        row = app_inspect()
        state = row.get("State") or {}
        count = row.get("RestartCount")
        out["app_restart_count"] = min(99, count) if type(count) is int and count >= 0 else 0
        out["app_container_present"] = True
        status = state.get("Status")
        out["app_state"] = status if status in APP_STATES else "unknown"
        health_status = (state.get("Health") or {}).get("Status")
        out["app_health_status"] = health_status if health_status in APP_HEALTH else "none"
        out["app_oom_killed"] = state.get("OOMKilled") is True
        code = state.get("ExitCode")
        out["app_exit_code"] = code if type(code) is int and 0 <= code <= 255 else None
        stamp = state.get("StartedAt")
        if isinstance(stamp, str) and len(stamp) >= 19:
            began = datetime.datetime.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc)
            seconds = int((datetime.datetime.now(datetime.timezone.utc) - began).total_seconds())
            out["app_uptime_bucket_s"] = min(86400, max(0, seconds) // 60 * 60)
    except Exception:
        pass
    return out


def plan():
    require_root()
    validate_installed_files()
    require_active_digest_pin()
    if not health():
        raise Halt("oce health")
    if not pinned_app_active():
        raise Halt("runtime digest pin not active")
    original, bind = read_env()
    _ = original
    meta = env_meta()
    if dao_has_docker_socket_access():
        raise Halt("dao has docker socket access")
    print(
        json.dumps(
            {
                "gateway_host_plan_ready": True,
                "oce_healthy": True,
                "demo_access_preserved": demo_enabled(),
                "compose_env_hardening_required": env_readable_by_dao(meta) or stat.S_IMODE(meta.st_mode) != 0o600,
                "dao_docker_socket_access": False,
                "loopback_bind_required": bind != "127.0.0.1" or not loopback_only(),
                "public_8080_url_will_be_closed_on_apply": not loopback_only(),
                "demo_login_preserved_but_remote_access_requires_tunnel": True,
                "gateway_service_active": service_active(GATEWAY_SERVICE),
                "egress_guard_active": service_active(GUARD_SERVICE),
                "gateway_socket_ready": socket_ready(),
                "app_diagnostics": app_diagnostics(),
            },
            sort_keys=True,
        )
    )


APPLY_PHASES = frozenset({
    "bind_change", "compose_recreate", "post_compose_pin", "guard_start",
    "gateway_start", "gateway_ready", "bypass_checks", "final_health",
})
ROLLBACK_OUTCOMES = frozenset({
    "verified", "service_stop_failed", "env_restore_failed",
    "compose_restore_failed", "postcheck_failed", "multiple_failed",
})


class ApplyFailure(Halt):
    """Sanitized closed-state failure; never include command output or secrets."""

    def __init__(self, reason, phase, rollback):
        super().__init__(reason)
        self.phase = phase
        self.rollback = rollback


def rollback_activation(changed, original, original_meta, gateway_was_active,
                        guard_was_active, pinned_sources, pinned_image, initial_loopback):
    """Best-effort *all* recovery steps, then verify the original invariant.

    Every sub-step is recorded in TRACE and every failing one in ROLLBACK_FAILURES (closed names), so an aggregate
    result is never the only evidence. The post-check waits for the app to answer: a restored container that is
    still starting is not a failed restoration.
    """
    failures = []

    def stop(service, step):
        started = time.monotonic()
        try:
            run([SYSTEMCTL, "disable", "--now", service], timeout=30)
            mark(step, "ok", started)
        except Exception:
            mark(step, "failed", started)
            failures.append("service_stop_failed")

    if not gateway_was_active:
        stop(GATEWAY_SERVICE, "rb_gateway_stop")
    if not guard_was_active:
        stop(GUARD_SERVICE, "rb_guard_stop")
    if changed:
        env_restored = False
        started = time.monotonic()
        try:
            restore_env(original, original_meta)
            env_restored = True
            mark("rb_env_restore", "ok", started)
        except Exception:
            mark("rb_env_restore", "failed", started)
            failures.append("env_restore_failed")
        if env_restored:
            try:
                compose_up_app(pinned_sources, pinned_image, step="rb_compose_up")
                wait_health(HEALTH_WAIT_ROLLBACK, "rb_health_wait")
            except Exception:
                failures.append("compose_restore_failed")

    def verify(step, check):
        started = time.monotonic()
        try:
            ok = bool(check())
        except Exception:
            ok = False
        mark(step, "ok" if ok else "failed", started)
        if not ok:
            failures.append("postcheck_failed")
        return ok

    verify("post_health", lambda: poll(health, POSTCHECK_WAIT))
    verify("post_demo", lambda: poll(demo_enabled, POSTCHECK_WAIT))
    verify("post_pin_active", pinned_app_active)
    verify("post_loopback", lambda: loopback_only() == initial_loopback)
    verify("post_gateway_state", lambda: service_active(GATEWAY_SERVICE) == gateway_was_active)
    verify("post_guard_state", lambda: service_active(GUARD_SERVICE) == guard_was_active)
    ROLLBACK_FAILURES[:] = sorted(set(failures))
    unique = set(failures)
    return "verified" if not unique else (next(iter(unique)) if len(unique) == 1
                                           else "multiple_failed")


def apply():
    require_root()
    validate_installed_files()
    pinned_sources = require_active_digest_pin()
    pinned_image = configured_app_image(pinned_sources)
    if not health() or not pinned_app_active():
        raise Halt("oce health or runtime digest pin unavailable")
    if not demo_enabled():
        raise Halt("demo access unavailable")
    if dao_has_docker_socket_access():
        raise Halt("dao has docker socket access")

    harden_env_permissions()
    original_meta = env_meta()
    original, bind = read_env()
    changed = bind != "127.0.0.1"
    initial_loopback = loopback_only()
    gateway_was_active = service_active(GATEWAY_SERVICE)
    guard_was_active = service_active(GUARD_SERVICE)
    phase = "bind_change"
    TRACE.clear()
    ROLLBACK_FAILURES.clear()
    try:
        if changed:
            started = time.monotonic()
            backup_env(original)
            mark("env_backup", "ok", started)
            started = time.monotonic()
            write_env_loopback(original)
            mark("env_write", "ok", started)
        if changed or not loopback_only():
            phase = "compose_recreate"
            compose_up_app(pinned_sources, pinned_image)
            wait_health(HEALTH_WAIT_APPLY, "health_wait")
        phase = "post_compose_pin"
        started = time.monotonic()
        if not loopback_only() or not pinned_app_active():
            mark("post_pin", "failed", started)
            raise Halt("loopback or pinned runtime verification failed")
        mark("post_pin", "ok", started)

        phase = "guard_start"
        started = time.monotonic()
        run([SYSTEMCTL, "enable", "--now", GUARD_SERVICE], timeout=30)
        if not service_active(GUARD_SERVICE):
            mark("guard_start", "failed", started)
            raise Halt("egress guard inactive")
        mark("guard_start", "ok", started)

        phase = "gateway_start"
        started = time.monotonic()
        run([SYSTEMCTL, "enable", "--now", GATEWAY_SERVICE], timeout=30)
        mark("gateway_start", "ok", started)
        phase = "gateway_ready"
        started = time.monotonic()
        deadline = started + 20
        while time.monotonic() < deadline and not (service_active(GATEWAY_SERVICE) and socket_ready()):
            time.sleep(1)
        if not service_active(GATEWAY_SERVICE) or not socket_ready() or not gateway_ready():
            mark("gateway_ready", "failed", started)
            raise Halt("gateway service not ready")
        mark("gateway_ready", "ok", started)

        phase = "bypass_checks"
        started = time.monotonic()
        ip = container_ip()
        if not dao_direct_denied("http://127.0.0.1:8080/api/health"):
            mark("bypass_checks", "failed", started)
            raise Halt("dao loopback bypass still reachable")
        if not dao_direct_denied("http://" + ip + ":8080/api/health"):
            mark("bypass_checks", "failed", started)
            raise Halt("dao container bypass still reachable")
        mark("bypass_checks", "ok", started)
        phase = "final_health"
        started = time.monotonic()
        if not poll(health, POSTCHECK_WAIT) or not demo_enabled() or not pinned_app_active():
            mark("final_health", "failed", started)
            raise Halt("operator OCE access or runtime pin unavailable")
        mark("final_health", "ok", started)
    except Exception as failure:
        result = rollback_activation(changed, original, original_meta,
                                     gateway_was_active, guard_was_active,
                                     pinned_sources, pinned_image, initial_loopback)
        if result != "verified":
            raise ApplyFailure("gateway activation failed and rollback incomplete", phase, result) from failure
        reason = str(failure) if isinstance(failure, Halt) else "internal_or_command_error"
        # Deliberately collapse the original exception to a closed allowlist.
        if reason not in {
            "command failed", "oce health timeout", "runtime pin changed during activation",
            "loopback or pinned runtime verification failed", "egress guard inactive",
            "gateway service not ready", "dao loopback bypass still reachable",
            "dao container bypass still reachable", "operator OCE access or runtime pin unavailable",
            "internal_or_command_error",
        }:
            reason = "internal_or_command_error"
        raise ApplyFailure(reason, phase, "verified") from failure

    print(
        json.dumps(
            {
                "gateway_host": "complete",
                "oce_loopback_only": True,
                "immutable_runtime_pin_preserved": True,
                "dao_loopback_bypass_denied": True,
                "dao_container_bypass_denied": True,
                "gateway_socket_ready": True,
                "gateway_ready": True,
                "demo_access_preserved": True,
                "egress_guard_active": True,
                "compose_env_not_readable_by_dao": True,
                "dao_docker_socket_access": False,
            },
            sort_keys=True,
        )
    )


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "plan":
        plan()
    elif (
        len(sys.argv) == 3
        and sys.argv[1] == "apply"
        and sys.argv[2] == "--acknowledge-public-demo-link-closes"
    ):
        apply()
    else:
        raise Halt("usage: plan or apply --acknowledge-public-demo-link-closes")


def failure_report(exc):
    """Closed report printed on stderr; trace and rollback detail only after an activation failure."""
    reason = str(exc) if isinstance(exc, Halt) else "internal_or_command_error"
    report = {"oce_gateway_host_error": reason}
    if isinstance(exc, ApplyFailure):
        report["phase"] = exc.phase
        report["rollback"] = exc.rollback
        report["rollback_failures"] = list(ROLLBACK_FAILURES)
        report["trace"] = [list(entry) for entry in TRACE]
    return report


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except Exception as exc:
        print(json.dumps(failure_report(exc), sort_keys=True), file=sys.stderr)
        sys.exit(1)
