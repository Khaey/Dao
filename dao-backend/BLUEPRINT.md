# Blueprint de référence D.A.O — 21/09/2026

## Vision et MVP

D.A.O simplifie la mise en concurrence de travaux pour le client et l’artisan, avec un backend rigoureux pour droits, versions, documents et traçabilité. Le MVP couvre projets, demandes, publications, offres, visibilité ciblée, documents privés et attribution partielle par demande.

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

Publications : `public`, `targeted`, `invite_only`. Une seule publication active est autorisée par projet.

## Offres

Workflow : `draft` → ajout des `bid_items`/groupes → soumission → contenu immutable. Le draft est invisible aux client et concurrents. `public.submit_bid_version` délègue à `dao_private.submit_bid_version` et exige le contractor propriétaire.

## Attribution

`public.award_request_atomic` délègue à `dao_private.award_request_atomic`. L’acteur doit être propriétaire du projet ou staff DAO. `command_receipts` assure l’idempotence. L’index `one_active_award_per_request` interdit deux attributions actives sur une demande.

Une offre multi-demandes ne crée jamais d’attribution implicite.

## Documents et Storage

`bid_documents` est attaché à une version d’offre. L’artisan propriétaire, le client propriétaire après soumission/approbation et le staff autorisé peuvent y accéder selon RLS. `document_grants` ne sert pas aux pièces d’offres.

Le client JWT vérifie l’accès ; le client Storage serveur génère ensuite le signed URL. Le bucket reste privé.

## Sécurité

- JWT utilisateur pour le métier ;
- RLS PostgreSQL ;
- logique sensible dans `dao_private` ;
- façades RPC publiques minimales PostgREST ;
- aucun droit direct métier inutile ;
- aucune identité du body ne remplace `auth.uid()` ;
- service role uniquement côté serveur pour opérations privilégiées contrôlées.

## Migrations et validation

Migrations appliquées jusqu’à `202609210005_public_rpc_facades.sql`.
- services/routes : 7/7 ;
- PGlite : 68/68 ;
- test autonome Supabase réel : 1/1, 0 échec lorsque les trois variables sont configurées.

## Hors MVP / Phase 2

Paiement/escrow, ledger, signature électronique, contrats exécutoires, garanties et litiges complets, sous-traitance, OCE et IA avancée.

## Prochaine étape

Après validation VPS finale : frontend MVP vertical `Client → publication → Artisan → offre → Client → attribution`.
