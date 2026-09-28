# D.A.O — Current State

> **Last verified:** 2026-09-28  
> **Repository:** `Khaey/Dao`

## 1. Main and deployment

PR [#1](https://github.com/Khaey/Dao/pull/1) remains merged at
`45e0e40230ba663c6d1633a310335561c2c0b838`. CI optimization PR
[#2](https://github.com/Khaey/Dao/pull/2) was merged on 2026-09-28. Its head
was `d0b2575c18955bb2737d3ebc1991a8b02230ea70`; the merge commit and deployed
application SHA are `8fec8b8b4356d2ca2b2822e5e4a0d6f9a26c505c`. Subsequent
documentation-only `[skip ci]` commits update this state; run #155 remains the
latest CI on the merged code SHA.

Main run [#155](https://github.com/Khaey/Dao/actions/runs/36393228800) passed
all jobs, including `deploy-dev`, in 286s (4m46s). The VPS release checked out
the merge SHA, switched `/opt/dao/current` to that release, restarted
`dao-dev.service`, and `systemctl is-active dao-dev.service` returned
`active`. The service became active 279s (4m39s) after merge.

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
- Main run #155 passed backend, PGlite, frontend build, fresh Supabase,
  reset/replay, both schema contracts, real Supabase integration, and 14/14
  desktop/mobile E2E with 2 workers. `deploy-dev` passed and the VPS service
  is active on the merge SHA.
- No test or business assertion was removed. No `force: true`, arbitrary
  sleeps, timeout increases, or `.first()` workarounds were added.
- No DEV/production write, migration, schema/RLS/Auth change, or product code
  change was made during this optimization.
