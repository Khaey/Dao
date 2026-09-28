# D.A.O — Current State

> **Last verified:** 2026-09-28  
> **Repository:** `Khaey/Dao`

## 1. Main and deployment

PR [#1](https://github.com/Khaey/Dao/pull/1) is merged. Its code-bearing
revision is `45e0e40230ba663c6d1633a310335561c2c0b838`. The current `main`
head when CI optimization began was the docs-only commit
`db19b3512062fc8fde4bafcae95b6aef5a8f884b`. Run [#148](https://github.com/Khaey/Dao/actions/runs/36366960973)
was green on the merged code, including `deploy-dev`; the VPS was active on the
merged revision.

CI optimization is on Draft PR [#2](https://github.com/Khaey/Dao/pull/2),
branch `chore/ci-e2e-optimization`. It is not merged. The last complete
optimization run recorded here is [#153](https://github.com/Khaey/Dao/actions/runs/36371688388)
on `251189159a7288f5b11eea470f65be004e68edee`.

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

Run #148 is the complete main-pipeline baseline. A PR run cannot execute the
main-only deploy, so keep its measured time separate from the projection that
adds the unchanged run #148 deploy job.

| Measurement | Run #148 baseline | Run #153 optimized |
| --- | ---: | ---: |
| Main pipeline elapsed | 386s / 6m26s | Not run on main |
| PR workflow elapsed, with deploy skipped | — | 229s / 3m49s |
| Critical schema + integration + E2E job | 118s schema + 179s E2E = 297s | 218s |
| Fresh Supabase start + migrations + seed | ~70s, twice across two stacks | 70.75s, once |
| Reset/replay | 29s | 28.56s |
| Playwright execution | 45.62s | 48.69s (14 tests, 2 workers) |
| `deploy-dev` job | 83s (SSH step ~79s) | Skipped on PR |

Using the #148 deploy duration as an unchanged estimate gives about 312s
(5m12s) for the optimized main pipeline: 229s PR workflow plus 83s deploy.
That is an estimated 74s / 19% reduction from #148; it is not a measured main
run. The shared-stack critical validation path itself is 79s shorter than the
two sequential #148 validation jobs. The <5 minute target was not reached
without changing the main-only deployment path.

The last run reports these stage timings in both the job logs and
`GITHUB_STEP_SUMMARY`:

| Run #153 stage | Duration |
| --- | ---: |
| Backend npm install for integration | 1.64s |
| Frontend npm install for E2E | 10.48s |
| Fresh Supabase start + migrations + seed | 70.75s |
| Fresh migration list + schema contract | 1.91s |
| Fresh-local fingerprint inventory | 1.13s |
| Reset + complete migration replay + seed | 28.56s |
| Post-reset migration list + schema contract | 1.91s |
| Real Supabase integration | 3.56s |
| E2E frontend build (local Supabase config) | 30.54s |
| Playwright browser + system dependencies, parallel with build | 28.27s |
| Playwright discovery | 1.22s |
| Playwright, desktop + mobile, 2 workers | 48.69s |
| Critical job | 218s |
| Entire PR workflow | 229s |

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
- #149–#153 all passed the full E2E gate at 14/14. The final measured run #153
  passed all workflow jobs; `deploy-dev` was skipped as required for a Draft PR.
- No test or business assertion was removed. No `force: true`, arbitrary
  sleeps, timeout increases, or `.first()` workarounds were added.
- No DEV/production write, migration, schema/RLS/Auth change, or product code
  change was made during this optimization.
