# Fast SQL cleanup lane in the mandatory CI

For a pull request that **only** adds one migration dropping unused `public.oce_*` or `dao_private.oce_*` function overloads and extends the schema contract to assert their absence, the existing third required job keeps the **fresh local Supabase database, schema/ledger checks, full migration replay and real integration tests**, but omits Playwright browser setup and execution **on that pull request**. The backend and frontend required jobs still run.

The classifier is automatic, conservative, and fail-closed (`scripts/ci-fast-path.py`); any extra file, other SQL operation, contract removal or uncertainty runs the **unchanged full suite**. **Every `main` push always runs full desktop/mobile Playwright E2E before DEV deployment.** The 3 required GitHub status checks and main protections are unchanged. A green fast-lane check is not a claim that browser tests ran on the PR; the job summary explains the selected scope.

Agents require no labels or special commands. This is not permission to skip database validation or bypass migrations, permissions, or reviewers. Track average runtimes before/after via the existing CI timings to decide whether further optimization is justified.
