#!/usr/bin/env bash
# Start the disposable local Supabase stack, retrying only on registry
# rate limits ("toomanyrequests"). Any other failure, including a
# migration or seed error, fails immediately so the gate is never bypassed.
#
# Registries are tried in order, one per attempt. Docker Hub comes first: on
# GitHub-hosted runners it is not subject to the shared-IP throttling that
# ghcr.io and public.ecr.aws apply to Supabase images ("toomanyrequests",
# "Data limit exceeded"). ghcr.io (authenticated by the workflow) and the
# public ECR mirror remain as fallbacks.
set -uo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: supabase-start-with-retry.sh <supabase start args...>" >&2
  exit 2
fi

read -r -a registries <<< "${DAO_SUPABASE_REGISTRIES:-docker.io ghcr.io public.ecr.aws}"
max_attempts="${#registries[@]}"
log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT

attempt=1
while :; do
  export SUPABASE_INTERNAL_IMAGE_REGISTRY="${registries[$((attempt - 1))]}"
  echo "Supabase start attempt ${attempt}/${max_attempts} (registry: ${SUPABASE_INTERNAL_IMAGE_REGISTRY})"

  supabase start "$@" 2>&1 | tee "$log_file"
  status=${PIPESTATUS[0]}
  if [ "$status" -eq 0 ]; then
    # Later steps (db reset, stop) must resolve the same image names.
    if [ -n "${GITHUB_ENV:-}" ]; then
      echo "SUPABASE_INTERNAL_IMAGE_REGISTRY=${SUPABASE_INTERNAL_IMAGE_REGISTRY}" >> "$GITHUB_ENV"
    fi
    exit 0
  fi

  if ! grep -qiE 'toomanyrequests|failed to pull docker image|429 Too Many Requests' "$log_file"; then
    echo "Supabase start failed for a reason other than an image pull rate limit; not retrying." >&2
    exit "$status"
  fi
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "::error::Supabase images still rate limited after ${max_attempts} attempts (${registries[*]})."
    exit "$status"
  fi

  delay=$((attempt * 30))
  echo "::warning::Image registry rate limit on attempt ${attempt}; stopping partial stack and retrying in ${delay}s."
  supabase stop --no-backup >/dev/null 2>&1 || true
  sleep "$delay"
  attempt=$((attempt + 1))
done
