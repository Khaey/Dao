# Espace Artisan / Entreprise — audit DEV 2

Date de reprise : 2026-10-09  
Dernière revalidation documentaire : 2026-10-15  
Issue de suivi : [#83](https://github.com/Khaey/Dao/issues/83)  
Branches historiques : `feat/artisan-space-completion`, puis `feat/artisan-workflows-v2`

## Périmètre vérifié

L’audit est parti du `main` GitHub réel, des PR ouvertes et de
`docs/ai-context/*`. Il couvre le tableau de bord Artisan / Entreprise, le
profil professionnel, Mes chantiers, les DAO disponibles, les invitations et
les offres. Les travaux Back-office #64 et OCE #58 sont exclus.

## Fonctionnel déjà livré avant les correctifs

- L’inscription Artisan / Entreprise crée un `contractor_profile` en attente de
  vérification.
- Le tableau de bord et la navigation dédiés au rôle contractor existent.
- Mes chantiers utilise les droits de membre ; un artisan invité accède au
  chantier partagé.
- Les invitations de collaboration disposent du cycle création, lien jetable,
  acceptation et envoi email.
- Les DAO publiés sont filtrés par les règles RLS du marketplace.
- Les offres gèrent brouillon, offre partielle, offre groupée, soumission,
  nouvelle version et résultat d’attribution.
- Les commandes serveur refusent déjà une offre d’un contractor non vérifié.

## Problèmes prouvés et corrections livrées

| Zone | Constat initial | Correction DEV 2 |
| --- | --- | --- |
| Profil professionnel | Les données existaient mais Mon compte n’affichait que le nom et le téléphone. | Affichage puis édition contrôlée de l’activité, du nom public, du type, des métiers, de l’expérience, de la présentation et de la disponibilité. |
| DAO disponibles | Un profil en attente, rejeté ou suspendu voyait le formulaire d’offre avant le refus serveur. | Consultation conservée, formulaire masqué et motif de blocage explicite, aligné sur la règle serveur. |
| Cartes DAO | Un brouillon était présenté comme « Offre envoyée ». | Libellé distinct selon le statut réel. |
| Offre multi-lots | La reprise d’un brouillon sélectionnait tous les lots ouverts. | Restauration depuis les seuls `bid_items` de la version chargée. |
| Mes chantiers | L’état vide était uniquement orienté Client. | Message Artisan : ajout par le client ou entrée par invitation. |
| Double rôle | Le compte ouvrait systématiquement l’espace Client. | Dernier espace Client / Artisan conservé côté serveur. |
| Invitations | Le traitement dépendait uniquement du lien reçu. | Boîte « Mes invitations » avec historique, acceptation et refus authentifiés. |
| Offres | Pas de vue globale ni de retrait d’une soumission. | « Mes offres » et retrait d’une version soumise non attribuée, avec historique immuable. |

## Décisions DAO Pilot appliquées

- Identité, activité et métiers sont les seuls changements qui relancent la
  vérification. Les suspensions restent suspendues.
- Un double rôle ouvre le dernier espace explicitement utilisé.
- « Mes invitations » liste l’historique et permet accepter/refuser après
  contrôle de l’adresse Auth confirmée, sans reconstruire ni exposer le jeton.
- « Mes offres » centralise toutes les versions et leurs résultats. Une offre
  soumise non attribuée peut être retirée entièrement sans effacer son contenu.

Les commandes restent atomiques, auditables et RPC-only pour l’acteur
authentifié. Une offre attribuée ne peut pas être retirée par ce parcours.

## Livraison et non-régression

- PR [#84](https://github.com/Khaey/Dao/pull/84) : correctifs d’interface et de
  reprise de brouillon.
- PR [#109](https://github.com/Khaey/Dao/pull/109) : décisions du second lot,
  migration `20261009103053_artisan_workflows_v2.sql`, RPC, UI, tests et
  documentation.
- Issue #83 : **fermée comme terminée** après CI, fusion, migration DEV et
  déploiement documentés.
- Revalidation du 2026-10-15 sur le `main` : les routes et accès
  `/app`, `/app/projects`, `/app/artisan`,
  `/app/artisan/offers`, `/app/artisan/profile` et
  `/app/invitations` sont toujours présents. Aucun des correctifs #83 n’a à
  être recréé.

Une prochaine intervention DEV 2 doit partir d’un défaut encore reproductible
ou d’un nouveau GO produit. Une simple formulation historique « reste à faire »
ne constitue pas une preuve de régression.

## Reprise DEV 2 — états d’erreur (#251)

La revalidation du 18/10/2026 a confirmé que les fonctions métier ci-dessus
restent livrées. Elle a en revanche reproduit un défaut transversal : une panne
de chargement sur « DAO disponibles », « Mes offres » ou « Mes invitations »
était présentée en même temps qu’un faux état vide, sans action de reprise.

Le lot #251 sépare désormais erreur et absence réelle de données, propose
« Réessayer » sur chaque écran et efface l’erreur obsolète avant le nouveau
chargement. Il ne change ni le cycle métier, ni Auth/RLS, ni le schéma SQL.
