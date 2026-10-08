# D.A.O — Autonomous execution / FAST EXECUTION MODE

## Scope and ownership

WORK OPT owns execution efficiency: CI, Playwright infrastructure, TEST
fixtures, validation scripts, DEV deployment tooling, VPS access diagnostics
and docs/ai-context. WORK DEV owns product features and their branches/PRs.

This protocol supports A→Z execution within the user's authorized scope.
It is not permission to change product behavior, business rules, RLS, Auth,
SQL/RPC/schema, production, infrastructure unrelated to D.A.O, or another
Work's branch. Explicit current user instructions take precedence over old
checkpoints. Do not ask again for already authorized routine work.

Repository-root `AGENTS.md` is the startup instruction for new Work/Codex
sessions. Read this protocol first, then the complete context index. The user
has authorized WORK OPT to complete its own normal branch → checks → PR → CI
→ merge workflow without repeated confirmations. WORK DEV remains separate.
Permanent DEV TEST accounts are allowed for targeted validation; they do not
replace isolated CI users. See [../platform-operations.md](../platform-operations.md)
for scripts, DEV operations and the fixture reset boundary.

## 1. Resume from remote evidence

1. Identify the official repository `Khaey/Dao`, local path (if any), branch,
   HEAD, worktree status and remote. Never assume a directory named dao is it.
2. Read every file in `docs/ai-context/` at the verified remote main SHA.
   Read applicable AGENTS.md instructions if present. Use the README index.
3. Read the actual `refs/heads/main`, latest main workflow and open PR metadata.
   Record SHA, run ID/attempt, conclusion, and PR ownership without changing
   other PRs. Chat and old documentation are leads, not live state.
4. Create a new `chore/...` branch from that exact main SHA, remotely before
   implementation. Use an isolated clone/worktree; preserve all other local
   changes. Never reset, clean, stash or switch a Work DEV checkout.
5. Before each modification phase, verify main again. If it advanced, inspect
   the delta and rebase only your own branch or recreate it cleanly from the
   new main, carrying only reviewed OPT changes. Never overwrite a concurrent
   context update or force-push another Work's history.

Use a working authenticated GitHub connector when shell Git/network access is
unavailable. Git data API publication must use the verified main tree as its
base, preserving all untouched paths, and the owned branch as its only target.
Confirm remote branch SHA after each publication via API or git ls-remote.
Never describe an API file snapshot as a complete local clone.

## 2. Preflight once, then execute

Record only the capabilities required by the phase:

| Capability | Evidence | If unavailable |
| --- | --- | --- |
| GitHub read/write | Read main; create/update owned branch; verify SHA | Use available authorized connector; report the exact remaining blocker |
| Local runtime | Relevant executable/version only | Use existing CI for checks needing its runtime |
| Disposable E2E stack | Docker and pinned CLI, or existing CI job | Do not substitute shared DEV |
| VPS | Existing authorized SSH identity, bounded read-only connection | Read deployment evidence through GitHub; mark direct access unverified |
| External provider | Required configuration exists, without showing values | Continue independent work; identify only missing prerequisite |

Do not probe unrelated accounts, extract GitHub Actions secrets, disable host
verification, bypass approval controls, or install broad new access to remove a
blocker. One concrete failure plus one supported fallback is normally enough
for access diagnosis; do not spend the task trying equivalent failed paths.

## 3. Plan the smallest complete phase

- State the outcome, allowed files, excluded files and acceptance evidence.
- Separate independent reads and inspections; batch them where practical.
  Keep dependent changes, publication and deployment sequential.
- Prepare a concrete change and verify it before seeking any genuinely missing
  approval. Do not stop at a plan when implementation is already authorized.
- Commit/publish a coherent checkpoint before starting the next phase.
  Avoid a push for every prose correction: finish the small phase first.
- Send concise progress updates about findings, next action or blockers.
  During execution, avoid long silent waits and tight polling.

## 4. Validation proportional to change

| Change | Minimum useful verification |
| --- | --- |
| Documentation only | Review diff and scope; local links/paths; whitespace; consistency of SHA/run evidence |
| Shell/helper script | Syntax and targeted behavior, including failure propagation and cleanup |
| Workflow/cache/fixtures/Playwright | Relevant local checks when available; existing mandatory CI on final head; coverage comparison |
| DEV deployment tooling | Above plus manifest/release/rollback invariants; authorized real DEV deployment evidence after merge |

Do not rerun local build, full E2E or CI for an unchanged validated SHA and
unchanged relevant inputs merely to reassure yourself. Documentation alone
does not need a local app build. The current workflow still runs on PRs,
including documentation PRs: observe its automatic run once; do not manually
rerun it, add skip markers, or weaken required checks.

Proof is scoped to code SHA, tested merge SHA where applicable, workflow,
environment, dependencies, run and attempt. Rebase, relevant configuration
changes or a changed main can invalidate prior evidence. Never label old
green checks as green on a new head. Test discovery is not test execution;
PGlite is not real Auth/JWT/Storage integration.

On failure: read logs/artifacts, classify the cause, make the smallest certain
technical fix, verify and publish it. Preserve the D-023 bound: stop that
correction path if the same cause returns after two different corrections,
three consecutive runs fail in one functional area, or the cause is ambiguous.
A product/Auth/RLS/business fix belongs to WORK DEV; report evidence and
continue independent OPT work without changing their PR.

