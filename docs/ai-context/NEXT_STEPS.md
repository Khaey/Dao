# D.A.O — Next Steps

> Start by reading the other files under `docs/ai-context`, then verify the
> actual GitHub `main` SHA and latest workflow run.

## Current checkpoint

PR #1 is merged. The code-bearing merge SHA is
`45e0e40230ba663c6d1633a310335561c2c0b838`. Run #148
(`36366960973`) is green through backend, frontend build, fresh Supabase/schema
contract, real local Supabase integration, 14/14 desktop/mobile E2E with 2
workers, and `deploy-dev`. The VPS reports `dao-dev.service` active on the
merged release.

Fresh Supabase reconstruction is validated from the 22 repository migrations.
DEV's ledger has those same 22 versions. Fresh-local ↔ DEV parity is 586 objects,
with no missing/extra objects or structural/semantic drift; nine raw-only SQL
representation differences remain documented.

## Next chantier: CI speed optimization

Use run #148 as the baseline before changing the pipeline:

- full workflow: 6m26s;
- fresh schema start/replay: 70s;
- explicit schema reset/replay: 29s;
- isolated E2E stack startup: 63.82s;
- Playwright 14/14 with 2 workers: 45.62s;
- deploy-dev SSH job: about 79s.

Plan the optimization work around:

1. FAST/FULL workflow separation and fail-fast dependencies;
2. dependency and browser cache effectiveness;
3. Playwright scenario independence, desktop/mobile isolation, and stability;
4. keeping 2 workers as the baseline until stability is demonstrated;
5. building once and reusing a verified artifact where the workflow permits it;
6. shortening the DEV deployment path without weakening verification;
7. path detection for changes that do not need every gate;
8. before/after timing comparisons with unchanged functional coverage.

Do not start P2/P3. The closeout stopped after the green merge/deploy.

## Invariants to preserve

- FULL E2E must use only disposable local Supabase
  (`http://127.0.0.1:54321`) with the target guard enabled.
- The E2E environment must replay the repository migrations; no hidden schema
  bootstrap or PGlite stub may mask a missing migration.
- Cleanup removes tracking files only. Runner disposal is the E2E data boundary.
- Never delete submitted offer history or weaken either immutability trigger.
- `deploy-dev` runs only for `push` to `refs/heads/main`, never for
  `pull_request`.
- Do not mutate or re-audit DEV without a new explicit task.
- Keep the 14 desktop/mobile tests and their functional assertions intact while
  optimizing speed.
