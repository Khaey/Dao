# D.A.O — Next Steps

> Verify path, branch, HEAD, remote SHA and working tree before every resumed
> phase. Resume from the last published checkpoint, never from an older checkout.

Active branch: `feat/project-collaboration-invitations`.
Verified main: `965054db897f18794b9f745bf86f397dea34b4d9`, latest main CI #171 green.
Product decisions: `COLLABORATION_DESIGN.md` and the final product supplement.

## Completed — do not recreate

- Model/backfill and schema contract: `f16bc61a6561ecbb9894e662218d279e368c6528`.
- Controlled RPCs, invitation lifecycle, memberships, private/document rights,
  backend/RLS and real integration test source: `d91fb0af21689ef850188f84213e7305ffdfb0b5`.
- Common Mes chantiers, separate DAO disponibles, client/contractor dashboard,
  simple creation, invitation/auth return, team/documents/tracking UX:
  `2273344b167fc814407099404d377010377ac930`.
- Existing E2E compatibility: `e31f1bf6c1da6aeaa6cd8847cbde802144ab9f04`.
- Independent client/team/mixed lots and contractor/client E2E:
  `6eb02c15aa4f3d370ca46ab02bd3883762b739e1`.
- Invitation roles, revocation, decline and isolation E2E:
  `abcca1c468448077bb7b3a26da5ef3aae53dd5ca`.
- Signup invitation return and external redirect rejection:
  `11872b3c85ce816d0da82f531abaffc2146bb5b2`.
- Shared/private documents, explicit permission and revoked-member downloads:
  `12846d9a6d6a1a108c316836a82c5618a5f2d729`.
- Current local checks: 20/20 backend, 140/140 PGlite and migration/RLS checks,
  shared schema contract, frontend production build (45 routes), TypeScript,
  diff check and discovery of 34 executions in 13 files. Discovery is not execution.

## Remaining — next small phase

1. PR #8 / CI #172 passed backend/build, fresh Supabase, schema contract,
   reset/replay and real integration; E2E was 31/34. The async private-permission
   assertion is corrected from trace evidence; preserve its UI and DB checks.
   The separate mobile list overflow is corrected with a constrained grid
   column and a width regression assertion. Confirm all 34 executions on the
   next CI. Docker is unavailable locally and browser download is
   blocked; never use shared DEV as a replacement for the disposable CI stack.
2. Read logs/artifacts before every failure correction; audit other occurrences
   of the same cause. Preserve all old tests and useful assertions. Each small
   validated correction must be committed, published and remotely confirmed.
3. Merge only when all mandatory checks and coverage are green. Verify exact
   new main, inspect the confirmed DEV migration ledger, apply missing SQL once
   only if needed, and verify deploy-dev and DEV desktop/mobile.
4. Confirm `DEPLOY_BUILD source=verified_ci_artifact` and measure warm VPS
   dependency caches. Update the verified state and stop; no P2/P3.

Never commit `dao-frontend/tsconfig.tsbuildinfo`. Never reset, restore, clean,
stash or discard unsaved collaboration changes. Keep at most one small phase
between pushes and independently confirm the remote SHA after every checkpoint.

Stop for a real product contradiction, data-loss/security risk, conflicting DEV
migration, ambiguous root cause, the same cause after two corrections, or three
consecutive CI failures in the same functional area. If the environment or
checkout changes, stop coding and recover the expected remote branch first.
