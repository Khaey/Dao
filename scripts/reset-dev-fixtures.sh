#!/usr/bin/env bash
set -euo pipefail
# Deliberately plan-only until exact permanent TEST account/resource IDs exist.
if [ "${1:---plan}" != --plan ]; then
  echo 'Reset refused: no approved DEV fixture manifest/implementation. Never reset the shared database.' >&2
  exit 2
fi
cat <<'EOF'
DEV_FIXTURE_RESET status=plan_only
Permanent TEST accounts: provision through existing standard Auth administration.
Identify exact client/artisan/reviewer IDs in an access-controlled manifest.
Default reset: rotate scenario namespace; create fresh TEST projects via normal APIs.
Preserve accounts, memberships required by fixtures, submitted offers and immutable history.
No shared DEV db reset, broad email-prefix deletion, RLS bypass or Auth-policy changes.
No data was read or modified. See docs/platform-operations.md.
EOF
