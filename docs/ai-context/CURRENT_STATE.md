# D.A.O — Current State

> **Last verified:** 2026-09-28  
> **Repository:** `Khaey/Dao`

## 1. Merged revision and deployment

PR [#1](https://github.com/Khaey/Dao/pull/1) was merged to `main`.
The code-bearing merge SHA is:

```text
45e0e40230ba663c6d1633a310335561c2c0b838
```

Run [#148](https://github.com/Khaey/Dao/actions/runs/36366960973), run ID
`36366960973`, completed successfully on that SHA.

| Gate | Result |
| --- | --- |
| `backend-verify` (backend and PGlite) | ✅ |
| `frontend-build` | ✅ |
| Fresh Supabase, 22 migrations, seed, schema contract, reset/replay, ledger | ✅ |
| Real Supabase integration against local stack | ✅ |
| Playwright discovery and FULL E2E | ✅ 14/14, desktop/mobile, 2 workers |
| `deploy-dev` | ✅ |

The deploy log shows the VPS checked out release `45e0e40230ba663c6d1633a310335561c2c0b838`, compiled it, switched
`/opt/dao/current` to that release through `ops/deploy-dev.sh`, and reported
`dao-dev.service` active. The deploy job completed successfully.

## 2. Supabase reproducibility and parity

- The repository contains 22 migrations. Fresh Supabase startup and reset/replay
  completed with the repository migration chain, seed, schema contract, and
  migration ledger checks.
- DEV has the same 22 migration versions; `20260927102942` is present exactly once.
- The real integration suite passed against the disposable local Supabase stack.
  It exercises Auth/JWT, RLS, RPC, publications, offers, immutability, Storage,
  and award foundations.
- The read-only DAO inventory compared fresh-local artifact from run #147 with
  DEV: 586 objects on each side, 0 missing, 0 extra, 0 structural drift, and
  0 semantic drift.
- Nine RAW function fingerprints differ only in SQL representation/formatting;
  function metadata and semantic fingerprints match. These are not blockers.
- The only DEV migration applied for this reconciliation was the authorized
  `20260927102942_reconcile_dao_function_definitions.sql`. No direct DEV
  functional test or further database audit was run after the user waived it.

Do not use shared DEV for FULL E2E. Preserve the immutability protections
`submitted_version_immutable` and `submitted_bid_content_immutable`.

## 3. E2E environment and cleanup boundary

FULL E2E runs on a disposable Supabase local stack at
`http://127.0.0.1:54321`. The target guard remains enabled. Run #148 discovered
14 tests and passed all 14 on desktop and mobile with 2 workers. Cleanup removed
worker tracking files only; runner disposal is the data cleanup boundary.

The known historical E2E accounts, projects, and submitted bid versions in DEV
were not cleaned or used by these tests.

`deploy-dev` is restricted to `push` on `refs/heads/main`; it is skipped for
pull requests.

## 4. CI timing baseline — run #148

Use these measurements as the starting point for the next CI speed work:

| Measurement | Duration |
| --- | ---: |
| Entire workflow, from start to completion | 6m26s |
| Fresh Supabase start/replay job step | 70s |
| Explicit schema reset/replay step | 29s |
| E2E Supabase startup plus migrations and seed | 63.82s |
| FULL Playwright, 14 tests / 2 workers | 45.62s |
| DEV SSH deployment job | about 79s |

No CI speed changes or P2/P3 work were started as part of closing PR #1.
