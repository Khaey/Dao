# D.A.O — Decisions

> Decisions already made. Agents should not reopen them without new evidence or an explicit product request.

## D-042 — Enterprise subcontracting is a P3 product capability

An enterprise/contractor may eventually be both a service provider and a
principal that subcontracts selected work. This belongs to P3 execution, not
the current manager V1 or P2 comparison scope.

Do not equate global `contractor` identity with a permanent "bidder only"
business role. Future authorization must derive principal/subcontractor rights
from the chantier/lot context, while preserving real lots, publication,
offer isolation, auditability and contract responsibility.

## D-041 — SaaS/multi-tenant conversion is deferred

D.A.O may later evolve toward SaaS/multi-tenant usage, including enterprise
workspaces, but this is explicitly out of current scope. Do not introduce
tenant tables, `organization_id` propagation or tenant RLS merely for future
possibility.

Current code should avoid unnecessarily blocking that evolution, but the
marketplace/workflow product remains the active architecture.

## D-040 — Settings V1 stays simple; advanced rules engine is deferred

The manager/admin back-office should expose only settings/reference data that
are required by current product flows. Do not create a generic configurable
rules engine now.

A later dedicated phase may support configuration by client type,
artisan/enterprise type, country, publication mode, notification policy and
workflow. Security and integrity constraints are not configurable settings.

## D-039 — Internal privileges are server-controlled, never browser-promoted

A browser may request an authorized administrative action, but it must never be
able to assign itself `dao_admin` or sensitive permissions by changing UI
state, JavaScript or request payloads.

Any future internal-team administration must verify the acting user's
privilege server-side, constrain assignable rights, apply changes through a
controlled backend/RPC path, and retain an audit trail.

## D-038 — Back-office Gestionnaire V1 reuses the existing staff perimeter

The first manager back-office is available to `dao_reviewer` and `dao_admin`
through the existing `dao_private.staff()` authorization and RLS policies. It
provides operational queues and read-only supervision, then delegates review
and publication to the existing secured commands.

V1 does not add a browser-side privileged client, a service-role path, a new
RLS policy or a migration. It does not permit staff-role assignment,
contractor verification mutation or platform settings. A rejection requires a
specific client-facing correction reason; comments are isolated per submitted
version. Publication continues to use the exact approved version and its linked
lot snapshots.

Any later role administration, contractor verification decision or mutable
platform configuration requires a separate product/security decision.

## D-036 — Protected real DEV email E2E path

The real shared-DEV invitation check is a separate, manually dispatched,
main-only GitHub Actions workflow. It uses the permanent TEST client and
contractor credentials from Environment `dev` only; credentials are read into
the Playwright worker and removed from its environment before browser launch.
The workflow never writes storage state, token-bearing traces, screenshots or
reports, and logs only sanitized result markers plus TEST-owned UUIDs. The
existing bounded reset runs before and after, serialized with fixture workflows.
This does not replace FULL E2E and does not modify product, Auth, RLS, SQL or
migration behavior.

## D-037 — Release-scoped automatic real DEV email validation

The real shared-DEV email workflow remains available through
`workflow_dispatch`, but ordinary pushes and pull requests must not send test
emails. The automatic trigger is an explicit published GitHub Release.

Before using protected secrets, the workflow checks the release commit against
the current `main`, waits for a successful `DAO CI and DEV deploy` run for the
same SHA, and queries prior runs of this workflow. A previously successful run
for that SHA causes a sanitized skip. The existing global
`dao-dev-test-scope` concurrency group is preserved so this runner cannot
overlap fixture provisioning/reset operations.

This is execution control only: it does not change product behavior, Auth,
RLS, SQL, migrations, Resend transport or fixture ownership. A published
release observation is still required before treating the automatic path as
operationally proven.

## D-001 — GitHub repository is the durable source of project context

**Decision:** Important context must live in the repository, not only in chats.

Use:

```text
docs/ai-context/
```

and update at least:

- `CURRENT_STATE.md`;
- `NEXT_STEPS.md`;

after meaningful milestones.

## D-002 — P1.1 stabilization before new scope

