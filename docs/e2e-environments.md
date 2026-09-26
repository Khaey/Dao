# E2E environments

## Automated FULL E2E

FULL Playwright runs use the disposable Supabase CLI stack on a fresh GitHub-hosted runner. The job starts PostgreSQL, Auth, Kong, PostgREST, and Storage; resets the local database; replays every migration in `dao-backend/supabase/migrations`; and then loads the E2E-only territory rows from `dao-backend/supabase/seed.sql`. Storage object files live in the runner's local Storage container. The runner and its containers are discarded after the job, so Auth users, database rows, Storage metadata, and object files do not carry over to another campaign.

The app receives URL and keys read from that local stack at runtime. `verify-supabase-target.mjs` and the Playwright fixtures both require the exact endpoint `http://127.0.0.1:54321`; no DEV or production Supabase secrets are attached to the E2E job. Playwright runs the desktop and mobile projects with two workers. Worker state records resource IDs for leak accounting, while `cleanup-e2e.mjs` removes only those local tracking files. Submitted offers and immutable history remain intact until the disposable runner is discarded.

Every run records stack startup, migration reset/seed, and FULL Playwright durations in the GitHub Actions summary. No isolated run has completed on this configuration yet, so those timings are pending its first CI run.

## Environment choice

| Option | Time | Cost | Fidelity | Complexity | Security | Maintenance |
| --- | --- | --- | --- | --- | --- | --- |
| Supabase development branch | Branch creation and reset were not measured; branch was not created | The current estimate is USD 0.01344/hour (about USD 9.81 for 730 active hours), plus applicable storage/egress; no paid resource was created | Hosted Supabase services; the documented branch reset did not explicitly guarantee clearing Auth state and Storage object files | Low once provisioned, but reset semantics must be independently verified | Separate project reference and keys; persistent branch data requires a reliable reset boundary | A long-lived branch would accrue compute cost while active and require periodic migration upkeep |
| Supabase CLI on GitHub runner | Startup and reset are measured by the first run; no local Docker engine was available here to measure them beforehand | No persistent Supabase compute charge; GitHub Actions minutes and runner use apply | Uses the repo's Supabase CLI stack with real PostgreSQL, Auth, REST, Storage, and exact repository migrations; local-only geography seed supplies test reference data | Requires Docker, pinned CLI, and local configuration in CI | Fresh runner, local-only keys, exact endpoint guard, no DEV/production secrets | CLI version and local seed/config need normal repository maintenance |

Option B is selected. A persistent branch was not created because it has a recurring compute charge and the available reset documentation did not establish the required Auth and Storage object reset guarantees. A fresh runner provides the reset boundary without touching the shared DEV project.

## Shared DEV E2E history

Read-only inventory on 2026-09-26 found 47 Auth accounts with the E2E email prefix `dao-e2e-…@logiclab.invalid`, 58 projects owned by those accounts, and 42 submitted bid versions attached to E2E contractor accounts. These are historical shared-DEV records. Submitted bid versions and their content are protected by `submitted_version_immutable` and `submitted_bid_content_immutable`; they were not deleted, and those protections remain unchanged.

No new FULL E2E run may target shared DEV. CI E2E uses the disposable local stack; the normal DEV deployment and manual functional checks continue to use the application DEV environment. Whether to retain or rebuild the historical DEV data is a separate maintenance decision.

## DEV migration state

Read-only Supabase checks found migration `20260926092748_enforce_draft_withdrawal_and_approved_publication` present exactly once. Both `publish_project` and `withdraw_project_request` are available on DEV, and catalog codes `general_contractor`, `plumbing`, and `electrical` are active. The migration was not reapplied during this E2E isolation work.
