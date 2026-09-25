# D.A.O — Current State

> **Last verified:** 2026-09-26  
> **Repository:** `Khaey/Dao`  
> This file must be updated whenever `main`, CI status, or the immediate root cause changes.

## 1. Current `main`

Current verified `main`:

```text
4544bf062dbc4456dbe22a9034eb6f05eba28c4c
```

Commit:

```text
fix(e2e): match private details warning punctuation
```

Relevant preceding commits:

```text
427b82e0183c9dd7e86e4c31bfe3da958aab2e4b
test(e2e): target project edit save action

6f70462165e7a6943e67e8768093dcf99e1a3cc9
fix(p1.1): stabilize project detail editing UX

0217c481f3f4be27da7517c7932e401f6762e374
fix: guard project detail state before status derivation
```

## 2. Latest CI

Latest verified workflow:

```text
Run #128
Run ID: 36197910697
SHA: 4544bf062dbc4456dbe22a9034eb6f05eba28c4c
```

Status:

```text
verify      ✅ success
e2e-dev     ❌ failure
deploy-dev  ⏭ skipped
```

The failure is in Playwright.

## 3. Resolved root cause — run #127

Both desktop and mobile now progress beyond:

- project edit;
- correct `Enregistrer` selection;
- PATCH `/api/projects`;
- budget payload assertion.

Current failure:

```text
getByText('Non visibles par les artisans', { exact: true })
```

Expected by the test:

```text
Non visibles par les artisans
```

Actual UI source currently renders:

```text
Non visibles par les artisans.
```

with a final period.

Therefore this is currently classified as:

```text
OBSOLETE / OVER-STRICT E2E ASSERTION
```

not a product/backend bug.

The test reaches:

```text
Vue d’ensemble
-> heading "Informations privées et confidentielles"
```

and fails only on the exact punctuation-sensitive text assertion.

### Evidence location

Current page:

```text
dao-frontend/app/app/projects/[id]/page.tsx
```

Current UI:

```tsx
<SectionHeading
  title="Informations privées et confidentielles"
  description="Non visibles par les artisans."
/>
```

Failing E2E:

```text
dao-frontend/tests/e2e/projects-flow.spec.ts
```

around the private-details assertion.

## 4. Run #127 artifact

Playwright artifacts were uploaded for the failure.

Current failure evidence includes:

- desktop screenshot;
- mobile screenshot;
- traces;
- `error-context.md`.

Artifact name:

```text
playwright-results-36166813134
```

Artifact ID:

```text
10878161831
```

## 5. What has already been proven/fixed

### Initial project detail crash

Previously:

```text
project.status
```

was read before `project` existed.

This prevented the page from rendering and prevented `Modifier le projet` from appearing.

Fixed before current state.

### Lots E2E / P1.1 UX

P1.1 intentionally hides the lot form.

Old E2E looked for `Métier` immediately after clicking `Lots`.

Correct behavior:

```text
Lots
-> Ajouter un lot
-> form visible
-> Métier
```

Do not regress this.

### Mobile project-edit race condition

A real async race was proven:

```text
multiple load()
-> stale load finishes later
-> stale setProjectForm()
-> overwrites user edits
```

Current code protects loads with a generation guard.

Preserve this fix.

### Run #124 save-button ambiguity

The project Overview contains more than one `Enregistrer`.

Old E2E:

```text
getByRole('button', { name: 'Enregistrer' })
```

was ambiguous.

Fixed by scoping to the form containing:

```text
Titre du projet
```

The run #126 evidence confirmed that the intended PATCH `/api/projects` is now captured on desktop and mobile.

### Run #126 budget assertion

The test incorrectly expected:

```text
indicative_budget_tnd: 175000
```

Actual API payload correctly uses:

```text
indicative_budget_millimes: 175000000
```

Fixed in commit `2d3b4e5`.

Run #127 progresses beyond this assertion.

## 6. Current project-detail implementation facts

Current page includes:

