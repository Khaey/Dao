#!/usr/bin/env python3
"""Synthetic D.A.O -> OpenConstructionERP PoC.

Creates/reuses only one bounded synthetic namespace:
  project_code=DAO-POC-001
  WBS code=DAO-LOT-001
  activity codes=DAO-ACT-001..003

Uses the existing OCE demo manager only for this isolated PoC. Never logs
tokens, project UUIDs, response bodies, or user data. No D.A.O DB access.
"""
from __future__ import annotations

import json
import os
import resource
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = "http://127.0.0.1:8080"
PROJECT_CODE = "DAO-POC-001"
WBS_CODE = "DAO-LOT-001"
SCHEDULE_NAME = "DAO PoC Master Schedule"
DAO_PROJECT_ID = "11111111-1111-4111-8111-111111111111"
DAO_LOT_ID = "22222222-2222-4222-8222-222222222222"
ACTIVITIES = (
    {
        "activity_code": "DAO-ACT-001",
        "name": "Préparation synthétique",
        "start_date": "2026-10-15",
        "end_date": "2026-10-17",
        "duration_days": 3,
        "sort_order": 10,
    },
    {
        "activity_code": "DAO-ACT-002",
        "name": "Exécution synthétique",
        "start_date": "2026-10-18",
        "end_date": "2026-10-20",
        "duration_days": 3,
        "sort_order": 20,
    },
    {
        "activity_code": "DAO-ACT-003",
        "name": "Contrôle synthétique",
        "start_date": "2026-10-21",
        "end_date": "2026-10-23",
        "duration_days": 3,
        "sort_order": 30,
    },
)


def emit(marker: str, **safe: object) -> None:
    print(marker + " " + json.dumps(safe, sort_keys=True, ensure_ascii=True))


def _uuid(value: object) -> str:
    return str(uuid.UUID(str(value)))


def _rows(body: object) -> list[dict]:
    if isinstance(body, list):
        return [x for x in body if isinstance(x, dict)]
    if isinstance(body, dict):
        for key in ("items", "data", "results"):
            value = body.get(key)
            if isinstance(value, list):
                return [x for x in value if isinstance(x, dict)]
    return []


def _metadata(row: dict) -> dict:
    """Accept OCE response keys serialized as either metadata or metadata_."""
    value = row.get("metadata")
    if not isinstance(value, dict):
        value = row.get("metadata_")
    return value if isinstance(value, dict) else {}


def _memory_available_mib() -> int | None:
    try:
        with open("/proc/meminfo", encoding="utf-8") as stream:
            for line in stream:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) // 1024
    except Exception:
        pass
    return None


def _loadavg1() -> float | None:
    try:
        return round(os.getloadavg()[0], 2)
    except Exception:
        return None


