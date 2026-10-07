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
FIXED_GETS = {"/api/health", "/openapi.json", "/openapi.json/",
              "/api/v1/users/me/", "/api/v1/projects/"}
PROJECT_GETS = {
    "wbs": "/api/v1/projects/{project_id}/wbs/",
    "schedule": "/api/v1/schedule/schedules/",
    "boq": "/api/v1/boq/boqs/",
    "bim": "/api/v1/bim-hub/",
    "cost_5d": "/api/v1/costmodel/projects/{project_id}/5d/snapshots/",
    "qaqc": "/api/v1/inspections/",
    "cde": "/api/v1/cde/containers/",
}


def emit(marker, **safe):
    print(marker + " " + json.dumps(safe, sort_keys=True))


def valid_id(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


def allowed_get(path):
    path = urllib.parse.urlsplit(path).path
    if path in FIXED_GETS or path in PROJECT_GETS.values():
        return True
    for template in PROJECT_GETS.values():
        if "{project_id}" in template:
            prefix, suffix = template.split("{project_id}")
            if path.startswith(prefix) and path.endswith(suffix):
                if valid_id(path[len(prefix):-len(suffix)]):
                    return True
    return False


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
                    cap = 16 * 1024 * 1024 if path.startswith("/openapi.json") else 256 * 1024
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
                if (method != "GET" or not location or
                    (target.scheme, target.netloc) != (origin.scheme, origin.netloc) or
                    target.path.rstrip("/") != original.path.rstrip("/") or
                    target.query != original.query or target.fragment):
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
        for key in ("items", "results", "data", "projects"):
            if isinstance(body.get(key), list):
                return body[key]
    return None


def read(client, label, path, token=None, account="anonymous"):
    status, body, outcome = client.request(path, token=token)
    items = rows(body)
    emit("OCE_READ", account=account, check=label, status=status, outcome=outcome,
         shape="list" if isinstance(body, list) else "object" if isinstance(body, dict) else "none",
         count=len(items) if items is not None else None)
    return status, body


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
            emit("OCE_LOCAL", health="ok",
                 version=version if isinstance(version, str) and re.fullmatch(r"\d+\.\d+\.\d+", version) else "unknown",
                 healthy=health.get("status") == "healthy",
                 database_ok=health.get("database") == "ok",
                 modules_enabled=enabled if type(enabled) is int else None,
                 modules_loaded=loaded if type(loaded) is int else None)
            break
    if client is None:
        emit("OCE_LOCAL", health="unreachable")
        return
    status, schema, outcome = client.request("/openapi.json")
    paths = schema.get("paths", {}) if isinstance(schema, dict) else {}
    if not isinstance(paths, dict):
        paths = {}
    emit("OCE_OPENAPI", status=status, outcome=outcome, paths=len(paths),
         operations=sum(1 for item in paths.values() if isinstance(item, dict)
                        for verb in item if verb in {"get", "post", "put", "patch", "delete", "head", "options"}),
         domains={label: "get" in paths.get(route, {}) for label, route in PROJECT_GETS.items()},
         demo_login_documented="post" in paths.get(LOGIN, {}))
    read(client, "me", "/api/v1/users/me/")
    read(client, "projects", "/api/v1/projects/?limit=1")
    if "post" not in paths.get(LOGIN, {}):
        emit("OCE_AUTH", status="not_attempted", reason="demo_route_not_verified")
        return
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
        # Fail closed if these nominally lesser-privileged accounts became admins.
        if me_status != 200 or role not in ("estimator", "manager") or me.get("is_superuser") is True:
            emit("OCE_AUTH", account=account, scope="stopped_unverified_nonadmin_role")
            token = None
            continue
        emit("OCE_ROLE", account=account, role=role,
             read_only_principal=False, audit_requests_read_only=True)
        _, projects = read(client, "projects", "/api/v1/projects/?limit=1", token, account)
        project_rows = rows(projects) or []
        project_id = valid_id(project_rows[0].get("id")) if project_rows and isinstance(project_rows[0], dict) else None
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
        token = me = projects = project_rows = None
    emit("OCE_QUALIFICATION", isolation="not_proven_no_controlled_tenant_fixtures",
         bim_4d_5d="list_reads_only_no_conversion_or_calculation",
         sso="not_tested", business_writes=False)


if __name__ == "__main__":
    try:
        run()
    except Exception:
        emit("OCE_AUDIT_ERROR", outcome="sanitized_failure")
        raise SystemExit(1)
