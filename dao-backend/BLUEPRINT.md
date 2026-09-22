# Blueprint de référence D.A.O — 21/09/2026

## Vision et MVP

D.A.O simplifie la mise en concurrence de travaux pour le client et l’artisan, avec un backend rigoureux pour droits, versions, documents et traçabilité. Le MVP couvre projets, demandes, publications, offres, visibilité ciblée, documents privés et attribution partielle par demande.

Le parcours client Priority 1 couvre aussi la fiche profil, la préparation versionnée du DAO, les lots, les détails privés, les documents de projet et la revue/correction avant publication. L’IA du MVP est un fournisseur mock déterministe : elle propose du texte, mais ne modifie jamais un lot sans acceptation explicite du client.

## Architecture

Next.js App Router et TypeScript côté serveur ; Supabase PostgreSQL source de vérité ; Supabase Auth/JWT ; Storage privé `dao-private` ; RLS comme barrière d’accès ; Realtime seulement si nécessaire.

Le navigateur n’a jamais de `service_role`. Les opérations métier utilisent le JWT. Le secret serveur est limité aux signed upload/download après contrôle RLS.

## Rôles

`client`, `contractor`, `dao_reviewer`, `dao_admin`. Un compte peut cumuler `client` et `contractor`. La sous-traitance est Phase 2.

## Modèle

```text
Projet → versions → demandes → publications → offres → items → attributions
```

Une offre peut couvrir plusieurs demandes, mais chaque attribution est explicite par demande.

`projects.status` décrit le cycle global (`draft`, `open`, `closed`, `archived`) tandis que `project_versions.status` décrit la validation (`draft`, `client_review`, `dao_review`, `approved`, `rejected`). Une correction après rejet crée une nouvelle version `draft`; la version rejetée et les commentaires `project_reviews` restent immuables dans l’historique. Les dates `desired_start_date` et `desired_end_date` sont facultatives, mais la fin ne peut précéder le début.

Les lots sont créés directement en version 1 avec leur budget. Une modification crée une nouvelle `project_request_versions`; un retrait passe à `withdrawn` sans suppression physique. Les détails exacts du chantier vivent dans `project_private_details` et ne sont jamais recopiés dans les champs `safe_*` des publications.

Publications : `public`, `targeted`, `invite_only`. Une seule publication active est autorisée par projet.

## Offres

Workflow : `draft` → ajout/upsert des `bid_items`/groupes → soumission → contenu immutable. Le draft est invisible aux client et concurrents. `public.create_bid_draft` crée une version idempotente, `public.upsert_bid_item` vérifie que le lot appartient à la publication accessible, et `public.submit_bid_version` délègue à `dao_private.submit_bid_version` en exigeant le contractor propriétaire, un rôle `contractor`, une ligne au minimum et une deadline non dépassée. Après une soumission, une nouvelle version draft peut être préparée avant la deadline ; la version soumise ne peut plus être modifiée.

## Attribution

`public.award_request_atomic` délègue à `dao_private.award_request_atomic`. L’acteur doit être propriétaire du projet ou staff DAO. `command_receipts` assure l’idempotence. L’index `one_active_award_per_request` interdit deux attributions actives sur une demande.

Une offre multi-demandes ne crée jamais d’attribution implicite.

## Documents et Storage

`bid_documents` est attaché à une version d’offre. L’artisan propriétaire, le client propriétaire après soumission/approbation et le staff autorisé peuvent y accéder selon RLS. `document_grants` ne sert pas aux pièces d’offres.

Le client JWT vérifie l’accès ; le client Storage serveur génère ensuite le signed URL. Le bucket reste privé.

Les documents projet utilisent `documents` (distinct de `bid_documents`) et le namespace `project/<project-id>/...`. Le navigateur ne reçoit qu’un signed upload après autorisation JWT; les téléchargements et suppressions passent par un contrôle serveur/RLS puis un client Storage privilégié côté serveur.

## Commandes Priority 1

Les façades publiques minimales ajoutées par `202609220007_priority1_client_workflow.sql` sont : `initialize_my_account`, `update_my_profile`, `create_project_draft` (avec date de fin), `update_project_draft`, `create_project_correction`, `archive_project`, `upsert_project_private_details`, `add_project_request` (budget dès la v1), `create_project_document`, `delete_project_document`, `generate_ai_proposal`, `accept_ai_proposal` et `reject_ai_proposal`. Elles délèguent toutes à `dao_private`, vérifient `auth.uid()` et n’accordent aucun INSERT/UPDATE générique à `authenticated`.

## Sécurité

- JWT utilisateur pour le métier ;
- RLS PostgreSQL ;
- logique sensible dans `dao_private` ;
- façades RPC publiques minimales PostgREST ;
- aucun droit direct métier inutile ;
- aucune identité du body ne remplace `auth.uid()` ;
- service role uniquement côté serveur pour opérations privilégiées contrôlées.

## Migrations et validation

Migrations appliquées jusqu’à `202609220007_priority1_client_workflow.sql`.
- services/routes : 9/9 ;
- PGlite : 78/78 ;
- test autonome Supabase réel : 1/1, 0 échec lorsque les trois variables sont configurées.

## Hors MVP / Phase 2

Paiement/escrow, ledger, signature électronique, contrats exécutoires, garanties et litiges complets, sous-traitance, OCE et IA avancée.

## Prochaine étape

Le frontend MVP couvre `Client → préparation/version → revue/correction → publication → Artisan → offre`. La comparaison avancée, le scoring et l’attribution restent hors de cette tranche.