class Client:
    def __init__(self, base: str = BASE):
        parsed = urllib.parse.urlsplit(base)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise ValueError("PoC client requires loopback OCE")
        self.base = base.rstrip("/")
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        body: dict | None = None,
        expected: tuple[int, ...] = (200,),
    ) -> object:
        if not path.startswith("/api/"):
            raise ValueError("API path required")
        url = self.base + path
        headers = {"Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=12) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise RuntimeError("OCE response too large")
                if response.status not in expected:
                    raise RuntimeError(f"unexpected OCE status {response.status}")
                if not raw:
                    return None
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            status = exc.code
            exc.close()
            raise RuntimeError(f"OCE request failed status={status}") from None
        except (urllib.error.URLError, TimeoutError):
            raise RuntimeError("OCE transport failure") from None

    def demo_manager_token(self) -> str:
        body = self.request(
            "POST",
            "/api/v1/users/auth/demo-login/",
            body={"email": "manager@openconstructionerp.com"},
            expected=(200,),
        )
        if not isinstance(body, dict):
            raise RuntimeError("unexpected login response")
        token = body.get("access_token")
        if not isinstance(token, str) or len(token) < 20:
            raise RuntimeError("manager demo token unavailable")
        return token


def _assert_exactly_one(rows: list[dict], *, label: str) -> dict | None:
    if len(rows) > 1:
        raise RuntimeError(f"duplicate {label} in bounded PoC namespace")
    return rows[0] if rows else None


def ensure_project(client: Client, token: str) -> tuple[dict, bool]:
    projects = _rows(client.request("GET", "/api/v1/projects/?limit=500&status=all", token=token))
    matches = [p for p in projects if p.get("project_code") == PROJECT_CODE]
    project = _assert_exactly_one(matches, label="project")
    created = False
    if project is None:
        project = client.request(
            "POST",
            "/api/v1/projects/",
            token=token,
            body={
                "name": "D.A.O OCE PoC 001",
                "description": "Projet strictement synthétique pour valider l'intégration D.A.O vers OCE.",
                "region": "Tunisia",
                "classification_standard": "custom",
                "currency": "TND",
                "locale": "fr",
                "project_code": PROJECT_CODE,
                "project_type": "dao_poc",
                "country_code": "TN",
                "planned_start_date": "2026-10-15",
                "planned_end_date": "2026-10-31",
                "custom_fields": {
                    "dao_poc": True,
                    "dao_project_id": DAO_PROJECT_ID,
                },
            },
            expected=(201,),
        )
        if not isinstance(project, dict):
            raise RuntimeError("unexpected project create response")
        created = True
    if project.get("project_code") != PROJECT_CODE:
        raise RuntimeError("project namespace mismatch")
    custom = project.get("custom_fields") or {}
    if isinstance(custom, dict):
        ext = custom.get("dao_project_id")
        if ext not in (None, DAO_PROJECT_ID):
            raise RuntimeError("project external mapping mismatch")
    _uuid(project.get("id"))
    return project, created


def ensure_wbs(client: Client, token: str, project_id: str) -> tuple[dict, bool]:
    path = f"/api/v1/projects/{project_id}/wbs/"
    rows = _rows(client.request("GET", path, token=token))
    matches = [w for w in rows if w.get("code") == WBS_CODE]
    node = _assert_exactly_one(matches, label="WBS")
    created = False
    if node is None:
        node = client.request(
            "POST",
            path,
            token=token,
            body={
                "code": WBS_CODE,
                "name": "Lot synthétique D.A.O",
                "level": 0,
                "sort_order": 10,
                "wbs_type": "work",
                "metadata": {
                    "dao_poc": True,
                    "dao_lot_id": DAO_LOT_ID,
                },
            },
            expected=(201,),
        )
        if not isinstance(node, dict):
            raise RuntimeError("unexpected WBS create response")
        created = True
    metadata = _metadata(node)
    if metadata.get("dao_lot_id") != DAO_LOT_ID:
        raise RuntimeError("WBS mapping mismatch")
    _uuid(node.get("id"))
    return node, created


def ensure_schedule(client: Client, token: str, project_id: str) -> tuple[dict, bool]:
    query = urllib.parse.urlencode({"project_id": project_id, "limit": 100})
    body = client.request("GET", f"/api/v1/schedule/schedules/?{query}", token=token)
    schedules = _rows(body)
    matches = [
        s for s in schedules
        if s.get("name") == SCHEDULE_NAME
        and _metadata(s).get("dao_project_id") == DAO_PROJECT_ID
    ]
    schedule = _assert_exactly_one(matches, label="schedule")
    created = False
    if schedule is None:
        schedule = client.request(
            "POST",
            "/api/v1/schedule/schedules/",
            token=token,
            body={
                "project_id": project_id,
                "name": SCHEDULE_NAME,
                "schedule_type": "master",
                "description": "Planning synthétique du PoC D.A.O/OCE.",
                "start_date": "2026-10-15",
                "end_date": "2026-10-31",
                "metadata": {
                    "dao_poc": True,
                    "dao_project_id": DAO_PROJECT_ID,
                },
            },
            expected=(201,),
        )
        if not isinstance(schedule, dict):
            raise RuntimeError("unexpected schedule create response")
        created = True
    _uuid(schedule.get("id"))
    return schedule, created


def ensure_activities(client: Client, token: str, schedule_id: str) -> tuple[dict[str, dict], int]:
    path = f"/api/v1/schedule/schedules/{schedule_id}/activities/"
    existing = _rows(client.request("GET", path + "?limit=5000", token=token))
    by_code: dict[str, list[dict]] = {}
    for row in existing:
        code = row.get("activity_code")
        if isinstance(code, str) and code.startswith("DAO-ACT-"):
            by_code.setdefault(code, []).append(row)

    results: dict[str, dict] = {}
    created_count = 0
    for spec in ACTIVITIES:
        code = spec["activity_code"]
        row = _assert_exactly_one(by_code.get(code, []), label=f"activity {code}")
        if row is None:
            row = client.request(
                "POST",
                path,
                token=token,
                body={
                    **spec,
                    "description": "Activité synthétique D.A.O/OCE.",
                    "wbs_code": WBS_CODE,
                    "status": "not_started",
                    "activity_type": "task",
                    "metadata": {
                        "dao_poc": True,
                        "dao_activity_code": code,
                        "dao_lot_id": DAO_LOT_ID,
                    },
                },
                expected=(201,),
            )
            if not isinstance(row, dict):
                raise RuntimeError("unexpected activity create response")
            created_count += 1
        # On the deployed OCE 17.7.0 image, activity metadata is not
        # reliably round-tripped by this endpoint. The stable synthetic
        # activity_code is therefore the PoC identity key. If OCE does return
        # a mapping marker, still fail closed on a conflicting value.
        metadata = _metadata(row)
        mapped_code = metadata.get("dao_activity_code")
        if mapped_code not in (None, code):
            raise RuntimeError(f"activity mapping conflict {code}")
        _uuid(row.get("id"))
        results[code] = row

    target_codes = {x["activity_code"] for x in ACTIVITIES}
    extras = [
        row for row in existing
        if isinstance(row.get("activity_code"), str)
        and row["activity_code"].startswith("DAO-ACT-")
        and row["activity_code"] not in target_codes
    ]
    if extras:
        raise RuntimeError("unexpected extra DAO PoC activities")
    return results, created_count


def ensure_relationships(client: Client, token: str, schedule_id: str, acts: dict[str, dict]) -> None:
    path = f"/api/v1/schedule/schedules/{schedule_id}/relationships/"
    pairs = (("DAO-ACT-001", "DAO-ACT-002"), ("DAO-ACT-002", "DAO-ACT-003"))
    for pred, succ in pairs:
        client.request(
            "POST",
            path,
            token=token,
            body={
                "predecessor_id": _uuid(acts[pred]["id"]),
                "successor_id": _uuid(acts[succ]["id"]),
                "relationship_type": "FS",
                "lag_days": 0,
            },
            expected=(201,),
        )
    rels = _rows(client.request("GET", path, token=token))
    target_ids = {_uuid(v["id"]) for v in acts.values()}
    scoped = [
        r for r in rels
        if str(r.get("predecessor_id")) in target_ids and str(r.get("successor_id")) in target_ids
    ]
    if len(scoped) != 2:
        raise RuntimeError("relationship cardinality mismatch")


def calculate_cpm(client: Client, token: str, schedule_id: str) -> tuple[int, int]:
    body = client.request(
        "POST",
        f"/api/v1/schedule/schedules/{schedule_id}/calculate-cpm/",
        token=token,
        body={},
        expected=(200,),
    )
    if not isinstance(body, dict):
        raise RuntimeError("unexpected CPM response")
    all_activities = body.get("all_activities")
    critical = body.get("critical_path")
    if not isinstance(all_activities, list) or len(all_activities) != 3:
        raise RuntimeError("CPM activity count mismatch")
    if not isinstance(critical, list) or not critical:
        raise RuntimeError("CPM critical path missing")
    duration = body.get("project_duration_days")
    if not isinstance(duration, int) or duration < 1:
        raise RuntimeError("CPM duration invalid")
    return duration, len(critical)


def execute_once(client: Client, token: str) -> dict[str, object]:
    project, project_created = ensure_project(client, token)
    project_id = _uuid(project["id"])
    _wbs, wbs_created = ensure_wbs(client, token, project_id)
    schedule, schedule_created = ensure_schedule(client, token, project_id)
    schedule_id = _uuid(schedule["id"])
    acts, activity_created_count = ensure_activities(client, token, schedule_id)
    ensure_relationships(client, token, schedule_id, acts)
    duration, critical_count = calculate_cpm(client, token, schedule_id)
    return {
        "project_created": project_created,
        "wbs_created": wbs_created,
        "schedule_created": schedule_created,
        "activities_created": activity_created_count,
        "activity_count": 3,
        "relationship_count": 2,
        "cpm_duration_days": duration,
        "critical_count": critical_count,
    }


def main() -> None:
    started = time.monotonic()
    before_mem = _memory_available_mib()
    before_load = _loadavg1()
    client = Client()
    token = client.demo_manager_token()
    first = execute_once(client, token)
    second = execute_once(client, token)

    if second["project_created"] or second["wbs_created"] or second["schedule_created"] or second["activities_created"]:
        raise RuntimeError("second pass was not idempotent")

    emit("OCE_POC_FIRST", **first)
    emit(
        "OCE_POC_SECOND",
        idempotent=True,
        project_created=second["project_created"],
        wbs_created=second["wbs_created"],
        schedule_created=second["schedule_created"],
        activities_created=second["activities_created"],
        activity_count=second["activity_count"],
        relationship_count=second["relationship_count"],
        cpm_duration_days=second["cpm_duration_days"],
        critical_count=second["critical_count"],
    )
    emit(
        "OCE_POC_METRICS",
        elapsed_seconds=round(time.monotonic() - started, 2),
        mem_available_before_mib=before_mem,
        mem_available_after_mib=_memory_available_mib(),
        loadavg1_before=before_load,
        loadavg1_after=_loadavg1(),
        self_max_rss_kib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    )
    print("OCE_POC_COMPLETE=true")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        safe = str(exc)
        if len(safe) > 160:
            safe = safe[:160]
        emit("OCE_POC_FAILED", error=safe)
        raise SystemExit(1)
