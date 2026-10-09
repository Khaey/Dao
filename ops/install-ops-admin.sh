#!/usr/bin/env bash
# Single reviewed root bootstrap; no service, configuration or OCE reinstall.
set -euo pipefail
[[ "$(id -u)" == 0 ]]
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
id dao >/dev/null
command -v visudo >/dev/null
[[ -f /usr/local/sbin/dao-dev-admin && ! -L /usr/local/sbin/dao-dev-admin ]]
[[ ! -e /usr/local/sbin/dao-ops-admin && ! -L /usr/local/sbin/dao-ops-admin ]]
[[ ! -e /var/lib/dao-ops && ! -L /var/lib/dao-ops ]]
[[ ! -e /etc/sudoers.d/dao-ops && ! -L /etc/sudoers.d/dao-ops ]]
[[ "$source_dir" == /root/dao-ops-bootstrap.* ]]
[[ "$(stat -c '%u:%a' "$source_dir")" == 0:700 ]]
tmp="$(mktemp /etc/sudoers.d/.dao-ops-XXXXXX)"
created=0
complete=0
cleanup() {
  rm -f -- "$tmp"
  if [[ "$created" == 1 && "$complete" == 0 ]]; then
    rm -f -- /usr/local/sbin/dao-ops-admin
    rm -rf -- /var/lib/dao-ops
  fi
}
trap cleanup EXIT
cat > "$tmp" <<'EOF'
# Fixed root verbs, no caller path, shell, wildcard or bootstrap grant.
dao ALL=(root) NOPASSWD: /usr/local/sbin/dao-ops-admin status, /usr/local/sbin/dao-ops-admin preflight, /usr/local/sbin/dao-ops-admin upgrade, /usr/local/sbin/dao-ops-admin rollback, /usr/local/sbin/dao-ops-admin backup-status
EOF
chmod 0440 "$tmp"
visudo -cf "$tmp"
mkdir -m 0700 -- /var/lib/dao-ops
created=1
install -o root -g root -m 0755 "$source_dir/dao-ops-admin.py" /usr/local/sbin/dao-ops-admin
/usr/bin/python3 -I /usr/local/sbin/dao-ops-admin bootstrap
mv -T -- "$tmp" /etc/sudoers.d/dao-ops
complete=1
echo 'OPS_BOOTSTRAP_READY — existing code adopted, no service or secret changed.'
