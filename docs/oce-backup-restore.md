# OCE cold backup and isolated restore — issue #58

This operator-only helper prepares the observed OCE + PostgreSQL 16 pair for
the later runtime pin and gateway work. It does not restore over live data,
recreate the original containers, modify Compose, pull an image, provision an
OCE account or grant new sudo permissions. It never runs automatically on
deployment or boot. Audit #45 and PoC #54 remain complete.

## Observed prerequisite and scope

The operator preflight on 2026-10-07 confirmed two running containers and two
local named volumes, about 593 MB allocated with 18.6 GB available. The helper
rechecks the actual containers, database URL targets, images, volume ownership,
health and logical capacity immediately before stopping anything. The accepted
image IDs are the exact IDs returned by that preflight, not mutable tags:

- app: `sha256:7621593064354a1df414f6598ae7f844bf8d12dc5977537f2297642fc4b523d3`;
- PostgreSQL: `sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685`.

Additional Compose services, any container sharing the data paths (including
parent bind mounts), exposed PostgreSQL, external database targets, non-local
volumes, alternate PGDATA, PostgreSQL symlinks/tablespaces, special files and
runtime drift are rejected. Logical data is limited to 2 GiB / 100000 entries
per archive, 2 GiB combined, with conservative disk reserve checks.

Arrange a maintenance window: pause OCE use and any host script or scheduled
job that directly writes these volumes. Do not run concurrent Docker/Compose
changes during the operation. The Docker census cannot prove absence of host
writers or future external jobs; this operation alone must not mark the global
`all_writers_verified` gateway qualification gate as passed.

## Install and execute after reviewed merge and green main CI

Use the exact deployed release recorded in #58. From its repository root, the
ubuntu operator with existing passwordless sudo runs:

```bash
sudo -n bash ops/install-oce-backup.sh
sudo -n /usr/local/sbin/dao-oce-backup plan
```

Installation copies only the helper and systemd unit. `plan` checks readiness
without stopping services; it may create the root-private backup directory.
Only the following command initiates the temporary OCE outage:

```bash
sudo -n /usr/local/sbin/dao-oce-backup start
sudo -n /usr/local/sbin/dao-oce-backup status
```

`start` returns after queuing systemd work. The operation continues if SSH
disconnects. Read `status` again while it progresses; do not submit another
start. Success requires `phase: complete` and all four flags true:
`backup_complete`, `restore_verified`, `live_resumed`, `cleanup_complete`.
Return only this sanitized JSON. No raw logs, archives, env or inspect output.

## What the operation verifies

1. Stop the original app with a 30-second grace period; reject an unclean exit.
   Read the local database version, relation count and cluster identifier.
2. Stop PostgreSQL cleanly, reject forced termination, and verify its control
   file says `shut down`. Archive both full volumes while both originals are
   stopped, including the complete PostgreSQL cluster/WAL. Hash the archives
   and every regular file; store metadata privately. The combined archive/hash
   deadline is 120 seconds. Total outage also includes stopping and readiness.
3. In a `finally` path, start the exact original PostgreSQL container and then
   the exact original app. Confirm local database readiness and OCE health.
4. Restore both archives into new UUID-labelled disposable volumes. Validate
   paths, types, ownership, modes and every file hash without following links.
   Start only a cloned PostgreSQL, using its exact local image, no network,
   no ports and no live writable mount. Compare its version, cluster identity
   and relation count with the stopped source. Do not start a cloned OCE app
   that might execute jobs or send messages.
5. Remove only this job's labelled clone containers/volumes. Keep private
   archives/manifests and the safe result. A cleanup failure prevents success.

Thus `restore_verified` means full-volume file restoration plus a real isolated
PostgreSQL boot/query. It is not a full OCE application recovery rehearsal,
off-host disaster recovery, row-by-row semantic validation or gateway approval.
PostgreSQL's [physical backup requirements](https://www.postgresql.org/docs/16/backup-file.html)
require shutdown and the complete cluster; live tar of a running database is
not used. Docker's [stop command](https://docs.docker.com/reference/cli/docker/container/stop/)
can force termination after its grace period, which is explicitly rejected.

## Restore-only re-verification after a qualified backup

If `backup_complete: true`, `live_resumed: true` and `cleanup_complete: true` but
the isolated restore failed, do not take another outage just to diagnose the
clone. After the worker is inactive, the reviewed helper can replay only the
retained archives into fresh disposable clone volumes:

```bash
sudo -n /usr/local/sbin/dao-oce-backup verify-restore
```

This mode never stops the live app or PostgreSQL. It revalidates retained
archive hashes, requires the original runtime identity to be unchanged, checks
current OCE/database health, recreates only UUID-labelled disposable restore
volumes, boots the isolated PostgreSQL clone, compares its fixed database proof,
and removes the clone again. Failure messages are mapped to fixed safe
categories; raw PostgreSQL logs, credentials and private metadata are not
printed. A successful replay upgrades the retained job to `phase: complete`
with all four success flags true.

## Failure recovery and retained data

`ExecStopPost` runs the same recovery hook after success, failure, service stop
or the 10-minute worker limit. It revalidates original container/image/volume
identities before resuming them, attempts app start even if database readiness
fails, and removes only owned clones. Recovery has a separate 5-minute limit.
This is bounded recovery, not a guarantee against host/Docker failure or power
loss. There is deliberately no automatic production restore.

If status is `recovery_failed` or `live_resumed: false`, first inspect the safe
service state. After the worker is no longer active, retry the fixed hook:

```bash
sudo -n systemctl is-active dao-oce-backup.service
sudo -n /usr/local/sbin/dao-oce-backup recover
sudo -n /usr/local/sbin/dao-oce-backup status
```

Do not force-delete volumes or recreate containers to clear a failure. Any
changed original identity requires operator review. A failed job's partial
archives are not qualified backups. Do not overwrite the previous state by
starting another job while recovery or cleanup remains unresolved.

Archives, manifests and selected app/PG runtime metadata remain under
`/var/backups/dao-oce/<job-id>` (root 0700, files 0600). Runtime metadata can
contain credentials; archives are unencrypted and never published as CI
artifacts. There is no automatic retention deletion. Capacity is rechecked
each run. Off-host encrypted retention and full application recovery remain
separate prerequisites before production readiness.

## Validation boundary

Local tests cover topology refusal, archive roundtrip, path/link safety,
checksums, redaction and failure resume. The dedicated disposable GitHub CI
job uses synthetic nginx health + PostgreSQL data, actual Docker volumes and
a real isolated PostgreSQL restore, then injects an archive failure and checks
that originals resume. It also validates installation/unit syntax on its own
runner. It does not access the VPS or use product credentials. Main's existing
full CI/deploy suite remains unchanged. Exact run outcomes and the later VPS
execution evidence belong in #58; implementation alone is not live proof.
