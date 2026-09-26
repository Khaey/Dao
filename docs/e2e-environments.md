# E2E environments

## Automated FULL E2E

The intended FULL Playwright target is the disposable Supabase CLI stack on a fresh GitHub-hosted runner. The job is configured to start PostgreSQL, Auth, Kong, PostgREST, and Storage; replay every migration in `dao-backend/supabase/migrations`; and load E2E-only territory rows from `dao-backend/supabase/seed.sql`. Storage object files live in the runner's local Storage container. The runner and its containers are discarded after the job, so Auth users, database rows, Storage metadata, and object files do not carry over to another campaign.

The app receives URL and keys read from that local stack at runtime. `verify-supabase-target.mjs` and the Playwright fixtures both require the exact endpoint `http://127.0.0.1:54321`; no DEV or production Supabase secrets are attached to the E2E job. Playwright runs the desktop and mobile projects with two workers. Worker state records resource IDs for leak accounting, while `cleanup-e2e.mjs` removes only those local tracking files. Submitted offers and immutable history remain intact until the disposable runner is discarded.

The first isolated run (#136) reached the fifth migration and failed in 58 seconds because the repository migration chain does not define `public.rls_auto_enable()`. It did not reach database reset verification or Playwright, so successful stack/reset/full-E2E timings are not yet available. As the before-isolation baseline, run #135's DEV Playwright step took 5m32s (the E2E job took 6m25s including setup and cleanup); that run failed during cleanup and must not be repeated against DEV.

## Environment choice

| Option | Time | Cost | Fidelity | Complexity | Security | Maintenance |
| --- | --- | --- | --- | --- | --- | --- |
| Supabase development branch | Branch creation and reset were not measured; branch was not created | The current estimate is USD 0.01344/hour (about USD 9.81 for 730 active hours), plus applicable storage/egress; no paid resource was created | Hosted Supabase services; the documented branch reset did not explicitly guarantee clearing Auth state and Storage object files | Low once provisioned, but reset semantics must be independently verified | Separate project reference and keys; persistent branch data requires a reliable reset boundary | A long-lived branch would accrue compute cost while active and require periodic migration upkeep |
| Supabase CLI on GitHub runner | First startup attempt took 58s and failed during migration 5; successful startup/reset/E2E times remain unmeasured | No persistent Supabase compute charge; GitHub Actions minutes and runner use apply | Uses the repo's Supabase CLI stack with real PostgreSQL, Auth, REST, Storage, and exact repository migrations; local-only geography seed supplies test reference data | Requires Docker, pinned CLI, and local configuration in CI | Fresh runner, local-only keys, exact endpoint guard, no DEV/production secrets | CLI version and local seed/config need normal repository maintenance |

Option B is selected as the isolation target. A persistent branch was not created because it has a recurring compute charge and the available reset documentation did not establish the required Auth and Storage object reset guarantees. Its first CI run is currently blocked by the migration prerequisite described above; do not fabricate a local schema or use shared DEV to bypass it.

## Shared DEV E2E history

Read-only inventory on 2026-09-26 found 47 Auth accounts with the E2E email prefix `dao-e2e-…@logiclab.invalid`, 58 projects owned by those accounts, and 42 submitted bid versions attached to E2E contractor accounts. These are historical shared-DEV records. Submitted bid versions and their content are protected by `submitted_version_immutable` and `submitted_bid_content_immutable`; they were not deleted, and those protections remain unchanged.

No new FULL E2E run may target shared DEV. CI E2E uses the disposable local stack; the normal DEV deployment and manual functional checks continue to use the application DEV environment. Whether to retain or rebuild the historical DEV data is a separate maintenance decision.

## DEV migration state

Read-only Supabase checks found migration `20260926092748_enforce_draft_withdrawal_and_approved_publication` present exactly once. Both `publish_project` and `withdraw_project_request` are available on DEV, and catalog codes `general_contractor`, `plumbing`, and `electrical` are active. The migration was not reapplied during this E2E isolation work.
