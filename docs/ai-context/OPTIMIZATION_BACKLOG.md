# D.A.O — Optimization backlog (analysis, not implementation)

Verified 2026-10-03 Europe/Paris against main
`1af71770eb660825e42fa1a2e9925276bb396a06`.
ENV-SYNC DEV is verified PASS on DAO DEV operations run #2
(`37079779120`). PR #10 remains the active DEV boundary; no OPT merge is
authorized until it is merged and DEV is validated.

## Autonomy DEV V3 — prepared, not merged

| Phase | Prepared objective | Guardrail |
| --- | --- | --- |
| V3-A | Remove routine manual `workflow_dispatch` for normal DEV deployment operations | Fixed operations, main-only, serialized and auditable |
| V3-B | Make env-sync automatically available in the DEV deployment pipeline | Protected secrets only; no output/artifact/input exposure; preserve rollback and root:dao / 0640 |
| V3-C | Add one permanent TEST client, one TEST contractor and bounded reset | Standard Auth administration only; contractor `pending`; no shared DB reset, RLS or Auth-policy change |
| V3-D | Remove Ahmed intervention from routine Work DEV operations | Reuse helper, health checks, host lock and concurrency; retain explicit stop gates |

Execution gate: do not implement or merge V3 while PR #10 is open. Once PR #10
is merged and DEV is validated, recheck the new main, reconcile this branch
with new DEV tests/context, measure baseline, then implement one phase at a time.

## Permanent TEST DEV accounts — one prerequisite remains

The VPS helper, SCP transfer and Resend env-sync are closed and verified.
Permanent accounts are still not provisioned. Creation waits for one protected,
authorized DEV Auth administration channel that can supply/store credentials
without exposing them to Git, docs, workflow inputs or logs.

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
