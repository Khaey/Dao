#!/usr/bin/env python3
"""Bounded OCE metadata audit over loopback; no credentials or business output.

Only POST: documented demo session issuance, once per non-admin demo identity.
All subsequent calls use an explicit GET allowlist. No generated API crawling.
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASES = ("http://127.0.0.1:8080", "http://127.0.0.1:8000")
LOGIN = "/api/v1/users/auth/demo-login/"
CONVERTERS = "/api/v1/takeoff/converters/"
FIXED_GETS = {
    "/api/health",
    "/openapi.json",
    "/openapi.json/",
    "/api/openapi.json",
    "/api/v1/users/me/",
    "/api/v1/projects/",
    CONVERTERS,
}
PROJECT_DETAIL_TEMPLATES = (
    "/api/v1/projects/{project_id}",
    "/api/v1/projects/{project_id}/",
)
PROJECT_GETS = {
    "wbs": "/api/v1/projects/{project_id}/wbs/",
    "schedule": "/api/v1/schedule/schedules/",
    "boq": "/api/v1/boq/boqs/",
    "bim": "/api/v1/bim-hub/",
    "cost_5d": "/api/v1/costmodel/projects/{project_id}/5d/snapshots/",
    "qaqc": "/api/v1/inspections/",
    "cde": "/api/v1/cde/containers/",
}
EXPECTED_DEMO_ROLES = {
    # Upstream v17.7.0 seeds this login with role="editor"; an older docstring
    # still calls it "estimator". Trust the actual seeder, not the stale prose.
    "estimator": "editor",
    "manager": "manager",
}


def emit(marker, **safe):
    print(marker + " " + json.dumps(safe, sort_keys=True))


def valid_id(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


def _template_matches(path, template):
    if "{project_id}" not in template:
        return path == template
    prefix, suffix = template.split("{project_id}")
    if not path.startswith(prefix) or not path.endswith(suffix):
        return False
    middle = path[len(prefix): len(path) - len(suffix) if suffix else None]
    return valid_id(middle) is not None


def allowed_get(path):
    path = urllib.parse.urlsplit(path).path
    if path in FIXED_GETS:
        return True
    return any(
        _template_matches(path, template)
        for template in (*PROJECT_DETAIL_TEMPLATES, *PROJECT_GETS.values())
    )


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class LocalClient:
    def __init__(self, base):
        if base not in BASES:
            raise ValueError("loopback origin required")
        self.base = base
        # Do not route bearer tokens through inherited HTTP_PROXY settings.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, path, token=None, demo_email=None):
        method = "POST" if demo_email is not None else "GET"
        if method == "POST":
            if path != LOGIN or demo_email not in (
                "estimator@openconstructionerp.com", "manager@openconstructionerp.com"
            ):
                raise ValueError("login outside allowlist")
        elif not allowed_get(path):
            raise ValueError("GET outside allowlist")
        url = self.base + path
        data = json.dumps({"email": demo_email}).encode() if demo_email else None
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        if data:
            headers["Content-Type"] = "application/json"
        for _ in range(4):
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with self.opener.open(req, timeout=6) as response:
                    # Public OpenAPI is large; private responses are limited separately.
                    cap = 16 * 1024 * 1024 if path in ("/openapi.json", "/api/openapi.json") else 256 * 1024
                    raw = response.read(cap + 1)
                    if len(raw) > cap:
                        return response.status, None, "oversize"
                    try:
                        body = json.loads(raw)
                    except (ValueError, UnicodeError):
                        return response.status, None, "not_json"
                    return response.status, body, "ok"
            except urllib.error.HTTPError as exc:
                location = exc.headers.get("Location", "")
                status = exc.code
                exc.close()
                if status not in (301, 302, 303, 307, 308):
                    return status, None, "http_error"
                newurl = urllib.parse.urljoin(url, location)
                target = urllib.parse.urlsplit(newurl)
                origin = urllib.parse.urlsplit(self.base)
                # Redirects may only add/remove a trailing slash on this same GET.
                # Never forward tokens to a new origin or another API operation.
                original = urllib.parse.urlsplit(self.base + path)
                if (
                    method != "GET"
                    or not location
                    or (target.scheme, target.netloc) != (origin.scheme, origin.netloc)
                    or target.path.rstrip("/") != original.path.rstrip("/")
                    or target.query != original.query
                    or target.fragment
                ):
                    return status, None, "redirect_blocked"
                url = newurl
            except Exception:
                # Exception text may contain tokens, URLs or response content.
                return 0, None, "transport_error"
        return 0, None, "redirect_limit"


def rows(body):
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        for key in ("items", "results", "data", "projects", "converters"):
            if isinstance(body.get(key), list):
                return body[key]
    return None


def project_ids(body):
    result = set()
    for row in rows(body) or ():
        if isinstance(row, dict):
            value = valid_id(row.get("id"))
            if value:
                result.add(value)
    return result


def read(client, label, path, token=None, account="anonymous"):
    status, body, outcome = client.request(path, token=token)
    items = rows(body)
    emit(
        "OCE_READ",
        account=account,
        check=label,
        status=status,
        outcome=outcome,
        shape="list" if isinstance(body, list) else "object" if isinstance(body, dict) else "none",
        count=len(items) if items is not None else None,
    )
    return status, body


def project_detail_template(paths):
    for template in PROJECT_DETAIL_TEMPLATES:
        if "get" in paths.get(template, {}):
            return template
    return None


def probe_isolation(client, paths, principals):
    if not all(name in principals for name in ("estimator", "manager")):
        emit("OCE_ISOLATION_PROBE", outcome="principals_unavailable", denial_confirmed=False)
        return

    estimator_ids = principals["estimator"]["project_ids"]
    manager_ids = principals["manager"]["project_ids"]
    estimator_only = estimator_ids - manager_ids
    manager_only = manager_ids - estimator_ids
    emit(
        "OCE_PROJECT_SCOPE",
        estimator_count=len(estimator_ids),
        manager_count=len(manager_ids),
        shared_count=len(estimator_ids & manager_ids),
        estimator_only_count=len(estimator_only),
        manager_only_count=len(manager_only),
    )

    template = project_detail_template(paths)
    if not template:
        emit("OCE_ISOLATION_PROBE", outcome="project_detail_route_absent", denial_confirmed=False)
        return

    probes = (
        ("estimator", "manager", estimator_only),
        ("manager", "estimator", manager_only),
    )
    attempted = 0
    confirmed = 0
    for owner, foreign, exclusive_ids in probes:
        if not exclusive_ids:
            continue
        attempted += 1
        project_id = sorted(exclusive_ids)[0]
        path = template.replace("{project_id}", project_id)
        owner_status, _, _ = client.request(path, token=principals[owner]["token"])
        foreign_status, _, _ = client.request(path, token=principals[foreign]["token"])
        denied = owner_status == 200 and foreign_status in (403, 404)
        if denied:
            confirmed += 1
        emit(
            "OCE_ISOLATION_PROBE",
            owner=owner,
            foreign=foreign,
            owner_status=owner_status,
            foreign_status=foreign_status,
            denial_confirmed=denied,
        )
    if attempted == 0:
        emit(
            "OCE_ISOLATION_PROBE",
            outcome="no_exclusive_existing_fixture",
            denial_confirmed=False,
        )
    else:
        emit(
            "OCE_ISOLATION_SUMMARY",
            attempted=attempted,
            confirmed=confirmed,
            all_confirmed=attempted == confirmed,
        )



def audit_converters(client, paths, token):
    """Use OCE's own read-only converter status API; never emit host paths/messages."""
    if "get" not in paths.get(CONVERTERS, {}):
        emit("OCE_CONVERTERS_API", outcome="route_absent")
        return
    status, body, outcome = client.request(CONVERTERS + "?verify=true", token=token)
    converter_rows = rows(body) or []
    safe_rows = []
    for row in converter_rows[:16]:
        if not isinstance(row, dict):
            continue
        converter_id = row.get("id")
        version = row.get("version")
        health = row.get("health")
        safe_rows.append({
            "id": converter_id if isinstance(converter_id, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", converter_id) else "unknown",
            "version": version if isinstance(version, str) and len(version) <= 40 else None,
            "installed": row.get("installed") if isinstance(row.get("installed"), bool) else None,
            "health": health if isinstance(health, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", health) else None,
        })
    emit(
        "OCE_CONVERTERS_API",
        status=status,
        outcome=outcome,
        verify_requested=True,
        count=len(safe_rows),
        converters=safe_rows,
    )

def run():
    client = None
    for base in BASES:
        candidate = LocalClient(base)
        status, health, _ = candidate.request("/api/health")
        if status == 200 and isinstance(health, dict):
            client = candidate
            version = health.get("version")
            modules = health.get("modules", {})
            if not isinstance(modules, dict):
                modules = {}
            enabled = health.get("modules_enabled", modules.get("enabled"))
            loaded = health.get("modules_loaded", modules.get("loaded"))
            emit(
                "OCE_LOCAL",
                health="ok",
                version=version if isinstance(version, str) and re.fullmatch(r"\d+\.\d+\.\d+", version) else "unknown",
                healthy=health.get("status") == "healthy",
                database_ok=health.get("database") == "ok",
                modules_enabled=enabled if type(enabled) is int else None,
                modules_loaded=loaded if type(loaded) is int else None,
            )
            break
    if client is None:
        emit("OCE_LOCAL", health="unreachable")
        return

    # v17.7.0 configures this canonical URL in backend/app/main.py.
    status, schema, outcome = client.request("/api/openapi.json")
    paths = schema.get("paths", {}) if isinstance(schema, dict) else {}
    if not isinstance(paths, dict):
        paths = {}
    emit(
        "OCE_OPENAPI",
        status=status,
        outcome=outcome,
        paths=len(paths),
        operations=sum(
            1
            for item in paths.values()
            if isinstance(item, dict)
            for verb in item
            if verb in {"get", "post", "put", "patch", "delete", "head", "options"}
        ),
        domains={label: "get" in paths.get(route, {}) for label, route in PROJECT_GETS.items()},
        demo_login_documented="post" in paths.get(LOGIN, {}),
    )
    read(client, "me", "/api/v1/users/me/")
    read(client, "projects", "/api/v1/projects/?limit=1")

    if "post" not in paths.get(LOGIN, {}):
        emit("OCE_AUTH", status="not_attempted", reason="demo_route_not_verified")
        return

    principals = {}
    for account in ("estimator", "manager"):
        status, login, outcome = client.request(LOGIN, demo_email=account + "@openconstructionerp.com")
        token = login.get("access_token") if isinstance(login, dict) else None
        login = None
        if status != 200 or not isinstance(token, str) or not token or len(token) > 16384:
            emit("OCE_AUTH", account=account, status=status, outcome=outcome, login_ok=False)
            if status == 429:
                break
            continue

        emit("OCE_AUTH", account=account, status=status, login_ok=True)
        me_status, me = read(client, "me", "/api/v1/users/me/", token, account)
        role = me.get("role") if isinstance(me, dict) else None
        expected_role = EXPECTED_DEMO_ROLES[account]
        # Fail closed if a nominally lesser-privileged demo identity drifted.
        if me_status != 200 or role != expected_role or me.get("is_superuser") is True:
            emit(
                "OCE_AUTH",
                account=account,
                scope="stopped_unverified_nonadmin_role",
                role_matches_expected=False,
            )
            token = None
            continue

        emit(
            "OCE_ROLE",
            account=account,
            role=role,
            role_matches_expected=True,
            read_only_principal=False,
            audit_requests_read_only=True,
        )
        _, projects = read(client, "projects", "/api/v1/projects/?limit=100", token, account)
        if account == "manager":
            audit_converters(client, paths, token)
        ids = project_ids(projects)
        principals[account] = {"token": token, "project_ids": ids}

        project_id = sorted(ids)[0] if ids else None
        if not project_id:
            emit("OCE_MODULE_READS", account=account, status="blocked_no_accessible_project")
        else:
            for label, template in PROJECT_GETS.items():
                if "get" not in paths.get(template, {}):
                    emit("OCE_READ", account=account, check=label, outcome="route_absent")
                    continue
                path = template.replace("{project_id}", project_id)
                path += "?limit=1" if "{project_id}" in template else "?limit=1&project_id=" + project_id
                read(client, label, path, token, account)
        me = projects = None

    probe_isolation(client, paths, principals)
    for principal in principals.values():
        principal["token"] = None
        principal["project_ids"] = set()

    emit(
        "OCE_QUALIFICATION",
        isolation="probed_only_when_existing_demo_project_scopes_differ",
        bim_4d_5d="list_reads_only_no_conversion_or_calculation",
        sso="not_tested",
        business_writes=False,
    )


if __name__ == "__main__":
    try:
        run()
    except Exception:
        emit("OCE_AUDIT_ERROR", outcome="sanitized_failure")
        raise SystemExit(1)
