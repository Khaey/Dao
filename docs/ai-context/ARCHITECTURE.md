# D.A.O — Architecture

> Living technical architecture. Do not treat old chat discussions as more authoritative than the current repository and actual DEV environment.

## 1. Repository structure

High-level repository:

```text
Khaey/Dao
├── .github/
├── dao-frontend/
├── dao-backend/
├── ops/
└── DEV_DEPLOYMENT.md
```

The frontend is a Next.js application with routes for:

- authentication;
- dashboard;
- projects;
- project detail;
- project review;
- D.A.O reviewer;
- publications;
- artisan space;
- bids/offers.

## 2. Frontend project detail

A major current file is:

```text
dao-frontend/app/app/projects/[id]/page.tsx
```

It currently handles many responsibilities:

- project loading;
- project versions;
- effective status;
- localization;
- project editing;
- work requests / lots;
- request history;
- project documents;
- private chantier details;
- AI proposals;
- review state;
- archive action;
- project history.

This file is known to be too coupled, but **must not be refactored during active P1.1 stabilization** unless a proven bug requires it.

Future refactor direction:

```text
ProjectDetail
├── useProjectDetailData()
├── ProjectHeader
├── ProjectOverview
├── ProjectLots
├── ProjectDocuments
├── ProjectDao
└── ProjectHistory
```

## 3. Backend model and Supabase

Supabase is the current data/security foundation.

Important conceptual tables/entities include:

- `profiles`;
- `user_roles`;
- `profile_contacts` where applicable;
- `projects`;
- `project_versions`;
- `project_requests`;
- `project_request_versions`;
- `project_private_details`;
- `project_reviews`;
- `documents`;
- `document_grants`;
- `publications`;
- `bids`;
- `bid_items`;
- `bid_groups`;
- `bid_group_items`;
- `award_items`;
- `contractor_profiles`;
- portfolio/reviews structures;
- `ai_runs`;
- `ai_proposals`.

Do not assume a migration is applied merely because a migration file exists in Git.

## 4. Authentication and authorization

Security model:

```text
Supabase Auth
-> user session / JWT
-> server/API/RPC
-> RLS as the actual data boundary
```

Rules:

- UI hiding is never the security boundary.
- Browser IDs must never be trusted for authorization.
- privileged/service-role credentials must never be exposed to browser code.
- admin role must not be self-assignable.
- a dual-role account must still respect row-level isolation.

## 5. RLS/security invariants already validated

The backend foundation has previously been validated around these principles:

- anonymous/public views expose only safe/expurgated data;
- Client A cannot access Client B private project data;
- an authorized professional sees only allowed publications;
- Professional A must never see Professional B:
  - bids;
  - bid lines;
  - bid groups;
  - documents;
  - prices;
- draft bids are not visible to competitors/client until workflow permits;
- targeted and invite-only publications remain protected even when IDs are guessed;
- invitation revocation takes effect immediately;
- users cannot promote themselves to admin;
- dual-role behavior remains isolated.

Do not weaken these rules during frontend stabilization.

## 6. Project document architecture

Project documents use private storage.

Core expectations:

- private bucket remains private;
- no public storage URL;
- authorization before signed URL issuance;
- client owner can access their permitted project documents;
- unauthorized users / competitors are denied;
- MIME and size validation remain enforced;
- no privileged storage key in browser code.

Current frontend behavior to preserve:

```text
upload
-> refreshDocuments()
```

and deletion updates the document list locally.

A simple document action must not trigger a full project `load()` and visual reset.

## 7. Project edit concurrency protection

A real race condition was found during P1.1:

```text
load A starts
load B starts
load A commits form state
user starts editing
load B finishes later
old data overwrites user input
```

The project detail now uses a generation/sequence guard.

Conceptually:

```text
load generation N
-> async reads
-> only commit state if N is still current
```

This protection must be preserved.

Do not replace it with:

- sleeps;
- retries;
- larger timeouts;
- forced reloads.

## 8. Project status architecture

There are two related status levels:

### `projects.status`

Represents the broader project lifecycle.

### `project_versions.status`

Represents the review/approval lifecycle of a particular version.

For current UI display, the effective status rule is:

```text
effectiveStatus =
  project.status === 'archived'
    ? 'archived'
    : latest project_version.status
      ?? project.status
```

This rule must remain coherent across:

- dashboard counters and recent projects;
- profile activity counters;
- Mes projets;
- project detail;
- next-action CTA.

The project-level `archived` state takes precedence over the latest version status. This keeps archived drafts out of draft counters and hides draft/rejection actions on the detail page.

Do not blindly synchronize the two database columns merely to make a badge look correct.

## 9. Money

Money amounts are stored in **TND millimes** in technical/backend payloads.

Example:

```text
175000 TND
= 175000000 millimes
```

Frontend forms may display TND, but API payloads and persisted monetary values use millimes where designed.

Do not change this convention casually.

## 10. Work requests / lots

`project_requests` are not merely UI cards.

They are currently the downstream unit feeding:

- publication;
- bids/offers;
- award.

A project can contain multiple requests.

The system supports:

- create;
- modify;
- duplicate;
- logical withdrawal;
- version history;
- budget per request.

The first request must remain v1 at creation; v2 appears only after a real user modification.

## 11. Review/versioning

Expected project review flow:

```text
draft v1
-> submit
-> DAO review
-> rejected + reason
-> client correction
-> new draft v2
-> resubmit
-> review
-> approved
```

Never silently mutate a rejected version.

Rejected versions and review reasons remain traceable.

## 12. CI/CD

GitHub Actions workflow includes at least:

```text
verify
e2e-dev
deploy-dev
```

`verify` covers backend checks and frontend build.

`e2e-dev` uses Playwright and DEV fixtures.

`deploy-dev` is skipped when previous required jobs fail.

Do not claim P1.1 complete solely because `verify` is green.

## 13. E2E architecture issue to improve later

The current main E2E project flow is too monolithic and covers a long chain.

Future direction after P1.1 stabilization:

```text
projects-basic.spec.ts
review-publication.spec.ts
documents-private.spec.ts
artisan-bid.spec.ts
archive.spec.ts
```

Desired CI shape later:

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

Do not restructure the suite in the middle of the current bug chain.

## 14. Infrastructure boundaries

Do not touch WireGuard during application stabilization.

Do not expose port 3000 publicly.

The historical OpenConstructionERP/OCE Docker exploration is not the source of truth for the current application.

The current `Khaey/Dao` application architecture is authoritative.
