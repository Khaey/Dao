#!/usr/bin/env bash
set -euo pipefail
operation="${1:---plan}"
case "$operation" in
  --plan)
    cat <<'EOF'
DEV_FIXTURE_RESET status=plan_only
Permanent TEST accounts are resolved by their protected DEV credentials.
The apply path archives only projects owned/initiated by the two TEST accounts
and revokes only their pending invitations. Accounts, memberships, documents,
submitted offers, audit history and Storage objects are preserved.
No shared DEV database reset, broad email-prefix deletion, RLS bypass or Auth
policy change is permitted. No data was read or modified.
EOF
    ;;
  --apply)
    : "${DAO_FIXTURE_TARGET:?DAO_FIXTURE_TARGET=dev is required for a mutation}"
    [ "$DAO_FIXTURE_TARGET" = dev ] || { echo 'Reset refused: target must be dev' >&2; exit 2; }
    exec node "$(dirname "${BASH_SOURCE[0]}")/dev-test-fixtures.mjs" reset
    ;;
  *)
    echo 'Usage: bash scripts/reset-dev-fixtures.sh [--plan|--apply]' >&2
    exit 2
    ;;
esac
