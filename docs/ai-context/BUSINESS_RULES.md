# D.A.O — Business Rules

## Back-office V2 (#64)

The current assigned-review/version/sublot/withdrawal/assisted-award and notification boundaries are documented in [backoffice-v2.md](../backoffice-v2.md). Older V1 read-only descriptions below are historical. No OCE or contractual runtime is introduced.

> Stable business constraints and invariants. Changes here require explicit product/architecture review.

## Contrat V1 — fondation P2.2-A (#125)

- Un contrat est rattaché à un seul award et fige atomiquement tous ses lots
  actifs, leurs offres, périmètres et montants convenus. Le total exact est la
  somme des millimes figés.
- Les parties immuables sont le client, le contractor et D.A.O. La préparation
  requiert une identité D.A.O explicite et ne peut pas en fabriquer une.
- Versions, lignes, parties, événements et archives sont append-only et les
  versions portent une empreinte SHA-256 vérifiée par la base.
- Le brouillon créé par P2.2-A est uniquement technique et `non_engaging`.
  Aucun utilisateur ne peut le créer ou le faire avancer vers `review`, `ready`,
  `awaiting_signatures` ou `signed` dans ce lot.
- Seules les parties actives et les administrateurs D.A.O actifs lisent le
  contrat. Un reviewer générique, un concurrent ou un compte suspendu est refusé.
- Aucun consentement, signature, PDF exécutoire, paiement ou mouvement financier
  n'est introduit. Voir [le design canonique](../product/contract-v1-design.md).

## Contrat V1 — avenants simples non engageants P2.2-C (#174)

- Seul le Client partie au contrat initie une proposition d'avenant.
- Une proposition peut clarifier le périmètre sans changer les lots, proposer un
  delta de montant en millimes et proposer une date/durée.
- Le Client et le Prestataire acceptent la même version immuable, puis D.A.O la
  contrôle. Chaque partie peut refuser avec motif ; D.A.O peut annuler avec motif
  avant son contrôle final. Il n'existe pas d'expiration automatique en V1.
- Proposition, version/hash, accords et événements sont distincts du contrat et
  append-only. Ils restent `non_engaging` avec effet juridique bloqué.
- Une validation technique ne modifie jamais le contrat initial, l'attribution,
  ses lots, ses parties, son montant ni ses dates exécutoires.
- Ajout/retrait de lot, changement de partie, réattribution, fiscalité, paiement,
  jalon, réception, garantie, résiliation, PDF exécutoire et signature juridique
  restent hors périmètre.

## Messagerie privée de chantier V1 — #116

- Un fil texte existe par chantier confirmé et professionnel accepté. Le client
  confirmé et l'utilisateur du profil contractor concerné sont les seuls
  acteurs autorisés ; staff, concurrents, invitations non acceptées et simples
  visiteurs n'obtiennent aucun accès.
- L'autorisation est recalculée à chaque lecture/envoi depuis les memberships
  actifs et l'état des comptes. Un participant révoqué ou suspendu perd l'accès
  immédiatement ; les lignes historiques restent conservées sans être exposées.
- Les messages sont immuables, attribués à `auth.uid()`, horodatés par la base,
  bornés à 4 000 caractères, paginés et envoyés avec une clé idempotente.
- Une notification interne sans contenu privé est créée uniquement pour l'autre
  participant. Aucun e-mail, SMS, Telegram, pièce jointe, temps réel strict ou
  accès de modération staff n'est introduit en V1.

## Espace Artisan / Entreprise — règles validées #83

- Un compte qui cumule les rôles client et contractor ouvre le dernier espace
  explicitement choisi. Le choix est accepté uniquement si le rôle correspondant
  est réellement attribué ; le défaut historique reste l'espace client.
- Le profil professionnel est éditable par son propriétaire via une commande
  contrôlée. Seuls un changement d'identité (`business_name`, nom public), de
  type d'activité ou de métiers actifs remet un profil vérifié/rejeté à
  `pending`. Présentation, expérience et disponibilité ne relancent pas la
  vérification. Une suspension reste suspendue et relève exclusivement de D.A.O.
- « Mes invitations » ne révèle jamais le jeton hashé ou le jeton en clair.
  L'adresse confirmée Supabase Auth, le rôle attendu et l'état courant sont
  vérifiés côté SQL avant acceptation/refus ; l'acceptation conserve les mêmes
  invariants de membership et d'affectation au lot que le parcours par lien.
