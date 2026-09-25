# D.A.O — Business Rules

> Stable business constraints and invariants. Changes here require explicit product/architecture review.

## 1. Project and request model

A **project** may contain multiple work requests.

A **project request** is currently the attributable unit used later in:

- publication;
- bidding;
- award.

Therefore:

```text
project = global chantier
request = unit of work / lot / scope
```

Do not collapse these concepts without an impact study.

## 2. Multi-request / multi-offer

A project may have multiple requests.

An offer/bid may cover multiple requests where the model permits it.

Award may be partial.

The award unit remains the request.

## 3. Single active award invariant

The platform must prevent multiple active awards for the same attributable request.

Real concurrency testing has previously validated the intended principle:

```text
two independent attempts
-> one successful award
-> one rejected by invariant/constraint
```

Preserve this invariant.

## 4. Project versioning

Before first submission:

- editing the current draft is acceptable.

After a rejected/submitted immutable version:

- do not modify the historical rejected version;
- create a new draft version for correction;
- preserve review history.

## 5. Request versioning

Creation of a request produces **v1**.

A second version must only be created after a real modification.

Do not create an artificial v2 simply to add the initial budget.

## 6. Review workflow

Expected lifecycle:

```text
draft
-> client submission
-> DAO review
-> approved OR rejected
```

After rejection:

```text
rejected version
-> reason visible to client
-> Corriger le DAO
-> new draft version
-> modify
-> resubmit
```

Reviewer comments must remain stored and visible.

## 7. Effective UI status

Current UI rule:

```text
effectiveStatus =
  latest project_version.status
  ?? projects.status
```

The same real business state must have the same label across the application.

Do not show duplicate status badges.

## 8. Private chantier information

Private details include:

- exact address;
- access instructions;
- private phone;
- private email.

They belong in:

```text
Vue d’ensemble
-> Informations privées et confidentielles
```

The UI must communicate that they are not visible to artisans.

These values must not be copied into public/safe publication fields.

## 9. Public vs private data

Public artisan-facing information must remain intentionally expurgated.

An artisan must never gain access to private chantier details merely because a project is published.

## 10. Documents

Project documents may include:

- PDF;
- JPEG;
- PNG;
- WebP;
- plans;
- photos;
- sketches;
- technical specifications;
- prior quotes or supporting files.

Security rules:

- private storage;
- signed URL after authorization;
- no direct public bucket exposure;
- owner/staff access only as allowed;
- competitors denied.

## 11. Lots UX

Current P1.1 UX:

### Zero active lots

Show:

- clear empty state;
- one single primary CTA `Ajouter un lot`.

Do not simultaneously show:

- header CTA;
- empty-state CTA;
- permanently visible form.

### One or more lots

Show:

- compact list;
- `Ajouter un lot` in section header;
- actions:
  - modify;
  - duplicate;
  - history;
  - withdraw.

### Form visibility

The lot form remains hidden until the user explicitly clicks `Ajouter un lot` or enters edit mode.

## 12. Simple project without explicit lot

Desired future UX:

```text
Simple project
-> full scope without forcing the user to understand "request"
```

Possible implementation:

```text
implicit request = "Projet complet"
```

But this is not approved for immediate implementation during P1.1.

A dedicated impact analysis must cover:

- publication;
- bids;
- partial award;
- downstream contracts;
- review;
- migration implications.

## 13. Budgets

Project and request budgets are indicative unless a later contractual rule says otherwise.

Technical monetary persistence uses TND millimes.

Example:

```text
175000 TND -> 175000000 millimes
```

A difference between global project budget and sum of lot budgets may generate an informative warning; it should not automatically block submission unless explicitly made a business rule.

## 14. Contracts and execution model — future foundation

The broader domain model must preserve room for:

- tripartite contract:
  - client;
  - D.A.O;
  - artisan/contractor;
- electronic signature;
- amendments;
- mutual termination;
- abandonment;
- takeover/recovery;
- reception;
- reservations;
- warranty.

Do not conflate these future concepts with current P1.1 work.

## 15. Financial concepts — future foundation

Keep separate:

- milestone;
- tranche;
- financing;
- payment/disbursement.

Amounts should use millimes.

Future ledger design must support double-entry accounting principles and non-destructive history.

## 16. Immutability / auditability

Historical workflow records must not be destructively rewritten.

Prefer:

- versioning;
- status transitions;
- append-only/auditable history;

over destructive deletion.

## 17. Role isolation

A client sees their own private data.

An artisan sees only allowed project/publication data.

An artisan must not see competitor:

- bids;
- bid items;
- groups;
- prices;
- documents.

A reviewer sees what their role authorizes.

An admin role cannot be self-granted.

## 18. Publication modes

Security must preserve rules for:

- public/allowed publication;
- targeted publication;
- invite-only publication.

Knowing an ID must never bypass authorization.

Revoked invitations must stop access immediately.

## 19. AI-assisted scope

AI proposals are suggestions only.

Rules:

- never silently overwrite client text;
- clearly identify AI-assisted content;
- client can accept/reject/edit;
- preserve traceability;
- accepted text may become request scope/new version according to workflow.

A fake external provider integration must not be invented when credentials/provider do not exist.

## 20. Out-of-scope for current stabilization

Do not start or expand these while P1.1 is unstable:

- advanced offer comparison;
- scoring;
- full award UX;
- full contracts;
- escrow/payment;
- disputes;
- subcontracting;
- advanced messaging;
- OCE replacement/integration.
