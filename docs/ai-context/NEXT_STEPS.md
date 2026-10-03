# D.A.O — Next Steps

> Verify path, branch, HEAD, remote SHA and working tree before every resumed
> phase. Resume from the last published checkpoint, never from an older checkout.

## Handoff — new ChatGPT conversation

The next conversation must start by reading, in order:

1. `PROJECT_CONTEXT.md`
2. `ARCHITECTURE.md`
3. `BUSINESS_RULES.md`
4. `DECISIONS.md`
5. `CURRENT_STATE.md`
6. `NEXT_STEPS.md`
7. `AUTONOMOUS_EXECUTION.md`

Then verify live GitHub `main`, the latest completed main CI and any open PRs
before acting. Never resume from an older SHA copied from chat history.

Current product implementation is already complete on main
`352d2a13ee124d0bfa2b8d5247bc8f0b78ac8483` with CI #222 green:
client existing-team creation supports multiple artisan rows on one screen,
minimum one artisan, one real principal lot per invited artisan, atomic
project/lots/invitations creation, principal-lot reservation, automatic
principal-lot assignment on acceptance, and later assignment of additional
lots to an accepted contractor.

The documentation-only PR #21 updates the AI context to this state. If it is
still open, finish it only after its exact current HEAD CI is green. It contains
no product/schema/runtime change.

The next product work must not recreate the existing-team/principal-lot feature.
Continue only from an explicit new user decision or from a real bug observed on
the deployed flow.

## Current product next steps — 2026-10-03

Verified main `352d2a13ee124d0bfa2b8d5247bc8f0b78ac8483`; CI #222 and
DEV deploy are green.

1. Treat **client existing team + principal lots** as completed. Do not recreate
   its schema, atomic RPC, principal-lot invitation binding or E2E coverage.
2. For any manual DEV check, validate one multi-artisan creation:
   each artisan has name/email/trade/title/budget, each receives a distinct
   principal lot invitation, and acceptance attaches that contractor member to
   the corresponding lot.
3. Validate the follow-up path separately: create another lot after acceptance
   and assign the already accepted contractor from the Lots tab. This is an
   additional project participation assignment, not a bid/award.
4. Preserve the MVP rule **1 invitation = 1 principal lot**. Do not add
   multi-select lots to invitation onboarding unless product explicitly changes
   this rule.
5. Preserve minimum 1 artisan/lot only for the `client_existing_team` flow.
   Marketplace-first client projects may still prepare lots without known
   professionals.
6. Permanent shared-DEV TEST accounts/reset automation remains a separate OPT
   concern and must not weaken Auth/RLS or expose credentials.

Historical instructions below are retained only for traceability.

## Current WORK OPT next steps — 2026-10-02 Europe/Paris

Verified main `990f65f916638431e05aa3733fffcb6cd8f103c5`; main CI #188 and
deploy-dev are green. PR #10 remains open and untouched at
`fc51a90fbd92271d9d6be18d479a9f2962ee3486`.

1. Keep the installed VPS helper as the source of truth for DEV operations:
   `/usr/local/sbin/dao-dev-admin` is present, `env-sync` is available,
   and VPS access is no longer a blocker.
2. The only remaining OPT prerequisite is one protected, authorized DEV Auth
   administration channel for the permanent TEST client/contractor credential
   pairs. Do not place credentials in Git, docs, workflow inputs or logs.
3. After that prerequisite is supplied, provision one TEST client and one TEST
   contractor through standard Auth administration; the contractor must use
   the expected signup status `pending`. Record only non-secret IDs/labels in
   an access-controlled manifest and implement a bounded reset for owned
   scenario resources.
4. Until provisioning is authorized and secret-backed, keep
   `bash scripts/reset-dev-fixtures.sh --plan` as the only supported reset.
   FULL E2E continues to use the disposable local Supabase stack.

No product, RLS, Auth or business code changes are authorized in this phase.

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


## Email V1 completion

1. Publish the tested checkpoint and PR; verify the exact remote SHA. Check
   the complete CI on its current HEAD: backend, build, fresh Supabase/schema
   contract, reset/replay, real integration and all 38 E2E executions.
2. Inspect failure logs/artifacts before changing anything. Keep the 34 old
   E2E cases and their assertions. The provider must remain mocked in CI.
   No DEV email, migration, RLS/Auth change or bypass for a failing test.
3. Report the PR/CI and external setup. No automatic merge is requested in
   this phase. Do not claim real delivery until tested with a TEST mailbox.
4. Configure Resend/domain and server-only `RESEND_API_KEY`, `DAO_EMAIL_FROM`,
   `DAO_PUBLIC_URL` out-of-band in `/etc/dao/dao-dev.env`, per
   `DEV_DEPLOYMENT.md`. No secret in Git/chat/logs; no Supabase Auth SMTP change.
5. After a separately authorized merge/deployment, test real receipt and
   acceptance with an authorized TEST mailbox. No resend after reload in V1.

Stop if a DB migration, RLS change, Auth change or new product choice is
required. Do not commit `dao-frontend/tsconfig.tsbuildinfo`. Never discard
unsaved work. Read current PR state rather than using historical checkpoints.
