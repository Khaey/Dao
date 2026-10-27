#!/usr/bin/env bash
# Start the disposable local Supabase stack, retrying only on registry
# rate limits (ghcr.io "toomanyrequests"). Any other failure, including a
# migration or seed error, fails immediately so the gate is never bypassed.
#
# Attempt 1 and 2 use ghcr.io (authenticated by the workflow when possible);
# the last attempt falls back to the public ECR mirror of the same images.
set -uo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: supabase-start-with-retry.sh <supabase start args...>" >&2
  exit 2
fi

max_attempts="${DAO_SUPABASE_START_ATTEMPTS:-3}"
fallback_registry="${DAO_SUPABASE_FALLBACK_REGISTRY:-public.ecr.aws}"
log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT

attempt=1
while :; do
  if [ "$attempt" -eq "$max_attempts" ] && [ "$attempt" -gt 1 ]; then
    export SUPABASE_INTERNAL_IMAGE_REGISTRY="$fallback_registry"
  fi
  echo "Supabase start attempt ${attempt}/${max_attempts} (registry: ${SUPABASE_INTERNAL_IMAGE_REGISTRY:-cli default})"

  supabase start "$@" 2>&1 | tee "$log_file"
  status=${PIPESTATUS[0]}
  if [ "$status" -eq 0 ]; then
    exit 0
  fi

  if ! grep -qiE 'toomanyrequests|failed to pull docker image|429 Too Many Requests' "$log_file"; then
    echo "Supabase start failed for a reason other than an image pull rate limit; not retrying." >&2
    exit "$status"
  fi
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "::error::Supabase images still rate limited after ${max_attempts} attempts (ghcr.io and ${fallback_registry})."
    exit "$status"
  fi

  delay=$((attempt * 45))
  echo "::warning::Image registry rate limit on attempt ${attempt}; stopping partial stack and retrying in ${delay}s."
  supabase stop --no-backup >/dev/null 2>&1 || true
  sleep "$delay"
  attempt=$((attempt + 1))
done
