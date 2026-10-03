# D.A.O — Next Steps

> Verify path, branch, HEAD, remote SHA and working tree before every resumed
> phase. Resume from the last published checkpoint, never from an older checkout.

## Current WORK OPT next steps — 2026-10-03 Europe/Paris

Verified main `1af71770eb660825e42fa1a2e9925276bb396a06`; main CI #193 and
DEV deploy are green. DAO DEV operations #2 is green:
**ENV-SYNC DEV = PASS**. PR #10 remains open and untouched at
`8d3d5298b4c34a764aad441a4ae0758d46e06989`; CI #194 is in progress.

1. Do not merge any OPT branch while PR #10 is open. Do not modify or rebase
   PR #10 from OPT.
2. Keep the prepared OPT V3 branch separate. After PR #10 is merged and DEV
   is validated, recheck the new main, rebase/recreate OPT V3 from that SHA,
   then run its own CI before any merge.
3. V3-A: remove the routine manual `workflow_dispatch` dependency by making
   the fixed DEV operations needed by a normal deployment available from the
   deployment pipeline.
4. V3-B: make env-sync automatically available during DEV deployment through
   protected environment secrets, fixed operations, concurrency and rollback;
   never expose secret values in artifacts, logs or inputs.
5. V3-C: provision one permanent TEST client and one TEST contractor through
   standard Auth administration once the protected credential channel exists;
   keep contractor verification `pending`, store only non-secret IDs, and
   make `reset-dev-fixtures.sh` reset only owned scenario resources.
6. V3-D: make normal DEV status, health, restart, env-sync and fixture actions
   autonomous for Work DEV without product, Auth/RLS, schema or migration
   changes.

FULL E2E remains disposable and isolated from shared DEV.

## Historical WORK DEV checkpoint — superseded by merged PR #8

The remaining text preserves the prior collaboration checkpoint as history.
Do not resume its branch or execute its old “merge PR #8” instructions:
PR #8 and #9 are already merged; use live main/PR/CI evidence.

Historical active branch: `feat/project-collaboration-invitations`.
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
- CI #174 (`36801932429`) on `a923f5c3aeb6d9228e0caca7be23ab93b2285aee`:
  backend/build, fresh schema, reset/replay, real Auth/JWT/RPC/RLS/Storage/
  concurrency and 34/34 desktop/mobile E2E green; all old coverage preserved.
  The async-permission test and mobile list overflow are fixed and validated.

## Remaining — next small phase

1. Merge PR #8 only after checks on its exact current HEAD are green.
   The final pre-merge documentation checkpoint only records #174's results;
   no product/test/migration change and no repeated local build is needed.
   Never use shared DEV as a replacement for the disposable CI stack.
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
