#!/usr/bin/env bash
set -euo pipefail

# Read-only, sanitized audit for the self-hosted OpenConstructionERP instance.
# Never print environment values, credentials, tokens, response bodies or business rows.

echo "OCE_AUDIT schema=1 mode=readonly"
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

health_file="$(mktemp)"
openapi_file="$(mktemp)"
trap 'rm -f "$health_file" "$openapi_file"' EXIT

base=""
for candidate in http://127.0.0.1:8080 http://127.0.0.1:8000; do
  code="$(curl --silent --show-error --connect-timeout 2 --max-time 6 -o "$health_file" -w '%{http_code}' "$candidate/api/health" || true)"
  if [[ "$code" == "200" ]]; then
    base="$candidate"
    break
  fi
done

if [[ -z "$base" ]]; then
  echo 'OCE_LOCAL health=unreachable'
else
  python3 - "$health_file" <<'PY'
import json, sys
try:
    d=json.load(open(sys.argv[1], encoding='utf-8'))
except Exception:
    print("OCE_LOCAL health=200 parse=failed")
    raise SystemExit
def pick(*keys):
    cur=d
    for key in keys:
        if not isinstance(cur, dict) or key not in cur:
            return None
        cur=cur[key]
    return cur
safe={
    "health":"ok",
    "version": d.get("version"),
    "status": d.get("status"),
    "database": d.get("database") if isinstance(d.get("database"), str) else pick("database","status"),
    "modules_enabled": d.get("modules_enabled") or pick("modules","enabled"),
    "modules_loaded": d.get("modules_loaded") or pick("modules","loaded"),
}
print("OCE_LOCAL "+json.dumps(safe, sort_keys=True))
PY

  openapi_code="$(curl --silent --show-error --connect-timeout 2 --max-time 12 -o "$openapi_file" -w '%{http_code}' "$base/openapi.json" || true)"
  if [[ "$openapi_code" == "200" ]]; then
    python3 - "$openapi_file" <<'PY'
import json, sys
d=json.load(open(sys.argv[1], encoding='utf-8'))
paths=d.get("paths",{})
ops=sum(1 for v in paths.values() if isinstance(v,dict) for k in v if k.lower() in {"get","post","put","patch","delete","options","head"})
domains={
 "users":"/api/v1/users/",
 "projects":"/api/v1/projects",
 "boq":"/api/v1/boq",
 "schedule":"/api/v1/schedule",
 "bim":"/api/v1/bim",
 "bim_hub":"/api/v1/bim_hub",
 "costmodel":"/api/v1/costmodel",
 "qaqc":"/api/v1/inspections",
 "cde":"/api/v1/cde",
 "backup":"/api/v1/backup",
}
present={k:sum(1 for p in paths if p.startswith(prefix)) for k,prefix in domains.items()}
login=[p for p,v in paths.items() if isinstance(v,dict) and "post" in v and ("login" in p.lower() or "token" in p.lower()) and p.startswith("/api/v1/users")]
print("OCE_OPENAPI "+json.dumps({"paths":len(paths),"operations":ops,"domain_path_counts":present,"login_candidates":login[:5]}, sort_keys=True))
PY
  else
    echo "OCE_OPENAPI status=$openapi_code"
  fi
fi

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
import importlib, json, os, pathlib, shutil
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

# Authenticate only with an existing local demo credential source. Secrets never leave
# this Python process and are never printed.
passwords=[]
for email,key in (
    ("demo@openconstructionerp.com","DEMO_USER_PASSWORD"),
    ("demo@openestimator.io","DEMO_USER_PASSWORD"),
    ("estimator@openconstructionerp.com","DEMO_ESTIMATOR_PASSWORD"),
    ("manager@openconstructionerp.com","DEMO_MANAGER_PASSWORD"),
):
    if os.environ.get(key):
        passwords.append((email,os.environ[key],"env:"+key))

