#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
run="${1:?Missing run ID}"
attempt="${2:?Missing attempt}"
[[ "$run" =~ ^[0-9]+$ && "$attempt" =~ ^[0-9]+$ ]] || exit 2
parent=/opt/dao
root="$parent/ops-incoming"
dir="$root/$run-$attempt"
test -d "$parent" && test ! -L "$parent" && test -O "$parent"
test -z "$(find "$parent" -maxdepth 0 -perm /002 -print -quit)"
if [ -e "$root" ] || [ -L "$root" ]; then
  # The existing OPS/SCP transport creates this shared parent as 0755.
  # Verify identity BEFORE changing mode. The private deploy must never
  # reuse a foreign-owned path or traverse an existing symlink.
  if [ ! -d "$root" ] || [ -L "$root" ]; then
    echo "DEV_PRIVATE_STAGE_REJECTED reason=directory_type" >&2
    exit 1
  fi
  if [ ! -O "$root" ]; then
    echo "DEV_PRIVATE_STAGE_REJECTED reason=directory_owner" >&2
    exit 1
  fi
fi
# GNU install -d -m updates the mode of a pre-existing owned directory.
# Restrict legacy 0755 OPS staging to 0700 before creating any credentials.
install -d -m 0700 "$root"
test -O "$root"
test "$(stat -c '%a' "$root")" = 700
stale_count="$(find "$root" -mindepth 1 -maxdepth 1 -type d -user "$(id -un)" -mmin +1440 -regextype posix-extended -regex '.*/[0-9]+-[0-9]+' -print | wc -l)"
find "$root" -mindepth 1 -maxdepth 1 -type d -user "$(id -un)" -mmin +1440 -regextype posix-extended -regex '.*/[0-9]+-[0-9]+' -exec rm -rf -- {} +
test ! -e "$dir" && test ! -L "$dir"
mkdir -m 0700 "$dir"
echo "Private DEV staging prepared; stale cleaned count=$stale_count"