- « Mes offres » expose uniquement les versions du contractor authentifié.
  Une version soumise, courante et non attribuée peut être retirée dans son
  intégralité. Elle devient `withdrawn`/`obsolete`, reste immuable et auditée,
  et ses lignes restent dans l'historique. Une offre déjà attribuée ne peut pas
  être retirée par ce parcours. Une nouvelle version peut être préparée si la
  publication accepte encore les offres.

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

### P2.1 closure and reassignment (issue #44)

Confirmed lots accept no new offer lines/submissions, regardless of payment.
Submitted competing lines become Non retenues (`not_selected`), never
`rejected`. Results are per lot and append-only; submitted commercial content
is untouched. Cancellation requires a reason (and comment for other), records
author/date/reason, preserves awards and reopens the concerned lots. A package
is attributed/cancelled atomically across all its lots. Reassignment uses fresh
award identities and keeps existing membership and contract boundaries.

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
  project.status === 'archived'
    ? 'archived'
    : latest project_version.status
      ?? project.status
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

Marketplace visibility never grants private details. An accepted chantier
contractor may see them only through an explicit membership permission; the
contractor initiator receives that permission when creating the chantier.

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

Each `project_request` / lot is a real, downstream unit for publication,
bidding, and award. A simple project has one real lot; a complex project can
have multiple real lots. Do not create, hide, or synchronize a virtual lot.

### Editable draft with zero active lots

An editable project draft may temporarily have zero lots. Its Lots tab shows a
`Travaux du projet` first-lot form prefilled from the current project version:

- title from the project title;
- scope from a real project description (leave blank for an empty or placeholder description);
- indicative lot budget from the project budget, converted from millimes;
- no trade selected by default.

Creating the lot requires an explicit active catalog trade, a non-empty title,
and a non-empty scope. The `Créer le lot principal` action is the only point
that sends the create request. No lot is created on page load. The client
review screen explains that one active lot is required and links back to the
Lots tab; submission stays disabled until a lot exists.

Project edits after the first lot is created do not update that lot or create a
new lot version automatically.

### One or more lots

Show the list and `Ajouter un lot` action. Keep the add form hidden until the
client explicitly asks to add another lot. Existing actions remain available
only while the project and its current version are editable drafts:

- modify;
- duplicate;
- history;
- withdraw.

Withdrawal is allowed only while the latest project version is a draft. The
database serializes withdrawal against review submission so the last active lot
cannot disappear while the project is being submitted.

### Review and publication snapshots

Client and DAO review screens show the exact lot versions linked to the project
version under review. Publication choices come from the approved project
version's linked lot snapshots and include only active lots. The publication
RPC rejects empty, null, duplicate, inactive, or unlinked selections and
publishes the approved snapshots, even if a newer lot version exists.

## 12. No implicit or virtual lot

A zero-lot state is allowed only during editable draft preparation. Before
review, the client creates at least one real lot. Do not auto-create a hidden
`Projet complet` request, introduce a no-lot mode, or infer a lot from project
fields. Keep project and lot data independent after lot creation.

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

## 21. Collaborative chantiers (authorized scope, 2026-09-30)

Mes chantiers lists real participation for clients and contractors. DAO
disponibles remains the separate artisan marketplace. Global account roles
never substitute for project participation roles. Contractor-initiated work
has a real contractor initiator and no client until a different client accepts
the invitation atomically; confirmation is distinct from client_review.

Work stage: not_started, started, in_progress, completed. Declarative payment:
not_set, unpaid, partial, paid. Neither state drives DAO/award/contract status.
The same chantier supports known professionals and missing lots sought through
the existing DAO workflow. Invitations au chantier never grant publication
invite_only access; its UX label is DAO sur invitation.

Invited contractors have read-only workspace access by default, no competitor
bids/prices/files, and no private details without explicit permission. Only
approved documents shared as project_members reach accepted participants;
owner_only documents keep their existing owner/staff/explicit-grant boundary.
Revocation removes shared and private access. Tokens are random, stored only
as hashes, expire, can be revoked/declined and are single-use.


## 22. Invitation email V1

Email is an additional transport of the same invitation, not a second
invitation or a DAO publication. The DB recipient is authoritative. Only a
user already authorized to manage the invitation may send it, while pending,
nonexpired and neither accepted, revoked nor declined. Hash verification is
mandatory; email does not confer or change any project/global role.