- `loadGeneration` async protection;
- one effective status badge;
- private information in Overview;
- private description:
  `Non visibles par les artisans.`;
- project edit form;
- lot form hidden by default;
- document-specific refresh;
- signed/private document workflow;
- project history;
- request history;
- review/correction actions.

## 7. Current private-details UX

Location:

```text
Vue d’ensemble
-> Informations privées et confidentielles
```

Fields:

- Adresse exacte;
- Instructions d’accès;
- Téléphone privé;
- Email privé.

Current copy:

```text
Non visibles par les artisans.
```

Do not move this section back to Documents.

## 8. Current documents behavior

Expected/preserved behavior:

```text
upload -> refreshDocuments()
```

No global project reload for upload.

Document actions use accessible icon actions:

- `Consulter`;
- `Retirer`.

## 9. Current lot behavior

Current intended UX:

```text
0 active lot
-> one Add CTA
-> form hidden

1+ active lots
-> list
-> Add CTA in header
```

Form is shown only when requested or in edit mode.

## 10. Current status behavior

Effective UI status remains:

```text
latest project_version.status
fallback projects.status
```

Do not add a second duplicate badge.

## 11. Known deferred issue

Simple project without explicit lot remains intentionally unresolved.

Current downstream architecture depends on `project_requests`.

Do not implement implicit request behavior during the current failure chain.

## 12. Run #127 conclusion

Do **not** change product code for run #127.

The smallest causal correction is in E2E text matching.

After that:

```text
one minimal commit
-> one CI
-> if failure, stop and analyze new evidence
```

Do not assume the next CI will automatically finish P1.1.

## 13. Run #127 resolution — 2026-09-26

Before modifying files, GitHub `main` and the latest Actions run were rechecked:

```text
main: 2d3b4e526708372ed8b79999d68a5d9dfa9469c1
Run #127 / 36166813134
verify: success
e2e-dev: failure
deploy-dev: skipped
```

The run log identifies step `Run DEV Playwright flow`, failing at
`tests/e2e/projects-flow.spec.ts:172`, on desktop and mobile:

```text
getByText('Non visibles par les artisans', { exact: true })
Expected: visible
Error: element(s) not found
```

The UI source at this same SHA renders the exact description
`Non visibles par les artisans.` with the final period. The current test omits
that period while requesting exact matching. Root cause is confirmed as a
punctuation-sensitive E2E assertion; no UI, backend, or data-layer change is
warranted.

The correction was committed and pushed as `4544bf062dbc4456dbe22a9034eb6f05eba28c4c`.
Local validation completed: `tsc --noEmit`, `next build`, and Playwright test
discovery passed. The E2E diff passed `git diff --check`; with the supplied
Markdown files included, Git reports only their intentional hard-break spaces.

## 14. Latest failure — run #128

Run #128 passed `verify`; `e2e-dev` failed at `Run DEV Playwright flow` for
desktop and mobile; `deploy-dev` was skipped. The original punctuation assertion
now passes. The next failure is at E2E line 198:

```text
getByText('Validation client', { exact: true })
strict mode violation
```

The locator resolves to the hidden `<option>` in `Filtrer par statut` plus
multiple status badges. Desktop reports 3 matches. Mobile reports 5 because
both desktop and mobile test projects leave a project for the same E2E client
account in the list. The screenshots show the expected `Validation client`
status on project cards/row; this is currently classified as an overly broad
E2E locator, not a product or backend failure.

Artifacts: `playwright-results-36197910697`, ID `10889749786`; both traces,
screenshots, and `error-context.md` were inspected. No follow-up correction has
been made before this task. The chosen E2E correction scopes the status badge
to the visible desktop row or mobile card containing this test's unique
`editedProjectTitle`, then asserts exactly one visible badge.
Local checks for this correction passed: `tsc --noEmit`, `next build`, Playwright
test discovery, and diff whitespace validation (excluding intentional Markdown
hard-break spaces in the supplied context files). The next CI result is pending.
