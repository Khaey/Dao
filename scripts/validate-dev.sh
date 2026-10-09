#!/usr/bin/env bash
set -euo pipefail
# Read-only HTTP readiness. No credentials, emails, mutations or FULL E2E.
base="${1:-https://dao-dev.logiclab.fr}"
attempts=15
case "$#:${2:-}" in
  0:|1:) ;;
  2:--once) attempts=1 ;;
  *) echo 'SMOKE refused: expected optional --once' >&2; exit 2 ;;
esac
case "$base" in
  https://dao-dev.logiclab.fr|http://127.0.0.1:3000) ;;
  *) echo 'SMOKE refused: expected D.A.O DEV or local runtime' >&2; exit 2 ;;
esac
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for route in /auth/login /auth/register /auth/forgot-password; do
  ready=0
  for ((attempt=1; attempt<=attempts; attempt++)); do
    code="$(curl --silent --output "$tmp/body" --write-out '%{http_code}' \
      --connect-timeout 2 --max-time 5 "$base$route" 2>/dev/null)" || code=000
    if [ "$code" = 200 ] && grep -qi '<html' "$tmp/body" \
      && grep -q '/_next/static/' "$tmp/body"; then
      ready=1
      break
    fi
    [ "$attempt" = "$attempts" ] || sleep 2
  done
  if [ "$ready" != 1 ]; then
    echo "SMOKE FAIL route=$route http=$code (body withheld)" >&2
    exit 1
  fi
  echo "SMOKE PASS route=$route http=200"
done
