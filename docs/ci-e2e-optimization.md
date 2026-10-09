# FULL E2E optimization — OPT #85

Verified on 2026-10-09 Europe/Paris, main
`77cd7ba74d59069f0f8c2534e258ea7c9a2cab77`.
The user authorizes normal OPT branch → checks → PR → CI → merge → DEV proof.
OCE/Cloudflare #58 is exclusively DEV 3's responsibility and excluded here.

## Baseline from actual Actions timestamps and timing logs

[Main CI #383](https://github.com/Khaey/Dao/actions/runs/37866132094), attempt 1,
SUCCESS; jobs API plus existing `measure-ci-step.sh` markers:

| Measurement | Baseline |
| --- | ---: |
| Workflow created → updated (00:42:28Z → 00:48:52Z) | 384 s |
| Critical FULL E2E job | 336 s |
| Backend verification job | 14 s |
| General frontend build job, parallel | 63 s |
| DEV deployment job | 35 s |
| Browser execution, four workers / 48 passed | 161.77 s |
| Fresh Supabase startup + migrations + seed | 70.68 s |
| Complete reset/replay + seed | 28.59 s |
| Real Supabase integration, 29 passed | 7.35 s |
| E2E frontend build | 33.84 s |
| Browser/system dependency installation | 27.84 s |

Build/browser preparation already run concurrently; do not sum those two
segments when calculating the critical path. Workflow duration includes
scheduling and the final timing-summary job. Deployment is not the main
bottleneck. Browser execution is about 48% of the critical job.

## First independent change

Set `PLAYWRIGHT_WORKERS: 6` only in FULL E2E's job environment, using the
existing override in `playwright.config.ts`. Its default remains four for
other workflows. The runner class and count remain unchanged. Six is an
experiment to be accepted from measured green evidence, not an assumed speedup.

Isolation review: fixture users are unique per run, attempt, viewport and
worker, with random suffixes. State files use those same identity dimensions.
Projects are created separately for each scenario; registration/invitation
recipients use UUIDs or unique worker emails. Admin mutations target worker
users; no shared hook or serial dependency needs modification. Existing
scenario order and in-file sequencing are preserved.

All 48 test executions, assertions, desktop/mobile viewports, retries/timeouts,
real actor JWT paths, negative isolation checks, immutable-history behavior,
fresh schema/ledger proof, full reset/replay, 29 real integration tests,
local-target guards and cleanup stay in place. No new E2E test/fixture or
application code is required for a concurrency-only change.

Deployment retains its independent DEV-configured artifact, exact-revision
manifest, main-only trigger, serialized activation, host lock, stale-main
refusal, private env-sync, atomic release and rollback through HTTP smoke.
No cache experiment or extra manual rerun is introduced.

## Acceptance and evidence

The normal automatic PR CI must execute all 48 tests with six workers and all
29 real integrations successfully. Compare precise browser duration and job
wall time; merge only with current-main reconciliation and green checks.
Observe main CI/deploy once, prove the deployed SHA and record the main result.
The durable outcome table, PR/head/merge SHAs, run IDs/attempts, coverage and
percentage changes live in [issue #85](https://github.com/Khaey/Dao/issues/85).
A slower or unreliable result must not be described as an optimization.

One baseline and candidate/main observations do not establish a long-term
performance distribution. Separate direct browser savings from changes in
startup/download/scheduling time. Validated identical code is not rerun merely
to collect a more favorable number. Return FULL E2E's override to four if
later measurements establish sustained regression or a concurrency defect.
