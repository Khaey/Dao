#!/usr/bin/env bash
set -Eeuo pipefail

# Run once as root on the DEV VPS. Re-running is safe.
[ "$(id -u)" -eq 0 ] || { echo 'Run as root.' >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAO_USER=dao
APP_ROOT=/opt/dao
ETC_ROOT=/etc/dao
PUBLIC_KEY="${DAO_DEPLOY_PUBLIC_KEY:-}"

command -v apt-get >/dev/null || { echo 'This bootstrap expects Debian/Ubuntu apt-get.' >&2; exit 1; }
id "$DAO_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/dao --shell /bin/bash "$DAO_USER"
install -d -o "$DAO_USER" -g "$DAO_USER" -m 0755 "$APP_ROOT" "$APP_ROOT/releases" "$ETC_ROOT"
install -d -o "$DAO_USER" -g "$DAO_USER" -m 0700 /home/dao/.ssh
touch /home/dao/.ssh/authorized_keys
chown "$DAO_USER:$DAO_USER" /home/dao/.ssh/authorized_keys; chmod 0600 /home/dao/.ssh/authorized_keys
if [ -n "$PUBLIC_KEY" ] && ! grep -Fqx "$PUBLIC_KEY" /home/dao/.ssh/authorized_keys; then printf '%s\n' "$PUBLIC_KEY" >> /home/dao/.ssh/authorized_keys; fi

if ! command -v node >/dev/null || ! command -v npm >/dev/null || ! command -v git >/dev/null; then apt-get update; apt-get install -y nodejs npm git ca-certificates; fi
if ! command -v caddy >/dev/null; then apt-get update; apt-get install -y caddy; fi
if ! command -v visudo >/dev/null; then apt-get update; apt-get install -y sudo; fi
NODE_PATH="$(command -v node)"; NPM_PATH="$(command -v npm)"; GIT_PATH="$(command -v git)"; CADDY_PATH="$(command -v caddy)"
for tool in "$NODE_PATH" "$NPM_PATH" "$GIT_PATH" "$CADDY_PATH"; do [ -x "$tool" ] || { echo "Invalid tool path: $tool" >&2; exit 1; }; done
printf 'node=%s\nnpm=%s\ngit=%s\ncaddy=%s\n' "$NODE_PATH" "$NPM_PATH" "$GIT_PATH" "$CADDY_PATH"

sed "s#@NPM_PATH@#$NPM_PATH#g" "$ROOT_DIR/dao-dev.service" > /etc/systemd/system/dao-dev.service
install -o root -g root -m 0440 "$ROOT_DIR/dao-dev.sudoers" /etc/sudoers.d/dao-dev
visudo -cf /etc/sudoers.d/dao-dev
install -o "$DAO_USER" -g "$DAO_USER" -m 0750 "$ROOT_DIR/deploy-dev.sh" "$APP_ROOT/deploy-dev.sh"
install -o root -g root -m 0644 "$ROOT_DIR/Caddyfile" /etc/caddy/Caddyfile
install -d -o root -g dao -m 0750 "$ETC_ROOT"
if [ ! -f "$ETC_ROOT/dao-dev.env" ]; then
  install -o root -g dao -m 0640 /dev/null "$ETC_ROOT/dao-dev.env"
  cat > "$ETC_ROOT/dao-dev.env" <<'EOF'
# Fill values out-of-band. Never commit this file.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
DAO_SUPABASE_SECRET_KEY=
EOF
fi
chown root:dao "$ETC_ROOT/dao-dev.env"; chmod 0640 "$ETC_ROOT/dao-dev.env"
"$CADDY_PATH" validate --config /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable dao-dev.service caddy
systemctl restart caddy
systemctl restart dao-dev.service || true
systemctl is-enabled dao-dev.service caddy
echo 'Bootstrap complete. WireGuard was not accessed or modified.'
