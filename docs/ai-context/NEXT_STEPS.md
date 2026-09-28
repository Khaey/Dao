# D.A.O — Next Steps

> Start by reading all files in `docs/ai-context/`, then verify the actual
> GitHub `main` SHA and the latest workflow run.

## Current checkpoint

PR [#3](https://github.com/Khaey/Dao/pull/3) is merged. Its PR head was
`3e73939046a8b3676f4031de2cab6412fefcfde5`; the merge and deployed
application SHA is `e0bbcdd19c29d46821d19ba2d56e8868b676eb9d`.

Main run [#158](https://github.com/Khaey/Dao/actions/runs/36411292612) succeeded: backend, PGlite, frontend build, fresh
Supabase, reset/replay, schema contract, real Supabase integration, 14/14
desktop/mobile E2E with 2 workers, and `deploy-dev`. The verified CI artifact
was accepted on the VPS, `dao-dev.service` is active, and no frontend VPS
build ran.

Measured against run #155: workflow 286s → 239s; `deploy-dev` ~85s → 44s;
SSH ~82s → 24.41s; merge to VPS active 279s → 231.38s. Backend and frontend
VPS dependency caches were cold and installed. The external HTTP probe from
this Work environment was blocked by its outbound proxy (HTTP 502/TLS alert);
the VPS-side systemd health check passed. Full measurements are in
`CURRENT_STATE.md` and `DEV_DEPLOYMENT.md`.

No database write, migration, schema/RLS/Auth change, or product change was
made. The deployment artifact optimization is validated for its first main
run; the warm dependency-cache path has not yet been measured.

## Next checkpoint

Measure dependency cache hits on the next naturally occurring deployment.
Do not create a synthetic commit or deployment just to warm the cache. The
repository has only `.github/workflows/ci.yml`, triggered by push and
pull_request; no `workflow_dispatch` exists for a same-SHA redeploy. Wait for
the next real main push, with its normal validation gates, to measure the
warm-cache path. No further CI, path-filtering, deploy, or product
optimization work is started until requested.

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
