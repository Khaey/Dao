#!/usr/bin/env bash
set -uo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: measure-ci-step.sh <label> <command> [args...]" >&2
  exit 2
fi

label="$1"
shift
started_at_ms="$(date +%s%3N)"

set +e
"$@"
status=$?
set -e

finished_at_ms="$(date +%s%3N)"
duration="$(awk -v start="$started_at_ms" -v end="$finished_at_ms" 'BEGIN { printf "%.2f", (end - start) / 1000 }')"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  summary_line="| ${label} | ${duration}s |"
  printf '%s\n' "$summary_line" | tee -a "$GITHUB_STEP_SUMMARY"
else
  printf '%s: %ss\n' "$label" "$duration"
fi

exit "$status"
