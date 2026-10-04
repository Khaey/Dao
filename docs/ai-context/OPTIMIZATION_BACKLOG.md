# D.A.O — Optimization backlog (analysis, not implementation)

Verified 2026-10-04 Europe/Paris against main
`6c3965a797d6af70714a96557ae192632b8c8b74`.
V3-C is implemented as platform tooling only; no product/Auth/RLS logic,
migration or schema implementation is included.

## V3-A — release-triggered real email validation (owned phase)

The candidate workflow adds an explicit GitHub Release trigger while keeping
`workflow_dispatch` as the recovery path. A read-only Actions API guard waits
for the green main CI/deploy run for the same commit and refuses a duplicate
after a successful run already exists for that SHA. The existing shared
`dao-dev-test-scope` concurrency group is unchanged, so reset and mailbox
validation remain serialized with fixture operations. No automatic trigger is
attached to ordinary pushes or pull requests.

Acceptance requires workflow syntax, PR CI, and a later published-release
observation. Until that observation, this remains a candidate rather than a
claim that a release was executed.

V3-B automatic env-sync and V3-D routine technical autonomy remain open and
must be implemented in separate phases.

## Protected real DEV email runner — implemented on OPT branch

The follow-up runner is a separate main-only workflow. It uses the existing
permanent TEST accounts and browser helpers against the deployed DEV origin,
with the four credential values injected only into the protected GitHub job.
It disables Playwright traces/screenshots/video, never uploads results, clears
browser state, and performs the existing bounded reset before and after the
scenario. The full local disposable E2E remains unchanged and remains the
coverage gate for product changes.

## Permanent TEST DEV accounts — protected workflow implemented

The VPS admin helper is installed and the DEV operations path is ready.
The only remaining optimization is one permanent TEST client plus one permanent
TEST contractor, both clearly marked TEST DEV, with credentials held only by a
protected secret mechanism and reset limited to owned scenario resources.

The `DAO DEV TEST fixtures` workflow consumes the two protected credential pairs
from GitHub Environment `dev`, reconciles the Auth users and ensures their
fixture role/profile rows. It also performs real login verification and keeps
the contractor at `pending` / `draft`. The disposable E2E fixture’s `verified`
profile is not reused.

`scripts/reset-dev-fixtures.sh --plan` remains the safe description; the
protected `--apply` path archives only projects owned or initiated by the two
TEST identities and revokes their pending invitations. It preserves accounts,
memberships, documents, Storage, submitted offers and immutable history.


## Measured baseline

Source: [main CI #178](https://github.com/Khaey/Dao/actions/runs/36918284057),
attempt 1, successful; job timestamps and existing timing helper.
One run is an observation, not a stable performance distribution.

| Measurement | Observed |
| --- | ---: |
| Workflow created → last update (19:59:17Z → 20:05:03Z) | 346 s, includes scheduling/final summary |
| Critical full-e2e job | 273 s |
| Playwright, 34 passed, two workers | 100.64 s |
| Fresh stack + migrations + seed | 70 s |
| Reset/replay | 29 s |
| E2E build + browser setup in parallel | 34 s |
| Real integration | 5 s |
| General frontend-build job | 66 s, parallel to full-e2e |
| General frontend build / cache save | 28 s / 11 s |
| backend-verify | 13 s, parallel to full-e2e |
| deploy-dev | 22 s |
| SCP / SSH step | 10 s / 5 s |
| Merge timestamp → logged service active/release | about 303 s |

Deployment job `110559521440` confirms both dependency caches hit,
`DEPLOY_BUILD source=verified_ci_artifact`, and release SHA matching main.
This is historical CI/VPS evidence, not a direct live SSH check.
Shell Git failed at its configured network proxy; authenticated GitHub API
reads/publication work. The VPS helper/bootstrap and DEV operations path are verified by the operator; direct shell SSH remains intentionally unnecessary.

## Ranked next phases

| Priority | Proposed phase | Evidence / expected value | Acceptance and guardrails |
| --- | --- | --- | --- |
| 1 | Read-only preflight/report script | Missing remote and stale checkout/context cost setup time; numeric gain unmeasured | Report repo/main/own head, CI IDs, PR overlaps and required capabilities; bounded calls, no secret values or automatic mutations |
| 2 | Measure and trial Playwright 2 → 4 workers | Completed in PR #13 / CI #185: 75.14 s, 34/34 pass, critical job 229 s | Kept: unchanged coverage, no flake, 25.4% browser gain and 16.1% critical-job gain; override remains available for controlled comparisons |
| 3 | Serialize DEV activation and reject stale deployments | Main workflow currently allows cancellation; deploy has atomic symlink/rollback but no cross-run deployment lock or latest-main guard | Separate tooling phase; prove competing deployments cannot activate out of order; preserve rollback and exact artifact checks; do not interrupt DEV work |
| 4 | Improve deploy readiness evidence | Health check currently only calls systemctl is-active | Bounded HTTP readiness on an existing appropriate local route and expected revision evidence; rollback on failure; no new product endpoint |
| 5 | Correct/test Next.js cache fallback prefix | Generated key puts source hash before environment; restore prefix puts environment immediately after lock hash, so it cannot restore keys of that shape | Preserve CI/DEV isolation and invalidation; measure cold/warm restore+save cost; general build is off critical path, so no promised workflow gain |
| 6 | Profile fresh stack startup before new caching | Startup is the second largest segment at 70 s | Separate image download/start/migration evidence; retain fresh DB and 29 s reset/replay proof; no database snapshot shortcut or new paid runner |
| 7 | Machine-readable timing/coverage summary | Helper and jobs API already expose stage timing | Reuse observations for stage durations, scenarios/viewports and pass/fail/skip counts; protect token-bearing traces |

Priorities 1–2 offer the strongest likely execution-time return. Priorities
3–4 improve reliable autonomy. Ideal doubling of browser parallelism could
save roughly half the browser segment; actual gain is unknown. Fixture
isolation alone does not prove four-worker safety.

## Coverage and concurrent DEV work

Main discovers 34 executions in 13 spec files; #178 executed 34 successfully.
WORK DEV owns PR #10, head `f6674946f6767cdb6af3367e39798aca2f5f88a2`;
[#180](https://github.com/Khaey/Dao/actions/runs/36947898450) is successful.
Its description reports 38 executions including email scenarios.

Do not implement experiments on that branch or change its PR. It overlaps
.github/workflows/ci.yml, E2E support, CURRENT_STATE, NEXT_STEPS, DECISIONS
and other context files. Before final OPT merge or the next technical phase,
recheck main and PRs. If DEV merges first, rebase/recreate OPT from new main,
preserve its new context/tests, and adopt its new coverage baseline. Never
overwrite a newer count of 38 with the older main count of 34.

## Already done — do not repeat without new evidence

- One disposable stack reused for fresh/reset/integration/FULL E2E (D-027).
- E2E build parallel with browser/system dependency installation.
- Split project scenarios and worker-scoped TEST users.
- Verified CI artifact deployment and warm VPS dependency caches.
- Chromium cache rejected for negligible net gain (D-028).
- npm installs parallel with stack startup reverted for no gain.
- FULL E2E against shared DEV remains forbidden; preserve immutable history.
- No CI skip/path filter introduced. Any future docs-only policy needs its
  own gate design and coverage review.

## Next concrete action

Publish this documentation phase as an owned draft PR and observe automatic
checks without manual reruns. Reconcile latest main before an authorized merge.
Then implement priority 1 on a fresh chore branch. No technical experiment,
merge or DEV deployment is claimed by this analysis.
