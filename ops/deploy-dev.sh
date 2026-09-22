#!/usr/bin/env bash
set -Eeuo pipefail

REVISION="${1:?revision required}"
APP_ROOT=/opt/dao
ENV_FILE=/etc/dao/dao-dev.env
RELEASE="$APP_ROOT/releases/$REVISION"
GIT_PATH="$(command -v git)"
NPM_PATH="$(command -v npm)"
NODE_PATH="$(command -v node)"
for tool in "$GIT_PATH" "$NPM_PATH" "$NODE_PATH"; do [ -x "$tool" ] || { echo "Missing executable: $tool" >&2; exit 1; }; done
mkdir -p "$APP_ROOT/releases"

[ -r "$ENV_FILE" ] || { echo "Missing readable environment file: $ENV_FILE" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is required}"
: "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required}"
: "${DAO_SUPABASE_SECRET_KEY:?DAO_SUPABASE_SECRET_KEY is required}"


if [ ! -d "$RELEASE/.git" ]; then
  "$GIT_PATH" clone --no-checkout https://github.com/Khaey/Dao.git "$RELEASE"
fi
"$GIT_PATH" -C "$RELEASE" fetch origin main
"$GIT_PATH" -C "$RELEASE" checkout --force "$REVISION"

cd "$RELEASE/dao-backend" && "$NPM_PATH" ci
cd "$RELEASE/dao-frontend" && "$NPM_PATH" ci && "$NPM_PATH" run build
ln -sfn "$RELEASE" "$APP_ROOT/current"
sudo -n /usr/bin/systemctl restart dao-dev.service
sudo -n /usr/bin/systemctl is-active dao-dev.service

# Keep the last five releases for rollback.
ls -1dt "$APP_ROOT"/releases/* | tail -n +6 | xargs -r rm -rf
