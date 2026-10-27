# CI fast path for safe pull requests — #372

The three protected-branch check names stay exactly the same: `backend-verify`, `frontend-build`, `Fresh schema, real Supabase integration, and FULL E2E`.

The third job runs `scripts/ci-fast-path.py` on the two exact pull-request SHAs, not the checkout's synthetic merge head. It publishes the mode in the Actions job summary. Classification always defaults to `full` on missing SHAs, failed fetch, unrecognized paths or altered code.

On PRs: `docs` is limited to README/CHANGELOG and Markdown under `docs/`; `cosmetic` requires **one modified TSX** whose only differences are literal className colors/decoration, or **one CSS file** with only whitelisted color/border/shadow property values changed; `sql_cleanup` preserves the narrowly-scoped #324 OCE DROP FUNCTION checks, **fresh Supabase/replay and real database integration**. Everything else is `full`, including changed JSX markup, removal of components, changed handlers, test files, mixed UI/functional changes, API, auth/RLS, SQL, CI, dependencies, and unclear diffs.

A passing mandatory check running in fast PR mode explicitly states that it **did not execute browser E2E on the PR**. This is not a fake E2E pass. After every push to `main`, **the mode is always `full`**: fresh schema, real DB integration, all Playwright tests, then (and only then) `deploy-dev`. All three required checks and the GitHub ruleset are unchanged.

The #369 PR that removed a profile card *also* changed assisted attribution and an E2E spec; it is **not cosmetic** and remains a full-E2E PR. Even a standalone removal of JSX structure is currently full: only strictly provable className/CSS edits and docs are fast. Do not bypass the classifier manually.

Validation: `python3 -m unittest discover -s scripts/tests -v`. Compare actual timings for a docs-only and static cosmetic PR with the baseline; GitHub runner queue may vary.