Do not start P2/P3/new product work while P1.1 is not explicitly closed.

A green single CI job is not enough; functional validation is required.

## D-003 — Root-cause-first debugging

Every failure must first be classified as:

- product bug;
- obsolete E2E;
- fixture/data;
- environment;
- business inconsistency.

No blind patch loops.

## D-004 — No test hacks

Forbidden as default fixes:

- sleeps;
- arbitrary retries;
- huge timeouts;
- forced reloads;
- making hidden UI visible only to satisfy tests.

Tests must follow real user behavior.

## D-005 — Preserve project-load race protection

The async load generation/sequence guard in project detail is a real bug fix.

Do not remove it.

Only the most current load may commit React state.

## D-006 — Effective status rule

For current UI:

```text
effectiveStatus =
  project.status === 'archived'
    ? 'archived'
    : latest project_version.status
      ?? project.status
```

Use one effective badge/state.

Dashboard counters, profile activity counters, Mes projets and project detail must agree.
Archived projects always display `archived`, even when their latest version
remains `draft`.

## D-007 — Additional lot form stays hidden by default

For a project that already has at least one lot, the form for adding another
lot stays hidden until the client selects `Ajouter un lot`. The zero-lot draft
case uses the visible, explicitly submitted first-lot form defined in D-025.

## D-008 — One create action for each lot state

When there are zero active lots, show one `Créer le lot principal` action on
the first-lot form. When one or more lots exist, show one `Ajouter un lot`
action in the section header. Do not show duplicate create actions.

## D-009 — Private details belong in Overview

Private details are not a Documents feature.

Location:

```text
Vue d’ensemble
-> Informations privées et confidentielles
```

Fields:

- exact address;
- access instructions;
- phone;
- email.

No RLS/schema change is required solely for this UI move.

## D-010 — Documents use local refresh

Keep:

```text
upload -> refreshDocuments()
```

Deletion updates the local document list.

Do not run a full project `load()` for ordinary document actions.

## D-011 — Document actions remain accessible

Compact icon actions are acceptable only with:

- `aria-label`;
- title/tooltip;
- keyboard accessibility;
- unambiguous meaning.

## D-012 — Navigation redundancy removed

Do not reintroduce both `Mon espace` and `Mon compte` pointing to the same profile.

Role-aware navigation remains the expected pattern.

## D-013 — Simple project without lot is deferred (superseded)

The initial deferral is superseded by D-025. `project_requests` remains the
downstream-critical unit, and the approved flow requires a client-created real
lot before review.

## D-014 — Money payloads use millimes

Backend/API monetary payloads follow millime representation.

Example:

```text
175000 TND
-> indicative_budget_millimes: 175000000
```

Frontend TND labels do not imply the API key should be `_tnd`.

## D-015 — Rejected versions are historical

A rejected project version must remain immutable/history-visible.

Correction creates a new draft version.

## D-016 — No unnecessary Supabase/security changes

For a frontend/E2E problem:

- do not change RLS;
- do not change RPC;
- do not add migration;
- do not change auth;
- do not expose privileged credentials.

Only change backend/security after demonstrated necessity.

## D-017 — `project_versions.governorate_id NOT NULL` is not to be altered casually

Do not remove/change this constraint as a workaround.

## D-018 — Do not touch WireGuard for app work

WireGuard is infrastructure outside the current application stabilization.

Do not expose port 3000 publicly.

## D-019 — OCE/OpenConstructionERP exploration is historical, not current app architecture

Do not replace the current `Khaey/Dao` application with OCE during current development.

## D-020 — P1.1 functional closure criteria

P1.1 is not complete until explicitly validated for:

- project edit desktop/mobile;
- persistence;
- lot empty state/form/add/edit/duplicate/withdraw/history;
- documents;
- private information;
- status across dashboard/list/detail;
- rejection/correction;
- approval;
- publication/artisan continuity;
- responsive behavior.

## D-021 — E2E split is a later improvement

The current monolithic E2E is a known maintenance problem.

Split only after P1.1 is functionally stable.

## D-022 — Project detail refactor is a later improvement

