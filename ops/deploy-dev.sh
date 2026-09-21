#!/usr/bin/env bash
set -Eeuo pipefail

REVISION="${1:?revision required}"
APP_ROOT=/opt/dao
RELEASE="$APP_ROOT/releases/$REVISION"
GIT_PATH="$(command -v git)"
NPM_PATH="$(command -v npm)"
NODE_PATH="$(command -v node)"
for tool in "$GIT_PATH" "$NPM_PATH" "$NODE_PATH"; do [ -x "$tool" ] || { echo "Missing executable: $tool" >&2; exit 1; }; done
mkdir -p "$APP_ROOT/releases"

if [ ! -d "$RELEASE/.git" ]; then
  "$GIT_PATH" clone --no-checkout https://github.com/Khaey/Dao.git "$RELEASE"
fi
"$GIT_PATH" -C "$RELEASE" fetch origin main
"$GIT_PATH" -C "$RELEASE" checkout --force "$REVISION"

cd "$RELEASE/dao-backend" && "$NPM_PATH" ci
cd "$RELEASE/dao-frontend" && "$NPM_PATH" ci && "$NPM_PATH" run build
ln -sfn "$RELEASE" "$APP_ROOT/current"
sudo -n /usr/bin/systemctl restart dao-dev.service
sudo -n /usr/bin/systemctl is-active --quiet dao-dev.service

# Keep the last five releases for rollback.
ls -1dt "$APP_ROOT"/releases/* | tail -n +6 | xargs -r rm -rf
