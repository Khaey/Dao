#!/usr/bin/env bash
# Nonprivileged router from the protected main checkout; sudo verbs stay fixed.
set -euo pipefail
[[ $# == 3 && "$2" =~ ^[0-9]+$ && "$3" =~ ^[0-9]+$ ]] || exit 2
operation="$1"
payload_dir="/opt/dao/ops-incoming/$2-$3"
env_state=not_attempted
env_recovery_needed=0
env_phase=prepare
finish() {
  local status=$? cleanup_status
  local restart_state=not_needed readiness_state=not_checked cleanup_state=complete outcome=not_needed
  trap - EXIT
  if [[ "$operation" == env-sync && "$status" != 0 ]]; then
    if [[ "$env_recovery_needed" == 1 ]]; then
      outcome=incomplete
      if [[ "$env_state" == updated ]]; then
        env_state=failed
        if sudo -n /usr/local/sbin/dao-dev-admin env-restore >/dev/null 2>&1; then
          env_state=restored
        fi
      fi
      restart_state=failed
      if sudo -n /usr/bin/systemctl restart dao-dev.service >/dev/null 2>&1; then
        restart_state=complete
      fi
      if [[ "$restart_state" == complete && ( "$env_state" == restored || "$env_state" == unchanged ) ]]; then
        readiness_state=failed
        if bash validate-dev.sh http://127.0.0.1:3000 --once >/dev/null 2>&1; then
          readiness_state=passed
          outcome=complete
        fi
      fi
    elif [[ "$env_state" == unverified ]]; then
      outcome=incomplete
    fi
  fi
  if rm -f -- "$payload_dir/dao-env.json" >/dev/null 2>&1; then
    :
  else
    cleanup_status=$?
    cleanup_state=failed
    outcome=incomplete
    if [[ "$status" == 0 ]]; then status=$cleanup_status; env_phase=cleanup; fi
  fi
  # The transported scripts keep this directory nonempty until workflow cleanup.
  rmdir -- "$payload_dir" 2>/dev/null || true
  if [[ "$operation" == env-sync && "$status" != 0 ]]; then
    printf '{"env_sync_recovery":"%s","original_status":%d,"phase":"%s","environment":"%s","restart":"%s","readiness":"%s","cleanup":"%s"}\n' \
      "$outcome" "$status" "$env_phase" "$env_state" "$restart_state" "$readiness_state" "$cleanup_state" || true
  elif [[ "$cleanup_state" == failed ]]; then
    echo 'OPS_PAYLOAD_CLEANUP_FAILED' >&2
  fi
  exit "$status"
}
trap finish EXIT
# Actions transports these public scripts independently of the active release.
# A missing/broken current link must not block installed helper recovery.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
case "$operation" in
  restart|env-sync|ops-upgrade|ops-rollback)
    env_phase=lock
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
    env_phase=payload
    [[ -s "$payload_dir/dao-env.json" && ! -L "$payload_dir/dao-env.json" ]]
    chmod 0600 "$payload_dir/dao-env.json" 2>/dev/null
    env_phase=sync
    env_state=unverified
    result="$(sudo -n /usr/local/sbin/dao-dev-admin env-sync 2>/dev/null < "$payload_dir/dao-env.json")"
    case "$result" in
      'ENV_SYNC unchanged') env_state=unchanged ;;
      'ENV_SYNC updated keys=DAO_EMAIL_FROM'|'ENV_SYNC updated keys=DAO_PUBLIC_URL'|'ENV_SYNC updated keys=RESEND_API_KEY'|\
      'ENV_SYNC updated keys=DAO_EMAIL_FROM,DAO_PUBLIC_URL'|'ENV_SYNC updated keys=DAO_EMAIL_FROM,RESEND_API_KEY'|\
      'ENV_SYNC updated keys=DAO_PUBLIC_URL,RESEND_API_KEY'|'ENV_SYNC updated keys=DAO_EMAIL_FROM,DAO_PUBLIC_URL,RESEND_API_KEY')
        env_state=updated
        env_recovery_needed=1
        ;;
      *) exit 1 ;;
    esac
    env_phase=payload_cleanup
    rm -f -- "$payload_dir/dao-env.json" >/dev/null 2>&1
    printf '%s\n' "$result"
    env_recovery_needed=1
    env_phase=restart
    sudo -n /usr/bin/systemctl restart dao-dev.service >/dev/null 2>&1
    env_phase=readiness
    bash validate-dev.sh http://127.0.0.1:3000
    env_recovery_needed=0
    env_phase=status
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
