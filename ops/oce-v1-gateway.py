#!/usr/bin/python3 -I
"""Private deny-by-default D.A.O -> OCE gateway for issue #58.

The service exposes a small HTTP interface on a Unix socket. The only accepted
peer is the real D.A.O runtime uid. OCE credentials never cross the socket.

Administrative authorize/revoke commands are root-only and create the explicit
D.A.O project/lot admission record required before any OCE object may exist.
"""

from __future__ import annotations

import fcntl
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler
import json
import os
from pathlib import Path
import re
import socket
import socketserver
import stat
import struct
import sys
import tempfile
import time
from datetime import date
from urllib.parse import urlencode
import uuid

SOCKET_PATH = Path("/run/dao-oce-gateway/gateway.sock")
STATE_DIR = Path("/var/lib/dao-oce-gateway")
STATE_FILE = STATE_DIR / "state.json"
LOCK_FILE = STATE_DIR / "state.lock"
SECRET_FILE = Path("/etc/dao-oce/private/gateway-credential.json")
DAO_USER = "dao"
GATEWAY_USER = "dao-oce-gateway"
OCE_HOST = "127.0.0.1"
OCE_PORT = 8080
MAX_REQUEST = 32768
MAX_RESPONSE = 1024 * 1024
MAX_MAPPINGS = 256
MAX_WBS = 256
MAX_ACTIVITIES = 2000
CODE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,49}$")
STATUS_VALUES = {"not_started", "in_progress", "completed", "delayed"}
ACTIVITY_TYPES = {"task", "milestone", "summary"}
RELATIONSHIP_TYPES = {"FS", "FF", "SS", "SF"}


class SafeError(Exception):
    """Safe, fixed-category error suitable for a client response."""

    def __init__(self, status: int, code: str):
        super().__init__(code)
        self.status = status
        self.code = code


class AmbiguousWrite(Exception):
    """Transport failed after a write may have reached OCE."""


def user_ids(name: str) -> tuple[int, int]:
    import pwd

    row = pwd.getpwnam(name)
    return row.pw_uid, row.pw_gid


def canonical_uuid(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise SafeError(400, "invalid_" + field)
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError) as exc:
        raise SafeError(400, "invalid_" + field) from exc


