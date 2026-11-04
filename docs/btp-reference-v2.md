# Référentiel BTP V2 — #561

## État de publication

La migration `20261104130000_btp_reference_v2_takeoff_library.sql` prépare la
version `TN-2026.3` comme **brouillon** dérivé de `TN-2026.1`. La version
publiée reste inchangée. La publication de `TN-2026.3` est explicitement
bloquée jusqu'à une décision propriétaire et une recette séparée.

Cette stratégie conserve les identifiants canoniques des ouvrages existants,
préserve les métrés déjà enregistrés et permet à l'administration #547 de
réviser le brouillon avant toute exposition aux projets partagés.

## Couverture V2

Le brouillon ajoute un lot de compléments, deux sous-lots et neuf ouvrages
mesurables : façades/parements, isolation extérieure, étanchéité de toiture,
tracés vérifiés de canalisation, équipements sanitaires, points électriques,
ouvertures, chapes et déposes de surface. Les ouvrages non mesurables ou
nécessitant une étude restent référencés avec une note de confirmation
professionnelle ; aucun dimensionnement structurel, électrique ou thermique
n'est produit.

Chaque modèle expose dans `inputSchema` :

- `required` et `properties` pour générer un formulaire côté #560 ;
- `x-dao.constructionTypes` pour filtrer neuf/rénovation/extension/réparation ;
- `x-dao.support` pour décrire la provenance attendue ;
- `x-dao.professionalConfirmation` lorsque le résultat géométrique doit être
  confirmé par un professionnel.

Les neuf modèles V2 utilisent uniquement l'opération AST `identity`, déjà
supportée par #548. Ils calculent une valeur fournie et convertie ; ils
n'ajoutent aucune perte, chute, joint, recouvrement, épaisseur, rendement,
norme, prix ou durée.

## Règles de sécurité métier

- une surface, longueur ou quantité doit avoir une valeur et une provenance ;
- une rénovation ne déduit jamais une quantité à partir de la seule surface
  totale ;
- les ouvrages sensibles indiquent `professionalConfirmation` et restent
  soumis à validation métier ;
- les dépendances sont indicatives et n'inventent aucune date ni durée ;
- la formule reste dans le contrat #548 : justificatifs, conversions exactes,
  idempotence, RLS, révisions immuables et isolation par chantier.

## Frontières

Le chantier ne modifie pas l'interface #560, l'assistant #543, les prix et
l'estimation #551, l'administration #547, les métrés d'exécution ou OCE. Il
fournit uniquement les données et contrats versionnés nécessaires à leur
consommation future.

L'application de la migration sur Supabase DEV partagé est conditionnée au
verdict de parité #555, conformément à la règle de protection du chantier.
