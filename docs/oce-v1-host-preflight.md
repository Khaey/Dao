# OCE V1 host preflight — operator checkpoint

This is a read-only diagnostic, not a backup, installer or deployment. It is
prepared on `chore/oce-v1-host-preflight` for issue #58. The operator executed
commit `8a3a7857fbcd649ad1fb34cf29a7450b29e57842` successfully on the VPS on
2026-10-07 at 21:57 Europe/Paris. Six local boundary/redaction tests pass.
Do not repeat this completed diagnostic without a relevant topology change.

## Confirmed by the operator, 2026-10-07 Europe/Paris

The PR #62 helper was installed successfully with `sudo -n` from the ubuntu
account. Its inventory confirms both configured DB URLs point to the same
PostgreSQL container; the OCE application has one writable named `/data`
volume, an unpinned runtime image and a wildcard port publication.

Both authoritative Compose files are in
`/home/ubuntu/dao/OpenConstructionERP/`:
`docker-compose.quickstart.yml` and `docker-compose.override.yml`.
The files are ubuntu:ubuntu mode 0664, the `dao` and `OpenConstructionERP`
directories ubuntu:ubuntu mode 0775, and `/home/ubuntu` mode 0750. This explains
the root-control check's failure. It is not proof of compromise or a service
failure. Do not recursively chown/chmod this existing checkout or restart OCE
to clear a diagnostic flag.

## Run the reviewed diagnostic

Completed result: exactly `app` and `postgres`, PostgreSQL 16, local named
volumes at `/data` and `/var/lib/postgresql/data`, no extra Compose service,
no database published port, no entrypoint/command override. Live volume
allocation was 312020992 + 280879104 bytes; free space 18611904512 bytes.
The `.env` exists; its values were not printed. Both services were running.
`compose_version: other` is a redaction category, not a Compose failure.
The next step is the [cold backup and isolated restore](oce-backup-restore.md).

Download `ops/oce-v1-preflight.py` from the immutable commit linked in #58 and
run it with `python3` as **ubuntu**, not through `sudo python3`. Root invocation
is deliberately refused. It uses the operator's existing non-interactive sudo
rights only for fixed local Docker inspection and named-volume size/stat
commands; it grants nothing to the automation account `dao`.

The script renders the two known Compose sources as the ordinary login user,
using `config --format json --no-interpolate --no-env-resolution`.
See the [official command reference](https://docs.docker.com/reference/cli/docker/compose/config/).
No rendered configuration or raw subprocess error is printed. Output includes
only structural service/mount metadata, image identities, volume allocation and
available filesystem bytes. Environment values, command bodies, health checks,
labels and driver-option values are excluded; variable expressions/defaults
are withheld. Configuration source/target paths are structural metadata and
may appear in this private operator report.

The script never starts/stops/executes a container, connects to PostgreSQL,
creates a backup or changes any file/service/network. The total subprocess
budget is 55 seconds. Unsupported storage or failed size queries are marked
unavailable, never assumed to be empty. Compose errors are reported without
their bodies. Named-volume sizes are live estimates, not a consistent snapshot
or a sufficient capacity guarantee for a backup/restore operation.

The emitted JSON has been received. Do not send full Compose, environment or
Docker inspect output. Runtime custody/pin still follows a qualified backup;
the new host operation must pass its PR/CI/merge cycle before root installation.

Gateway implementation, native editor credential isolation, revocation/rotation,
mapping checks and direct-call bypass tests remain incomplete. The approved
gateway decision stands; there is no READY handoff to DEV. Previous audit #45
and PoC #54 remain complete and must not be repeated.
