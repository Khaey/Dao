# D.A.O — Decisions

> Decisions already made. Agents should not reopen them without new evidence or an explicit product request.

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

## D-023 — CI failures stop the patch loop

When CI fails:

```text
STOP
-> logs
-> trace
-> screenshot
-> error-context
-> network/DOM if relevant
-> root cause
```

Then make the next change.

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
