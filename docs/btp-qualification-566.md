# Qualification métier du référentiel BTP — #566

Ce document décrit uniquement des cas `TEST` fictifs. Il ne constitue ni une étude, ni un devis, ni une norme tunisienne.

## Matrice de couverture mesurée

| Famille | État actuel | Mesure | Limite |
|---|---|---|---|
| Maçonnerie / structure | couvert partiel | surfaces et volumes déclarés | dimensionnement structurel : étude professionnelle |
| Chapes / enduits / façades | couvert partiel | surfaces explicites | épaisseur, rendement et pertes non déduits |
| Étanchéité / toiture | brouillon V2 | surface de support | pente, système et recouvrements à confirmer |
| Plomberie / sanitaires | couvert partiel | tracés et dénombrements fournis | diamètre, pente et accessoires hors moteur |
| Électricité | brouillon V2 | points explicitement comptés | aucun dimensionnement automatique |
| Menuiseries / ouvertures | brouillon V2 | nombre d'ouvertures | dimensions et performances séparées |
| Revêtements / peinture | à enrichir | surface fournie | support et préparation à qualifier |
| Terrassement / fondations / VRD | non calculable sans étude | référence possible | sol, plans et règles locales requis |

## Scénarios rejouables

1. Villa R+1 avec seule surface construite : `insufficient_data`, aucune quantité de lot n'est inférée.
2. Villa avec longueur/largeur explicites : calcul exact, unité et étapes conservées dans le justificatif.
3. Rénovation pièce par pièce : seule la pièce mesurée est calculée ; aucune déduction depuis la surface habitable totale.
4. Multi-lots répétitifs : chaque ouvrage possède un `scopeKey` distinct, empêchant le double-comptage et permettant des révisions séparées.

Les tests associés sont dans `dao-backend/tests/btp-qualification.test.ts` et les données dans `dao-backend/tests/fixtures/btp-qualification-fixtures.ts`.

## Contrôles

Le moteur refuse les unités incompatibles, la provenance vide, les champs inconnus, les valeurs hors précision et toute formule non autorisée. Les coefficients, pertes, épaisseurs et normes ne sont jamais implicites. Les points non démontrables restent `UNTESTED` ou `requires_professional_study`.

La migration V2 #561 reste indépendante et non appliquée à DEV partagé tant que le contrôle de parité #555 n'est pas levé.
