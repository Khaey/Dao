# Espace Artisan / Entreprise — audit DEV 2

Date de reprise : 2026-10-09  
Issue de suivi : [#83](https://github.com/Khaey/Dao/issues/83)  
Branches : `feat/artisan-space-completion`, puis `feat/artisan-workflows-v2`
Base du lot 2 : `efe86f584343e06553157c4a121f3c270cac8cbb`

## Périmètre vérifié

L'audit part du `main` GitHub réel, des PR ouvertes et de `docs/ai-context/*`. Il couvre le tableau de bord Artisan / Entreprise, le profil professionnel, Mes chantiers, les DAO disponibles, les invitations et les offres. Les travaux Back-office #64 et OCE #58 sont exclus.

## Fonctionnel déjà livré

- L'inscription Artisan / Entreprise crée un `contractor_profile` en attente de vérification.
- Le tableau de bord et la navigation dédiés au rôle contractor existent.
- Mes chantiers utilise les droits de membre ; un artisan invité accède au chantier partagé.
- Les invitations de collaboration disposent du cycle création, lien jetable, acceptation et envoi email déjà livré.
- Les DAO publiés sont filtrés par les règles RLS du marketplace.
- Les offres gèrent brouillon, offre partielle, offre groupée, soumission, nouvelle version et résultat d'attribution.
- Les commandes serveur d'offre refusent déjà un contractor qui n'est pas `verified`.

## Problèmes prouvés et correction

| Zone | Constat sur `main` | Correction DEV 2 |
| --- | --- | --- |
| Profil professionnel | Les données existent mais Mon compte n'affiche que le nom et le téléphone. | Affichage en lecture seule de l'activité, du nom public, du type, des métiers, de l'expérience, de la présentation, de la disponibilité et des statuts. |
| DAO disponibles | Un profil en attente, rejeté ou suspendu voit le formulaire d'offre alors que le backend refuse ensuite la commande. | Consultation conservée, formulaire masqué et motif de blocage explicite ; comportement aligné sur la règle serveur existante. |
| Cartes DAO | Tout enregistrement d'offre, y compris un brouillon, est présenté comme « Offre envoyée ». | Libellé distinct par statut, dont « Brouillon ». |
| Offre multi-lots | La reprise d'un brouillon sélectionne tous les lots ouverts au lieu des seuls lots enregistrés. | Restauration des sélections à partir des `bid_items` du brouillon ou de la version chargée. |
| Mes chantiers | L'état vide parle uniquement de création de chantier, formulation orientée client. | Message contractor : ajout par le client ou entrée par invitation. |

Les scénarios E2E existants sont renforcés sans augmenter leur nombre : profil contractor en attente, distinction du brouillon et restauration d'une sélection multi-lots. Aucun changement Auth, RLS, SQL, migration ou architecture n'est introduit.

## Décisions DAO Pilot et lot 2

- Identité, activité et métiers sont les seuls changements qui relancent la
  vérification. Le lot 2 active l'édition contrôlée et conserve les suspensions.
- Un double rôle ouvre le dernier espace explicitement utilisé ; les listes du
  tableau de bord sont filtrées selon cet espace.
- « Mes invitations » liste l'historique et permet accepter/refuser après
  contrôle de l'adresse Auth confirmée, sans reconstruire ni exposer le token.
- « Mes offres » centralise toutes les versions et leurs résultats. Une offre
  soumise non attribuée peut être retirée entièrement, sans effacer son contenu.

Les commandes restent atomiques, auditables et RPC-only pour l'acteur
authentifié. Une offre attribuée ne peut pas être retirée par ce parcours.

## Validation

- `git diff --check`
- `npx tsc --noEmit`
- `npm run build` — 60 routes
- `npx playwright test --list` — 48 tests, desktop et mobile

La preuve de CI exacte, de PR et de fusion est tenue dans l'issue #83.
