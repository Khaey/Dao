#!/usr/bin/env bash
# Nonprivileged router from the protected main checkout; sudo verbs stay fixed.
set -euo pipefail
[[ $# == 3 && "$2" =~ ^[0-9]+$ && "$3" =~ ^[0-9]+$ ]] || exit 2
operation="$1"
payload_dir="/opt/dao/ops-incoming/$2-$3"
cleanup() { rm -f -- "$payload_dir/dao-env.json"; rmdir -- "$payload_dir" 2>/dev/null || true; }
trap cleanup EXIT
# Actions transports these public scripts independently of the active release.
# A missing/broken current link must not block installed helper recovery.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
case "$operation" in
  restart|env-sync|ops-upgrade|ops-rollback)
    exec 9>/opt/dao/.deploy.lock
    flock -w 120 9 || { echo 'OPS_BUSY'; exit 1; }
    ;;
esac
case "$operation" in
  status) bash dev-status.sh ;;
  health) bash validate-dev.sh http://127.0.0.1:3000 ;;
  restart)
    sudo -n /usr/bin/systemctl restart dao-dev.service
    bash validate-dev.sh http://127.0.0.1:3000
    bash dev-status.sh
    ;;
  env-sync)
    [[ -s "$payload_dir/dao-env.json" && ! -L "$payload_dir/dao-env.json" ]]
    chmod 0600 "$payload_dir/dao-env.json"
    result="$(sudo -n /usr/local/sbin/dao-dev-admin env-sync < "$payload_dir/dao-env.json")"
    rm -f -- "$payload_dir/dao-env.json"
    printf '%s\n' "$result"
    if ! sudo -n /usr/bin/systemctl restart dao-dev.service || ! bash validate-dev.sh http://127.0.0.1:3000; then
      if [[ "$result" == ENV_SYNC\ updated* ]]; then
        sudo -n /usr/local/sbin/dao-dev-admin env-restore
        sudo -n /usr/bin/systemctl restart dao-dev.service
        bash validate-dev.sh http://127.0.0.1:3000
      fi
      exit 1
    fi
    bash dev-status.sh
    ;;
  log-summary) sudo -n /usr/local/sbin/dao-dev-admin log-summary ;;
  oce-integration-inventory) sudo -n /usr/local/sbin/dao-dev-admin oce-integration-inventory ;;
  oce-gateway-plan) sudo -n /usr/local/sbin/dao-dev-admin oce-gateway-plan ;;
  diagnostics) python3 dao-ops-diagnostics.py ;;
  ops-status) sudo -n /usr/local/sbin/dao-ops-admin status ;;
  ops-preflight) sudo -n /usr/local/sbin/dao-ops-admin preflight ;;
  ops-upgrade) sudo -n /usr/local/sbin/dao-ops-admin upgrade ;;
  ops-rollback) sudo -n /usr/local/sbin/dao-ops-admin rollback ;;
  backup-status) sudo -n /usr/local/sbin/dao-ops-admin backup-status ;;
  oce-status) sudo -n /usr/local/sbin/dao-oce-private-admin status ;;
  oce-audit) sudo -n /usr/local/sbin/dao-oce-private-admin audit ;;
  oce-probe) sudo -n /usr/local/sbin/dao-oce-private-admin probe ;;
  oce-start) sudo -n /usr/local/sbin/dao-oce-private-admin start ;;
  oce-stop) sudo -n /usr/local/sbin/dao-oce-private-admin stop ;;
  *) echo 'Unsupported operation'; exit 2 ;;
esac