`projects/[id]/page.tsx` is too large, but refactoring it during current stabilization would introduce unnecessary variables.

Refactor later.

## D-023 — CI failures use a bounded root-cause correction loop

For a CI failure:

```text
inspect logs and artifacts
-> identify the root cause
-> make a certain technical correction
-> validate locally
-> commit and push
-> run the next CI
```

Stop only if the same cause returns after two different corrections, three
successive runs fail in the same functional area, the cause is ambiguous, a
product choice is required, or the correction requires unplanned RLS/Auth/schema
or architecture changes or risks data loss/regression. Desktop and mobile
failures for the same cause within one run count as one failure.

## D-024 — Chat/agent session limits must not cause context loss

Before ending a long Work/Codex session:

1. update `CURRENT_STATE.md`;
2. update `NEXT_STEPS.md`;
3. record any new durable decision in `DECISIONS.md`;
4. record architecture/business changes in their files;
5. commit those documentation updates with the related work or a dedicated context commit.

## D-025 — Every reviewed project contains at least one real lot

An editable draft may temporarily have no lot. Before review, the client must
create at least one real `project_request` / lot. A simple project uses one
real lot; a complex project may use several. Do not create a hidden or virtual
`Projet complet` lot, auto-create a lot, or synchronize project edits into
existing lots.

The first-lot form is prefilled from the current project title, real
description, and indicative budget, with no trade selected. Creation occurs
only after explicit client action. Review screens show the exact snapshots
linked to the reviewed project version. Publication accepts only active lots
linked to the approved version and uses those snapshots. Lot withdrawal is
allowed only while the latest project version remains a draft.

## D-026 — FULL E2E uses a disposable Supabase environment

FULL Playwright campaigns must start from a fresh isolated Supabase environment.
The selected implementation is the Supabase CLI stack on a new GitHub-hosted
runner: apply the repository migrations and local E2E seed, provision
worker-scoped users, then run desktop and mobile with two workers. The exact
local endpoint is enforced before tests. Runner disposal resets database,
Auth, and Storage state; cleanup scripts must not delete immutable submitted
offer history or weaken the corresponding triggers.

The shared application DEV Supabase project is reserved for deploy and manual
validation. Do not run FULL E2E against it. Historical E2E data remain until a
separate maintenance decision. A long-lived hosted development branch was not
created because it would incur recurring compute cost and its documented reset
does not explicitly guarantee Storage object removal.

The repository versions the exact DEV `public.rls_auto_enable()` function and
enabled `ensure_rls` event trigger at their historical position, with the DEV
owner, `search_path`, event tags, and postgres-only EXECUTE ACL. The repository
and DEV migration ledgers align at 22 versions, including the repeated
award/bid-document v2 migration. PGlite replays the real migration without a
function stub. Fresh Supabase reconstruction, reset/replay, schema contract,
integration, and FULL E2E are validated on GitHub-hosted disposable runners.
The shared DEV project stays separate from E2E.

## D-027 — Reuse one disposable Supabase stack for full CI validation

The critical CI job must prove both initial fresh migration application and a
complete `supabase db reset --local` replay, checking the migration ledger and
schema contract before and after reset. It then reuses that same local stack for
real integration and all FULL E2E tests. Do not remove the reset/replay proof
or replace the stack with a preconfigured database. Backend verification and
the general frontend build remain parallel independent jobs. The FULL E2E
target guard must continue to require `http://127.0.0.1:54321`.

The E2E frontend build uses the local public Supabase URL and key and remains
separate from the general build artifact. Browser installation can run in
parallel with that E2E build. `deploy-dev` remains push-to-main only.

## D-028 — Keep browser cache disabled unless it shows a material net gain

The Chromium cache experiment measured about 3 seconds of warm-run savings
(4 seconds to restore plus 14 seconds for system dependencies, versus 21
seconds for the uncached install), while a cold cache was slower after cache
save. The cache adds maintenance and state without a meaningful gain, so the
workflow uses `playwright install --with-deps chromium` on each fresh runner.

## D-029 — One chantier model, separate participation and marketplace

