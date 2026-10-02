#!/usr/bin/env bash
set -euo pipefail
exec python3 "$(dirname "${BASH_SOURCE[0]}")/dao_task_check.py" "$@"