def short_text(value: object, field: str, max_length: int, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise SafeError(400, "invalid_" + field)
    value = value.strip()
    if (not allow_empty and not value) or len(value) > max_length:
        raise SafeError(400, "invalid_" + field)
    if "<" in value or ">" in value:
        raise SafeError(400, "invalid_" + field)
    return value


def iso_date(value: object, field: str) -> str:
    if not isinstance(value, str) or len(value) != 10:
        raise SafeError(400, "invalid_" + field)
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise SafeError(400, "invalid_" + field) from exc
    return parsed.isoformat()


def exact_body(body: object, allowed: set[str], required: set[str]) -> dict:
    if not isinstance(body, dict):
        raise SafeError(400, "invalid_json_object")
    keys = set(body)
    if keys - allowed:
        raise SafeError(400, "extra_fields")
    if required - keys:
        raise SafeError(400, "missing_fields")
    return body


def mapping_key(project_id: str, lot_id: str) -> str:
    return project_id + ":" + lot_id


def stable_token(project_id: str, lot_id: str, length: int = 24) -> str:
    raw = (project_id + ":" + lot_id).encode()
    return hashlib.sha256(raw).hexdigest()[:length]


def project_code(project_id: str, lot_id: str) -> str:
    return "DAO-" + stable_token(project_id, lot_id, 28).upper()


def schedule_name(project_id: str, lot_id: str) -> str:
    return "DAO Planning " + stable_token(project_id, lot_id, 20).upper()


def initial_state() -> dict:
    return {"version": 1, "mappings": {}}


def validate_state_shape(state: object) -> dict:
    if not isinstance(state, dict) or state.get("version") != 1:
        raise SafeError(500, "gateway_state_invalid")
    mappings = state.get("mappings")
    if not isinstance(mappings, dict) or len(mappings) > MAX_MAPPINGS:
        raise SafeError(500, "gateway_state_invalid")
    return state


def ensure_state_dir() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    uid, gid = user_ids(GATEWAY_USER)
    if os.geteuid() == 0:
        os.chown(STATE_DIR, uid, gid)
    os.chmod(STATE_DIR, 0o700)
    meta = STATE_DIR.lstat()
    if not stat.S_ISDIR(meta.st_mode) or meta.st_uid != uid or meta.st_mode & 0o077:
        raise SafeError(500, "gateway_state_directory_unsafe")


def load_state() -> dict:
    if not STATE_FILE.exists():
        return initial_state()
    uid, _ = user_ids(GATEWAY_USER)
    meta = STATE_FILE.lstat()
    if (
        not stat.S_ISREG(meta.st_mode)
        or meta.st_uid != uid
        or meta.st_mode & 0o077
        or meta.st_size > 2 * 1024 * 1024
    ):
        raise SafeError(500, "gateway_state_file_unsafe")
    try:
        state = json.loads(STATE_FILE.read_text())
    except Exception as exc:
        raise SafeError(500, "gateway_state_invalid") from exc
    return validate_state_shape(state)


def save_state(state: dict) -> None:
    validate_state_shape(state)
    ensure_state_dir()
    uid, gid = user_ids(GATEWAY_USER)
    fd, name = tempfile.mkstemp(prefix=".state-", dir=STATE_DIR)
    try:
        with os.fdopen(fd, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            if os.geteuid() == 0:
                os.fchown(stream.fileno(), uid, gid)
            json.dump(state, stream, separators=(",", ":"), sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, STATE_FILE)
    finally:
        if os.path.exists(name):
            os.unlink(name)


class StateLock:
    def __enter__(self):
        ensure_state_dir()
        self.stream = open(LOCK_FILE, "a+")
        uid, gid = user_ids(GATEWAY_USER)
        try:
            os.fchmod(self.stream.fileno(), 0o600)
            if os.geteuid() == 0:
                os.fchown(self.stream.fileno(), uid, gid)
        except PermissionError:
            pass
        fcntl.flock(self.stream, fcntl.LOCK_EX)
        return self

    def __exit__(self, exc_type, exc, tb):
        fcntl.flock(self.stream, fcntl.LOCK_UN)
        self.stream.close()


def read_credential() -> dict:
    meta = SECRET_FILE.lstat()
    gateway_uid, gateway_gid = user_ids(GATEWAY_USER)
    if (
        not stat.S_ISREG(meta.st_mode)
        or meta.st_uid != 0
        or meta.st_gid != gateway_gid
        or meta.st_mode & 0o007
        or meta.st_mode & 0o020
        or meta.st_size > 8192
    ):
        raise SafeError(500, "gateway_credential_unsafe")
    try:
        data = json.loads(SECRET_FILE.read_text())
    except Exception as exc:
        raise SafeError(500, "gateway_credential_invalid") from exc
    if (
        not isinstance(data, dict)
        or data.get("email") != "dao-oce-gateway@logiclab.fr"
        or not isinstance(data.get("password"), str)
        or len(data["password"]) < 12
        or not isinstance(data.get("user_id"), str)
        or data.get("qualified") is not True
    ):
        raise SafeError(500, "gateway_credential_invalid")
    try:
        uuid.UUID(data["user_id"])
    except ValueError as exc:
        raise SafeError(500, "gateway_credential_invalid") from exc
    # Silence linter-style concern: service uid itself must never own the secret.
    if meta.st_uid == gateway_uid:
        raise SafeError(500, "gateway_credential_unsafe")
    return data


class OCEClient:
    def __init__(self, credential: dict):
        self.credential = credential
        self.token: str | None = None

    def request(self, method: str, path: str, payload=None, *, timeout: int = 10) -> tuple[int, object]:
        raw = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            raw = json.dumps(payload, separators=(",", ":")).encode()
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        conn = http.client.HTTPConnection(OCE_HOST, OCE_PORT, timeout=timeout)
        try:
            conn.request(method, path, body=raw, headers=headers)
            response = conn.getresponse()
            data = response.read(MAX_RESPONSE + 1)
            if len(data) > MAX_RESPONSE:
                raise SafeError(502, "oce_response_too_large")
            parsed = None
            if data:
                try:
                    parsed = json.loads(data)
                except json.JSONDecodeError:
                    parsed = None
            return response.status, parsed
        except SafeError:
            raise
        except (OSError, TimeoutError, http.client.HTTPException) as exc:
            if method in {"POST", "PATCH", "PUT", "DELETE"}:
                raise AmbiguousWrite() from exc
            raise SafeError(502, "oce_transport_failure") from exc
        finally:
            conn.close()

    def login(self) -> None:
        status, data = self.request(
            "POST",
            "/api/v1/users/auth/login",
            {
                "email": self.credential["email"],
                "password": self.credential["password"],
            },
        )
        if status != 200 or not isinstance(data, dict) or not isinstance(data.get("access_token"), str):
            raise SafeError(502, "oce_login_failed")
        self.token = data["access_token"]
        status, me = self.request("GET", "/api/v1/users/me/")
        if (
            status != 200
            or not isinstance(me, dict)
            or me.get("id") != self.credential["user_id"]
            or me.get("role") != "editor"
            or me.get("is_active") is not True
        ):
            self.token = None
            raise SafeError(502, "oce_identity_mismatch")

    def expect(self, method: str, path: str, statuses: set[int], payload=None, *, timeout: int = 10):
        status, data = self.request(method, path, payload, timeout=timeout)
        if status == 401:
            raise SafeError(502, "oce_session_rejected")
        if status == 403:
            raise SafeError(502, "oce_permission_rejected")
        if status not in statuses:
            raise SafeError(502, "oce_operation_rejected")
        return data


def parse_json_request(handler: BaseHTTPRequestHandler) -> dict:
    raw_len = handler.headers.get("Content-Length")
    if raw_len is None:
        raise SafeError(411, "content_length_required")
    try:
        length = int(raw_len)
    except ValueError as exc:
        raise SafeError(400, "invalid_content_length") from exc
    if length < 0 or length > MAX_REQUEST:
        raise SafeError(413, "request_too_large")
    raw = handler.rfile.read(length)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SafeError(400, "invalid_json") from exc
    if not isinstance(data, dict):
        raise SafeError(400, "invalid_json_object")
    return data


def mapping_for(state: dict, body: dict) -> tuple[str, dict]:
    project_id = canonical_uuid(body.get("dao_project_id"), "dao_project_id")
    lot_id = canonical_uuid(body.get("dao_lot_id"), "dao_lot_id")
    key = mapping_key(project_id, lot_id)
    row = state["mappings"].get(key)
    if not isinstance(row, dict) or row.get("authorized") is not True or row.get("revoked") is True:
        raise SafeError(403, "mapping_not_authorized")
    if row.get("dao_project_id") != project_id or row.get("dao_lot_id") != lot_id:
        raise SafeError(500, "gateway_state_invalid")
    return key, row


class Gateway:
    def __init__(self):
        self.credential = read_credential()

    def client(self) -> OCEClient:
        client = OCEClient(self.credential)
        client.login()
        return client

    def oce_project(self, client: OCEClient, row: dict) -> dict:
        value = row.get("oce_project_id")
        if not isinstance(value, str):
            raise SafeError(409, "project_not_ensured")
        data = client.expect("GET", "/api/v1/projects/" + value, {200})
        if (
            not isinstance(data, dict)
            or data.get("id") != value
            or data.get("owner_id") != self.credential["user_id"]
            or data.get("project_code") != project_code(row["dao_project_id"], row["dao_lot_id"])
        ):
            raise SafeError(409, "project_ownership_mismatch")
        return data

    def list_projects(self, client: OCEClient) -> list[dict]:
        data = client.expect("GET", "/api/v1/projects/?limit=500&status=all", {200})
        if not isinstance(data, list):
            raise SafeError(502, "oce_response_shape")
        return [x for x in data if isinstance(x, dict)]

    def reconcile_project(self, client: OCEClient, row: dict) -> dict | None:
        expected = project_code(row["dao_project_id"], row["dao_lot_id"])
        matches = [
            p
            for p in self.list_projects(client)
            if p.get("project_code") == expected and p.get("owner_id") == self.credential["user_id"]
        ]
        if len(matches) > 1:
            raise SafeError(409, "project_identity_ambiguous")
        return matches[0] if matches else None

    def ensure_project(self, state: dict, row: dict, body: dict) -> dict:
        exact_body(
            body,
            {"dao_project_id", "dao_lot_id", "name", "description", "region", "currency"},
            {"dao_project_id", "dao_lot_id", "name", "region", "currency"},
        )
        name = short_text(body["name"], "name", 255)
        description = short_text(body.get("description", ""), "description", 2000, allow_empty=True)
        region = short_text(body["region"], "region", 100)
        currency = short_text(body["currency"], "currency", 10).upper()
        client = self.client()

        if isinstance(row.get("oce_project_id"), str):
            self.oce_project(client, row)
            return {"ok": True, "created": False}

        found = self.reconcile_project(client, row)
        if found is None:
            payload = {
                "name": name,
                "description": description,
                "region": region,
                "currency": currency,
                "locale": "fr",
                "project_code": project_code(row["dao_project_id"], row["dao_lot_id"]),
                "validation_rule_sets": ["boq_quality"],
                "compliance_rule_packs": ["universal"],
            }
            try:
                data = client.expect("POST", "/api/v1/projects/", {201}, payload)
            except AmbiguousWrite:
                data = self.reconcile_project(client, row)
                if data is None:
                    raise SafeError(502, "oce_write_ambiguous")
            if not isinstance(data, dict):
                raise SafeError(502, "oce_response_shape")
            created = True
        else:
            data = found
            created = False

        if (
            not isinstance(data.get("id"), str)
            or data.get("owner_id") != self.credential["user_id"]
            or data.get("project_code") != project_code(row["dao_project_id"], row["dao_lot_id"])
        ):
            raise SafeError(409, "project_ownership_mismatch")
        row["oce_project_id"] = data["id"]
        return {"ok": True, "created": created}

    def list_wbs(self, client: OCEClient, project_id: str) -> list[dict]:
        data = client.expect("GET", "/api/v1/projects/" + project_id + "/wbs/", {200})
        if not isinstance(data, list) or len(data) > MAX_WBS:
            raise SafeError(502, "oce_response_shape")
        return [x for x in data if isinstance(x, dict)]

    def ensure_wbs(self, state: dict, row: dict, body: dict) -> dict:
        exact_body(
            body,
            {"dao_project_id", "dao_lot_id", "code", "name"},
            {"dao_project_id", "dao_lot_id", "code", "name"},
        )
        code = short_text(body["code"], "code", 50)
        if not CODE_RE.fullmatch(code):
            raise SafeError(400, "invalid_code")
        name = short_text(body["name"], "name", 255)
        client = self.client()
        project = self.oce_project(client, row)
        project_id = project["id"]
        nodes = self.list_wbs(client, project_id)
        matches = [n for n in nodes if n.get("code") == code]
        if len(matches) > 1:
            raise SafeError(409, "wbs_identity_ambiguous")
        wbs = row.setdefault("wbs", {})
        mapped_id = wbs.get(code)
        if mapped_id is not None:
            matches = [n for n in nodes if n.get("id") == mapped_id and n.get("code") == code]
            if len(matches) != 1 or matches[0].get("project_id") != project_id:
                raise SafeError(409, "wbs_ownership_mismatch")
            return {"ok": True, "created": False, "code": code}
        if matches:
            node = matches[0]
            if node.get("project_id") != project_id:
                raise SafeError(409, "wbs_ownership_mismatch")
            created = False
        else:
            payload = {
                "code": code,
                "name": name,
                "level": 0,
                "sort_order": len(nodes),
                "wbs_type": "cost",
                "metadata": {"source": "dao_gateway"},
            }
            try:
                node = client.expect("POST", "/api/v1/projects/" + project_id + "/wbs/", {201}, payload)
            except AmbiguousWrite:
                nodes = self.list_wbs(client, project_id)
                matches = [n for n in nodes if n.get("code") == code]
                if len(matches) != 1:
                    raise SafeError(502, "oce_write_ambiguous")
                node = matches[0]
            created = True
        if (
            not isinstance(node, dict)
            or not isinstance(node.get("id"), str)
            or node.get("project_id") != project_id
            or node.get("code") != code
        ):
            raise SafeError(409, "wbs_ownership_mismatch")
        wbs[code] = node["id"]
        return {"ok": True, "created": created, "code": code}

    def list_schedules(self, client: OCEClient, project_id: str) -> list[dict]:
        query = urlencode({"project_id": project_id, "limit": 100, "archive_state": "current"})
        data = client.expect("GET", "/api/v1/schedule/schedules/?" + query, {200})
        if not isinstance(data, dict) or not isinstance(data.get("items"), list):
            raise SafeError(502, "oce_response_shape")
        if int(data.get("total", len(data["items"]))) > 100:
            raise SafeError(409, "schedule_inventory_too_large")
        return [x for x in data["items"] if isinstance(x, dict)]

    def schedule(self, client: OCEClient, row: dict) -> dict:
        schedule_id = row.get("schedule_id")
        if not isinstance(schedule_id, str):
            raise SafeError(409, "schedule_not_ensured")
        project = self.oce_project(client, row)
        data = client.expect("GET", "/api/v1/schedule/schedules/" + schedule_id, {200})
        if not isinstance(data, dict) or data.get("id") != schedule_id or data.get("project_id") != project["id"]:
            raise SafeError(409, "schedule_ownership_mismatch")
        return data

    def ensure_schedule(self, state: dict, row: dict, body: dict) -> dict:
        exact_body(
            body,
            {"dao_project_id", "dao_lot_id", "start_date", "end_date"},
            {"dao_project_id", "dao_lot_id", "start_date", "end_date"},
        )
        start = iso_date(body["start_date"], "start_date")
        end = iso_date(body["end_date"], "end_date")
        if end < start:
            raise SafeError(400, "invalid_date_range")
        client = self.client()
        project = self.oce_project(client, row)
        project_id = project["id"]
        expected_name = schedule_name(row["dao_project_id"], row["dao_lot_id"])

        if isinstance(row.get("schedule_id"), str):
            sched = self.schedule(client, row)
            created = False
        else:
            schedules = self.list_schedules(client, project_id)
            matches = [s for s in schedules if s.get("name") == expected_name]
            if len(matches) > 1:
                raise SafeError(409, "schedule_identity_ambiguous")
            if matches:
                sched = matches[0]
                created = False
            else:
                payload = {
                    "project_id": project_id,
                    "name": expected_name,
                    "schedule_type": "master",
                    "description": "D.A.O bounded planning schedule",
                    "start_date": start,
                    "end_date": end,
                    "metadata": {"source": "dao_gateway"},
                }
                try:
                    sched = client.expect("POST", "/api/v1/schedule/schedules/", {201}, payload)
                except AmbiguousWrite:
                    matches = [
                        s for s in self.list_schedules(client, project_id) if s.get("name") == expected_name
                    ]
                    if len(matches) != 1:
                        raise SafeError(502, "oce_write_ambiguous")
                    sched = matches[0]
                created = True

        if (
            not isinstance(sched, dict)
            or not isinstance(sched.get("id"), str)
            or sched.get("project_id") != project_id
            or sched.get("name") != expected_name
        ):
            raise SafeError(409, "schedule_ownership_mismatch")
        row["schedule_id"] = sched["id"]

        if sched.get("start_date") != start or sched.get("end_date") != end:
            patch = {"start_date": start, "end_date": end}
            try:
                updated = client.expect(
                    "PATCH",
                    "/api/v1/schedule/schedules/" + sched["id"],
                    {200},
                    patch,
                )
            except AmbiguousWrite:
                updated = client.expect("GET", "/api/v1/schedule/schedules/" + sched["id"], {200})
            if (
                not isinstance(updated, dict)
                or updated.get("project_id") != project_id
                or updated.get("start_date") != start
                or updated.get("end_date") != end
            ):
                raise SafeError(502, "oce_write_ambiguous")
        return {"ok": True, "created": created}

    def list_activities(self, client: OCEClient, schedule_id: str) -> list[dict]:
        data = client.expect(
            "GET",
            "/api/v1/schedule/schedules/" + schedule_id + "/activities/?offset=0&limit=2000",
            {200},
        )
        if not isinstance(data, dict) or not isinstance(data.get("items"), list):
            raise SafeError(502, "oce_response_shape")
        if int(data.get("total", len(data["items"]))) > MAX_ACTIVITIES:
            raise SafeError(409, "activity_inventory_too_large")
        return [x for x in data["items"] if isinstance(x, dict)]

    def activity_payload(self, row: dict, body: dict) -> tuple[str, dict]:
        code = short_text(body["activity_code"], "activity_code", 50)
        if not CODE_RE.fullmatch(code):
            raise SafeError(400, "invalid_activity_code")
        name = short_text(body["name"], "name", 255)
        start = iso_date(body["start_date"], "start_date")
        end = iso_date(body["end_date"], "end_date")
        if end < start:
            raise SafeError(400, "invalid_date_range")
        status = body.get("status", "not_started")
        if status not in STATUS_VALUES:
            raise SafeError(400, "invalid_status")
        activity_type = body.get("activity_type", "task")
        if activity_type not in ACTIVITY_TYPES:
            raise SafeError(400, "invalid_activity_type")
        progress = body.get("progress_pct", 0.0)
        if isinstance(progress, bool) or not isinstance(progress, (int, float)) or not 0 <= float(progress) <= 100:
            raise SafeError(400, "invalid_progress_pct")
        description = short_text(body.get("description", ""), "description", 2000, allow_empty=True)
        wbs_code = body.get("wbs_code", "")
        if wbs_code:
            wbs_code = short_text(wbs_code, "wbs_code", 50)
            if wbs_code not in row.get("wbs", {}):
                raise SafeError(400, "wbs_not_authorized")
        payload = {
            "name": name,
            "description": description,
            "wbs_code": wbs_code,
            "start_date": start,
            "end_date": end,
            "progress_pct": float(progress),
            "status": status,
            "activity_type": activity_type,
            "activity_code": code,
        }
        return code, payload

    def upsert_activity(self, state: dict, row: dict, body: dict) -> dict:
        exact_body(
            body,
            {
                "dao_project_id",
                "dao_lot_id",
                "activity_code",
                "name",
                "description",
                "wbs_code",
                "start_date",
                "end_date",
                "progress_pct",
                "status",
                "activity_type",
            },
            {"dao_project_id", "dao_lot_id", "activity_code", "name", "start_date", "end_date"},
        )
        code, payload = self.activity_payload(row, body)
        client = self.client()
        schedule = self.schedule(client, row)
        schedule_id = schedule["id"]
        items = self.list_activities(client, schedule_id)
        matches = [a for a in items if a.get("activity_code") == code]
        if len(matches) > 1:
            raise SafeError(409, "activity_identity_ambiguous")
        activities = row.setdefault("activities", {})
        mapped = activities.get(code)
        if mapped is not None:
            matches = [a for a in items if a.get("id") == mapped and a.get("activity_code") == code]
            if len(matches) != 1:
                raise SafeError(409, "activity_ownership_mismatch")
            current = matches[0]
        elif matches:
            current = matches[0]
            if current.get("schedule_id") != schedule_id:
                raise SafeError(409, "activity_ownership_mismatch")
            activities[code] = current["id"]
        else:
            current = None

        if current is None:
            try:
                result = client.expect(
                    "POST",
                    "/api/v1/schedule/schedules/" + schedule_id + "/activities/",
                    {201},
                    payload,
                )
            except AmbiguousWrite:
                matches = [a for a in self.list_activities(client, schedule_id) if a.get("activity_code") == code]
                if len(matches) != 1:
                    raise SafeError(502, "oce_write_ambiguous")
                result = matches[0]
            created = True
        else:
            changed = any(current.get(k) != v for k, v in payload.items())
            if changed:
                try:
                    result = client.expect(
                        "PATCH",
                        "/api/v1/schedule/activities/" + current["id"],
                        {200},
                        payload,
                    )
                except AmbiguousWrite:
                    matches = [a for a in self.list_activities(client, schedule_id) if a.get("id") == current["id"]]
                    if len(matches) != 1:
                        raise SafeError(502, "oce_write_ambiguous")
                    result = matches[0]
                for k, v in payload.items():
                    if result.get(k) != v:
                        raise SafeError(502, "oce_write_ambiguous")
            else:
                result = current
            created = False

        if (
            not isinstance(result, dict)
            or not isinstance(result.get("id"), str)
            or result.get("schedule_id") != schedule_id
            or result.get("activity_code") != code
        ):
            raise SafeError(409, "activity_ownership_mismatch")
        activities[code] = result["id"]
        return {"ok": True, "created": created, "activity_code": code}

    def list_relationships(self, client: OCEClient, schedule_id: str) -> list[dict]:
        data = client.expect(
            "GET",
            "/api/v1/schedule/schedules/" + schedule_id + "/relationships/",
            {200},
        )
        if not isinstance(data, list):
            raise SafeError(502, "oce_response_shape")
        return [x for x in data if isinstance(x, dict)]

    def ensure_dependency(self, state: dict, row: dict, body: dict) -> dict:
        exact_body(
            body,
            {
                "dao_project_id",
                "dao_lot_id",
                "predecessor_activity_code",
                "successor_activity_code",
                "relationship_type",
                "lag_days",
            },
            {"dao_project_id", "dao_lot_id", "predecessor_activity_code", "successor_activity_code"},
        )
        pred_code = short_text(body["predecessor_activity_code"], "predecessor_activity_code", 50)
        succ_code = short_text(body["successor_activity_code"], "successor_activity_code", 50)
        if pred_code == succ_code:
            raise SafeError(400, "dependency_self_reference")
        relation_type = body.get("relationship_type", "FS")
        if relation_type not in RELATIONSHIP_TYPES:
            raise SafeError(400, "invalid_relationship_type")
        lag = body.get("lag_days", 0)
        if isinstance(lag, bool) or not isinstance(lag, int) or not -(2**31 - 1) <= lag <= 2**31 - 1:
            raise SafeError(400, "invalid_lag_days")
        activities = row.get("activities", {})
        pred_id = activities.get(pred_code)
        succ_id = activities.get(succ_code)
        if not isinstance(pred_id, str) or not isinstance(succ_id, str):
            raise SafeError(409, "dependency_activity_not_mapped")
        client = self.client()
        schedule = self.schedule(client, row)
        schedule_id = schedule["id"]
        visible = {a.get("id"): a for a in self.list_activities(client, schedule_id)}
        if (
            pred_id not in visible
            or succ_id not in visible
            or visible[pred_id].get("activity_code") != pred_code
            or visible[succ_id].get("activity_code") != succ_code
        ):
            raise SafeError(409, "activity_ownership_mismatch")
        relations = self.list_relationships(client, schedule_id)
        matches = [
            r for r in relations
            if r.get("predecessor_id") == pred_id and r.get("successor_id") == succ_id
        ]
        if len(matches) > 1:
            raise SafeError(409, "dependency_identity_ambiguous")
        payload = {
            "predecessor_id": pred_id,
            "successor_id": succ_id,
            "relationship_type": relation_type,
            "lag_days": lag,
        }
        if not matches:
            try:
                result = client.expect(
                    "POST",
                    "/api/v1/schedule/schedules/" + schedule_id + "/relationships/",
                    {201},
                    payload,
                )
            except AmbiguousWrite:
                matches = [
                    r for r in self.list_relationships(client, schedule_id)
                    if r.get("predecessor_id") == pred_id and r.get("successor_id") == succ_id
                ]
                if len(matches) != 1:
                    raise SafeError(502, "oce_write_ambiguous")
                result = matches[0]
            created, updated = True, False
        else:
            result = matches[0]
            created, updated = False, False
            if result.get("relationship_type") != relation_type or result.get("lag_days") != lag:
                try:
                    result = client.expect(
                        "PATCH",
                        "/api/v1/schedule/relationships/" + result["id"],
                        {200},
                        {"relationship_type": relation_type, "lag_days": lag},
                    )
                except AmbiguousWrite:
                    matches = [
                        r for r in self.list_relationships(client, schedule_id)
                        if r.get("predecessor_id") == pred_id and r.get("successor_id") == succ_id
                    ]
                    if len(matches) != 1:
                        raise SafeError(502, "oce_write_ambiguous")
                    result = matches[0]
                updated = True
        if (
            not isinstance(result, dict)
            or result.get("schedule_id") != schedule_id
            or result.get("predecessor_id") != pred_id
            or result.get("successor_id") != succ_id
            or result.get("relationship_type") != relation_type
            or result.get("lag_days") != lag
        ):
            raise SafeError(502, "oce_write_ambiguous")
        return {"ok": True, "created": created, "updated": updated}

    def calculate(self, state: dict, row: dict, body: dict) -> dict:
        exact_body(body, {"dao_project_id", "dao_lot_id"}, {"dao_project_id", "dao_lot_id"})
        client = self.client()
        schedule = self.schedule(client, row)
        try:
            result = client.expect(
                "POST",
                "/api/v1/schedule/schedules/" + schedule["id"] + "/calculate-cpm/",
                {200},
                timeout=30,
            )
        except AmbiguousWrite as exc:
            raise SafeError(502, "oce_write_ambiguous") from exc
        if not isinstance(result, dict) or not isinstance(result.get("project_duration_days"), int):
            raise SafeError(502, "oce_response_shape")
        reverse = {value: key for key, value in row.get("activities", {}).items()}
        critical_codes: list[str] = []
        for item in result.get("critical_path", []):
            if not isinstance(item, dict):
                raise SafeError(502, "oce_response_shape")
            code = reverse.get(item.get("activity_id"))
            if code is None:
                raise SafeError(409, "planning_contains_unmapped_activity")
            critical_codes.append(code)
        return {
            "ok": True,
            "project_duration_days": result["project_duration_days"],
            "critical_activity_codes": critical_codes,
        }

    def planning_summary(self, state: dict, row: dict, body: dict) -> dict:
        exact_body(body, {"dao_project_id", "dao_lot_id"}, {"dao_project_id", "dao_lot_id"})
        client = self.client()
        project = self.oce_project(client, row)
        self.schedule(client, row)
        query = urlencode({"project_id": project["id"]})
        data = client.expect("GET", "/api/v1/schedule/stats/?" + query, {200})
        if not isinstance(data, dict):
            raise SafeError(502, "oce_response_shape")
        allowed = {
            "total_activities",
            "critical_count",
            "on_track",
            "delayed",
            "completed",
            "not_started",
            "in_progress",
            "progress_pct",
            "total_duration_days",
        }
        result = {"ok": True}
        for key in allowed:
            value = data.get(key)
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise SafeError(502, "oce_response_shape")
            result[key] = value
        next_ms = data.get("next_milestone")
        if next_ms is None:
            result["next_milestone"] = None
        elif (
            isinstance(next_ms, dict)
            and isinstance(next_ms.get("name"), str)
            and isinstance(next_ms.get("date"), str)
        ):
            result["next_milestone"] = {
                "name": next_ms["name"][:255],
                "date": next_ms["date"][:20],
            }
        else:
            raise SafeError(502, "oce_response_shape")
        return result

    def handle(self, method: str, path: str, body: dict | None) -> dict:
        if method == "GET" and path == "/health":
            client = OCEClient(self.credential)
            status, data = client.request("GET", "/api/health")
            if status != 200 or not isinstance(data, dict) or data.get("status") != "healthy":
                raise SafeError(503, "oce_unhealthy")
            return {"ok": True, "gateway": "healthy", "oce": "healthy"}
        if method == "GET" and path == "/ready":
            client = self.client()
            return {"ok": True, "gateway": "ready", "identity": "editor"}

        operations = {
            "/v1/ensure-project": self.ensure_project,
            "/v1/ensure-wbs": self.ensure_wbs,
            "/v1/ensure-schedule": self.ensure_schedule,
            "/v1/upsert-activity": self.upsert_activity,
            "/v1/ensure-dependency": self.ensure_dependency,
            "/v1/calculate-planning": self.calculate,
            "/v1/planning-summary": self.planning_summary,
        }
        if method != "POST" or path not in operations:
            raise SafeError(404, "operation_not_allowed")
        if body is None:
            raise SafeError(400, "invalid_json_object")

        with StateLock():
            state = load_state()
            _, row = mapping_for(state, body)
            result = operations[path](state, row, body)
            save_state(state)
            return result


class GatewayServer(socketserver.UnixStreamServer):
    allow_reuse_address = True

    def server_bind(self):
        super().server_bind()
        _, dao_gid = user_ids(DAO_USER)
        os.chmod(SOCKET_PATH, 0o660)
        os.chown(SOCKET_PATH, -1, dao_gid)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "dao-oce-gateway"
    sys_version = ""

    def log_message(self, format, *args):
        return

    def peer_allowed(self) -> bool:
        try:
            raw = self.connection.getsockopt(
                socket.SOL_SOCKET,
                socket.SO_PEERCRED,
                struct.calcsize("3i"),
            )
            _pid, uid, _gid = struct.unpack("3i", raw)
            dao_uid, _ = user_ids(DAO_USER)
            return uid == dao_uid
        except Exception:
            return False

    def send_json(self, status: int, data: dict):
        raw = json.dumps(data, separators=(",", ":"), sort_keys=True).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def dispatch(self):
        started = time.monotonic()
        correlation = secrets_token()
        operation = self.path.split("?", 1)[0]
        if not self.peer_allowed():
            self.close_connection = True
            return
        try:
            path = operation
            body = None
            if self.command == "POST":
                body = parse_json_request(self)
            elif self.command != "GET":
                raise SafeError(404, "operation_not_allowed")
            result = self.server.gateway.handle(self.command, path, body)
            self.send_json(200, result)
            status_name = "ok"
        except SafeError as exc:
            self.send_json(exc.status, {"ok": False, "error": exc.code})
            status_name = exc.code
        except Exception:
            self.send_json(500, {"ok": False, "error": "gateway_internal_error"})
            status_name = "gateway_internal_error"
        duration_ms = int((time.monotonic() - started) * 1000)
        # Logs are deliberately body/id/name free.
        print(
            json.dumps(
                {
                    "operation": safe_operation_name(operation),
                    "result": status_name,
                    "duration_ms": duration_ms,
                    "correlation": correlation,
                },
                separators=(",", ":"),
                sort_keys=True,
            ),
            flush=True,
        )

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()


def secrets_token() -> str:
    return os.urandom(8).hex()


def safe_operation_name(path: str) -> str:
    return {
        "/health": "health",
        "/ready": "ready",
        "/v1/ensure-project": "ensure-project",
        "/v1/ensure-wbs": "ensure-wbs",
        "/v1/ensure-schedule": "ensure-schedule",
        "/v1/upsert-activity": "upsert-activity",
        "/v1/ensure-dependency": "ensure-dependency",
        "/v1/calculate-planning": "calculate-planning",
        "/v1/planning-summary": "planning-summary",
    }.get(path, "denied")


def authorize(project: str, lot: str) -> None:
    if os.geteuid() != 0:
        raise SafeError(500, "root_required")
    project_id = canonical_uuid(project, "dao_project_id")
    lot_id = canonical_uuid(lot, "dao_lot_id")
    with StateLock():
        state = load_state()
        key = mapping_key(project_id, lot_id)
        row = state["mappings"].get(key)
        if row is None:
            if len(state["mappings"]) >= MAX_MAPPINGS:
                raise SafeError(409, "mapping_limit")
            state["mappings"][key] = {
                "dao_project_id": project_id,
                "dao_lot_id": lot_id,
                "authorized": True,
                "revoked": False,
                "oce_project_id": None,
                "wbs": {},
                "schedule_id": None,
                "activities": {},
            }
            created = True
        else:
            if row.get("dao_project_id") != project_id or row.get("dao_lot_id") != lot_id:
                raise SafeError(500, "gateway_state_invalid")
            row["authorized"] = True
            row["revoked"] = False
            created = False
        save_state(state)
    print(json.dumps({"mapping_authorized": True, "created": created}, sort_keys=True))


def revoke(project: str, lot: str) -> None:
    if os.geteuid() != 0:
        raise SafeError(500, "root_required")
    project_id = canonical_uuid(project, "dao_project_id")
    lot_id = canonical_uuid(lot, "dao_lot_id")
    with StateLock():
        state = load_state()
        row = state["mappings"].get(mapping_key(project_id, lot_id))
        if not isinstance(row, dict):
            raise SafeError(404, "mapping_not_found")
        row["revoked"] = True
        row["authorized"] = False
        save_state(state)
    print(json.dumps({"mapping_revoked": True}, sort_keys=True))


def status() -> None:
    if os.geteuid() != 0:
        raise SafeError(500, "root_required")
    credential = read_credential()
    with StateLock():
        state = load_state()
    active = sum(
        1
        for row in state["mappings"].values()
        if isinstance(row, dict) and row.get("authorized") is True and row.get("revoked") is not True
    )
    print(
        json.dumps(
            {
                "gateway_state": "ready",
                "credential_qualified": credential.get("qualified") is True,
                "mapping_count": len(state["mappings"]),
                "active_mapping_count": active,
            },
            sort_keys=True,
        )
    )


def serve() -> None:
    if os.geteuid() == 0:
        raise SafeError(500, "gateway_must_not_run_as_root")
    uid, _ = user_ids(GATEWAY_USER)
    if os.geteuid() != uid:
        raise SafeError(500, "gateway_wrong_service_user")
    ensure_state_dir()
    read_credential()
    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)
    if SOCKET_PATH.exists():
        SOCKET_PATH.unlink()
    server = GatewayServer(str(SOCKET_PATH), Handler)
    server.gateway = Gateway()
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        if SOCKET_PATH.exists():
            SOCKET_PATH.unlink()


def main() -> None:
    if len(sys.argv) < 2:
        raise SafeError(500, "usage")
    op = sys.argv[1]
    if op == "serve" and len(sys.argv) == 2:
        serve()
    elif op == "authorize" and len(sys.argv) == 4:
        authorize(sys.argv[2], sys.argv[3])
    elif op == "revoke" and len(sys.argv) == 4:
        revoke(sys.argv[2], sys.argv[3])
    elif op == "status" and len(sys.argv) == 2:
        status()
    else:
        raise SafeError(500, "usage")


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except SafeError as exc:
        print(json.dumps({"oce_gateway_error": exc.code}, sort_keys=True), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print(json.dumps({"oce_gateway_error": "internal_or_command_error"}, sort_keys=True), file=sys.stderr)
        sys.exit(1)
