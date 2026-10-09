# Espace Artisan / Entreprise — audit DEV 2

Date de reprise : 2026-10-09  
Issue de suivi : [#83](https://github.com/Khaey/Dao/issues/83)  
Branche : `feat/artisan-space-completion`  
Base vérifiée : `77cd7ba74d59069f0f8c2534e258ea7c9a2cab77`

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

## Décisions métier laissées au DAO Pilot

- Définir quels changements du profil professionnel remettent un artisan vérifié au statut `pending` avant d'autoriser l'édition.
- Choisir l'espace d'arrivée par défaut d'un compte qui cumule les rôles client et contractor.
- Décider si une boîte « Mes invitations » et une vue globale « Mes offres » font partie du produit ; elles ne sont pas implicites dans les parcours actuels.
- Confirmer un éventuel retrait d'offre soumise ; le contrat actuel place `BidService.withdraw` hors MVP.

Ces décisions ne sont pas implémentées dans DEV 2 afin de ne pas inventer de nouvelle règle métier.

## Validation

- `git diff --check`
- `npx tsc --noEmit`
- `npm run build` — 57 routes
- `npx playwright test --list` — 48 tests, desktop et mobile

La preuve de CI exacte, de PR et de fusion est tenue dans l'issue #83.