The explicitly authorized collaboration scope uses projects plus real members
and invitations; no parallel project model, fake client or automatic DAO
publication. The product supplement overrides the initial work-stage names:
not_started / started / in_progress / completed. Payment remains declarative
and independent. Client confirmation has its own audit fields, never a review
status. Strict client owner semantics and all competitor-offer isolation stay.

## D-030 — Push every stable collaboration checkpoint

Create the remote branch before code. Test, commit and publish every stable
phase before starting the next; confirm its remote SHA. A changed environment
or checkout requires identity verification and recovery from GitHub, not an
assumed local state. Do not commit tsconfig.tsbuildinfo.

## D-031 — Separate WORK OPT ownership and autonomous execution

WORK OPT owns CI, Playwright infrastructure, TEST fixtures, validation and
DEV tooling, access diagnostics and AI context. It starts from verified remote
main on its own chore branch and never changes WORK DEV branches or PRs.
No product, business, RLS, Auth or schema modification belongs to this scope.

[AUTONOMOUS_EXECUTION.md](AUTONOMOUS_EXECUTION.md) defines FAST EXECUTION MODE:
bounded preflight, reuse of valid evidence, proportional checks, durable
remote checkpoints and main freshness checks before modifications/merge.
Preserve all coverage, new tests merged by DEV, deployment gates and rollback.
Keep current state separate from historical checkpoints. Use
[OPTIMIZATION_BACKLOG.md](OPTIMIZATION_BACKLOG.md) for measured priorities;
proposals are not implemented improvements.

## D-032 — Platform startup, DEV operations and readiness

Root AGENTS.md loads the execution protocol for repository-aware Work sessions.
Use read-only task preflight and impact suggestions; all required CI coverage
remains. Main/deploy operations are not cancelled mid-activation. Serialize
DEV jobs and host deploys, reject stale main revisions, and keep rollback
armed until bounded HTTP readiness succeeds.

GitHub Actions is the stable DEV control path independent of shell Work SSH.
Environment administration uses a reviewed root-owned helper, installed once,
with protected secrets and atomic root:dao / 0640 env replacement. Raw logs
and secret values never enter public Actions output. Permanent TEST DEV
accounts are separate from disposable FULL E2E; fixture reset initially stays
plan-only until exact account/resource ownership is established.

## D-033 — Playwright four-worker result

PR #13 tested the unchanged 34 desktop/mobile executions with four CI workers.
CI #185 passed all 34; Playwright dropped from 100.64 s (main #178, two
workers) to 75.14 s, and the critical job from 273 s to 229 s. Keep four
workers as the CI default. The worker count remains overrideable through
`PLAYWRIGHT_WORKERS` for controlled comparisons; never reduce coverage to
improve timing.


## D-034 — VPS helper installed; permanent TEST accounts await one secure channel

The reviewed root bootstrap has completed successfully. `/usr/local/sbin/dao-dev-admin`
is installed, environment values and `dao-dev.service` are unchanged, and the
main-only DAO DEV operations workflow is the stable control path. VPS access is
not a blocker.

The final OPT reliquat is one permanent TEST client and one permanent TEST
contractor. Provisioning is paused until one authorized protected DEV Auth
administration channel can supply/store their credential pairs without exposing
secrets in Git, docs, workflow inputs or logs. The contractor must retain the
expected standard signup verification status `pending`. FULL E2E’s disposable
`verified` contractor fixture is not reused. `reset-dev-fixtures.sh` remains
plan-only until explicit owned-resource IDs exist.

## D-035 — Permanent TEST DEV fixtures use a protected workflow

The V3-C prerequisite is now available through GitHub Environment `dev`. The
dedicated `DAO DEV TEST fixtures` workflow is the only supported provisioning
surface. It accepts an operation choice, never a credential input, and injects
the two TEST credential pairs only into the protected runner process. Scripts
never print passwords, service keys, Auth responses or Resend response bodies.

Provisioning reconciles exactly the approved client and contractor aliases and
ensures the existing public role/profile rows. The contractor is always reset
to `verification_status=pending` and `public_identity_status=draft`; no Auth
configuration or product authorization logic changes.

