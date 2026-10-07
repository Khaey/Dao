#!/usr/bin/env bash
set -euo pipefail

# Read-only, sanitized audit for the self-hosted OpenConstructionERP instance.
# Never print environment values, credentials, tokens, response bodies or business rows.

echo "OCE_AUDIT schema=3 mode=readonly"
echo "OCE_AUDIT_TIME_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

python3 - <<'PY'
import json, os, shutil
mem = {}
try:
    with open('/proc/meminfo', encoding='utf-8') as f:
        for line in f:
            k, v = line.split(':', 1)
            mem[k] = int(v.strip().split()[0])
except Exception:
    pass
disk = shutil.disk_usage('/')
print(json.dumps({
    "host": {
        "cpu_count": os.cpu_count(),
        "memory_total_mib": mem.get("MemTotal", 0) // 1024,
        "memory_available_mib": mem.get("MemAvailable", 0) // 1024,
        "root_disk_total_gib": round(disk.total / 1024**3, 1),
        "root_disk_free_gib": round(disk.free / 1024**3, 1),
        "root_disk_used_pct": round((disk.used / disk.total) * 100, 1) if disk.total else None,
    }
}, sort_keys=True))
PY

python3 "$(dirname "$0")/oce-api-readonly-audit.py"

docker_state="$(systemctl is-active docker 2>/dev/null || true)"
case "$docker_state" in
  active|inactive|failed|activating|deactivating) ;;
  *) docker_state="unknown" ;;
esac

if [[ -S /var/run/docker.sock ]]; then
  socket_meta="$(stat -c '%A|%U|%G' /var/run/docker.sock 2>/dev/null || true)"
  if [[ -n "$socket_meta" ]]; then
    IFS='|' read -r socket_mode socket_owner socket_group <<<"$socket_meta"
    echo "DOCKER_SOCKET present=true mode=$socket_mode owner=$socket_owner group=$socket_group"
  else
    echo 'DOCKER_SOCKET present=true metadata=unavailable'
  fi
else
  echo 'DOCKER_SOCKET present=false'
fi
echo "DOCKER_SERVICE state=$docker_state"

if test -x /usr/local/sbin/dao-dev-admin; then
  if sudo -n /usr/local/sbin/dao-dev-admin oce-audit 2>/dev/null; then
    echo 'OCE_ROOT_AUDIT status=ok'
  else
    echo 'OCE_ROOT_AUDIT status=helper_unavailable_or_not_authorized'
  fi
else
  echo 'OCE_ROOT_AUDIT status=helper_not_installed'
fi

python3 - <<'PY'
import json, os, pathlib, re

roots = [pathlib.Path("/opt"), pathlib.Path("/srv"), pathlib.Path("/home/dao")]
names = {"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"}
files = []
for root in roots:
    if not root.exists():
        continue
    for current, dirs, filenames in os.walk(root):
        rel_depth = len(pathlib.Path(current).relative_to(root).parts)
        if rel_depth >= 5:
            dirs[:] = []
        for name in filenames:
            if name in names:
                p = pathlib.Path(current) / name
                if os.access(p, os.R_OK):
                    files.append(p)
        if len(files) >= 40:
            break
    if len(files) >= 40:
        break

matched = 0
images = set()
for path in files[:40]:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        continue
    if not re.search(r"openconstruction|openestimate", text, re.I):
        continue
    matched += 1
    for m in re.finditer(r"(?m)^\s*image:\s*([^\s#]+)", text):
        value = m.group(1).strip().strip("'\"")
        if "$" in value or "{" in value or "}" in value:
            images.add("dynamic")
        elif re.fullmatch(r"[A-Za-z0-9._/@:+-]{1,300}", value):
            images.add(value)
print("OCE_COMPOSE_META " + json.dumps({
    "readable_candidate_files": len(files[:40]),
    "oce_compose_matches": matched,
    "declared_images": sorted(images)[:10],
}, sort_keys=True))
PY

docker_ok=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker_ok=1
  echo 'DOCKER access=ok'