## 5. Coverage is a gate, not an optimization variable

Preserve all existing scenarios and useful assertions, desktop and mobile,
negative authorization checks, real integration, fresh migration/schema
proof, full reset/replay, target guards and immutable-history behavior.

Determine expected coverage from the current code and CI, not a stale fixed
number in this document. Preserve newly merged DEV tests when rebasing.
Do not remove tests, introduce skips, reduce viewports, add force clicks,
arbitrary sleeps/retries/timeouts, share mutable scenarios, or replace real
user/API behavior with privileged fixture shortcuts to improve timing.

CI TEST users/data remain scoped to run, attempt, viewport and worker, with a
project unique to each scenario. Privileged setup is limited to the existing
disposable test-provisioning boundary. Product commands keep real actor JWTs.
FULL E2E requires the exact local target `http://127.0.0.1:54321`.
Never run it against shared DEV or production; never delete immutable history.

Keep one fresh disposable stack with reset/replay. Keep E2E's local-config
frontend build separate from the DEV-configured artifact. Preserve the
existing measured optimizations and rejected experiments in DECISIONS.md.

## 6. Review, concurrency and merge

Before publishing: re-read main, check that only owned OPT files changed,
review overlaps with open DEV PRs, and confirm the remote checkpoint SHA.

Before any final merge: re-read main and own PR head; if main advanced, rebase
or recreate the owned branch, reconcile overlapping docs and new tests, then
obtain the required green checks on the updated candidate. Recheck freshness
immediately before merge. Use an exact-head precondition where supported;
otherwise stop on any detected race and repeat the verification.

Merge only within existing user authorization and repository protections.
Do not infer authorization to merge/deploy another Work's PR. A request to
prepare/analyze a phase can finish as a reviewable draft PR. Do not request
confirmation for reversible preparation already authorized.

## 7. DEV and VPS boundaries

A GitHub merge, successful deploy job, active service and successful HTTP
response are distinct observations; report only those actually verified.

**VPS execution rule:** routine D.A.O VPS work must run through the protected
GitHub Actions SSH path and fixed allowlisted operations. Do not ask the user
for repetitive terminal/SSH copy-paste commands. A direct root command is only
acceptable for an unavoidable one-time bootstrap/refresh of a reviewed
root-owned helper or sudoers entry when the existing GitHub identity cannot
perform that installation. Once bootstrapped, status, health, diagnostics,
OCE gateway plan and similar repeated operations return to GitHub Actions.
Never use this rule to widen sudo into an arbitrary shell or caller-controlled
command/path.

Preserve main-only deployment after all required validation succeeds, exact
revision and artifact-manifest checks, separate environment configuration,
versioned releases, atomic current-link switch and rollback. Never redeploy an
older revision over a newer active release. Coordinate any shared DEV restart
or deployment with current main/run state; do not interrupt WORK DEV validation.

Secrets stay outside Git and logs. Report only variable presence/absence and
safe metadata, never values or full env files. Preserve
`/etc/dao/dao-dev.env` ownership/mode `root:dao / 0640` when an authorized
configuration task requires editing it. Do not change Auth, migrations or RLS
as part of OPT work. Do not touch WireGuard or expose port 3000 publicly.

When direct SSH is unavailable but CI deployment works, report both facts.
Do not claim live VPS inspection from an old CI log. Do not rerun deployment
solely to test whether credentials exist.

## 8. Durable checkpoint and stop condition

Update CURRENT_STATE and NEXT_STEPS, linking the owned branch/PR, without
rewriting WORK DEV's history. Add durable execution decisions to DECISIONS.
Every checkpoint should record:

- verification timestamp/timezone; base main and owned head SHA;
- changed scope; completed work versus proposed experiments;
- checks actually run, exact run/attempt and outcome;
- coverage and measured timing, distinguishing PR from main and warm from cold;
- access limitations, remaining blockers and the exact next action.

The remote commit/PR is the durable checkpoint; local scratch is not enough.
On session recovery, read remote state and resume after the last verified
checkpoint. Do not repeat completed setup or tests without a specific reason.
The assigned OPT role does not imply a background scheduler: only claim work
actually executed in an active session or separately configured automation.


## 9. Keep the visual architecture model current

The living C4/Structurizr model is stored in:

```text
docs/architecture/workspace.dsl
```

Read [../architecture/README.md](../architecture/README.md) before changing it.

Update the model in the same PR whenever a change materially affects an actor,
major functional domain, external system/provider, runtime container,
structuring business flow, deployment topology, or authorization boundary.

Do not churn the model for local UI polish or implementation details that do
not alter architecture. Do not show planned capabilities as operational ones.
When a future capability becomes real, update the relevant current-state view
at the same checkpoint that makes the capability effective.

This is a mandatory maintenance rule for WORK DEV and WORK OPT: if their PR
changes architecture in one of the categories above, the same PR must update
`docs/architecture/workspace.dsl`. Do not defer that update to a later PR
unless the user explicitly separates the work.

After such a PR is merged to `main`, the `D.A.O Architecture Pages` workflow
must validate the Structurizr model, regenerate the static interactive site and
publish it automatically to GitHub Pages. A green Pages workflow is the expected
publication evidence for architecture changes.