Copy link remains usable even when email is unavailable or delivery fails.
Retry reuses the current token without changing expiry/hash/DB; after provider
acceptance the action is disabled. No resend after leaving/reloading the
screen in V1. Missing email is explained without requesting it again. Email
contains no private details: only inviter name, chantier title, secure link
and the 7-day/single-use notice. Password recovery/Auth emails are unchanged.

## 23. Existing-team onboarding and principal lots

For a client who already knows the professionals on the chantier, the MVP
onboarding rule is:

```text
1 invited artisan / enterprise = 1 principal real lot
```

The client prepares at least one artisan/lot row on the same screen. Each row
contains:

- contractor / enterprise name;
- recipient email;
- trade;
- principal lot title;
- optional indicative lot budget in TND, persisted in millimes.

Multiple artisan/lot rows may be prepared before creation. The project, each
real `project_request` + v1, and each contractor invitation must be created as
one controlled business operation so a partial project/team is not left behind.

A contractor invitation must reference one active principal request belonging
to the same project. A principal lot cannot simultaneously have another active
contractor member or another nonexpired pending contractor invitation.

Accepting the contractor invitation:

- creates/activates the chantier membership;
- binds that accepted contractor member to the invitation's principal lot;
- does **not** create a DAO award, bid, contract or marketplace entitlement.

If an enterprise performs several lots, onboarding still uses only its principal
lot. After acceptance, the client may create additional real lots and assign
the same accepted contractor member to them from the chantier. These additional
lot assignments remain project participation data, distinct from DAO award
semantics.

The minimum-one-artisan rule applies only to the `client_existing_team`
creation path. A marketplace-first client project may contain lots with no known
professional and use the normal DAO search/publication workflow.

## 24. Carnet d’exécution par lot attribué (P2.3, #289)

Le suivi global `project_stage` et le paiement déclaratif existants restent
distincts. Le carnet est disponible uniquement pour un chantier confirmé et un
`award_item` actif dont le lot est `awarded` ou `contracted`. L’Artisan doit être
à la fois titulaire de l’award et membre Contractor accepté du chantier ; une
attribution seule ne crée aucun accès.

L’Artisan habilité, dans son espace Contractor effectif, peut ajouter un progrès
0–100 motivé, une intervention datée et un jalon technique. Le Client confirmé,
dans son espace Client effectif, lit ces déclarations et peut enregistrer une
prise de connaissance ou une contestation motivée. Les doubles rôles suivent
`profiles.last_workspace`. Staff, concurrents, invités, membres révoqués, comptes
suspendus, projets archivés et awards annulés n’obtiennent aucun droit implicite.

Toutes les écritures sont append-only, horodatées par le serveur, attribuées à
`auth.uid()` et idempotentes. Un jalon terminé ou annulé n’est pas rouvert. Les
justificatifs sont uniquement des références vers des `documents` approuvés et
partagés avec `project_members`; un document `owner_only` ne devient jamais
visible par le carnet. Les lectures revalident les droits vivants.

Une progression à 100 %, un jalon terminé ou une prise de connaissance Client
ne vaut ni réception, ni acceptation juridique, ni paiement, ni modification du
contrat ou de l’attribution. Le modèle fournit des codes événementiels stables
mais n’exécute aucune synchronisation OCE.

## 25. Accord précontractuel bilatéral P9-A1 (#345)

- L’accord est facultatif, lié à un award actif et disponible uniquement avant
  la création du contrat. Il ne remplace ni l’offre attribuée ni le contrat.
- Client et Artisan peuvent proposer ou contre-proposer. Chaque proposition
  crée une version immuable et hashée ; modifier une version exige de nouveaux
  accords des deux parties.
- L’état « convenu » exige l’acceptation de la même version par le Client et
  l’Artisan titulaire. Un refus est motivé et conserve l’historique.
- Le parcours simple fonctionne sans date, sous-lot ou échéancier. Les dates,
  durées, modalités d’exécution, calendriers de sous-lots et échéances sont
  facultatifs.
- Une échéance chiffrée reste informative et la somme fournie doit égaler le
  prix attribué. Aucune taxe, devise ou somme n’est déduite.
- Toute version reste non engageante : aucune signature, réception, dette,
  facture, autorisation bancaire ou transaction n’est créée. Les trois drapeaux
  restent `non_engaging=true`, `legal_effect_enabled=false` et `contract_signed=false`.
- Seuls le Client exact et l’Artisan titulaire, actifs et membres acceptés du
  chantier, peuvent lire ou agir. Concurrents, tiers, simples membres, staff et
  comptes suspendus sont refusés.