Reset is deliberately non-destructive: it resolves the two fixture users,
archives only projects where either is `client_id` or `initiator_id`, and
revokes only their pending invitations. Accounts, memberships, documents,
Storage objects, submitted offers, audit events and other immutable history
remain intact. A real Resend mailbox smoke uses the contractor alias and is
confirmed in the controlled Gmail mailbox before WORK DEV runs the product
invitation-email flow.


## D-031 — Separate WORK OPT ownership and autonomous execution

WORK OPT owns CI, Playwright infrastructure, TEST fixtures, validation and
DEV tooling, access diagnostics and AI context. It starts from verified remote
main on its own chore branch and never changes WORK DEV branches or PRs.
No product, business, RLS, Auth or schema modification belongs to this scope.

[AUTONOMOUS_EXECUTION.md](AUTONOMOUS_EXECUTION.md) defines FAST EXECUTION MODE:
bounded preflight, reuse of valid evidence, proportional checks, durable
remote checkpoints and main freshness checks before modifications/merge.
Preserve all coverage, new tests merged by DEV, deployment gates and rollback.
Keep current state separate from historical checkpoints. Use
[OPTIMIZATION_BACKLOG.md](OPTIMIZATION_BACKLOG.md) for measured priorities;
proposals are not implemented improvements.

## D-032 — Platform startup, DEV operations and readiness

Root AGENTS.md loads the execution protocol for repository-aware Work sessions.
Use read-only task preflight and impact suggestions; all required CI coverage
remains. Main/deploy operations are not cancelled mid-activation. Serialize
DEV jobs and host deploys, reject stale main revisions, and keep rollback
armed until bounded HTTP readiness succeeds.

GitHub Actions is the stable DEV control path independent of shell Work SSH.
Environment administration uses a reviewed root-owned helper, installed once,
with protected secrets and atomic root:dao / 0640 env replacement. Raw logs
and secret values never enter public Actions output. Permanent TEST DEV
accounts are separate from disposable FULL E2E; fixture reset initially stays
plan-only until exact account/resource ownership is established.

## D-033 — Playwright four-worker result

PR #13 tested the unchanged 34 desktop/mobile executions with four CI workers.
CI #185 passed all 34; Playwright dropped from 100.64 s (main #178, two
workers) to 75.14 s, and the critical job from 273 s to 229 s. Keep four
workers as the CI default. The worker count remains overrideable through
`PLAYWRIGHT_WORKERS` for controlled comparisons; never reduce coverage to
improve timing.


## D-031 — Email transports the existing one-time chantier invitation

Approved 2026-10-02. Preserve the issuance/acceptance SQL RPCs, SHA-256 hash,
7-day expiry, single use, expected role and explicit confirmation. Add server
Resend delivery only while the current browser state holds the token. Copy
link stays available; no resend after reload and no extra invitation, rotation,
plaintext persistence or delivery table. No migration, RLS or Auth change.

The authenticated send route accepts only `{token}`. JWT/RLS metadata and a
shared invitation authorization preflight precede a narrowly scoped privileged
hash read. The preflight is also used by issuance and revocation, delegates
ownership/preparation facts to `project_team`, and preserves the existing SQL
management/role rules. SQL RPCs remain the final atomic mutation authority.
Compare SHA-256 UTF-8 with the stored hex hash using a constant-time comparison;
use recipient email exclusively from DB. Never log the route body or provider
errors. Replies contain only success and a masked recipient, or a clean error.

Server-only configuration: `RESEND_API_KEY`, `DAO_EMAIL_FROM`, `DAO_PUBLIC_URL`.
Validate the public origin and build the invitation URL on the server. Resend
idempotency is stable per invitation/operation, never derived from its token;
accepted requests are replayed for 24h and failures are not cached locally.
Keep the same key for retries, including ambiguous network failures. Provider
payload conflicts fail cleanly, without silently issuing a fresh invitation.
HTML and text contain only inviter name, chantier title, CTA/link and validity.
CI mocks delivery and uses only disposable local Supabase.
