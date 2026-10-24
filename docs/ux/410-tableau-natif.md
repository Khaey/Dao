# DAO #410 — Tableau natif : maquette UX isolée

**Owner : COPILOT 4 · DTO/backend : DEV 3 (#409), et non DEV 4 · Parent #408**
**Statut : prototype React fictif, non branché aux routes de l’application ; backend N1 PR #412 fusionnée, intégration UX non effectuée.**

## Décision produit

Un seul parcours « Devis → Attribution par lot → Conditions facultatives → Suivi ». **Aucune bascule Simple/Avancé.**
Les sous-lots, dates, dépendances, jalons et échéancier sont cinq options **indépendantes et facultatives**, accessibles depuis la ligne du lot concerné. L’attribution demeure exclusivement au niveau LOT. Contrat ON/OFF est un paramètre juridique distinct, sans effet sur la visibilité de la maquette.

## Livrables

- [Composant React responsive isolé](../../dao-frontend/components/execution-native/NativeExecutionTablePrototype.tsx) : Client, Artisan, Gestionnaire, tableau à 6 colonnes et cartes mobiles, expansion des sous-lots existants, panneau contextuel des cinq options.
- [Fixtures fictives et scénarios](../../dao-frontend/components/execution-native/mock-data.ts) : entreprises et IDs fake-*, aucun compte, JWT, RPC ou donnée DEV.
- [Maquette visuelle desktop SVG](410-tableau-natif-wireframe.svg) : vue annotée, non interactive.

Le composant ne fait aucun fetch, ne change aucune donnée et ne s’importe dans aucune page existante. Les sélecteurs et l’expansion sont de **simples interactions de démonstration** ; les commandes métier sont désactivées. Le filtre Artisan de démonstration n’est **PAS un contrôle de sécurité**.

## Réutilisations réelles constatées sur main

| Composant actuel | Rôle conservé et réutilisation future |
| --- | --- |
| components/ui.tsx | Card, Badge, SectionHeading (déjà utilisés par la maquette) |
| components/precontract/AgreementPanel.tsx (#346) | Conditions par award/version, accords Client et Artisan distincts |
| components/precontract/InstallmentPanel.tsx (#346) | Échéancier informatif, jamais paiement, dette ou signature |
| components/SiteExecutionJournal.tsx et app/app/execution/[projectId]/page.tsx | Carnet des lots attribués, événements, progression, justificatifs et observations |
| components/artisan/AwardedWork.tsx (#356) | Découverte des lots actifs de l’Artisan même sans appartenance globale au chantier |
| components/ProjectGlobalPlan.tsx et components/OceLotPlanning.tsx | Dépendances/planning/OCE existants ; aucun Gantt ou CPM natif à réimplémenter |
| components/ProjectTracking.tsx | Suivi global déclaratif distinct du progrès réel de chaque lot |

**Aucun de ces composants, pages, règles, styles globaux, contrats, API ou migrations n’a été modifié.**

## Parcours annoté

1. **Devis :** le Client peut exprimer les sous-lots de sa demande ; l’Artisan peut fournir des sous-lots propres à son devis. Le sous-lot de la demande ne se confond pas avec celui du devis. Une demande n’a pas besoin de sous-lots.
2. **Attribution :** seul le lot commercial est attribué, sans casser les packages indivisibles. L’Artisan ne voit que les awards ACTIFS qui lui appartiennent ; un award ne crée aucune appartenance automatique à l’équipe du chantier.
3. **Conditions :** les sous-lots du devis gagnant deviennent une proposition de conditions, non une altération du devis. Chaque changement engageant passe par une nouvelle version acceptée par Client ET Artisan. Gestionnaire habilité : prépare/propose seulement ; jamais une acceptation au nom d’une partie.
4. **Tableau :** une ligne par lot. Les sous-lots du devis retenu sont visibles seulement sur expansion ; aucun sous-lot = suivi du lot. Colonnes : Intitulé, Titulaire, Dates renseignées, Progression déclarée, Statut, Action. N’afficher **ni 0 % ni barre** lorsque la valeur est null ; dates absentes = « Dates non renseignées ». Aucune agrégation implicite entre lots.
5. **Options directes :** sur la ligne sélectionnée, cinq commandes indépendantes « Ajouter un sous-lot / des dates / une dépendance / un jalon / un échéancier ». **Désactivées dans le prototype**, en attente des droits et API de DEV 3. Après award, un sous-lot nouveau est une **révision additive/versionnée**, non une mutation silencieuse du devis retenu.
6. **Suivi :** pourcentages et jalons restent des déclarations, distinctes de la prise de connaissance Client, contestation, validation technique, réception, contrat, dette et paiement. Reprendre le carnet existant (#346/#289) et son RLS ; ne pas inventer de nouvelles validations.
7. **Tableau / Gantt :** emplacement « Gantt (à venir) » désactivé ; il lira plus tard **le même DTO** que le tableau. Les calculs de chemin critique appartiennent toujours à OCE tant qu’une décision ultérieure ne valide pas autre chose.

### Visibilité et responsabilité

| Acteur | Lecture future | Actions futures selon permissions DTO |
| --- | --- | --- |
| Client propriétaire | Lots et détails autorisés sur son propre chantier | Proposer les options, accepter uniquement ses conditions |
| Artisan attributaire actif | Ses lots, sous-lots autorisés, dépendances externes publiables seulement | Déclarer ses progrès, proposer une révision, pas agir sur lot d’autrui |
| Gestionnaire habilité | Chantier dans le périmètre de son habilitation vérifiée | Préparer ou proposer, ne peut consentir pour Client/Artisan |
| Concurrent/Artisan révoqué/tiers | Aucun détail privé de suivi | Aucune |

## Matrice de recette **maquette uniquement**

| Scénario fictif | Attendu |
| --- | --- |
| Client multi-artisans | Atlas (Maçonnerie + Peinture), Éclair (Électricité) et Jardin ouvert |
| Artisan deux lots | Atlas voit Maçonnerie + Peinture seulement dans la simulation |
| Petit chantier détaillé | Sous-lots Fondations et Murs repliables ; Murs sans faux 0 % |
| Grand chantier sans sous-lots | Lignes simples sans expansion, pas de paramétrage requis |
| Dates seules | Dates affichées sans jalons/progression inférés |
| Échéancier sans sous-lot | 2 échéances indicatives ; aucune opération financière |
| Contrat OFF | Tableau disponible, pas de signature déclarée |
| Mobile 375 px | Cartes empilées, champs étiquetés, actions à taille accessible |
| Empty / Loading / Error | Messages spécifiques, aucun état vide trompeur |

## Intégration API en lecture — composants ajoutés après #412

**Route isolée, hors navigation principale** : `/app/native-execution/[projectId]`. Elle est client-side et transmet exclusivement le JWT de la session courante à `GET /api/projects/native-execution`, dans le périmètre filtré par le serveur. Cette route n'est pas un accès public ; 401/403/404/503 ne sont jamais remplacés par un tableau vide.

- [Client JWT paginé](../../dao-frontend/components/execution-native/read-native-plan.ts) : `getSession()`, entête Authorization, `cache:no-store`, pagination limitée, invalidation/abort, erreurs distinctes ; aucune écriture.
- [Adaptateur DTO réel](../../dao-frontend/components/execution-native/native-plan-adapter.ts) : un lot = une ligne, progression au niveau LOT ou null, sous-lots attribués seulement, source de dates explicitée, droits par lot, échéances par award (N1 ou N2).
- [Tableau live](../../dao-frontend/components/execution-native/NativeExecutionLiveTable.tsx) : aucun filtre de sécurité local, gestion A↔B sans conserver les lignes de l'ancien compte, cinq actions désactivées tant que leur API n'est pas disponible, liens vers les écrans métier existants.
- [Route de recette isolée](../../dao-frontend/app/app/native-execution/[projectId]/page.tsx) : ne modifie ni Mes chantiers ni Conditions ni Carnet ni OCE.

**États techniques** : `loading` distinct de `empty`, messages spécifiques pour 401 / 403 / 404 / 503, bouton actualiser, pas de valeur 0 inventée. Le serveur est seul garant des autorisations ; le client ne choisit pas librement un workspace. Les données métiers complètes de N2 (#413) s'intègreront par petits incréments une fois fusionnées.

**À valider avant fusion/recette complète** : `frontend-build`, `backend-verify`, FULL E2E requis sur PR et lecture navigateur Client/Artisan/Gestionnaire sur DEV si API N1/migration effectivement installées. Aucune PR ou pipeline vert n'est assimilé à une validation utilisateur.

---

## Contrat DEV 3 #409 — vérification après PR #412

Le contrat lecture V1 est maintenant livré **dans main** par [PR #412](https://github.com/Khaey/Dao/pull/412) (merge `89d9720a7e4cc3b6140aa41d770eadf907af8fac`). Source canonique : `dao-backend/src/native-tracking/contract.ts`. Le déploiement API sur DEV doit être confirmé séparément. Le prototype reste volontairement isolé et fictif.

| Données DTO réel `NativeExecutionPlanDTO` | Projection UI à construire plus tard |
| --- | --- |
| `viewer.workspace` (`client`, `contractor`, `dao_manager`) | Vue de l’acteur déduite du serveur, **jamais** du sélecteur de maquette |
| `lots[].requestId`, `requestVersionId`, `award` | Une ligne par lot ; rattachement par attribution active ; non-attribué visible uniquement si autorisé |
| `lots[].permissions` par lot | Garde d’interaction séparé des permissions de lecture, pas de dérivation du simple rôle global |
| `lots[].executionSubLots` vs `officialSubLots` | Déplier seulement les sous-lots du devis gagnant, distinguer sous-lots officiels Client |
| `lots[].progress?.percent` | Progression du LOT, nulle si inconnue, **0 % seulement si explicitement fourni** ; pas de moyenne de sous-lots |
| `lots[].dates.{proposed,agreed,plan,observed}` | Afficher la source/date avec son libellé ; aucune priorité implicite inventée entre baseline, replanification et observé |
| `lots[].modalities?.installments` | Échéances informatives par award/version ; pas d’ordre de paiement |
| `lots[].milestones`, `dependencies` | Données présentables selon RLS serveur ; dépendances externes seulement autorisées |
| `activities.supported=false`, `forecast=null` | Activités et prévision native non disponibles dans N1 ; ni faux Gantt ni faux chemin critique |

**Écart fonctionnel assumé :** le DTO de **lecture** N1 ne fournit pas encore de permissions spécifiques `can_add_sub_lot`, `can_add_dependency`, etc., ni les commandes serveur nécessaires. Les cinq boutons d’options restent désactivés. Attendre le backend d’écriture DEV 3, plutôt que transformer un booléen général `canPrepareChange` en autorisation universelle.

**Correction UX de maquette :** un lot attribué avec **contrat OFF et aucune option** est directement « Prêt à démarrer » ; « Conditions à convenir » n’est pas un passage obligatoire. Cette nuance devra être pilotée par les faits du DTO, pas par un état supposé.

## Dépendance précise DEV 3 #409

L’intégration **attend l’API N1 réellement déployée et le contrat d’écriture ultérieur de DEV 3**. Le DTO actuel de lecture est désormais disponible ; les éléments requis au-delà de N1 sont :
- Hiérarchie stable projet → lot → sous-lot du devis accepté → activité optionnelle, et identifiants source/award/version.
- Scoping serveur via JWT/RLS selon Client, Artisan award actif et Gestionnaire ; permissions can_* calculées serveur. Le filtre Client/Artisan local de la maquette est exclusivement pédagogique.
- Dates proposées vs convenues (baseline) vs recalées vs observées, progression avec origine/date ou null, dépendances intra/inter-lots dont la visibilité est autorisée.
- Version de Conditions et accords séparés, statut d’award/annulation, autorisation de proposer des révisions post-award, indicateurs financiers informatifs.
- États loading/empty/error/forbidden/unavailable sans fuite ; permissions pour ajouter chaque option indépendamment.

**Point d’insertion après DTO :** synthèse dans l’onglet Suivi existant, ou composition proche du carnet SiteExecutionJournal. Ne pas remplacer Mes chantiers, Conditions, OCE, ni créer de seconde application.

## Preuves et limites

- **PASS :** inspection ciblée de #409/#410 et des composants déjà présents sur main ; les deux fichiers React/TypeScript ont été préparés sur une branche dédiée avec des fixtures purement fictives.
- **UNTESTED :** typage complet avec les dépendances du dépôt, rendu interactif dans Next.js, capture réelle navigateur 375 px, tests JWT/RLS et CI.
- **NON EFFECTUÉ :** backend, SQL, endpoint, route utilisateur, Gantt/CPM, écriture, signature, paiement, merge ou déploiement.

Maquette destinée à la revue UX ; l’API réelle et les actions ne peuvent être intégrées qu’après remise du DTO et coordination avec DEV 3.
