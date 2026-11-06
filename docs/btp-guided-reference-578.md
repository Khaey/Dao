# Contrat de consultation guidée BTP — #578

Owner : DEV 5. Intégration et occurrences : Coordinateur Mission 2, #577.
Base auditée : `06dc3d1dcaa2232a6b56d80ef872e0bcc80bad96`.

## Audit et couverture observée

Lecture seule du catalogue DEV le 05/11/2026 : `TN-2026.3`, version
`56110000-0000-4000-8000-000000000001`, publiée à `2026-11-05 21:20:31.825785+00`.
11 lots, 29 ouvrages, 14 modèles. Le snapshot complet passe le validateur #578.
Les mentions historiques « brouillon / PUBLISH BLOCKED » restent présentes dans
`provenance` ; elles ne remplacent pas le statut SQL de publication vérifié.
Les décomptes ci-dessous sont une observation de ce snapshot, pas une promesse
de couverture complète du métier, ni une prescription.

| Nature | Maison / villa | Appartement | Local / bureau | Projet libre |
| --- | --- | --- | --- | --- |
| Construction | 26 couverts par nature, à confirmer | Identique | Identique | Identique si nature choisie |
| Rénovation | 22 couverts par nature, à confirmer | Identique | Identique | Identique si nature choisie |
| Extension | 29 couverts par nature, à confirmer | Identique | Identique | Identique si nature choisie |
| Réparation | 9 couverts par nature, à confirmer | Identique | Identique | Identique si nature choisie |
| Petit travail | 29 consultables, sans preuve de pertinence | Identique | Identique | Identique |

« Couvert » signifie uniquement que les trois niveaux portent la nature demandée.
Les catégories Maison/Appartement/Local/Bureau n'existent pas dans ces métadonnées.
Tous les candidats correspondants restent donc **à confirmer**. Sans nature,
la consultation reste possible avec **sans preuve de pertinence**. La description
libre sert de recherche lexicale, sans classifier implicitement le projet.
`small_work` n'est assimilé ni à `repair`, ni à `other`.

| Nature | Sans modèle, non calculable ici | Modèles incomplets/incompatibles | Étude professionnelle avant métré | Confirmation professionnelle |
| --- | ---: | ---: | ---: | ---: |
| Construction | 13 | 0 | 2 | 4 |
| Rénovation | 10 | 0 | 0 | 5 |
| Extension | 15 | 0 | 2 | 5 |
| Réparation | 0 | 0 | 0 | 5 |
| Petit travail, consultation sans preuve | 15 | 0 | 2 | 5 |

Ces colonnes sont indépendantes : un ouvrage peut demander une étude et ne pas
avoir de modèle. Une confirmation professionnelle n'est pas assimilée à une
étude structurelle. Un modèle géométrique n'est jamais une validation technique.
Les 14 modèles disponibles demandent tous des dimensions avec provenance ;
aucune valeur n'est fournie par ce contrat.

Consommateurs audités :

- #543 : `assistant/referential/daoReferential.ts` aplatit la hiérarchie en items,
  conserve les IDs/codes et la provenance, mais ne transporte pas les modèles ;
  son `ProjectKind` ne contient pas `repair`. Aucun changement dans ce module.
- #560 : le parcours métrés lit `BtpCatalogSnapshot`, puis cherche les modèles
  par `workId`. `btp-takeoff-ui/presentation.ts` fournit les libellés de champs ;
  `btp-takeoff/engine.ts` fait foi pour les unités et calculs. #578 réutilise
  `expectedInputUnit`, sans second moteur de calcul.
- #571 : `btp-takeoff/v3-models.ts` contient des propositions version-agnostiques
  avec IDs de fixture ; leur présence dans le code ne prouve pas leur publication.
  Seuls les modèles du snapshot fourni sont exposés.
