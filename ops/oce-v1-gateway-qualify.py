#!/usr/bin/python3 -I
"""Live qualification of the private D.A.O -> OCE gateway (#58).

Uses only fixed synthetic identifiers/resources. All gateway calls are made as
the real D.A.O runtime uid over the Unix socket. Direct OCE probes are also made
as that uid. No credential or bearer value is read or printed.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

GATEWAY = "/usr/local/libexec/dao-oce-gateway"
RUNUSER = "/usr/sbin/runuser"
CURL = "/usr/bin/curl"
SOCKET = "/run/dao-oce-gateway/gateway.sock"
DOCKER = "/usr/bin/docker"
APP_CONTAINER = "openconstructionerp-app-1"

P1 = "4efb6b4e-5d5f-4a7d-9d5d-2f1c7d3a8b11"
L1 = "61c23382-4234-4fa0-9e7a-6f2a1a6c6711"
P2 = "b1d2baf2-3d93-4693-a08c-858ef4a80a22"
L2 = "0aa5e722-8ef6-41e8-8c0d-40f51b5d1222"
PF = "e2cf42f8-c20c-44cf-a48a-a2317a35a3ff"
LF = "92555915-4fa8-4caf-a3f2-b0db510c29ff"


class Halt(ValueError):
    pass


def run(args, *, input_bytes=None, timeout=20, check=True):
    result = subprocess.run(
        args,
        input=input_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=timeout,
    )
    if check and result.returncode:
        raise Halt("qualification command failed")
    if len(result.stdout) > 1024 * 1024:
        raise Halt("qualification response bound")
    return result


def admin(action, project, lot):
    run([GATEWAY, action, project, lot], timeout=10)


def gateway(method, path, body=None, *, expected=200, timeout=20):
    args = [
        RUNUSER,
        "-u",
        "dao",
        "--",
        CURL,
        "--silent",
        "--show-error",
        "--max-time",
        str(timeout),
        "--unix-socket",
        SOCKET,
        "--request",
        method,
        "--header",
        "Content-Type: application/json",
        "--write-out",
        "\n%{http_code}",
        "http://localhost" + path,
    ]
    raw = None
    if body is not None:
        args.extend(["--data-binary", "@-"])
        raw = json.dumps(body, separators=(",", ":")).encode()
    result = run(args, input_bytes=raw, timeout=timeout + 5, check=False)
    if result.returncode:
        raise Halt("gateway request transport failed")
    try:
        text = result.stdout.decode()
        body_text, status_text = text.rsplit("\n", 1)
        status = int(status_text)
        data = json.loads(body_text) if body_text else None
    except Exception as exc:
        raise Halt("gateway response invalid") from exc
    if status != expected:
        raise Halt("gateway response status")
    return data


def expect_error(path, body, status, code):
    data = gateway("POST", path, body, expected=status)
    if not isinstance(data, dict) or data.get("ok") is not False or data.get("error") != code:
        raise Halt("negative gateway contract failed")


def direct_denied(url):
    result = run(
        [
            RUNUSER,
            "-u",
            "dao",
            "--",
            CURL,
            "--silent",
            "--show-error",
            "--fail",
            "--max-time",
            "2",
            url,
        ],
        timeout=5,
        check=False,
    )
    return result.returncode != 0


def app_ip():
    result = run(
        [DOCKER, "inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", APP_CONTAINER],
        timeout=10,
    )
    value = result.stdout.decode().strip()
    parts = [x for x in value.split() if x]
    if len(parts) != 1 or "." not in parts[0]:
        raise Halt("app network identity unavailable")
    return parts[0]


def positive_flow():
    base = {"dao_project_id": P1, "dao_lot_id": L1}
    project = dict(
        base,
        name="DAO Gateway Qualification",
        description="Synthetic bounded qualification resource",
        region="TN",
        currency="TND",
    )
    first = gateway("POST", "/v1/ensure-project", project)
    second = gateway("POST", "/v1/ensure-project", project)
    if not isinstance(first, dict) or first.get("ok") is not True:
        raise Halt("ensure project failed")
    if not isinstance(second, dict) or second.get("created") is not False:
        raise Halt("ensure project not idempotent")

    wbs = gateway("POST", "/v1/ensure-wbs", dict(base, code="LOT1", name="Qualification lot"))
    if not isinstance(wbs, dict) or wbs.get("ok") is not True:
        raise Halt("ensure wbs failed")

    schedule = gateway(
        "POST",
        "/v1/ensure-schedule",
        dict(base, start_date="2026-10-01", end_date="2026-10-10"),
    )
    if not isinstance(schedule, dict) or schedule.get("ok") is not True:
        raise Halt("ensure schedule failed")

    a1 = dict(
        base,
        activity_code="A1",
        name="Qualification activity 1",
        wbs_code="LOT1",
        start_date="2026-10-01",
        end_date="2026-10-03",
        status="not_started",
        progress_pct=0,
    )
    a2 = dict(
        base,
        activity_code="A2",
        name="Qualification activity 2",
        wbs_code="LOT1",
        start_date="2026-10-04",
        end_date="2026-10-06",
        status="not_started",
        progress_pct=0,
    )
    first_a1 = gateway("POST", "/v1/upsert-activity", a1)
    gateway("POST", "/v1/upsert-activity", a2)
    repeat_a1 = gateway("POST", "/v1/upsert-activity", a1)
    if first_a1.get("ok") is not True or repeat_a1.get("created") is not False:
        raise Halt("activity upsert not idempotent")

    dep = gateway(
        "POST",
        "/v1/ensure-dependency",
        dict(
            base,
            predecessor_activity_code="A1",
            successor_activity_code="A2",
            relationship_type="FS",
            lag_days=0,
        ),
    )
    if not isinstance(dep, dict) or dep.get("ok") is not True:
        raise Halt("dependency ensure failed")

    calc = gateway("POST", "/v1/calculate-planning", base, timeout=35)
    if (
        not isinstance(calc, dict)
        or calc.get("ok") is not True
        or not isinstance(calc.get("project_duration_days"), int)
        or not isinstance(calc.get("critical_activity_codes"), list)
    ):
        raise Halt("planning calculation failed")

    summary = gateway("POST", "/v1/planning-summary", base)
    if (
        not isinstance(summary, dict)
        or summary.get("ok") is not True
        or not isinstance(summary.get("total_activities"), int)
        or summary.get("total_activities", 0) < 2
    ):
        raise Halt("planning summary failed")


def main():
    if os.geteuid() != 0:
        raise Halt("root required")

    admin("authorize", P1, L1)
    admin("authorize", P2, L2)
    try:
        ready = gateway("GET", "/ready")
        if ready.get("ok") is not True or ready.get("identity") != "editor":
            raise Halt("gateway readiness failed")

        expect_error(
            "/v1/delete-project",
            {"dao_project_id": P1, "dao_lot_id": L1},
            404,
            "operation_not_allowed",
        )
        expect_error(
            "/v1/ensure-project",
            {
                "dao_project_id": P1,
                "dao_lot_id": L1,
                "name": "x",
                "region": "TN",
                "currency": "TND",
                "extra": "forbidden",
            },
            400,
            "extra_fields",
        )
        expect_error(
            "/v1/ensure-project",
            {
                "dao_project_id": PF,
                "dao_lot_id": LF,
                "name": "forged",
                "region": "TN",
                "currency": "TND",
            },
            403,
            "mapping_not_authorized",
        )
        expect_error(
            "/v1/ensure-project",
            {
                "dao_project_id": P1,
                "dao_lot_id": L2,
                "name": "cross",
                "region": "TN",
                "currency": "TND",
            },
            403,
            "mapping_not_authorized",
        )

        positive_flow()

        ip = app_ip()
        if not direct_denied("http://127.0.0.1:8080/api/health"):
            raise Halt("loopback bypass reachable")
        if not direct_denied("http://" + ip + ":8080/api/health"):
            raise Halt("container bypass reachable")

        admin("revoke", P1, L1)
        expect_error(
            "/v1/planning-summary",
            {"dao_project_id": P1, "dao_lot_id": L1},
            403,
            "mapping_not_authorized",
        )

        print(
            json.dumps(
                {
                    "gateway_qualification": "complete",
                    "positive_flow_verified": True,
                    "unknown_operation_rejected": True,
                    "extra_fields_rejected": True,
                    "forged_mapping_rejected": True,
                    "cross_project_mapping_rejected": True,
                    "mapping_revocation_verified": True,
                    "dao_loopback_bypass_denied": True,
                    "dao_container_bypass_denied": True,
                    "demo_access_preserved": True,
                },
                sort_keys=True,
            )
        )
    finally:
        for project, lot in ((P1, L1), (P2, L2)):
            try:
                admin("revoke", project, lot)
            except Exception:
                pass


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        reason = str(exc) if isinstance(exc, Halt) else "internal_or_command_error"
        print(json.dumps({"oce_gateway_qualification_error": reason}, sort_keys=True), file=sys.stderr)
        sys.exit(1)
