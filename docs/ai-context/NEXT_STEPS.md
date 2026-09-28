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

## 1. Validate database reproducibility in a Draft PR

The local migration reconciliation is on branch
`chore/db-repro-reconciliation`, based on `c32ef4820e4603662e5897fc0e33c7d59fdca5f6`.
It maps the repository's 21 versions to DEV history, preserves the repeated
v2 ledger entry, versions the exact DEV RLS bootstrap, and removes the PGlite
function stub. Backend, PGlite, frontend build, and 14-test discovery checks
were green before opening the PR.

Use the Draft PR as the authoritative fresh Supabase runner: `schema-repro`
must pass before `full-e2e` can run. Run Auth/JWT/RLS/RPC/Storage integration
and all 14 desktop/mobile tests only against `http://127.0.0.1:54321`. Measure
the separate schema and E2E stack startup/reset durations from the workflow
summary before deciding whether they should share a stack. Keep the jobs
separate if sharing would compromise diagnostic clarity or E2E freshness.

Never use the shared DEV project as a test target or mutate its migration
ledger. After schema-repro passes, compare fresh local with DEV read-only over
DAO objects and stop before any DEV mutation if a DAO divergence is unexplained.
Do not merge the Draft PR; the user decides whether to merge after every gate
is green and the schema comparison is explained. The four Playwright selector
corrections remain preserved on `main` at the starting commit.

## 2. Manual P1.1 validation

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

- zero-lot editable draft shows a prefilled `Travaux du projet` form;
- blank trade remains unselected and blank real description leaves scope blank;
- direct review route explains the active-lot requirement and links to Lots;
- no create request occurs before explicit `Créer le lot principal` action;
- required scope validation blocks an empty first lot;
- first lot creates one real request and v1 with selected trade and millime budget;
- later project edits do not alter or version the lot;
- with an existing lot, the add form stays hidden until explicit action;
- add;
- edit;
- duplicate;
- withdraw while current project version is draft;
- withdrawal is rejected once the current project version is in review;
- history;
- v1/v2 behavior.

### Review and publication

Validate that client and DAO review screens show the exact lot snapshot linked
to the reviewed project version. Publication must offer only active lots linked
to the approved project version, publish those exact snapshots, and reject an
empty, null, duplicate, inactive, or unlinked selection at the RPC boundary.

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

## 6. Simple and complex project lot model

The product decision is recorded in D-025: a simple project has one real lot,
and a complex project may have multiple real lots. No implicit or hidden
`Projet complet` request is used.

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
