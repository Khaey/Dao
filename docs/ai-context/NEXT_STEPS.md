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

## 1. Resolve the isolated migration-chain blocker

Current `main` is `32b3470beddf2ac9bbd693fe1aef78f1e96d6e2d`. CI run #136
passed backend verification and frontend build, then failed before Playwright
while applying `202609210001_dao_security_hardening_rls_auto_enable.sql` to a
fresh local Supabase stack. The migration references `public.rls_auto_enable()`
but no repository migration defines it. The DEV database has a real
`SECURITY DEFINER` event-trigger function and enabled `ensure_rls` event
trigger; the PGlite test harness creates only a simplified stub. This is an
RLS/security architecture gap, so stop before editing migrations or retrying
CI. Do not use the shared DEV database for E2E.

Next work requires an explicit decision about versioning the real RLS event
trigger in the repository or selecting an approved isolated baseline that
already contains it. Do not create a paid hosted branch without cost approval.
After the migration source is resolved, run the isolated stack and 14 FULL E2E
tests with two workers, then allow DEV deployment only after E2E is green.

No local-only trigger stub, DDL bypass, migration change, or DEV data cleanup
was made. The four Playwright selector corrections remain on `main`.

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
