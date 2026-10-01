# D.A.O — Current State

> **Last verified:** 2026-09-30
> **Repository:** `Khaey/Dao`

## 1. Verified base and active collaboration checkpoints

The real GitHub `main` and the new remote branch were independently verified as
`965054db897f18794b9f745bf86f397dea34b4d9` on 2026-09-30. Main CI #171
(`36695297577`) succeeded, including 18 desktop/mobile E2E and DEV deployment.
Registration PR #7 is merged; do not repeat the completed login/recovery or
public client/contractor registration changes.

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
Those tests are compiled but require the disposable CI stack to execute.

Checkpoint 3 was published as `2273344b167fc814407099404d377010377ac930`.
It implements the common Mes chantiers view, separate DAO disponibles,
role-aware dashboard, simple existing-team/client creation, safe invitation
summary and auth return, team permissions, document sharing and declarative
tracking. The frontend production build passed (45 routes); the full E2E
suite must now validate both viewports.

On 2026-10-01 the previous collaboration checkout was absent in the accessible
workspace. The official remote branch was verified at checkpoint 3 and cloned
in isolation, preserving all other checkouts. No post-checkpoint collaboration
files were found. The existing E2E now choose the new client marketplace entry
and assert the current chantier/private-permission labels. All useful assertions
are preserved. Collaboration E2E and real disposable-stack integration remain
pending; the 18 existing viewport executions remain. Compatibility was published as
`e31f1bf6c1da6aeaa6cd8847cbde802144ab9f04`.

Core collaboration E2E was published as `6eb02c15aa4f3d370ca46ab02bd3883762b739e1`.
It adds two independent scenarios:
client/team/lot-specific marketplace publication and contractor/client atomic
confirmation with separate work/payment tracking. Playwright discovers 22
executions; TypeScript and diff checks pass. Actual E2E remains pending on the
existing disposable CI stack, not claimed as passing locally.

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
7. Require discovery of exactly 18 tests, then run all desktop and mobile
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
  cases; checkpoint 1 now adds migration 24. All existing coverage remains.
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