- #577 : la nouvelle occurrence du chantier et son rattachement à un lot réel
  appartiennent à cette mission. Le présent contrat est disponible pour son
  intégration ; cette documentation n'atteste pas une intégration réalisée.

## API pure et emploi depuis #577

Entrées/sorties : `dao-backend/src/btp-reference/guided-selection.ts`.
Validation : `guided-validation.ts`. Aucun accès DB, aucune nouvelle API ni persistance.

```ts
import { buildGuidedCatalog, suggestGuidedWorks, compareGuidedReference }
  from '../btp-reference/guided-selection.js';
import type { GuidedProjectSelection } from '../btp-reference/guided-selection.js';

// Le provider existant lit btp_catalog_snapshot(null, 'TN'), sans filtre SQL.
// published_active est une attestation du provider de confiance, pas du Client.
const catalog = buildGuidedCatalog(snapshot, { kind: 'published_active' });
const result = suggestGuidedWorks(catalog, {
  usage: 'apartment', nature: 'renovation', text: 'chape',
});
// result.groups = lot -> subLots -> works ; aucune sélection automatique.
// #577 attribue lui-même projectWorkItemId/projectLotId/projectSubLotId.
// Deux occurrences peuvent conserver exactement le même workId.
// Pour l'historique : compareGuidedReference(savedReference, catalog).
```

| Champ / option | Contrat |
| --- | --- |
| `workId` + `catalogVersion.id/code` | Identité canonique versionnée obligatoire ; ne jamais identifier un ouvrage par son libellé |
| `path.lot/subLot` | Chemin canonique obligatoire, avec IDs/codes/sources/applicabilité |
| `unit` | Code/symbole/dimension/précision du catalogue ; conserver dans l'historique |
| `lifecycle` | `active` attesté par le provider publié ; `retired` par preuve explicite ; sinon `unknown` |
| `models[]` | Modèles exacts, IDs/formules/sources/hypothèses/précision, sans choisir arbitrairement si plusieurs |
| `models[].dimensions[]` | Noms de champs, unité canonique ou `null` si inconnue, caractère requis ; jamais de valeur |
| `requiredInputs`, `measurementNote`, `sourceRef` | Préconditions descriptives et limites conservées, même sans modèle |
| `rules[]`, `dependencies[]` | Conditions/effets/explanations/sources conservés ; aucune exécution d'une DSL ni insertion automatique d'ouvrages dépendants |
| `relevance` | Preuve de nature séparée de l'usage non documenté ; `usual` est un classement éditorial, pas une obligation |
| `measurement` | `no_model`, `dimensions_required` ou `not_calculable`, avec explication |
| `professional` | `study_required`, `confirmation_required` ou `not_documented`, avec IDs de preuves ; les conditions des règles demeurent visibles |
| `nature`, `text` | Facultatifs ; recherche normalisée accents/ligatures/alias/libellés/chemin/codes |
| `includeWithoutEvidence` | Facultatif, false par défaut ; élargit la consultation sans inventer une preuve |
| `projectWorkItemId` / `projectLotId` | IDs d'occurrence et de lot réel attribués/validés par #577, distincts du catalogue |
| `projectSubLotId` | Obligatoirement présent mais nullable ; l'usage sans sous-lot ne modifie jamais `path.subLot` |
| `selection.kind = custom` | Libellé libre, unité nullable, aucune association automatique à un ouvrage canonique |

Ordre stable par code canonique (modèles/dépendances par ID), indépendant de
l'ordre du JSON. Pas de classement normatif. Un filtre vérifie la nature au lot,
au sous-lot et à l'ouvrage. Toute suggestion reste à sélectionner explicitement,
y compris piscine/facultatifs ; les règles d'exclusion ne sont pas des sélections.

