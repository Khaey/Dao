#!/usr/bin/env bash
set -Eeuo pipefail

REVISION="${1:?revision required}"
APP_ROOT=/opt/dao
RELEASE="$APP_ROOT/releases/$REVISION"
mkdir -p "$APP_ROOT/releases"

if [ ! -d "$RELEASE/.git" ]; then
  git clone --no-checkout https://github.com/Khaey/Dao.git "$RELEASE"
fi
git -C "$RELEASE" fetch origin main
git -C "$RELEASE" checkout --force "$REVISION"

cd "$RELEASE/dao-backend" && npm ci
cd "$RELEASE/dao-frontend" && npm ci && npm run build
ln -sfn "$RELEASE" "$APP_ROOT/current"
systemctl restart dao-dev.service
systemctl is-active --quiet dao-dev.service

# Keep the last five releases for rollback.
ls -1dt "$APP_ROOT"/releases/* | tail -n +6 | xargs -r rm -rf
