#!/usr/bin/env bash
# Stage only the fixed non-root operations scripts, plus an optional private env
# payload. Called from the protected main checkout, never from user input.
set -euo pipefail
[[ $# == 2 && "$1" =~ ^[0-9]+$ && "$2" =~ ^[0-9]+$ ]] || exit 2
destination="ops-incoming/$1-$2"
[[ ! -e "$destination" && ! -L "$destination" ]] || exit 2
install -d -m 0755 "$destination/scripts"
for name in dao-operations.sh dev-status.sh validate-dev.sh dao-ops-diagnostics.py; do
  install -m 0644 "scripts/$name" "$destination/scripts/$name"
done
if [[ -e dao-env.json || -L dao-env.json ]]; then
  [[ -f dao-env.json && ! -L dao-env.json ]] || exit 2
  mv -- dao-env.json "$destination/dao-env.json"
  # Preserve the existing short scp-container boundary. The router changes this
  # to 0600 before helper consumption; Actions always cleans runner and host.
  chmod 0644 "$destination/dao-env.json"
fi
echo 'OPS_TRANSPORT_PREPARED scripts=4'
