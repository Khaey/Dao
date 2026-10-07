#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'Root installation required.' >&2; exit 1; }
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "$(systemctl is-active dao-oce-backup.service || true)" in
  active|activating|deactivating|reloading) echo 'Backup service is busy.' >&2; exit 1 ;;
esac
install -o root -g root -m 0755 "$source_dir/dao-oce-backup.py" /usr/local/sbin/dao-oce-backup
install -o root -g root -m 0644 "$source_dir/dao-oce-backup.service" /etc/systemd/system/dao-oce-backup.service
systemd-analyze verify /etc/systemd/system/dao-oce-backup.service
systemctl daemon-reload
echo 'OCE backup helper installed; no service started and no sudo access granted.'
