# D.A.O — Next Steps

> Read `docs/ai-context/*`, then verify the real GitHub `main` and latest CI
> before acting.

## Active task: public registration account type

Work is on `feat/register-account-type`, based on main SHA
`6fd4303b26f0e8ece4cb290ae9dcd723a13c7004` (latest verified run #168 green).
The change is limited to the registration UI, profile API/backend, one
migration, CI test discovery count, tests, and this state documentation.

- Public signup accepts only `client` and `contractor`.
- No direct browser role-table writes; the RPC uses `auth.uid()` and has an
  explicit allowlist. Legacy two-argument initialization is no longer
  executable by authenticated clients.
- Contractor signup requires the real business/activity name, creates role
  `contractor` with profile verification `pending`, and does not assign a
  contractor subtype or trade.
- Client redirects to `/app/projects`; contractor redirects to `/app/artisan`.
- No RLS policy is changed. The contractor subtype column becomes nullable to
  avoid the old implicit `artisan` default.

## Validation and release sequence

1. Run backend tests/build, frontend production build, E2E discovery, fresh
   migration replay, real Supabase integration, and desktop/mobile Playwright
   in GitHub Actions. The suite now has 18 cases.
2. If CI is green, merge the PR to `main`. Immediately apply the migration to
   the verified DEV Supabase project; the repository's `deploy-dev` job only
   deploys the frontend and does not push SQL migrations. Wait for main CI and
   successful `deploy-dev`.
3. Verify DEV registration UI and desktop/mobile layout. Use disposable CI
   Supabase for actual account creation; do not create fake company data in DEV.
4. Update `CURRENT_STATE.md` and this file with final main SHA, run, migration,
   deployment, and DEV verification. Stop; no P2/P3.

The current shell lacks Docker and Chromium; integration/browser validation is
therefore delegated to the required CI run. Do not run FULL E2E against shared
DEV. Preserve all RLS policies and existing internal DAO roles.
