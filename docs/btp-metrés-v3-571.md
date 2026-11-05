# Métrés BTP V3 ciblés — #571

## Audit et décision

Le moteur #548 possède déjà les opérations déterministes `identity`, `multiply`
et `subtract`, les conversions exactes, la provenance, les étapes de calcul et
les révisions immuables. L’audit ne justifie donc pas de nouvel opérateur AST.
La V3 ajoute quatre modèles métier utiles, sans migration concurrente :

| Modèle | Entrées obligatoires | Formule | Sortie | Limite |
|---|---|---|---|---|
| mur net | longueur, hauteur, surface ouvertures | longueur × hauteur − ouvertures | m² | ouvertures obligatoirement mesurées |
| revêtement local | longueur, largeur du local | longueur × largeur | m² | pas de surface globale inférée |
| enduit/peinture support | longueur, hauteur du support | longueur × hauteur | m² | rendement, pertes et épaisseur exclus |
| volume connu | longueur, largeur, profondeur | produit des trois | m³ | aucune étude ou dimension structurelle déduite |

Les modèles sont proposés dans `src/btp-takeoff/v3-models.ts` et ne sont pas
publiés dans un catalogue partagé. Leur rattachement à une version de catalogue
reste conditionné par la procédure #555 et la validation de versionnement.

## Qualification

Les fixtures TEST couvrent : villa avec seule surface totale (refus), mur avec
ouvertures explicites, local de rénovation, enduit/peinture, volume connu,
ouverture excessive et unités incompatibles. Chaque résultat conserve unité,
provenance et étapes ; aucune majoration, norme, rendement ou épaisseur n’est
inventée. Les cas sans données restent `insufficient_data`.

Tests : `dao-backend/tests/btp-v3-models.test.ts`.