else
  echo 'DOCKER access=unavailable_or_denied'
fi

if [[ "$docker_ok" == "1" ]]; then
  candidate="$(docker ps --format '{{.ID}}|{{.Image}}|{{.Names}}|{{.Ports}}' | awk -F'|' 'BEGIN{IGNORECASE=1} /openconstruction|openestimate/ {print; found=1; exit} /8080->/ {fallback=$0} END{if (!found && fallback) print fallback}' | head -n1 || true)"
  if [[ -z "$candidate" ]]; then
    echo 'OCE_CONTAINER found=false'
  else
    IFS='|' read -r cid image name ports <<<"$candidate"
    image_id="$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null || true)"
    repo_digest="$(docker image inspect --format '{{join .RepoDigests ","}}' "$image" 2>/dev/null || true)"
    [[ -n "$repo_digest" ]] || repo_digest="unavailable"
    echo "OCE_CONTAINER found=true name=$name image=$image image_id=${image_id:-unavailable} digest=$repo_digest"

    docker inspect "$cid" | python3 -c '
import json,sys
x=json.load(sys.stdin)[0]
env=x.get("Config",{}).get("Env",[]) or []
keys=sorted(e.split("=",1)[0] for e in env if "=" in e)
interesting=[k for k in keys if any(t in k for t in ("DEMO_","JWT_","DATABASE_","S3_","REDIS_","APP_ENV","DISABLE_DEMO","SEED_DEMO"))]
mounts=x.get("Mounts",[]) or []
safe_mounts=[{"type":m.get("Type"),"name":m.get("Name") or "bind","destination":m.get("Destination")} for m in mounts]
print("OCE_CONTAINER_META "+json.dumps({"env_keys":interesting,"mounts":safe_mounts},sort_keys=True))
'

    docker exec -i "$cid" python3 - <<'PY' || true
import importlib, json, shutil
checks={}
for exe in ("IfcConvert","ifcconvert","ffmpeg","libreoffice"):
    checks[exe]=bool(shutil.which(exe))
for mod in ("ifcopenshell","pymupdf","fitz","lancedb","sentence_transformers"):
    try:
        m=importlib.import_module(mod)
        checks[mod]=getattr(m,"__version__",True)
    except Exception:
        checks[mod]=False
print("OCE_CONVERTERS "+json.dumps(checks,sort_keys=True))
PY
  fi
fi

timers="$(systemctl list-timers --all --no-legend 2>/dev/null | grep -Ei 'backup|openconstruction|openestimate|oce' || true)"
if [[ -n "$timers" ]]; then
  count="$(printf '%s\n' "$timers" | wc -l | tr -d ' ')"
  echo "OCE_BACKUP_SIGNAL systemd_timer_matches=$count"
else
  echo 'OCE_BACKUP_SIGNAL systemd_timer_matches=0'
fi

python3 - <<'PY'
import json, os, pathlib, time
roots = [pathlib.Path("/var/backups"), pathlib.Path("/opt"), pathlib.Path("/srv")]
matches = []
needles = ("openconstruction", "openestimate", "oce")
for root in roots:
    if not root.exists():
        continue
    for current, dirs, files in os.walk(root):
        rel_depth = len(pathlib.Path(current).relative_to(root).parts)
        if rel_depth >= 4:
            dirs[:] = []
        for name in files:
            low = name.lower()
            if "backup" in low and any(n in low or n in str(current).lower() for n in needles):
                p = pathlib.Path(current) / name
                try:
                    stat = p.stat()
                except OSError:
                    continue
                matches.append(stat.st_mtime)
        if len(matches) >= 100:
            break
    if len(matches) >= 100:
        break
latest_age_hours = None
if matches:
    latest_age_hours = round(max(0, time.time() - max(matches)) / 3600, 1)
print("OCE_BACKUP_FILES " + json.dumps({
    "name_matched_count": len(matches),
    "latest_age_hours": latest_age_hours,
    "restoration_proven": False,
}, sort_keys=True))
PY

echo 'OCE_AUDIT_COMPLETE=true'