cred_paths=[]
home=pathlib.Path.home()
cred_paths.extend([home/".openestimator/.demo_credentials.json", pathlib.Path("/root/.openestimator/.demo_credentials.json")])
if pathlib.Path("/home").exists():
    cred_paths.extend(pathlib.Path("/home").glob("*/.openestimator/.demo_credentials.json"))
for p in cred_paths:
    try:
        raw=json.loads(p.read_text())
    except Exception:
        continue
    if isinstance(raw,dict):
        for label,v in raw.items():
            if isinstance(v,str) and "pass" in label.lower():
                passwords.append(("demo@openconstructionerp.com",v,"credential_file"))
            elif isinstance(v,dict):
                email=v.get("email")
                pw=v.get("password")
                if isinstance(email,str) and isinstance(pw,str):
                    passwords.append((email,pw,"credential_file"))

disabled=str(os.environ.get("DISABLE_DEMO_ACCOUNTS","")).lower() in {"1","true","yes","on"}
if disabled:
    print("OCE_AUTH demo_accounts=disabled status=not_attempted")
    raise SystemExit
if not passwords:
    print("OCE_AUTH credential_source=none status=not_attempted")
    raise SystemExit

import urllib.error, urllib.parse, urllib.request
bases=("http://127.0.0.1:8080","http://127.0.0.1:8000")
token=None
source=None
used_base=None
for email,pw,src in passwords:
    for base in bases:
        url=base+"/api/v1/users/auth/login/"
        attempts=[
            ("application/json", json.dumps({"email":email,"password":pw}).encode()),
            ("application/x-www-form-urlencoded", urllib.parse.urlencode({"username":email,"password":pw}).encode()),
        ]
        for ctype,data in attempts:
            req=urllib.request.Request(url,data=data,headers={"Content-Type":ctype,"Accept":"application/json"},method="POST")
            try:
                with urllib.request.urlopen(req,timeout=5) as resp:
                    obj=json.loads(resp.read().decode("utf-8","replace"))
                    token=obj.get("access_token") or obj.get("token")
                    if token:
                        source=src
                        used_base=base
                        break
            except Exception:
                pass
        if token:
            break
    if token:
        break
if not token:
    print("OCE_AUTH credential_source=present status=login_failed")
    raise SystemExit
print("OCE_AUTH credential_source="+source+" status=login_ok")

def get(path):
    req=urllib.request.Request(used_base+path,headers={"Authorization":"Bearer "+token,"Accept":"application/json"},method="GET")
    try:
        with urllib.request.urlopen(req,timeout=6) as resp:
            body=resp.read()
            ctype=resp.headers.get("content-type","")
            shape="unknown"; count=None
            if "json" in ctype.lower():
                try:
                    obj=json.loads(body.decode("utf-8","replace"))
                    if isinstance(obj,list):
                        shape="list"; count=len(obj)
                    elif isinstance(obj,dict):
                        shape="object"
                        for key in ("items","results","data"):
                            if isinstance(obj.get(key),list):
                                count=len(obj[key]); break
                except Exception:
                    shape="json"
            return resp.status,shape,count
    except urllib.error.HTTPError as e:
        return e.code,"error",None
    except Exception:
        return 0,"error",None

for label,path in (
    ("me","/api/v1/users/me/"),
    ("projects","/api/v1/projects/?limit=1"),
    ("modules","/api/v1/modules/"),
):
    status,shape,count=get(path)
    print("OCE_AUTH_READ "+json.dumps({"check":label,"status":status,"shape":shape,"count":count},sort_keys=True))
PY

    timers="$(systemctl list-timers --all --no-legend 2>/dev/null | grep -Ei 'backup|openconstruction|openestimate|oce' || true)"
    if [[ -n "$timers" ]]; then
      count="$(printf '%s\n' "$timers" | wc -l | tr -d ' ')"
      echo "OCE_BACKUP_SIGNAL systemd_timer_matches=$count"
    else
      echo 'OCE_BACKUP_SIGNAL systemd_timer_matches=0'
    fi
  fi
fi

echo 'OCE_AUDIT_COMPLETE=true'
