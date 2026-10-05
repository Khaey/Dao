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

Password recovery uses Supabase Auth's standard browser flow:

```text
/auth/login -> /auth/forgot-password
resetPasswordForEmail(email, redirectTo: /auth/reset-password)
-> PASSWORD_RECOVERY session -> updateUser({ password })
```

The reset page accepts only a session created by the recovery event, checks
that the current Supabase user matches that recovery session, and requires a
matching password confirmation. The exact reset URL must be present in the
Auth redirect allowlist for each environment. E2E captures the local Auth
email in the disposable local SMTP inbox; it must never send a test email from
DEV.

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

Current main also provides the operational P2 flow:
- submitted offers can be compared read-only by lot;
- attribution is explicit and per lot, with partial selection supported;
- only one active award is allowed per lot;
- offer confidentiality and competitor isolation remain enforced;
- contract/execution is not inferred or activated by attribution.

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

GitHub Actions validation workflow includes:

```text
backend-verify
frontend-build
full-e2e
deploy-dev
ci-timing-summary
```

`backend-verify`, the general `frontend-build`, and `full-e2e` run in parallel.
The critical `full-e2e` job starts one fresh Supabase CLI stack on its
disposable GitHub-hosted runner, applies all repository migrations and seed,
checks the exact ledger and schema contract, captures the fresh-local DAO
inventory, runs `supabase db reset --local`, replays all migrations and seed,
and checks the ledger and schema contract again. It then runs real
Auth/JWT/RLS/RPC/Storage integration and the FULL E2E suite on the same stack.
The reset/replay proof remains mandatory; this job replaces the former second
Supabase startup used by E2E.

Before Playwright, the job refuses every Supabase URL except
`http://127.0.0.1:54321`. The E2E frontend build uses the local URL and public
key, and is not reused from the general frontend build. The E2E build and
Playwright Chromium/system dependency setup run in parallel. The job confirms
14 discovered tests, then runs all desktop and mobile coverage with two
workers. No DEV or production credentials are used on pull requests. Cleanup
removes worker tracking files only; runner disposal resets DB, Auth, and
Storage.

`deploy-dev` is strictly limited to a push on `refs/heads/main`, after backend,
frontend, and FULL E2E validation succeeds. Pull requests cannot trigger
deployment. Its protected `dev` environment secrets are assembled into a
run-scoped private payload outside the immutable build artifact. After the
stale-main check, the deploy script invokes the installed root `env-sync`
helper under the host deployment lock, preserving unmanaged environment keys
and the `root:dao / 0640` file contract. Release readiness failure restores the
previous environment and release together. Payload cleanup is attempted on
both the runner and VPS in `always()` paths. The final timing summary records
stage, critical-job, and workflow durations; skipped PR deployment jobs are
omitted from job duration totals.

The repository and DEV contain 22 matching migration versions. Fresh schema
reconstruction and the read-only DAO inventory match DEV structurally and
semantically (586 objects, no missing or extra objects, no structural or
semantic drift). The current CI optimization does not modify migrations,
schema, Supabase DEV, or production. Its one-stack architecture passed in the
Draft PR; the measured main-equivalent workflow estimate remains just above
five minutes because the main-only deploy job was not changed.

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

The first isolation step runs desktop and mobile with two workers. Measure its
stability and duration before increasing worker count or splitting suites.

## 14. Infrastructure boundaries

Do not touch WireGuard during application stabilization.

Do not expose port 3000 publicly.

The historical OpenConstructionERP/OCE Docker exploration is not the source of truth for the current application.

The current `Khaey/Dao` application architecture is authoritative.

## 15. Collaborative chantier foundation

See `COLLABORATION_DESIGN.md` for the dependency audit and permission model.
The collaboration migration adds participation on the existing projects and
lots without replacing versioning, review, publication, offers or attribution.
`dao_private.owner()` remains the confirmed client check. Separate private
helpers govern accepted-member workspace reads, initiator preparation and
explicit private-details permission. All mutations remain controlled RPCs;
new public tables have RLS and no browser write grants.

Collaboration command migration `20260930165307` uses explicit public
SECURITY INVOKER facades delegating to private, authenticated SECURITY DEFINER
commands. Only token preview is anonymous and whitelisted. Invitation mutations
lock project then invitation; deferred client-membership constraints validate
atomic confirmation. Member identity and confirmed project identity are
immutable. Contractor-only legacy creation is blocked by the model trigger.

ProjectService and the API adapters expose the commands; they never accept
actor/client/initiator identities or role overrides during token acceptance.
DocumentService still uses JWT/RLS checks before server-only signed Storage
access. Shared scopes require accepted membership; revoke removes any explicit
project document grants too. Real Auth/Storage/concurrent confirmation tests
are included by the integration test script on the isolated CI stack.

Collaboration E2E adds eight independent scenarios (16 viewport executions)
without removing the original 18. Every scenario creates its own project and
records ids for runner disposal. Worker users are separated by run, viewport
and worker, including the unrelated client. Email V1 adds two scenarios (four viewport executions), taking strict CI
discovery to 38 executions in 14 files. Local-only service credentials are restricted to test
provisioning/read/moderation; all product/API commands use real actor JWTs.
No sleep, arbitrary .first(), timeout increase or assertion removal was added.


## Application invitation email V1 (2026-10-02)

POST `/api/project-invitations/[id]/send-email` uses the existing bearer JWT
verification (`getUser`). Its only body field is token. `InvitationAuthorization`
is the shared API preflight for issue/revoke/send; it obtains preparation and
confirmed-client authority from the existing SQL `project_team` RPC. The
original SQL command guards are unchanged. Normal JWT/RLS reads precede a
lazy server-secret read of this one invitation's hash and minimal metadata.
Revalidate its identity, role, creator and lifecycle, compare SHA-256 UTF-8 in
constant time, and obtain recipient exclusively from DB. The preview RPC is
reused only to select inviter name and public title for the email.

`ResendEmailTransport` isolates the fixed HTTPS sending endpoint, HTML/text
rendering and stable per-invitation idempotency. Server configuration validates
`DAO_PUBLIC_URL` and sender; no host is hardcoded in the email service. Tokens,
request bodies and provider errors are never logged/persisted. Responses omit
hash, token and provider ID. No privileged mutation, migration or RLS change.

The two creation screens keep ID/token only in current React state and share
`InvitationEmailButton`. Copy remains enabled while sending, after failure and
after success. No recipient means a disabled action with an explicit message.
After navigation/reload, no historical resend is offered. Email acceptance
means provider acceptance; actual delivery is checked separately on DEV.

The new integration invokes the production handler with real local Auth/JWT/
RLS and intercepts only Resend. E2E checks UI states and DB immutability on
1440×900 and 390×844; email POSTs are mocked and sensitive traces are disabled.
