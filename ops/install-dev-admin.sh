#!/usr/bin/env bash
set -euo pipefail
# One-time root installation from a reviewed main checkout. No credentials needed.
[ "$(id -u)" = 0 ] || { echo 'Root installation required once.' >&2; exit 1; }
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
id dao >/dev/null
command -v python3 >/dev/null
command -v visudo >/dev/null
test -f /etc/dao/dao-dev.env
test ! -L /etc/dao/dao-dev.env
install -d -o root -g dao -m 0750 /etc/dao
chown root:dao /etc/dao/dao-dev.env
chmod 0640 /etc/dao/dao-dev.env
install -o root -g root -m 0755 "$source_dir/dao-dev-admin.py" /usr/local/sbin/dao-dev-admin
tmp="$(mktemp /etc/sudoers.d/.dao-admin-XXXXXX)"
trap 'rm -f "$tmp"' EXIT
cat > "$tmp" <<'EOF'
# D.A.O environment and safe diagnostics; existing service sudoers remain intact.
dao ALL=(root) NOPASSWD: /usr/local/sbin/dao-dev-admin env-sync, /usr/local/sbin/dao-dev-admin env-restore, /usr/local/sbin/dao-dev-admin log-summary, /usr/local/sbin/dao-dev-admin oce-audit, /usr/local/sbin/dao-dev-admin oce-integration-inventory, /usr/local/sbin/dao-dev-admin oce-gateway-plan
EOF
chmod 0440 "$tmp"
visudo -cf "$tmp"
mv "$tmp" /etc/sudoers.d/dao-admin
echo 'D.A.O admin helper installed; environment values and service unchanged.'
