#!/usr/bin/env bash
set -euo pipefail
# One-time reviewed root bootstrap. No service start, enable or OCE mutation.
[[ "$(id -u)" == 0 ]]
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ "$(uname -m)" == x86_64 ]]
if systemctl is-active --quiet dao-oce-cloudflared.service; then
  echo 'Stop the private tunnel through its protected workflow before upgrading the helper.' >&2
  exit 1
fi
id dao >/dev/null
command -v visudo >/dev/null
install -d -o root -g root -m 0700 /etc/dao-oce-cloudflare
install -d -o root -g root -m 0755 /usr/local/libexec
id dao-oce-tunnel >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin dao-oce-tunnel
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 120 \
  https://github.com/cloudflare/cloudflared/releases/download/2026.10.0/cloudflared-linux-amd64 -o "$tmp/cloudflared"
printf '%s  %s\n' d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db "$tmp/cloudflared" | sha256sum --check --status
install -o root -g root -m 0755 "$tmp/cloudflared" /usr/local/libexec/dao-oce-cloudflared
install -o root -g root -m 0755 "$source_dir/oce-cloudflare.py" /usr/local/libexec/dao-oce-cloudflare.py
install -o root -g root -m 0755 "$source_dir/dao-oce-private-admin.py" /usr/local/sbin/dao-oce-private-admin
install -o root -g root -m 0644 "$source_dir/dao-oce-cloudflared.service" /etc/systemd/system/dao-oce-cloudflared.service
cat > "$tmp/sudoers" <<'EOF'
dao ALL=(root) NOPASSWD: /usr/local/sbin/dao-oce-private-admin audit, /usr/local/sbin/dao-oce-private-admin probe, /usr/local/sbin/dao-oce-private-admin start, /usr/local/sbin/dao-oce-private-admin stop, /usr/local/sbin/dao-oce-private-admin status
EOF
chmod 0440 "$tmp/sudoers"
visudo -cf "$tmp/sudoers"
install -o root -g root -m 0440 "$tmp/sudoers" /etc/sudoers.d/dao-oce-private
systemctl daemon-reload
echo 'Private demo helper installed; tunnel not started, OCE unchanged. Root configuration still required.'