Le validateur requiert un **snapshot complet d'une seule version** : pas de
filtre SQL par nature avant cette couche, car des règles pourraient référencer
des ouvrages absents. Les doublons, liens manquants, unités incompatibles et
parents/versions contradictoires sont refusés avec `GuidedCatalogError.path`.
Un snapshot sans catalogue donne `no_catalog`, un catalogue vide `empty`.
Le validateur vérifie la structure des modèles ; une formule non prise en charge
ou des dimensions absentes deviennent une limite explicite, jamais un calcul.
Les prix sont ignorés et ne sont pas exposés.

## Historique et frontière de sécurité

Sauvegarder la référence sélectionnée avec l'occurrence dans le mécanisme #577.
Lors d'une nouvelle version, `compareGuidedReference` retourne l'ancienne référence
inchangée et un candidat séparé : `current`, `reference_changed`, `version_changed`,
`retired` ou `not_in_snapshot`. **Aucune mise à jour automatique des anciennes unités,
modèles ou quantités**. Une absence ne prouve pas un retrait : elle peut venir d'un
filtre ou d'un catalogue manquant. Le code identique avec un ID différent n'est
pas remappé. Les retraits attestés se lisent via un snapshot historique et
`retiredWorkIds` explicites ; l'état inconnu reste inconnu. Aucun historique n'est
proposé comme nouvelle sélection active.

Ces helpers ne sont pas un contrôle d'autorisation. #577 doit revalider côté
serveur l'appartenance du lot/sous-lot au projet, la version/unité/modèle choisi,
les droits, la confidentialité et les liens de l'occurrence. Un Client ne peut
pas attester lui-même `published_active` ni imposer un snapshot au serveur.
Le métré reste calculé/revérifié par #548 ; les dimensions restent facultatives
pour une sélection descriptive, obligatoires pour un calcul justifié.

## Exemple issu du snapshot DEV lu, sans dimensions inventées

Projection réelle du résultat `usage=apartment, nature=renovation, text=chape` :

```json
{
  "workId": "56110000-0000-4000-8000-000000000308",
  "code": "btp_work_floor_screed_surface",
  "label": "Chape ou support de sol",
  "version": {"id": "56110000-0000-4000-8000-000000000001", "code": "TN-2026.3"},
  "path": {
    "lot": {"id": "56110000-0000-4000-8000-000000000101", "code": "btp_lot_complements"},
    "subLot": {"id": "56110000-0000-4000-8000-000000000202", "code": "btp_sub_equipment_complements"}
  },
  "unit": {"code": "m2", "symbol": "m²", "label": "Mètre carré", "dimension": "area", "decimalScale": 2},
  "lifecycle": "active",
  "relevance": {"status": "to_confirm", "nature": "covered", "usage": "not_documented"},
  "measurement": {"status": "dimensions_required"},
  "models": [{
    "id": "56110000-0000-4000-8000-000000000608",
    "dimensions": [{"name": "surface_area_m2", "unitCode": "m2", "required": true}],
    "sourceRef": "D.A.O. #561 — bibliothèque V2"
  }],
  "sourceRef": "D.A.O. #561 — surface nette confirmée"
}
```

Projection documentaire : les champs `version` et `models[].id` ci-dessus
abrègent `catalogVersion` et `models[].template.id` ; le type exporté fait foi.

## Vérifications / handoff

Tests fictifs : `npm run build && node --test dist/tests/btp-guided-reference.test.js`.
Ils couvrent les 36 couples usage/nature, recherche FR, hiérarchie, erreurs,
limites des modèles, unités, historique, retraits et occurrences distinctes.
L'exécution sur le snapshot DEV lu ne constitue ni une recette UI ni une mutation.
Les 3 gates CI et SHA de fusion seront publiés dans #578.

Revue contractuelle #577 **pending** jusqu'à présentation de sa PR : contrôler
IDs/version/unité/modèle côté serveur, occurrences distinctes, sous-lot nullable,
historique sans remapping, personnalisés sans faux lien, visibilité des limites,
et confirmation d'intégration par le Coordinateur 2. Ne pas clôturer #578 sur la
seule livraison de ces helpers.
