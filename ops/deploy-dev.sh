#!/usr/bin/env bash
set -Eeuo pipefail

REVISION="${1:?revision required}"
RUN_ID="${2:?GitHub run ID required}"
RUN_ATTEMPT="${3:?GitHub run attempt required}"
ARTIFACT_DIR="${4:-}"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "Expected a full commit SHA" >&2; exit 2; }
[[ "$RUN_ID" =~ ^[0-9]+$ && "$RUN_ATTEMPT" =~ ^[0-9]+$ ]] || { echo "Invalid GitHub run identifier" >&2; exit 2; }

APP_ROOT=/opt/dao
ENV_FILE=/etc/dao/dao-dev.env
CURRENT="$APP_ROOT/current"
# Serialize direct SSH and Actions deployments on the host as well.
exec 9>"$APP_ROOT/.deploy.lock"
flock -w 120 9 || { echo "Another D.A.O deployment holds the lock" >&2; exit 1; }
RELEASE_ID="${REVISION}-${RUN_ID}-${RUN_ATTEMPT}"
STAGING="$APP_ROOT/releases/.staging-${RELEASE_ID}"
RELEASE="$APP_ROOT/releases/${RELEASE_ID}"
DEPENDENCIES_ROOT="$APP_ROOT/dependencies"
GIT_PATH="$(command -v git)"
NPM_PATH="$(command -v npm)"
NODE_PATH="$(command -v node)"
for tool in "$GIT_PATH" "$NPM_PATH" "$NODE_PATH"; do [ -x "$tool" ] || { echo "Missing executable: $tool" >&2; exit 1; }; done

[ -r "$ENV_FILE" ] || { echo "Missing readable environment file: $ENV_FILE" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is required}"
: "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required}"
: "${DAO_SUPABASE_SECRET_KEY:?DAO_SUPABASE_SECRET_KEY is required}"

mkdir -p "$APP_ROOT/releases" "$DEPENDENCIES_ROOT"
if [ -e "$RELEASE" ] || [ -L "$RELEASE" ] || [ -e "$STAGING" ] || [ -L "$STAGING" ]; then
  echo "Release path already exists: $RELEASE_ID" >&2
  exit 1
fi

measure() {
  local stage="$1"
  shift
  local started_ms finished_ms duration status
  started_ms="$(date +%s%3N)"
  set +e
  "$@"
  status=$?
  set -e
  finished_ms="$(date +%s%3N)"
  duration="$(awk -v start="$started_ms" -v end="$finished_ms" 'BEGIN { printf "%.2f", (end - start) / 1000 }')"
  printf 'DEPLOY_TIMING stage=%s duration_s=%s status=%s\n' "$stage" "$duration" "$status"
  return "$status"
}

run_npm_ci() {
  local install_dir="$1"
  (cd "$install_dir" && "$NPM_PATH" ci --no-audit --no-fund)
}

cache_dependencies() {
  local label="$1"
  local package_dir="$2"
  local key_material="$3"
  local cache_key cache_path build_path started_ms finished_ms duration
  started_ms="$(date +%s%3N)"
  cache_key="$(printf '%s' "$key_material" | sha256sum | awk '{ print $1 }')"
  cache_path="$DEPENDENCIES_ROOT/${label}-${cache_key}"

  if [ -d "$cache_path/node_modules" ] \
    && [ -r "$cache_path/.dao-dependency-cache-key" ] \
    && [ "$(cat "$cache_path/.dao-dependency-cache-key")" = "$cache_key" ]; then
    ln -s "$cache_path/node_modules" "$package_dir/node_modules"
    finished_ms="$(date +%s%3N)"
    duration="$(awk -v start="$started_ms" -v end="$finished_ms" 'BEGIN { printf "%.2f", (end - start) / 1000 }')"
    printf 'DEPLOY_TIMING stage=npm_ci_%s duration_s=%s status=0 outcome=cache_hit\n' "$label" "$duration"
    printf 'DEPLOY_CACHE package=%s result=hit\n' "$label"
    return 0
  fi

  build_path="$DEPENDENCIES_ROOT/.${label}-${cache_key}-${RUN_ID}-${RUN_ATTEMPT}"
  rm -rf "$build_path"
  mkdir -p "$build_path"
  cp "$package_dir/package.json" "$package_dir/package-lock.json" "$build_path/"
  measure "npm_ci_${label}" run_npm_ci "$build_path"
  printf '%s\n' "$cache_key" > "$build_path/.dao-dependency-cache-key"

  if [ -e "$cache_path" ]; then
    if [ -d "$cache_path/node_modules" ] \
      && [ -r "$cache_path/.dao-dependency-cache-key" ] \
      && [ "$(cat "$cache_path/.dao-dependency-cache-key")" = "$cache_key" ]; then
      rm -rf "$build_path"
    else
      cache_path="${cache_path}-${RUN_ID}-${RUN_ATTEMPT}"
      if [ -e "$cache_path" ]; then
        echo "Dependency cache recovery path already exists: $cache_path" >&2
        return 1
      fi
      mv "$build_path" "$cache_path"
    fi
  else
    mv "$build_path" "$cache_path"
  fi

  ln -s "$cache_path/node_modules" "$package_dir/node_modules"
  printf 'DEPLOY_CACHE package=%s result=installed\n' "$label"
}

