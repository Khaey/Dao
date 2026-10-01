# D.A.O — Next Steps

> Verify the real GitHub branch/SHA and working tree before every resumed phase.

Active branch: `feat/project-collaboration-invitations`.
Base main: `965054db897f18794b9f745bf86f397dea34b4d9`, CI #171 green.
Product source: the collaboration prompt plus its later product supplement;
final decisions are recorded in `COLLABORATION_DESIGN.md`.

1. Checkpoint 0: remote branch exists at the base SHA — done.
2. Checkpoint 1: collaboration model, legacy backfill, isolated workspace RLS,
   private/document permissions, schema contract and local tests — validated;
   published as `f16bc61a6561ecbb9894e662218d279e368c6528`.
3. Checkpoint 2: controlled creation, invitations/preview/atomic confirmation,
   revoke/decline/expiry, membership/lot assignment, declarative tracking,
   preparation permissions and backend/security integration tests — validated
   locally; published as `d91fb0af21689ef850188f84213e7305ffdfb0b5`.
   Real integration remains for CI.
4. Checkpoint 3: common Mes chantiers, separate DAO disponibles, simple client
   and contractor creation, role-aware dashboard, team/documents/tracking,
   safe invitation summary and login/register return — implemented.
   Production build passed with 45 routes; published as
   `2273344b167fc814407099404d377010377ac930`.
5. Existing E2E compatibility: current marketplace entry and chantier/private
   labels adapted. Published as `e31f1bf6c1da6aeaa6cd8847cbde802144ab9f04`.
   Checkpoint 4: core client/team and contractor/client scenarios added (22
   viewport executions). Save this small checkpoint; then add roles,
   revocation, private documents and regression. Preserve existing tests.
6. Checkpoint 5: full local checks where available, disposable fresh Supabase
   and reset/replay, real JWT/RPC/RLS/Storage/concurrency, complete E2E, PR CI.
7. Merge only after all coverage is green. Verify real main, inspect DEV
   migration ledger, apply missing SQL once, then verify deployed DEV.
   Confirm `DEPLOY_BUILD source=verified_ci_artifact` and measure warm caches.
8. Stop after DEV validation; no P2/P3.

After each stable phase: git status, useful phase tests, commit, remote branch
update, independent remote SHA confirmation. Never accumulate a second phase
without a pushed checkpoint. Never commit `dao-frontend/tsconfig.tsbuildinfo`.

Stop for a real product contradiction, data-loss/security risk, conflicting DEV
migration, an ambiguous root cause, the same cause after two corrections, or
three consecutive CI failures in the same functional area. If the checkout or
environment changes, stop and verify path, branch, HEAD and working tree;
resume only from the expected branch's remote checkpoint.
