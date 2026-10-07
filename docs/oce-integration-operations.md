# OCE Integration V1 — operational gates (#58)

Status: preparation, **not ready for DEV integration or production dependency**.
The approved decision and live execution record are in
[issue #58](https://github.com/Khaey/Dao/issues/58).
The completed audit #45 and synthetic PoC #54 must not be rerun.

## Approved gateway boundary

DAO Pilot approved a private bounded gateway on 2026-10-07. The gateway will
hold a dedicated non-demo, non-admin OCE `editor` credential. D.A.O receives
only the gateway interface, never an OCE password or bearer token. No D.A.O
identity/JWT secret is shared with OCE. The native editor credential still has
broader permissions: this is an explicitly accepted compensating control,
**not native OCE least privilege**.

The allowlist is closed: health/readiness, ensure-project, ensure-WBS,
ensure-schedule, upsert-activity by stable `activity_code`, ensure-dependency,
calculate/read-planning-summary. No generic HTTP proxy or arbitrary method,
URL, path, OCE identifier or request body. No delete, users, finance, config,
contracts, legal reception, BIM or IFC operations.

Every command must resolve a previously authorized D.A.O project/lot mapping
and verify OCE object ownership. Initial ensure-project requires an authorized
D.A.O project registration; merely supplying a UUID is not authorization.
Opaque technical IDs must never become cross-project capabilities. Mapping
creation/revocation, caller authentication and transport are implementation
gates, not assumed properties of loopback networking.

Before handoff, prove rejected unknown operations, extra fields, forged and
cross-project mappings, and direct OCE bypass attempts from the actual D.A.O
runtime identity. Network isolation alone does not replace object checks.
Inspect demo/login exposure and every reachable direct path to OCE; a Unix
socket or loopback listener alone does not prove the caller cannot bypass it.
Rotation must invalidate the old credential/session as appropriate, and account
deactivation must reject a previously valid token. Test on synthetic resources.

## Current deliverable: bounded infrastructure inventory

`oce-integration-inventory` is a new operation of the existing root-owned
`dao-dev-admin` helper. The old helper's audit does not identify the DB target,
Compose authority or other possible writers needed to design a coherent backup.
This targeted prerequisite is separate from the completed API/converter audit.

The operation takes no arguments or stdin. It inspects only the fixed
`openconstructionerp-app-1`, lists at most 64 local containers, inspects those
containers and the active image (four read-only Docker calls, each at most
12 seconds). Docker JSON is retained only in process memory. No Docker exec,
Compose execution, service restart, DB connection, file-content read or write
is performed. No account, credential or network rule is created.

Output is an allowlisted JSON summary:

- recognized immutable OCE image digests and whether the runtime reference is
  already a digest;
- Compose label presence, configuration file count and whether paths and their
  ancestors are root-owned, non-writable by others and not symlinks;
- `/data` mount type/writability and possible related containers using anonymous
  aliases, including containers sharing parent/child bind paths;
- known database URL keys classified by engine and target alias; no DSN,
  username, password, hostname, IP, database name, filesystem path or env value;
- published container ports classified as loopback/wildcard/specific interface,
  host-network/privileged flags and free space on the host root filesystem.

Missing DSNs remain unknown. SQLAlchemy absolute SQLite URLs under `/data`
are hints only; the database file is not opened. Shared storage/network or
Compose membership identifies possible peers, not a complete writer census.
Host processes, external databases, aliases outside Docker and proxy/firewall
routes still require qualification. Root filesystem free space is not a volume
capacity measurement. No backup, restore or bypass acceptance gate is marked
successful by this report.

### One-time operator installation

After this change is merged and its main CI/deploy succeeds, an operator with
existing root access runs from that reviewed deployed checkout:

```bash
bash ops/install-dev-admin.sh
/usr/local/sbin/dao-dev-admin oce-integration-inventory
```

The installer updates the root-owned helper and its exact sudoers allowlist.
It grants no Docker group membership, generic sudo, arbitrary command or
caller-controlled file path. Existing environment operations remain unchanged.
Do not run an unreviewed branch installer as root. The Work's `dao` identity
cannot install a new root operation using the old helper; this is an access
boundary, not a missing consent for routine work.

After installation, **DAO DEV operations** on `main` can repeat the same fixed
inventory using the protected Actions SSH identity. It is manual-only, emits
the sanitized report and publishes no artifact. A GitHub connector without
Actions dispatch cannot claim the workflow ran. The operator can instead
return the JSON from the second command above; no full inspect/config output.

## Remaining implementation and qualification

1. Use the inventory to establish authoritative Compose configuration, exact
   DB topology/storage, all writers and safe capacity. Unknowns fail closed.
2. Prepare reviewed, fixed-purpose host operations for coherent DB + `/data`
   backup and isolated restore, with bounded quiescence, guaranteed resume on
   errors, private checksummed manifests, capacity checks and cleanup. Restore
   must have separate DB/volumes/network, no public ports, no outbound messages
   and no writable production mounts. Local backups alone do not cover VPS
   loss; retention/off-host copying must be settled before production.
3. Pin the verified running digest in the authoritative startup configuration;
   preserve ports/mounts/environment and a rollback configuration. Do not pull
   `latest`. Do not recreate OCE before a qualified backup and maintenance window.
4. Provision the isolated technical identity and gateway, then run negative
   permissions/bypass tests and real rotation/revocation checks. Secrets stay
   on VPS under root/service ownership, outside the `dao` group, CI and logs.
5. Publish exact implemented primitives to DEV only after these gates pass.
   D.A.O retains business authority and its durable sync journal/mapping work
   remains Phase 2. No automatic contract/payment/award/legal state changes.

Proposed transport bounds for implementation: connect 2 s, read 10 s, CPM 30 s,
global operation 40 s, bounded body sizes. At most two retries for reads on
transport/502/503/504, bounded jitter and capped 429 Retry-After; no retry on
401/403/validation failures. No blind POST/PATCH retry: reconcile stable identity
after ambiguous timeout before issuing another write. Serialize per project.
Circuit opens after five consecutive technical failures for 60 s, then one
probe. These are proposed budgets, not live measurements. A gateway failure
must leave unrelated commercial D.A.O functions usable.

Logs may contain only allowlisted operation/result/status/duration/attempt and
opaque correlation fields, never bodies, URLs, names, documents or credentials.
Update C4/Structurizr when the actual adapter is implemented, as explicitly
scoped by #58; do not depict this preparation as an operational integration.
