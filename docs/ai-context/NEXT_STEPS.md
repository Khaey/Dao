# D.A.O — Next Steps

> Start by reading all files in `docs/ai-context/`, then verify the actual
> GitHub `main` SHA and the latest workflow run.

## Current checkpoint

PR [#2](https://github.com/Khaey/Dao/pull/2), branch
`chore/ci-e2e-optimization`, is a Draft PR and must not be merged by an agent.
Main remains at `db19b3512062fc8fde4bafcae95b6aef5a8f884b` (docs-only commits
after the code-bearing `45e0e40230ba663c6d1633a310335561c2c0b838`).

The CI optimization combines schema reproducibility, reset/replay, real local
Supabase integration, and FULL E2E on one disposable local stack. Run #153
passed backend, frontend build, fresh schema, reset/replay, integration, and
14/14 desktop/mobile E2E with 2 workers. Its critical job took 218s and the PR
workflow took 229s. `deploy-dev` was skipped, as required on a pull request.

The #148 main pipeline took 386s. Adding the unchanged 83s #148 deploy job to
the 229s PR duration estimates about 312s (5m12s), a 74s / 19% reduction. The
main-equivalent estimate remains just above the <5 minute target; do not report
it as an actual main run. The 14-test coverage and all DB reproducibility
checks remain intact. DEV and production were not changed.

## Before closing this optimization PR

- Keep PR #2 Draft and do not merge.
- Finish the documentation-only update and let its PR run complete every
  validation job; confirm 14/14 desktop/mobile tests and 2 workers.
- Confirm `deploy-dev` is skipped on the PR and `main` remains unchanged.
- Report the projected main duration separately from the measured PR run.

## Future optimization work (not started)

1. Analyze the 83s SSH deployment path and possible artifact deployment as a
   separate, explicitly reviewed change.
2. Analyze FAST/FULL workflow separation and path detection without skipping a
   required gate for relevant changes.
3. Consider a verified build artifact only after proving public Supabase
   configuration is identical; the E2E build currently uses local
   `127.0.0.1:54321` values and stays separate.
4. Consider Playwright suite decomposition or higher worker counts only in a
   separate measurement after maintaining stable desktop/mobile coverage.
5. Keep browser caching disabled unless a later run shows a material net gain;
   the measured warm-cache saving was about 3s.

Do not begin P2/P3.

## Invariants to preserve

- FULL E2E uses only disposable local Supabase at
  `http://127.0.0.1:54321`, with the target guard enabled.
- Fresh start, migration/seed replay, schema contract, complete reset/replay,
  and post-reset schema contract remain required.
- Keep the real Supabase integration coverage for Auth/JWT, RLS, RPC,
  publications, offers, immutability, Storage, and award foundations.
- Cleanup removes worker tracking files only. Runner disposal is the E2E data
  cleanup boundary.
- Never delete submitted offer history or weaken either immutability trigger.
- `deploy-dev` runs only for a push to `refs/heads/main`, never a
  `pull_request`.
- Keep all 14 Playwright tests, desktop and mobile, and at least 2 workers.
- Do not change DEV/production, migrations, schema, RLS, Auth, product behavior,
  or test assertions for CI speed.