PREVIOUS_RELEASE=""
if [ -L "$CURRENT" ]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT" || true)"
  case "$PREVIOUS_RELEASE" in
    "$APP_ROOT"/releases/*) [ -d "$PREVIOUS_RELEASE" ] || PREVIOUS_RELEASE="" ;;
    *) PREVIOUS_RELEASE="" ;;
  esac
fi
CURRENT_SWITCHED=0
handle_error() {
  local status=${1:-$?}
  trap - ERR HUP INT TERM
  if [ "$CURRENT_SWITCHED" -eq 1 ]; then
    if [ -n "$PREVIOUS_RELEASE" ]; then
      local rollback_link="$APP_ROOT/.current-rollback-${RUN_ID}-${RUN_ATTEMPT}"
      ln -s "$PREVIOUS_RELEASE" "$rollback_link"
      mv -Tf "$rollback_link" "$CURRENT"
      if ! sudo -n /usr/bin/systemctl restart dao-dev.service; then
        echo "Rollback selected the previous release, but its restart failed" >&2
      fi
    else
      rm -f "$CURRENT"
      echo "No previous release was available for rollback; the failed current link was removed" >&2
    fi
  fi
  if [ -d "$STAGING" ]; then
    rm -rf "$STAGING"
  fi
  echo "Deployment failed with status $status" >&2
  exit "$status"
}
trap handle_error ERR
trap 'handle_error 129' HUP
trap 'handle_error 130' INT
trap 'handle_error 143' TERM

measure git_init "$GIT_PATH" init "$STAGING"
measure git_remote_add "$GIT_PATH" -C "$STAGING" remote add origin https://github.com/Khaey/Dao.git
measure git_fetch "$GIT_PATH" -C "$STAGING" fetch origin main
measure git_checkout "$GIT_PATH" -C "$STAGING" checkout --detach "$REVISION"
test "$("$GIT_PATH" -C "$STAGING" rev-parse HEAD)" = "$REVISION"

FRONTEND_NODE_VERSION="$("$NODE_PATH" --version)"
NPM_VERSION="$("$NPM_PATH" --version)"
FRONTEND_PLATFORM="$("$NODE_PATH" -p '`${process.platform}-${process.arch}`')"
BACKEND_LOCK_SHA="$(sha256sum "$STAGING/dao-backend/package-lock.json" | awk '{ print $1 }')"
BACKEND_PACKAGE_SHA="$(sha256sum "$STAGING/dao-backend/package.json" | awk '{ print $1 }')"
FRONTEND_LOCK_SHA="$(sha256sum "$STAGING/dao-frontend/package-lock.json" | awk '{ print $1 }')"
FRONTEND_PACKAGE_SHA="$(sha256sum "$STAGING/dao-frontend/package.json" | awk '{ print $1 }')"
cache_dependencies backend "$STAGING/dao-backend" "${BACKEND_LOCK_SHA}|${BACKEND_PACKAGE_SHA}|${FRONTEND_NODE_VERSION}|${NPM_VERSION}|${FRONTEND_PLATFORM}"
cache_dependencies frontend "$STAGING/dao-frontend" "${FRONTEND_LOCK_SHA}|${FRONTEND_PACKAGE_SHA}|${FRONTEND_NODE_VERSION}|${NPM_VERSION}|${FRONTEND_PLATFORM}"

ARTIFACT_ACCEPTED=0
if [ -n "$ARTIFACT_DIR" ] \
  && [ -f "$ARTIFACT_DIR/.dao-deploy-manifest.json" ] \
  && [ -d "$ARTIFACT_DIR/.next" ] \
  && [ -s "$ARTIFACT_DIR/.next/BUILD_ID" ]; then
  if measure artifact_verification "$NODE_PATH" "$STAGING/ops/deploy-artifact-manifest.mjs" verify \
    "$ARTIFACT_DIR/.dao-deploy-manifest.json" \
    "$REVISION" \
    "$STAGING/dao-frontend/package-lock.json" \
    "$ARTIFACT_DIR/.next/BUILD_ID"; then
    measure artifact_stage cp -a "$ARTIFACT_DIR/.next" "$STAGING/dao-frontend/.next"
    ARTIFACT_ACCEPTED=1
  fi
else
  echo "DEPLOY_ARTIFACT result=missing_or_incomplete"
fi

if [ "$ARTIFACT_ACCEPTED" -eq 1 ]; then
  echo "DEPLOY_BUILD source=verified_ci_artifact"
else
  echo "DEPLOY_BUILD source=vps_fallback"
  measure frontend_build bash -c 'cd "$1" && "$2" run build' _ "$STAGING/dao-frontend" "$NPM_PATH"
fi

# Never activate a queued old revision over a newer main.
latest_main="$("$GIT_PATH" ls-remote https://github.com/Khaey/Dao.git refs/heads/main | awk '{print $1}')"
[[ "$latest_main" =~ ^[0-9a-f]{40}$ ]] || { echo "Unable to verify current main" >&2; false; }
if [ "$latest_main" != "$REVISION" ]; then
  echo "DEPLOY_SKIPPED reason=main_advanced sha=$REVISION"
  rm -rf "$STAGING"
  exit 0
fi
measure release_prepare mv "$STAGING" "$RELEASE"

switch_release() {
  local next_link="$APP_ROOT/.current-${RUN_ID}-${RUN_ATTEMPT}"
  ln -s "$RELEASE" "$next_link"
  mv -Tf "$next_link" "$CURRENT"
  CURRENT_SWITCHED=1
}
measure release_symlink switch_release
measure service_restart sudo -n /usr/bin/systemctl restart dao-dev.service
measure health_check sudo -n /usr/bin/systemctl is-active dao-dev.service
measure http_smoke bash "$RELEASE/scripts/validate-dev.sh" http://127.0.0.1:3000
bash "$RELEASE/scripts/dev-status.sh"

# Do not roll back a healthy activation because retention cleanup failed.
CURRENT_SWITCHED=0
trap - ERR HUP INT TERM
echo "DEPLOY_RELEASE sha=$REVISION path=$RELEASE"
ls -1dt "$APP_ROOT"/releases/* 2>/dev/null | tail -n +6 | xargs -r rm -rf
