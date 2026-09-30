# D.A.O — Current State

> **Last verified:** 2026-09-30
> **Repository:** `Khaey/Dao`

## 1. Main and deployment

PR [#1](https://github.com/Khaey/Dao/pull/1) remains merged at
`45e0e40230ba663c6d1633a310335561c2c0b838`. CI optimization PR
[#2](https://github.com/Khaey/Dao/pull/2) is merged; its application SHA is
`8fec8b8b4356d2ca2b2822e5e4a0d6f9a26c505c`. Deployment optimization PR
[#3](https://github.com/Khaey/Dao/pull/3) merged on 2026-09-28. Its PR head was
`3e73939046a8b3676f4031de2cab6412fefcfde5`; merge/application SHA is
`e0bbcdd19c29d46821d19ba2d56e8868b676eb9d`.

Main run [#158](https://github.com/Khaey/Dao/actions/runs/36411292612) passed backend, PGlite, frontend build, fresh
Supabase, reset/replay, schema contract, real integration, and all 14 E2E
tests on desktop and mobile with 2 workers. `deploy-dev` accepted the verified
CI artifact, restarted `dao-dev.service`, and its `systemctl is-active`
check returned `active`. The deploy log identifies release
`/opt/dao/releases/e0bbcdd19c29d46821d19ba2d56e8868b676eb9d-36411292612-1`.

The current GitHub `main` head is `c26b58c55a31ee3d022d409bcc55fa747100b804`
(`docs: record public HTTP verification limit`, documentation-only, `[skip ci]`).
The last main deployment remains run #158 at `e0bbcdd19c29d46821d19ba2d56e8868b676eb9d`.

## 1.1 Password recovery work

Main does not yet contain the recovery link or routes. Draft PR
[#4](https://github.com/Khaey/Dao/pull/4) contains the initial implementation
on `feat/password-recovery`, commit `f5b45117ec0638043d6317be950bf156a0eada87`.
Its run [#159](https://github.com/Khaey/Dao/actions/runs/36647183172) succeeded
(backend-verify, frontend-build, FULL E2E and timing summary); `deploy-dev` was
skipped because this was a pull request. That run validated the prior 14-test
suite, not the local uncommitted email-flow E2E change described below.

The local branch contains uncommitted work to capture a real recovery message
from the disposable Supabase SMTP inbox and complete the reset flow. The test
uses the worker's isolated E2E client; desktop and mobile receive distinct
worker emails. The local Auth allowlist now includes the exact reset route.
Local build and sequential TypeScript checks pass, and test discovery remains
14 cases. Docker/Supabase is unavailable in this shell, so the new email flow
has not yet run locally or in CI.

The Supabase connector exposes project metadata but not Auth SMTP or redirect
allowlist settings. DEV settings and delivery therefore remain unconfirmed;
no DEV recovery email has been sent and no Auth configuration was changed in
the hosted DEV project.

Public HTTP remains unverified. The Work shell returned HTTP/2 502 with
`server: mitmproxy 12.2.3` and a TLS internal-error alert. A follow-up in the
cloud browser also displayed `502 Bad Gateway` with the same OpenSSL TLS
alert. These results do not identify the origin's HTTP status or confirm its
page response. The VPS-side `systemctl is-active` health check succeeded.

No database write, migration, schema/RLS/Auth change, or product change was
made during this deployment optimization.

## 2. Supabase reproducibility and parity

- The repository has 22 migrations. Fresh Supabase start, seed, the complete
  migration ledger, schema contract, and reset/replay are validated.
- DEV's migration ledger has those same 22 versions. The read-only inventory
  previously compared 586 DAO objects on each side, with 0 missing, 0 extra,
  0 structural drift, and 0 semantic drift.
- Real Supabase integration tests run against the disposable local stack and
  cover Auth/JWT, RLS, RPC, publications, offers, immutability, Storage, and
  award foundations.
- This CI optimization made no database, Supabase, migration, DEV, or
  production changes. Do not use shared DEV for FULL E2E; preserve
  `submitted_version_immutable` and `submitted_bid_content_immutable`.

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
7. Require discovery of exactly 14 tests, then run all desktop and mobile
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

- The same 22 migration files, initial and post-reset schema contracts,
  migration-ledger checks, DAO inventory, real integration test, 14 Playwright
  tests, desktop/mobile projects, and 2-worker setting remain enabled.
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
