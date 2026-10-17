#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${RUNNER_TEMP:?}"
: "${DEV_SSH_KEY:?Missing DEV SSH key}"
: "${DEV_SSH_HOST_FINGERPRINT:?Missing independently verified DEV host fingerprint}"
[[ "$DEV_SSH_HOST_FINGERPRINT" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]] || { echo "Invalid DEV host fingerprint format" >&2; exit 1; }
base="$RUNNER_TEMP/dao-secure-ssh"
mkdir -p -m 0700 "$base"
chmod 0700 "$base"
printf '%s\n' "$DEV_SSH_KEY" > "$base/id"
chmod 0600 "$base/id"
host=137.74.168.122
ssh-keyscan -T 12 -p 22 -t ed25519 "$host" 2>/dev/null > "$base/scan" || { echo "DEV host key unavailable" >&2; exit 1; }
awk -v h="$host" '$1 == h && $2 == "ssh-ed25519" {print}' "$base/scan" | sort -u > "$base/known_hosts"
test "$(wc -l < "$base/known_hosts")" -eq 1 || { echo "DEV host key missing or ambiguous" >&2; exit 1; }
observed="$(ssh-keygen -lf "$base/known_hosts" -E sha256 | awk 'NR==1 {print $2}')"
if [ "$observed" != "$DEV_SSH_HOST_FINGERPRINT" ]; then
  echo "DEV host does not match independently trusted host fingerprint" >&2
  exit 1
fi
cat > "$base/config" <<EOF
Host dao-dev
  HostName $host
  User dao
  IdentityFile $base/id
  UserKnownHostsFile $base/known_hosts
  StrictHostKeyChecking yes
  CheckHostIP yes
  IdentitiesOnly yes
  BatchMode yes
  PasswordAuthentication no
  ConnectTimeout 20
  LogLevel ERROR
EOF
chmod 0600 "$base/config" "$base/known_hosts"
echo "Verified DEV host identity and prepared OpenSSH"
