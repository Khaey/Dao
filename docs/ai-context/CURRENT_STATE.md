# D.A.O — Current State

## OPT #58 — host preflight received; bounded backup/restore prepared (2026-10-07)

Verified base remains main `6741f60f0401cf0846db58739c953883eb5d0de5`,
CI/deploy #316 (`37645521354`) green. The operator ran preflight commit
`8a3a7857fbcd649ad1fb34cf29a7450b29e57842` at 21:57 Europe/Paris:
app + PostgreSQL 16, two local named volumes, 593 MB allocated / 18.6 GB free,
both running, no restart. Do not repeat that completed diagnostic.

Owned branch `chore/oce-v1-host-preflight` now prepares the fixed operator-only
cold backup and isolated PostgreSQL restore, systemd recovery, private
checksummed archives, safe status and disposable Docker validation. No new dao
sudo grant; no automatic VPS execution. See [backup operation](../oce-backup-restore.md).
Local 19 tests and shell/Python syntax passed before publication. Actual PR/main
CI, merged release and operator execution outcomes are recorded in
[issue #58](https://github.com/Khaey/Dao/issues/58); they are not inferred here.

A real backup still requires root installation from the reviewed merged release
and an operator-triggered maintenance window. Restore proof covers files and
an isolated PostgreSQL boot, not a full OCE recovery or all host writers.
Runtime custody/pin, full recovery qualification and private gateway gates
remain open: no READY DEV handoff. WORK DEV PR #68 and older docs PRs #34/#46
are untouched. The checkpoints below are historical where superseded.

## OPT #58 — operator bootstrap confirmed; host preflight prepared (2026-10-07)

Main `6741f60f0401cf0846db58739c953883eb5d0de5`, CI/deploy #316 green.
The operator installed the PR #62 helper successfully with `sudo -n` and
returned its sanitized inventory at 20:38 Europe/Paris. Both DB URL hints
resolve to the same postgres peer. At 20:45, the operator confirmed the two
Compose sources and their ancestors are ubuntu-owned and group-writable;
this explains the root-control flag without implying an OCE outage.

Owned branch `chore/oce-v1-host-preflight` prepares a consolidated read-only
operator probe: Compose structural metadata and live named-volume capacity.
Six local redaction/boundary tests pass. No PR CI, merge or live execution of
this probe is claimed; it is a reviewable checkpoint pending operator output.
See [host preflight](../oce-v1-host-preflight.md) and the latest [#58 record](https://github.com/Khaey/Dao/issues/58).
The earlier installer blocker is resolved. Do not reinstall it, recursively
change checkout ownership, restart OCE or repeat #45/#54. No production
integration or READY DEV handoff; backup/restore, pin and gateway remain open.

## Active OPT — OCE V1 #58 (2026-10-07 Europe/Paris)

Verified implementation base: `b531382495f5e508ba5d37064e5e4970571d450f`;
main CI/deploy #313 (`37638769300`) and synthetic PoC #6 (`37638769313`) green.
Audit #45 and PoC #54 are complete. The older next-PoC instructions below
are historical. DEV's product work and open docs PRs #34/#46 remain untouched.

DAO Pilot approved the private bounded gateway in #58, accepting the residual
native permissions of a dedicated OCE editor credential. See the
[operational contract](../oce-integration-operations.md). The gateway itself
is not yet implemented or installed; there is no READY handoff to DEV.

Owned branch: `chore/oce-v1-inventory`. This checkpoint prepares the necessary
DB/Compose/storage/network inventory as a fixed root-helper operation and adds
it to the main-only DEV operations workflow. Four bounded read-only Docker
calls; sanitized metadata only, no credentials, paths, service or OCE changes.
Local validation: 14 helper/inventory tests pass, installer shell syntax passes.
The automatic exact-head PR/main CI outcomes and merged SHA are recorded in
[issue #58](https://github.com/Khaey/Dao/issues/58), not inferred here.

Live inventory requires one root reinstallation of the reviewed helper. The
current installed helper cannot install itself or grant new operations. After
that inventory, prepare the concrete coherent backup/isolated restore, digest
pin and gateway implementation against the real topology. Database identity,
all writers and direct-call isolation are not proven by the previous audit.
No backup/restore, pin, technical-account provisioning or bypass proof is
claimed at this checkpoint. C4 remains unchanged under #58's explicit scope.

## OCE architecture audit — issue #45 complete (2026-10-07 Europe/Paris)

Final implementation/audit base: main `c7c6ef72a253196bf58abeaed9c9228ecd37cb6a`
after PR #52. OCE audit #5 (`37560361477`) ran successfully on the real VPS.

Confirmed instance facts:
- OCE 17.7.0 healthy, database ok, 192/192 modules loaded;
- live OpenAPI: 2,938 paths / 3,956 HTTP operations;
- host: 2 vCPU, ~3.8 GiB RAM, ~37.7 GiB root disk;
- real container `openconstructionerp-app-1`, image
  `ghcr.io/datadrivenconstruction/openconstructionerp:latest`, pinned observed
  digest `sha256:7621593064354a1df414f6598ae7f844bf8d12dc5977537f2297642fc4b523d3`;
- application data uses a named Docker volume mounted at `/data`;
- non-admin project isolation was observed on an existing fixture:
  manager access 200 and editor access 404 for the same manager-owned project;
- authenticated read endpoints for WBS, planning, BOQ, BIM, 5D, QA/QC and CDE
  return 200 on the accessible project;
- OCE's own converter verification reports DWG 1.0.0 installed/healthy; RVT,
  IFC and DGN converter packages are not installed. IFC still has an upstream
  built-in fallback path; its real import quality was not exercised because
  imports remained outside the read-only audit;
- the only timer previously matching the broad backup scan is
  `dpkg-db-backup.timer`, i.e. an OS package database backup, not an OCE
  application backup. No OCE backup artifact or restoration proof was found.

Architecture recommendation: **HYBRID, conditional GO for an isolated PoC;
NO-GO for replacing D.A.O with OCE.** D.A.O remains authoritative for
identity/roles/pro verification, projects and commercial lots, publication,
offers/awards and future contract/legal/financial/reception/warranty state.
OCE may become the optional technical engine for WBS/activities/planning,
BOQ/technical quantities, BIM/4D/5D and selected execution/QA/CDE functions
through a server-side adapter.

Production integration is not approved by this audit. Before production:
validate AGPL/commercial licensing, create coherent OCE database+file backup
with an actual restore test, pin deployment by digest rather than `latest`,
qualify required converters/files, finalize non-admin technical identity
mapping/revocation, and benchmark/resize OCE for real BIM/planning workloads.
The current VPS remains suitable for bounded qualification/small PoC, not a
proven production BIM workload.

Canonical detailed evidence and matrix remain in
[issue #45](https://github.com/Khaey/Dao/issues/45). No D.A.O↔OCE integration
was implemented and `workspace.dsl` was intentionally unchanged because no
integration architecture has yet been approved for implementation.

> **Last verified:** 2026-10-06 Europe/Paris (GitHub PR #47 validation; final deployment evidence in issue #44)
> **Repository:** `Khaey/Dao`

## Active DEV checkpoint — issue #44 P2.1 (2026-10-06 Europe/Paris)

- Base verified main: `6e42eb279249bc3d8c9098b326f246a4072ae2f3`;
  main CI #289 (`37258094821`, attempt 1) and deploy-dev SUCCESS.
- Owned branch: `feat/p21-award-closure`. Open documentation PRs #34/#46
  are untouched. Existing PR #39 comparison and simple attribution are reused.
- P2.1 implementation: per-lot SQL offer closure, append-only
  `bid_item_results` (`selected` / `not_selected` / `available`), mandatory
  cancellation reason/comment for other in immutable `award_cancellations`,
  safe reopen/reassignment, atomic whole-package award/cancellation, client
  history and contractor availability/results UI. Project row serialization
  covers offer creation/edit/submission and award/cancellation commands.
- Migration: `20261006203956_award_closure_reassignment.sql`. Adds two
  RLS-protected history tables, immutable triggers and authenticated commands.
  No membership grant, Auth setting, contract, ledger or actual payment.
- Local checks: 56/56 backend, 152/152 PGlite/schema/RLS, frontend build and
  TypeScript PASS; populated legacy-award migration check PASS.
- PR #47 / CI #291 (`37529526799`) on `9f3be03` passed fresh/reset,
  real Auth/JWT/RLS/concurrency and 36/40 E2E. Four desktop/mobile offer-flow
  executions failed because the panel used an ambiguous PostgREST relationship
  (`PGRST201`, two award-item FKs). The read now names the direct bid-item FK;
  real integration also verifies this exact UI query. All 40 scenarios/assertions
  remain, with no waits/retries/permission changes.
- Corrected code head: `bc2611b6db33e7441811d496fbf0a95ef9fc4f23`.
  PR CI #292 (`37530250664`, attempt 1) SUCCESS: backend/build, fresh schema,
  full reset/replay, 21/21 real Auth/JWT/RLS/concurrency tests and 40/40 FULL
  E2E desktop/mobile (100.14 s). Architecture #23 (`37530250637`) SUCCESS.
  This final documentation checkpoint changes no validated product code;
  observe its automatically required CI once before merge.
- DEV ledger read before changes: 28 migrations through `20261004120000`.
  No DEV migration applied at this checkpoint. After exact-head green CI/merge,
  apply only the missing migration, preserve its repository ledger version,
  verify DEV deployment and record final evidence in [issue #44](https://github.com/Khaey/Dao/issues/44).
  That issue is the canonical continuation/final deployment record: consult
  its latest comment and live GitHub main/CI before repeating any step.

## Product roadmap reality — Back-office Gestionnaire V1 and P2 offers/awards

- Verified implementation base: remote `main`
  `c01eac228210b65108e6273a6393f2de82aae036`.
- P1/P1.1 is complete and validated: project preparation, lots, documents,
  review/correction, publication continuity and desktop/mobile coverage are on
  main. Collaborative chantiers, principal-lot invitations and the real Resend
  invitation journey are also complete; do not recreate them.
- P2 comparison and per-lot attribution are operational on main after PR #39.
  The current flow supports secure offer creation/versioning/submission,
  read-only comparison of submitted offers by lot, confidentiality and
  authorization boundaries, plus explicit partial/atomic attribution with one
  active award per lot.
- P3/P4 execution is not operational. Contract, milestone, payment ledger,
  reception/reservations, amendment, termination/recovery and warranty flows
  remain future product lots. `projects.payment_status` is only declarative
  chantier tracking and is not a financial ledger.
- `feat/manager-backoffice-v1` delivers the first internal operational surface
  without a migration or new privilege: a role-aware manager landing page,
  exact review queues, approved projects ready for publication, an active
  publication registry and read-only supervision of professional profiles.
  Existing staff RLS and review/publication commands remain the authority.
- V1 intentionally excludes internal-user/role administration, contractor
  verification decisions and global settings because those rules have not yet
  been defined by the DAO Pilot.

## Autonomy DEV V3 — live status

- Verified remote `main`: `c01eac228210b65108e6273a6393f2de82aae036`.
- CI main `#287` and DEV deployment are green. The real DEV email workflow
  `#6` (`37166009683`) passed the complete client → Resend → contractor
  acceptance scenario, with bounded TEST-owned reset before and after.
- **V3-C permanent TEST accounts:** complete and validated. Credentials remain
  only in the protected GitHub Environment `dev`; no values are documented or
  emitted.
- **V3-A release-triggered real email E2E:** implementation merged in
  `3ea59c383a5a09ead906e3c87ace4ac30db18dc2` (PR #28). Published GitHub
  Releases now trigger the protected runner only after the matching green main
  deployment; a prior successful run for the same SHA is skipped. The shared
  concurrency lock and `workflow_dispatch` fallback remain. A future published
  release is still needed to observe the automatic path once.
- **V3-B automatic env-sync:** implemented and validated in this OPT phase.
  Main CI #272 transferred the protected payload, ran the existing root helper
  idempotently, passed readiness and activated release `c09b8e1`. The manual
  operation remains available for recovery; environment/release rollback,
  unmanaged keys and the `root:dao / 0640` contract remain unchanged.
- **V3-D routine technical autonomy:** next. The stable GitHub Actions
  control path exists, but normal operational actions are not yet inferred or
  scheduled automatically.

## V3-C follow-up — protected real DEV invitation runner

- Base main: `3083f1b7d429f51641b2737c9fa2d40ad02dac3b`.
- WORK OPT branch: `chore/dev-test-auth-playwright`.
- The new main-only `DAO DEV real email E2E` workflow uses GitHub Environment
  `dev` secrets only inside the runner job. It passes no credentials through
  workflow inputs, commits, artifacts or reports.
- The dedicated Playwright config targets only `https://dao-dev.logiclab.fr`,
  runs one desktop scenario, keeps browser state in memory, disables traces,
  screenshots and video, and removes temporary state in all paths.
- The scenario logs only sanitized PASS markers and a TEST-owned project UUID.
  It sends the real invitation email through the deployed product, then
  accepts the invitation with the permanent contractor account.
- A bounded fixture reset runs before and after the scenario. A shared
  `dao-dev-test-scope` concurrency group prevents overlapping fixture/reset
  operations. No product, Auth, RLS, SQL, migration or business behavior is
  changed.

## V3-C checkpoint — protected permanent TEST DEV fixtures

- Base main for this phase: `7b2893a06798cfc17bba9c74456bf372062b3151`.
- WORK OPT branch: `chore/autonomy-dev-v3c-permanent-fixtures`.
- The protected `dev` Environment supplies the TEST fixture credentials;
  values are never stored in Git, docs, workflow inputs, logs or artifacts.
- Approved mailbox aliases are `ahmedhattab.pro+dao-client@gmail.com` and
  `ahmedhattab.pro+dao-contractor@gmail.com`, delivered to the controlled
  mailbox `ahmedhattab.pro@gmail.com`.
- Provisioning uses standard Supabase Auth Admin only for these two fixture
  identities, then ensures the expected public role/profile rows. It does not
  change Auth configuration, product code, SQL, RLS or migrations.
- The contractor fixture is deliberately kept at `verification_status=pending`
  and `public_identity_status=draft`.
- `scripts/reset-dev-fixtures.sh --apply` is bounded to projects whose
  `client_id` or `initiator_id` is one of these two TEST users. It archives
  those projects and revokes only their still-pending invitations. It never
  deletes accounts, memberships, documents, Storage objects, submitted offers
  or immutable history.
- The dedicated `DAO DEV TEST fixtures` workflow provides `provision`,
  `verify`, `reset` and `mailbox-smoke` operations on `main` only. The
  mailbox smoke sends a marker email through the real Resend configuration;
  receipt is confirmed separately in the controlled Gmail mailbox.
- This checkpoint is infrastructure-only. WORK DEV owns the subsequent real
  invitation-email A→Z validation.

## Latest verified snapshot — client team with principal lots

- Remote `main`: `352d2a13ee124d0bfa2b8d5247bc8f0b78ac8483`.
- Main CI #222 is green, including backend, build, fresh schema, real integration,
  38/38 desktop+mobile E2E and DEV deployment.
- The DEV database is aligned through migration `20261003030134`.
- The client `client_existing_team` creation flow now prepares the chantier,
  at least one real principal lot and at least one contractor invitation in one
  atomic command.
- MVP rule: **1 invited artisan/enterprise = 1 principal lot at invitation time**.
  Each row captures recipient name, email, trade, principal lot title and
  optional indicative lot budget. Multiple rows/artisans can be prepared on
  the same screen before creation.
- Contractor invitations require a real active principal request. A pending
  contractor invitation reserves that lot; a second pending invitation for the
  same lot is refused. A contractor-accepted invitation automatically binds the
  accepted project member to that principal lot.
- If an enterprise later performs more work, the client can create additional
  lots and assign any accepted contractor to them from the Lots tab. The
  principal lot is only the invitation/onboarding lot, not an award or contract.
- Membership, lot assignment and DAO award remain separate concepts. No
  invitation publishes a DAO or grants competitor bid visibility.
- Invitation preview/email now carries only the principal lot concerned for
  contractor invitations; registration remains guided by the invitation role.

The older sections below are retained as historical evidence and must not
override this snapshot.

## Latest verified snapshot — platform readiness and permanent TEST accounts

- Verified remote `main`: `990f65f916638431e05aa3733fffcb6cd8f103c5`.
  Main CI #188 is green, including deploy-dev and the post-deploy HTTP smoke.
- The VPS bootstrap is complete. `/usr/local/sbin/dao-dev-admin` is installed
  by the reviewed `ops/install-dev-admin.sh`; `dao-dev.service`,
  `/etc/dao/dao-dev.env` and existing environment values were left unchanged.
  The main-only DAO DEV operations workflow can use `env-sync`; VPS access is
  not blocked.
- PR #10 DEV is open and untouched at
  `fc51a90fbd92271d9d6be18d479a9f2962ee3486`. Its 38-test coverage and
  Resend changes remain outside OPT ownership.
- Permanent TEST DEV accounts are not provisioned. The existing E2E admin
  provisioning is intentionally scoped to the disposable CI Supabase stack,
  while `reset-dev-fixtures.sh` remains plan-only for shared DEV.
- The sole missing prerequisite for account creation is one authorized,
  protected DEV Auth administration channel that supplies/stores the two
  account credential pairs without exposing them to Git, docs or logs. No
  secure secret-write or account-provisioning operation is currently exposed
  to this Work session, so no Auth data was modified.
- Once that prerequisite exists, provision exactly one TEST client and one
  TEST contractor through standard Auth administration, mark them with a
  dedicated TEST DEV identity/manifest, keep the contractor at the expected
  signup verification status `pending`, and make reset operate only on
  explicitly owned scenario resources.

## Historical checkpoints — through 2026-10-01

The sections below retain earlier evidence and pending actions as history.
They do not override the latest snapshot. Local paths, counts, PR states
and environment limitations are dated observations.

## 1. Verified base and active collaboration checkpoints

The real GitHub `main` and the new remote branch were independently verified as
`965054db897f18794b9f745bf86f397dea34b4d9` on 2026-09-30. Main CI #171
(`36695297577`) succeeded, including 18 desktop/mobile E2E and DEV deployment.
Registration PR #7 is merged; do not repeat the completed login/recovery or
public client/contractor registration changes.

Main was reverified on 2026-10-01 at the same SHA; #171 is still the latest
completed main CI. Collaboration E2E checkpoints are published through
`a923f5c3aeb6d9228e0caca7be23ab93b2285aee`. CI #174 (`36801932429`)
is green on that exact code SHA: 34/34 desktop/mobile E2E (18 existing,
16 new), backend, build, fresh migrations/schema contract, reset/replay and
real Auth/JWT/RPC/RLS/Storage/concurrency integration. On this checkout, backend
20/20, PGlite 140/140 (including the shared schema contract), production
frontend build with 45 routes, TypeScript and diff checks pass. No real
Supabase or browser execution is claimed locally: Docker is unavailable.
PR #8 is open. CI #172 (`36800795598`) passed backend, build, fresh schema,
reset/replay and real Auth/JWT/RPC/RLS/Storage integration. E2E was 31/34:
both document-permission scenarios failed at the synchronous checkbox check,
and client/team mobile failed when the overflowing list intercepted logout.
No merge or DEV changes. Traces prove the permission POST is 200 and the
subsequent team response changes contractor private access from false to true;
the checkbox is checked in the error snapshot. The test now clicks once,
awaits the actual POST, and asserts both refreshed UI and persisted permission.
The permission correction is published as
`5d0fedc8e5c7d1fd34f798d15696c3e579ac8f2e`.
The separate mobile trace shows an expanded 599px layout viewport on the 390px
device and horizontal overflow from the implicit grid column containing a
truncated long title. The mobile list now uses an explicit minmax(0,1fr) grid
column (`grid-cols-1`); E2E also asserts no document overflow before the genuine
logout click. No forced click, Auth change or assertion removal. Both fixes
passed in #174. The next checkpoint only records these verified results;
merge must still wait for green checks on its exact PR HEAD. DEV deployment
is skipped on PRs; main merge and DEV migration/deployment validation remain.

Active branch: `feat/project-collaboration-invitations`.
Active worktree: `/workspace/scratch/dao-project-collaboration`.
The branch was created remotely before any implementation. No files from the
old `feat/login-recovery-links` worktree were carried over.

Checkpoint 1 was published as `f16bc61a6561ecbb9894e662218d279e368c6528`.
It adds migration `20260930163650`: real initiator, nullable pending client,
independent work/payment states, client confirmation evidence, members,
hashed invitations, document sharing and explicit private permission.

Checkpoint 2 was published as `d91fb0af21689ef850188f84213e7305ffdfb0b5`.
It adds migration `20260930165307` and controlled JWT-scoped RPCs
for creation, issuance/safe preview, atomic accept/decline, expiry/revocation,
member permission/revocation, lot participation and declarative tracking.
Preparation is limited to confirmed client or accepted contractor initiator;
invited contractors are read-only on project/lots. Only the confirmed client
can submit DAO or invite contractors. Strict `dao_private.owner()` and all
existing bid/publication/award authorization stay unchanged. Membership
revocation also revokes project document grants and clears lot assignments.
The new public facades use SECURITY INVOKER and explicit execution grants;
only the safe token preview is callable anonymously.

Local validation: 101 existing PGlite/migration controls, 15 model/backfill
controls, 24 RPC/RLS lifecycle controls (140 total), 20 backend unit/route tests,
and diff check pass. The shared schema contract expects 25 migrations and
45 public DAO tables with RLS. All backend and integration TypeScript compiles.
New real Supabase tests cover two independent JWTs racing to confirm exactly
one client, recipient checks, private/shared files and Storage authorization.
Those tests were executed successfully against the disposable CI stack in #174.

Checkpoint 3 was published as `2273344b167fc814407099404d377010377ac930`.
It implements the common Mes chantiers view, separate DAO disponibles,
role-aware dashboard, simple existing-team/client creation, safe invitation
summary and auth return, team permissions, document sharing and declarative
tracking. The frontend production build passed (45 routes), and the full E2E
suite later passed both viewports in #174.

On 2026-10-01 the previous collaboration checkout was absent in the accessible
workspace. The official remote branch was verified at checkpoint 3 and cloned
in isolation, preserving all other checkouts. No post-checkpoint collaboration
files were found. The existing E2E now choose the new client marketplace entry
and assert the current chantier/private-permission labels. All useful assertions
are preserved. At that recovery checkpoint, collaboration E2E and real
disposable-stack integration were pending; compatibility was published as
`e31f1bf6c1da6aeaa6cd8847cbde802144ab9f04`.

Core collaboration E2E was published as `6eb02c15aa4f3d370ca46ab02bd3883762b739e1`.
It adds two independent scenarios:
client/team/lot-specific marketplace publication and contractor/client atomic
confirmation with separate work/payment tracking. Playwright discovers 22
executions at that checkpoint; TypeScript and diff checks passed. Actual E2E
was pending then and is now green in #174, never claimed as passing locally.

Git push from this shell has no credentials; durable branch creation and
checkpoint publication use the authenticated GitHub connector. A checkpoint
is complete only after its commit is present in the remote branch and its
SHA is confirmed with `git ls-remote`.

## 2. Validation and environment boundaries

PGlite reconstructs all migrations on a fresh in-memory PostgreSQL database.
The added model suite also inserts old projects/documents before applying
collaboration SQL, proving the data backfill independently of empty startup.
Its shared schema contract and simulated SQL-role/RLS tests are green.

This shell has no Docker/local Supabase stack. PGlite does not prove real
Auth/JWT/HTTP/Storage integration or independent-session concurrency. Those
checks remain mandatory on the existing disposable CI runner: fresh Supabase,
reset/replay, schema contract, real integration and desktop/mobile E2E.
Never substitute shared DEV for that isolated test environment.

No Supabase DEV migration, Auth setting or production change has been made
for collaboration. After all checkpoints and a green merge, inspect the
verified DEV ledger before applying any missing migration. Frontend deploy
alone does not apply SQL. Do not merge an incomplete older collaboration model.

## 3. CI and E2E architecture

`backend-verify` and the standalone `frontend-build` run in parallel with one
critical validation job, `full-e2e`. That job uses one fresh Supabase CLI stack
on its disposable GitHub-hosted runner:

1. Start from the runner's empty database and apply migrations plus seed.
2. Check the migration ledger and schema contract; capture the read-only DAO
   fingerprint inventory.
3. Run `supabase db reset --local`, replay every repository migration and seed,
   then check the ledger and schema contract again.
4. Run real Supabase integration tests against that replayed stack.
5. Verify the E2E target is exactly `http://127.0.0.1:54321`.
6. Build the frontend with the local Supabase URL/key while installing the
   Playwright Chromium browser and system dependencies in parallel.
7. Require discovery of exactly 34 tests, then run all desktop and mobile
   tests with 2 workers.
8. Cleanup removes worker tracking files only; disposing of the runner is the
   database/Auth/Storage cleanup boundary.

The E2E build still receives the local public Supabase configuration; the
separate general frontend build is not reused. `deploy-dev` is restricted to a
push on `refs/heads/main` and is skipped on pull requests. PR runs need no
DEV/production credentials.

## 4. CI timing and experiments

Run #148 is the historical main-pipeline baseline. Run #155 is the measured
main pipeline after PR #2 merged; no deploy projection is used.

| Measurement | Run #148 baseline | Run #155 main |
| --- | ---: | ---: |
| Main workflow elapsed | 386s / 6m26s | 286s / 4m46s |
| Critical schema + integration + E2E job | 118s schema + 179s E2E = 297s | 190s |
| Supabase start + migrations + seed | ~70s schema stack plus a separate ~63.82s E2E stack | 73.11s, one shared stack |
| Reset/replay | 29s | 27.18s |
| Playwright execution | 45.62s | 34.98s (14 tests, 2 workers) |
| `deploy-dev` job | 83s (SSH step ~79s) | 85s (SSH step 82s) |

The actual main workflow saved 100s, a 25.9% reduction from #148. The shared
critical job took 107s less than the two sequential #148 schema and E2E jobs.
The merge-to-DEV-active time was 279s (4m39s). The complete run retained the
fresh migration/seed proof, reset/replay, schema contracts, real Supabase
integration, all 14 desktop/mobile tests, and the DEV deploy.

Run #155 stage timings, measured by the job helper and emitted to job logs and
`GITHUB_STEP_SUMMARY`:

| Run #155 stage | Duration |
| --- | ---: |
| Backend npm install | 1.20s |
| Backend npm install for integration | 1.06s |
| Frontend npm install (general build) | 9.98s |
| Frontend build (general environment) | 18.67s |
| Frontend npm install for E2E | 6.89s |
| Fresh Supabase start + migrations + seed | 73.11s |
| Fresh migration list + schema contract | 1.57s |
| Fresh-local fingerprint inventory | 0.94s |
| Reset + complete migration replay + seed | 27.18s |
| Post-reset migration list + schema contract | 1.56s |
| Real Supabase integration | 2.91s |
| E2E frontend build (local Supabase config) | 23.30s |
| Chromium + system dependencies, parallel with build | 26.10s |
| Playwright discovery | 0.88s |
| Playwright, desktop + mobile, 2 workers | 34.98s |
| Critical job | 190s |
| `deploy-dev` job (SSH step) | 85s (82s) |
| Entire main workflow | 286s |

Experiments:

- **One Supabase stack:** kept. Runs #149–#153 passed with the full reset/replay
  and unchanged coverage. It removes the second ~64s Supabase start.
- **Chromium cache:** reverted. Run #150's cold cache path took about 25s for
  system dependencies and Chromium, plus cache save; run #151's warm path took
  4s restore + 14s system dependencies = 18s, only about 3s faster than the
  21s uncached run #149.
- **npm installs parallel with Supabase start:** reverted. Run #152's combined
  step took 85s; run #151's sequential npm installs plus start took about 83s.
  There was no measured saving.
- **E2E build parallel with browser setup:** kept. Run #153 took 31s for the
  combined step; run #152's equivalent sequential work took 20s + 23s = 43s.
  Both the local-config build and browser setup succeeded, saving 12s in that
  segment without reusing a build artifact.

## 5. Functional coverage and safety

- Historical CI optimization preserved the then-current 22 migrations and 14
  Playwright cases. Registration increased the base to 23 migrations and 18
  cases; collaboration adds migrations 24 and 25 and 16 viewport executions.
  All existing coverage remains.
- Main run #158 passed backend, PGlite, frontend build, fresh Supabase,
  reset/replay, both schema contracts, real Supabase integration, and 14/14
  desktop/mobile E2E with 2 workers. `deploy-dev` accepted the verified CI
  artifact and the VPS service is active on the merge SHA.
- No test or business assertion was removed. No `force: true`, arbitrary
  sleeps, timeout increases, or `.first()` workarounds were added.
- No DEV/production write, migration, schema/RLS/Auth change, or product code
  change was made during this optimization.


## 6. First live artifact deployment measurements

The comparison for this deployment optimization is main run #155 versus #158.
Run #158 started at 10:42:29Z and completed at 10:46:28Z.

| Measurement | Run #155 | Run #158 |
| --- | ---: | ---: |
| Full workflow | 286s | 239s |
| `deploy-dev` job | ~85s | 44s |
| SSH action | ~82s | 24.41s |
| Merge to VPS active | 279s | 231.38s |
| VPS frontend build | ~54s | skipped; verified CI artifact |

Run #158 saved 47s (16.4%) on the workflow, about 41s (48.2%) on
`deploy-dev`, and about 47.6s (17.1%) from merge to VPS active.

| GitHub deployment stage | Run #158 |
| --- | ---: |
| Artifact download | 0.44s |
| Artifact preparation for transfer | 0.02s |
| SCP transfer | 9.29s |
| SSH deployment action | 24.41s |

The VPS emitted `DEPLOY_BUILD source=verified_ci_artifact`. Its dependency
cache was cold: backend and frontend both reported `installed`, not a cache
hit. The deployment measured payload extraction 0.095s, git init 0.02s,
remote add 0.01s, fetch 1.45s, checkout 0.03s, backend npm ci 2.50s, frontend
npm ci 16.20s, artifact verification 0.10s, artifact staging 0.04s, release
preparation 0.01s, symlink switch 0.01s, service restart 0.10s, and service
health check 0.03s. No VPS frontend build ran.

The current-release link is switched atomically by the deployment script.
Rollback remains available through the previous versioned release; no
intentional rollback was performed.

Invitation security/lifecycle E2E now adds incompatible-role/internal-role
rejection, unrelated-client isolation, revocation and decline. Each scenario
creates its own project; desktop/mobile use separate worker users. Discovery
is 26 viewport executions; TypeScript/diff pass. Real execution remains for CI.

Invitation security/lifecycle was published as
`abcca1c468448077bb7b3a26da5ef3aae53dd5ca`.
Registration-return coverage adds client/contractor explicit signup from the
invitation, contractor pending verification, protected return to the chantier,
and rejection of an external return URL. Discovery now lists 32 executions;
TypeScript/diff pass; real browser/Auth execution remains pending in CI.

Invitation registration-return coverage was published as
`11872b3c85ce816d0da82f531abaffc2146bb5b2`.
The document/private-permission scenario adds owner_only versus project_members,
quarantine before approval, explicit private permission and membership revocation
with denied signed download. Discovery now lists 34 executions (18 retained,
16 added) in 13 files. TypeScript/diff checks pass. This is discovery and type
validation, not a claim that the browser suite has executed locally.


## Current — invitation email V1

Verified actual main: `3d0104c658b38c1ffcd44f308ba2ba6bbe12d441`.
Latest completed main CI #178 (`36918284057`) is green, including DEV deployment.
The user confirms the prior DEV validation: client, contractor, client
invitation, permissions/isolation, documents, desktop 1440×900 and mobile
390×844 all PASS. Collaboration PR #8 and the responsive correction are
already merged. Do not recreate their model, migrations, Auth or validation.

Active branch: `feat/project-invitation-email`, created locally and remotely
from that exact main before implementation. Checkout:
`/workspace/scratch/dao-analysis-main`. The initial working tree was clean.

V1 adds authenticated server Resend sending of the invitation just created;
copy link remains. Canonical JWT/RLS invitation preflight is shared by
issuance, revocation and email. Only after authorization is the specific
invitation's hash read with the server secret. Recipient is DB-only; token is
compared using SHA-256 UTF-8 / constant time, never persisted or logged.
No DB, migration, RLS or Supabase Auth configuration change. No provider SDK
dependency, resend UI, new invitation, token rotation or delivery table.

Local evidence: backend 54/54, existing PGlite/migration/RLS 140/140,
production frontend build and TypeScript pass. Playwright discovers 38
viewport executions (34 existing plus 4 email cases), in 14 files. Discovery
is not execution. The new production-handler integration uses real local
Auth/JWT/RLS and mocks Resend; actual integration and FULL E2E execution
must be checked in the latest CI attached to this branch/PR. Docker is not
available in this Work shell. No real email or DEV data mutation is claimed.

PR #10 publishes the feature. CI #179 (`36947283719`) on
`6f5087e9732a09b9713b41bc5b935c2e756418b8` passes backend/build, fresh schema,
reset/replay and all real integration tests. Playwright is 36/38: all 34 old
cases and both artisan email cases pass. Both client email cases fail solely
because the global alert locator also selects Next.js's route announcer.
The masked screenshots show the correct error, retry and copy-link UI; error
contexts contain no token. Scope both error assertions to main and wait on
the first intercepted request before checking double-click count. No product
change, sleep, timeout increase or assertion removal. Check the latest CI
on the corrected PR HEAD for the final full-execution result.

External setup before a real DEV email test: validated Resend sender/domain
and server-only `RESEND_API_KEY`, `DAO_EMAIL_FROM`, `DAO_PUBLIC_URL` in the
existing protected `/etc/dao/dao-dev.env`, then service restart/deployment.
See `DEV_DEPLOYMENT.md` and decision D-031. No change to password recovery.
