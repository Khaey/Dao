# Chantiers collaboratifs / relations existantes

Final product decisions, reconciled on 2026-09-30 against main `965054d`.
The later product supplement takes precedence over the initial prompt.

## One project model

- `project_origin`: `client_marketplace`, `client_existing_team`, `contractor_existing_client`.
- `initiator_id` is immutable. Existing records are backfilled from their real client.
- `client_id` is nullable only for contractor-origin projects awaiting confirmation.
- `confirmed_at`/`confirmed_by` are separate from the DAO review lifecycle.
- `project_stage`: `not_started`, `started`, `in_progress`, `completed`.
- `payment_status`: `not_set`, `unpaid`, `partial`, `paid`; informational only.
- `project_members` records accepted/revoked participation, not global roles.
- Lot `contractor_member_id` can attach an existing professional independently of awards.
- The same project can mix known participants and marketplace lots. No implicit lot.

## Dependency audit before making client nullable

| Existing dependency | Preserved boundary / adaptation |
| --- | --- |
| `projects.client_id` FK/index | FK and existing clients retained; pending-client check and immutable initiator added |
| Child project/version/request/publication/bid/award/contract FKs | Reference project IDs; no change to snapshots, identities or versioning |
| `dao_private.owner()` | Unchanged strict `client_id = auth.uid()` predicate |
| Bids, versions/items/groups, offer files, awards/contracts, AI authorization | Existing helpers/policies retained; membership grants no commercial access |
| Publication recipients / visibility `invite_only` | Unchanged marketplace authorization; chantier invitation does not create recipients |
| Legacy project creation RPCs | Trigger fills initiator/client membership; contractor-only actors cannot become implicit clients |
| Draft/lot preparation commands | Next checkpoint authorizes confirmed client or accepted contractor initiator only |
| Shared workspace SELECT policies | Project/version/lot reads use accepted participation plus existing owner/staff access |
| Private chantier details | Separate explicit permission helper; no access from marketplace visibility |
| Project files / Storage | Private bucket and signed access retained; sharing extends only approved project documents |
| Browser/server ownership inputs | Actor IDs never trusted from input; creation/confirmation resolve `auth.uid()` |

No legacy project is reclassified as contractor-origin. Backfill does not
change any project/version lifecycle state or public snapshot.

## Permissions

| Actor | Workspace | Preparation | Private details | DAO submission / competitor offers |
| --- | --- | --- | --- | --- |
| Confirmed project client | Read | Existing client actions | Yes | Existing client permissions |
| Accepted contractor initiator | Read | Draft project/lots/documents | Explicit initial permission | No client privileges |
| Accepted invited contractor | Read-only project/lots | No draft edits | False until explicitly granted | No competitor offers |
| Revoked member / unrelated user | No membership access | No | No | Existing isolated marketplace rules only |
| DAO staff | Existing staff scope | Existing staff scope | Existing staff scope | Existing reviewed workflow only |

Project documents default to `owner_only`. Existing owner/staff/explicit grants
are preserved. `project_members` sharing adds approved-file access only for
accepted participants. Public Storage access stays denied.

## Invitation lifecycle and atomic confirmation

Dedicated `project_invitations`, separate from publication recipients:
expected role (`client`/`contractor`), optional normalized recipient email,
token hash, expiry, pending/accepted/declined/revoked/expired state and audit
timestamps/actors. Plaintext token is returned once and never persisted or
logged. Default validity is seven days; RPCs enforce expiry and single use.

Issuance/acceptance/revocation serialize on the project row, then invitation
row. Exactly one pending client invitation and one accepted client membership
per project. Acceptance checks the stored expected global role and optional
recipient email; it cannot change a global role. A contractor initiator cannot
accept their own client invitation, even with a dual-role account.

Client acceptance atomically consumes the invitation, sets the real client,
adds client membership and immutable confirmation evidence, and preserves the
contractor participant. It never submits for DAO or publishes the chantier.
The public token preview exposes only the safe company/title/territory,
declared work/payment state and safe lot summary, never contacts, exact address,
tokens, commercial bids or prices.

## UX checkpoints

Contractor navigation: Tableau de bord, Mes chantiers, DAO disponibles, Mon compte.
Dashboard: Mes chantiers clients (including Client à confirmer), Ajouter un
chantier client; separate DAO disponibles / Voir les appels d'offres.

Contractor creation: Chantier (title/short description/location), État (work
stage, optional payment), Client, Invitation. No advanced onboarding fields.
Client creation: Nouveau chantier, then Je cherche des professionnels or
J'ai déjà mes artisans / entreprises. The existing marketplace flow remains.

Both origins use the same Overview/Lots/Équipe/Documents/Suivi/history screen.
An unassigned lot offers Trouver un professionnel through the existing
review/publication/bid/award workflow. `invite_only` reads DAO sur invitation.

`/invite/[token]` shows a safe summary and Confirmer et rejoindre le chantier /
Refuser. Login/register preserve a validated internal return path and expected
role. Wrong-role, expired, used or revoked invitations fail clearly.

## Verification and durability

Checkpoint 1: fresh PGlite migration, legacy populated-data backfill, shared
schema contract, RLS/grants/private/shared-document tests; existing suite intact.
Later checkpoints add RPC/lifecycle/concurrency, backend, real Auth/JWT/Storage
integration and isolated desktop/mobile E2E. Shared DEV is never a FULL E2E target.
Every stable checkpoint is committed and published before the next phase.
