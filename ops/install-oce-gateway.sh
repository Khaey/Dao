#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "root required" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_USER="dao-oce-gateway"
SECRET="/etc/dao-oce/private/gateway-credential.json"

getent passwd dao >/dev/null
if ! getent passwd "${SERVICE_USER}" >/dev/null; then
  /usr/sbin/useradd \
    --system \
    --user-group \
    --home-dir /nonexistent \
    --shell /usr/sbin/nologin \
    "${SERVICE_USER}"
fi

/usr/bin/python3 -I - "${SECRET}" <<'PY'
import json, stat, sys
from pathlib import Path
p=Path(sys.argv[1])
m=p.lstat()
if not stat.S_ISREG(m.st_mode) or m.st_uid != 0 or m.st_mode & 0o077 or m.st_size > 8192:
    raise SystemExit("gateway credential source is not root-only")
data=json.loads(p.read_text())
if data.get("email") != "dao-oce-gateway@logiclab.fr" or data.get("qualified") is not True:
    raise SystemExit("gateway credential is not qualified")
if not isinstance(data.get("password"), str) or len(data["password"]) < 12:
    raise SystemExit("gateway credential invalid")
PY

install -d -m 0755 -o root -g root /usr/local/libexec
install -m 0755 -o root -g root "${ROOT}/ops/oce-v1-gateway.py" /usr/local/libexec/dao-oce-gateway
install -m 0755 -o root -g root "${ROOT}/ops/oce-v1-egress-guard.py" /usr/local/libexec/dao-oce-egress-guard
install -m 0755 -o root -g root "${ROOT}/ops/oce-v1-gateway-host.py" /usr/local/sbin/dao-oce-gateway-host
install -m 0755 -o root -g root "${ROOT}/ops/oce-v1-gateway-qualify.py" /usr/local/sbin/dao-oce-gateway-qualify
install -m 0644 -o root -g root "${ROOT}/ops/dao-oce-gateway.service" /etc/systemd/system/dao-oce-gateway.service
install -m 0644 -o root -g root "${ROOT}/ops/dao-oce-egress-guard.service" /etc/systemd/system/dao-oce-egress-guard.service
install -d -m 0755 -o root -g root /etc/tmpfiles.d
install -m 0644 -o root -g root "${ROOT}/ops/dao-oce-gateway.tmpfiles" /etc/tmpfiles.d/dao-oce-gateway.conf

install -d -m 0700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" /var/lib/dao-oce-gateway
/usr/bin/systemd-tmpfiles --create /etc/tmpfiles.d/dao-oce-gateway.conf

/usr/bin/systemctl daemon-reload

echo "D.A.O OCE private gateway installed; no service started and demo access unchanged."
