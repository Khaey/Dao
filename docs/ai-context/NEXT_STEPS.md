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

## 1. Immediate action — correct only the run #128 locator

Verified GitHub `main`: `4544bf062dbc4456dbe22a9034eb6f05eba28c4c`.
Run #128 (`36197910697`) has `verify` green, `e2e-dev` failed, and `deploy-dev`
skipped. The punctuation-only assertion fix for run #127 is confirmed passed.

The run #128 failure was E2E line 198 in
`dao-frontend/tests/e2e/projects-flow.spec.ts`:

```text
getByText('Validation client', { exact: true })
strict mode violation: locator resolved to 3 elements (desktop), 5 (mobile)
```

The list included the hidden status `<option>` and multiple project status
badges. Screenshots show the expected status is present. Root cause: the E2E
locator was global and did not identify the project created by this test.

The chosen correction scopes the badge to the visible desktop row (`tr`) or
mobile project card (`a`) containing this test's unique `editedProjectTitle`,
then asserts that exactly one `Validation client` badge is visible. It does not
use `.first()` and does not change the UI.

Run #128 artifact `playwright-results-36197910697` (ID `10889749786`) was
inspected, including both `error-context.md` files, screenshots, and traces.
Local `tsc --noEmit`, `next build`, Playwright test discovery, and diff checks
passed. Next: one commit, one push to `main`, and one CI.
If that CI fails, stop and report its evidence without another correction. If
it passes, stop for manual P1.1 validation. Do not touch UI, backend, RLS, RPC,
schema, or auth for this test locator issue.

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
