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

## Backup operation checkpoint — 2026-10-07

The operator installed the inventory helper and completed the read-only host
preflight: app + PostgreSQL 16, two local named volumes, sufficient measured
space. Do not repeat the installer or audit solely for these completed facts.
The [cold backup / isolated restore runbook](oce-backup-restore.md) now defines
the fixed operator-only operation and its disposable CI validation. It requires
reviewed merge, root installation and an explicit maintenance window before
live execution. It is not automatically installed or started by deployment.
Global writer census, full application recovery, runtime pin and gateway
qualification are not marked complete by this implementation.

## Runtime digest pin — live qualified

The live backup/restore gate is complete for job
`b709caaf50a947a99d80536d3e8e76a2`: backup, isolated PostgreSQL restore,
live resume and cleanup are all verified. Do not take another backup outage
solely for the runtime pin.

`ops/oce-v1-runtime-pin.py` is the fixed root-only pin operation. It discovers
the registry `RepoDigest` attached to the exact already-running validated image
IDs; it does not treat Docker's local image ID as a registry manifest digest.
It refuses missing or ambiguous digests and never pulls `latest`.

The two existing Compose files remain byte-for-byte unchanged and form the
rollback configuration. The pin is a root-controlled final override at
`/etc/dao-oce/runtime-pin.yml` containing only immutable image references for
the OCE app and PostgreSQL. Before apply, the helper proves that rendering the
extra override changes only the two image fields. It also proves the original
resolved image references still map locally to the exact validated image IDs,
so rollback can run with `--pull never`.

`apply` recreates only the OCE app with `--no-deps --no-build --pull never`;
PostgreSQL is not restarted. It verifies the exact app image ID, the effective
digest reference, authoritative Compose source labels and OCE/database health.
Any failure removes the pin override and recreates the app from the original
two-file configuration with `--pull never`; a failed rollback is reported as
a distinct safe error.

After reviewed merge and green main CI/deploy, run from the exact deployed
release:

```bash
sudo -n python3 <release>/ops/oce-v1-runtime-pin.py plan
sudo -n python3 <release>/ops/oce-v1-runtime-pin.py apply
```

Only sanitized JSON is returned. Do not run ad-hoc `docker compose pull`,
`build` or a compose command omitting the root-controlled pin after a successful
apply.

## Dedicated OCE gateway identity

The dedicated D.A.O integration identity is a non-demo OCE `editor`.
Demo access is preserved by explicit DAO Pilot decision and remains a separate
operator/qualification path; it is never used by the D.A.O adapter.

`ops/oce-v1-identity.py` is a root-only local helper. It talks only to
`127.0.0.1:8080`, obtains the local demo-admin bootstrap session in memory,
creates or reconciles the fixed technical identity, and stores its generated
credential only in the root-owned `/etc/dao-oce/private` directory. Passwords
and JWTs are never emitted.

The helper exposes three fixed operations:

- `plan`: health and identity-state check, no write;
- `apply`: idempotent creation/reconciliation of the technical `editor`;
- `qualify`: one-time credential rotation, rejection of the old token,
  deactivate/reject/reactivate proof, and final login verification.

The live qualification completed on 2026-10-08: the technical identity is an
active `editor`, its secret remains protected on the VPS, password rotation
invalidated the previous token, account deactivation rejected both token and
login, reactivation restored login, and demo access remained enabled.

## Private deny-by-default gateway — implementation checkpoint

`ops/oce-v1-gateway.py` exposes only a Unix-domain HTTP socket to the exact
Linux uid running `dao-dev.service`. It also verifies the peer uid with
`SO_PEERCRED`; socket group membership alone is not authorization. The OCE
credential stays root-only. systemd `LoadCredential=` projects a private
read-only copy into the dedicated `dao-oce-gateway` service, so the `dao`
runtime never receives the password or bearer token.

The gateway has no generic proxy primitive. Its only operations are health,
readiness, ensure-project, ensure-WBS, ensure-schedule, upsert-activity by
stable `activity_code`, ensure-dependency, calculate-planning and
planning-summary. Request objects reject unknown fields. No caller-supplied
method, URL, OCE id, delete, user, finance, contract, legal, BIM or IFC call
can pass through.

A root-only `authorize <dao_project_id> <dao_lot_id>` operation creates the
explicit admission record before ensure-project is accepted; `revoke`
immediately makes that pair unusable. OCE ids live only in the private gateway
state. Every mapped project/WBS/schedule/activity/dependency is rechecked
against its parent and technical owner before use. Ambiguous writes are
reconciled through stable project codes, schedule names and activity codes
rather than blindly replayed.

Host activation is separate and fail-closed. It changes the existing OCE
`OE_BIND` to `127.0.0.1`, keeps a root-only backup of the previous Compose
environment, recreates only the OCE app with `--pull never` and re-verifies
the immutable digest plus authoritative Compose labels. The immutable image
may come either from the root-owned `/etc/dao-oce/runtime-pin.yml` final override
or directly from the active reviewed Compose files; in both cases the rendered
image must exactly equal the currently running digest before recreation. It installs a
dedicated nftables output guard denying uid `dao` any direct TCP/8080 path.
The gateway service uses a different uid.

**Operator access safety gate:** the currently functional public link
`http://137.74.168.122:8080/dashboard` will **stop being accessible** from
a normal remote browser after this loopback bind. The OCE demo login/accounts
are retained; the operator can still reach them through a separately prepared
SSH tunnel to the VPS. `plan` is read-only and reports this access impact.
`apply` refuses to run without the explicit
`--acknowledge-public-demo-link-closes` argument. Never invoke `apply` merely
because code/CI is green, or imply the original public URL stays reachable.
**Obtain the operator's separate approval of the access change and verify an
alternative access path before activation.** Installation itself starts no service
and changes neither Compose nor demo access.

`ops/oce-v1-gateway-qualify.py` uses fixed synthetic mappings and the real
`dao` uid to prove the positive project -> WBS -> schedule -> activities ->
dependency -> CPM/summary flow, idempotency, denied unknown operation, denied
extra fields, forged mapping, cross-project pair, mapping revocation, and both
loopback and direct-container bypass denial. It emits booleans only and never
reads the credential.

## Remaining implementation and qualification

1. Backup/restore, immutable OCE runtime pin and the dedicated technical
   identity/secret rotation gate are complete; do not repeat them without a
   new cause.
2. Validate and merge the private-gateway implementation, then install it from
   the exact green deployed release without starting services implicitly.
3. Run gateway-host `plan`; **stop there** unless the operator has
   separately approved closing the public OCE:8080 link and has verified an SSH
   tunnel/alternative to the same demo. The explicit activation command is
   `dao-oce-gateway-host apply --acknowledge-public-demo-link-closes`.
   After a successful activation, run the fixed live `gateway-qualify` suite.
   Record only sanitized output in #58.
4. Only after all bypass/mapping/operation gates pass, publish the exact gateway
   primitives to DEV. D.A.O retains business authority; durable product
   sync/journal/mapping orchestration remains Phase 2. No automatic
   contract/payment/award/legal state changes.

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
