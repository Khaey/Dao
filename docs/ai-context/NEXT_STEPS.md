# D.A.O — Next Steps

> Start by reading all files in `docs/ai-context/`, then verify the actual
> GitHub `main` SHA and the latest workflow run.

## Current checkpoint

PR [#2](https://github.com/Khaey/Dao/pull/2) is merged. Main is
`8fec8b8b4356d2ca2b2822e5e4a0d6f9a26c505c` (merge commit); its PR head was
`d0b2575c18955bb2737d3ebc1991a8b02230ea70`.

Main run [#155](https://github.com/Khaey/Dao/actions/runs/36393228800) passed
backend, PGlite, frontend build, fresh Supabase, reset/replay, both schema
contracts, real local Supabase integration, and 14/14 desktop/mobile E2E with
2 workers. `deploy-dev` also passed. The VPS checked out the merge SHA and
`dao-dev.service` is active.

Measured main duration: 286s (4m46s), versus 386s (6m26s) on baseline #148;
the actual saving is 100s / 25.9%. The shared critical job was 190s, Supabase
start+migrations+seed 73.11s, reset/replay 27.18s, E2E build 23.30s,
Chromium/system setup 26.10s in parallel with that build, Playwright 34.98s,
and deploy-dev 85s. Merge to DEV active took 279s. Detailed measurements are
in `CURRENT_STATE.md`.

The optimization is complete at this checkpoint. No database, migration,
RLS/Auth, product, or DEV database changes were made. Do not start the next
optimization topics below until explicitly requested.

## Deferred optimization topics (not started)

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
