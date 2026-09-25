# D.A.O — Next Steps

> Start here in every new Work/Codex session after reading the other AI context files.

## 0. Session startup protocol

Before any modification:

1. read:
   - `PROJECT_CONTEXT.md`;
   - `ARCHITECTURE.md`;
   - `BUSINESS_RULES.md`;
   - `DECISIONS.md`;
   - `CURRENT_STATE.md`;
   - this file;
2. verify actual GitHub `main`;
3. verify latest workflow run;
4. if GitHub is ahead of this documentation, update context first;
5. do not replay old bug analysis if a newer run has already passed that point.

## 1. Immediate action — fix the confirmed run #129 archive status bug

Verified GitHub `main`: `147932320a26ca523fbe3d799ab93b04f0a3c55c`.
Run #129 (`36198890953`) has `verify` green, `e2e-dev` failed, and `deploy-dev`
skipped. Its failure artifact is `playwright-results-36198890953` (ID
`10891212626`).

The two failures are confirmed as one product root cause:

- desktop cannot find `Archivé` on the detail page after archive + reload;
- mobile's dashboard still counts the desktop archive as `Brouillons 1` rather
  than `0`.

`archive_project` changes `projects.status` to `archived` and leaves
`project_versions.status` unchanged. The detail, dashboard, and Mes projets
currently prefer the latest version status, so a draft version overrides the
project's archived lifecycle state. Profile activity counters used only
`projects.status` and could disagree with review states.

Apply this shared UI rule:

```text
effectiveStatus =
  project.status === 'archived'
    ? 'archived'
    : latest project_version.status ?? project.status
```

The local correction uses one helper on project detail, dashboard, Mes
projets, and profile activity counters, and gates status-driven draft/rejection
actions on the same effective state. Keep the archive RPC and database/security
layers unchanged. No E2E assertion change is needed: the remaining archive
assertions correctly verify the status on detail and in the filtered list. The
rest of the flow was reviewed; no other assertion is manifestly stale or too
global.

Local checks passed after installing the checked-in lockfiles: `npx tsc --noEmit`,
`npm run build`, Playwright discovery (2 desktop/mobile tests), and
`git diff --check`. Next: one commit, one push, and monitor the resulting CI. If
the full CI is green, stop for manual P1.1 validation. Do not start P2/P3 or CI
optimization.

## 2. After first green full CI — do NOT immediately declare P1.1 complete

Perform explicit P1.1 functional validation.

### Project edit

Validate desktop + mobile:

- title;
- description;
- budget;
- start date;
- end date;
- correct PATCH payload;
- immediate UI update;
- reload persistence;
- no stale load overwrites.

### Lots

Validate:

- zero-lot empty state;
- one CTA only;
- form hidden initially;
- form opens after click;
- add;
- edit;
- duplicate;
- withdraw;
- history;
- v1/v2 behavior.

### Documents

Validate:

- upload;
- stays on Documents tab;
- no global project reload;
- visible immediately;
- pending state readable by owner if expected;
- signed download;
- remove;
- accessibility labels.

### Private information

Validate:

- appears under Overview;
- heading correct;
- warning visible;
- exact address;
- access instructions;
- private phone;
- private email;
- persistence;
- absent from Documents;
- not visible to artisan/public role.

### Status coherence

Validate across:

- dashboard;
- counters;
- recent projects;
- Mes projets;
- project detail.

Transitions:

```text
draft
-> submitted/review
-> rejected
-> correction
-> resubmission
-> approved
```

No duplicate badge.

### Downstream regression

Validate continuity:

- reviewer;
- publication;
- artisan visibility;
- offer creation;
- offer versioning;
- award foundations not broken.

### Responsive

Validate at least:

```text
desktop 1440x900
mobile 390x844
```

Include long project title/badge layout.

## 3. P1.1 closure

Only after:

```text
verify ✅
e2e-dev ✅
deploy-dev ✅
+
explicit functional checks
```

may P1.1 be marked complete.

At closure:

1. update `CURRENT_STATE.md`;
2. record final SHA;
3. record final workflow run;
4. record validated behaviors;
5. update `DECISIONS.md` for any durable new decision.

## 4. After P1.1 — CI/E2E restructuring

Only after stabilization, split the monolithic flow.

Target examples:

```text
projects-basic.spec.ts
review-publication.spec.ts
documents-private.spec.ts
artisan-bid.spec.ts
archive.spec.ts
```

Target pipeline:

```text
FAST
├── build
├── backend tests
└── client-project-smoke

FULL
├── review/publication
├── artisan/offre
├── documents/private
└── desktop/mobile

DEPLOY
```

Goals:

- faster failure localization;
- fail-fast;
- no waiting through the entire business journey to discover an early bug;
- independent evidence per domain.

## 5. After P1.1 — project detail refactor

Refactor only after functional stability.

Potential split:

```text
ProjectDetail
├── useProjectDetailData
├── ProjectHeader
├── ProjectOverview
├── ProjectLots
├── ProjectDocuments
├── ProjectDao
└── ProjectHistory
```

Preserve behavior exactly during refactor.

## 6. Later product study — simple project without explicit lot

Do an impact study before implementation.

Question:

Can a simple project use an implicit request such as:

```text
Projet complet
```

without changing downstream semantics?

Study impact on:

- publication;
- offers;
- partial awards;
- reviewer flow;
- contracts;
- data migrations;
- E2E fixtures.

If impact is significant:

```text
STOP
-> present options
-> wait for product decision
```

## 7. Later product phases

Do not automatically start:

- advanced offer comparison/scoring;
- final award UX;
- full contract workflow;
- escrow/payment;
- dispute management;
- subcontracting;
- advanced messaging;
- OCE replacement.

Each requires an explicit next-phase decision.

## 8. End-of-session protocol

Before a Work/Codex session ends or reaches context limit:

### Always update

`CURRENT_STATE.md` with:

- current main SHA;
- last run number/id;
- job statuses;
- exact current failure/root cause;
- artifact IDs if useful;
- what was proven fixed.

`NEXT_STEPS.md` with:

- exact next action;
- things not to touch;
- validation required.

### Update when relevant

`DECISIONS.md` for durable decisions.

`ARCHITECTURE.md` for technical architecture changes.

`BUSINESS_RULES.md` for approved business-rule changes.

`PROJECT_CONTEXT.md` only for product scope/role/phase changes.

### Handoff prompt for a new session

Use:

```text
Read all files under docs/ai-context first.
Then verify the actual GitHub main SHA and latest CI.
If the repository is newer than the docs, reconcile the docs before coding.
Continue only from CURRENT_STATE.md + NEXT_STEPS.md.
Do not repeat closed analyses unless current code/evidence contradicts them.
Use root-cause-first debugging.
At the end, update CURRENT_STATE.md and NEXT_STEPS.md.
```
