# D.A.O — Next Steps

> Verify path, branch, HEAD, remote SHA and working tree before every resumed
> phase. Resume from the last published checkpoint, never from an older checkout.

Active branch: `feat/project-collaboration-invitations`.
Verified main: `16cd8d3550408007ab130fcefa7e7e9006af3323`, main CI #176 green.
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
- PR #8 merged; main CI #176 passed all 34 E2E and real integration; deploy-dev
  succeeded with a verified CI artifact and a warm frontend dependency cache.
- DEV runtime project confirmed as `nmbpjdltirotoifwuzat`; both collaboration
  migrations applied once, canonical ledger 25, DAO tables 45, structural
  contract green and all 91 legacy client projects backfilled safely.
- Public DEV login and unavailable invitation render correctly. The browser
  redirects `/app` to login because it has no authenticated session.

## Remaining — next small phase

1. Obtain secure DEV sign-in in the existing browser session; never request
   passwords in chat or read Auth secrets. Validate Client/Artisan live screens,
   common Mes chantiers, separate marketplace, simple creation, invitation
   confirmation and responsive desktop/mobile. Report any access boundary
   explicitly instead of claiming the live authenticated checks passed.
2. Complete the release documentation snapshot from these actual results;
   publish each small checkpoint. Product code/migrations/tests are already
   green and merged; do not redo them or apply the DEV SQL again.
3. If live validation reveals a clear technical issue, read its evidence and
   audit the same cause before correcting. Preserve all useful assertions and
   security boundaries; commit/push validated small corrections.
4. Stop after live DEV verification and final documentation; no P2/P3.

Never commit `dao-frontend/tsconfig.tsbuildinfo`. Never reset, restore, clean,
stash or discard unsaved collaboration changes. Keep at most one small phase
between pushes and independently confirm the remote SHA after every checkpoint.

Stop for a real product contradiction, data-loss/security risk, conflicting DEV
migration, ambiguous root cause, the same cause after two corrections, or three
consecutive CI failures in the same functional area. If the environment or
checkout changes, stop coding and recover the expected remote branch first.
