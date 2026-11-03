# Référentiel BTP avancé (#541)

## Périmètre livré

La source de vérité est un catalogue PostgreSQL versionné, publié en lecture seule et relié aux
métiers D.A.O. existants. La version initiale `TN-2026.1` contient :

| Donnée | Contenu V1 |
| --- | ---: |
| Métiers reliés | 10 lots canoniques |
| Sous-lots | 12 |
| Ouvrages | 20 |
| Unités | 7 |
| Règles métier | 5 |
| Dépendances logiques | 5 |
| Formules de métré préparées | 5 |
| Prix publiés | 0 |

Le catalogue couvre construction, rénovation et extension. Le filtre de type de projet ne peut
que réduire le périmètre publié : par exemple une rénovation n'hérite pas des fondations ou du
terrassement, tandis qu'une extension expose les interfaces avec l'existant.

## Contrat et sécurité

- RPC : `public.btp_catalog_snapshot(p_project_type, p_country_code)` ; `SECURITY INVOKER`,
  exécutable uniquement par `authenticated` et `service_role`.
- API serveur : `GET /api/btp/catalog?project_type=renovation&country=TN` avec JWT.
- Paramètres acceptés : `project_type` et `country`, chacun au plus une fois.
- Tables publiques avec RLS ; lecture des seules versions publiées ; aucune mutation utilisateur.
- Réponse privée, cache cinq minutes et variation par en-tête `Authorization`.

Le résultat imbrique version, unités, lots, sous-lots, ouvrages, règles, dépendances, modèles de
métré et sources tarifaires. Chaque objet métier possède un code stable et une provenance.

## Métrés et estimation futures

Les modèles de métré sont des AST déterministes. Toutes les dimensions sont des entrées requises :
aucune surface, perte, ratio, durée ou quantité n'est calculée par défaut. Les ouvrages structurels
exigent explicitement des études et dimensions confirmées.

Les tables de bordereaux et de prix sont prêtes mais volontairement vides. Un futur prix devra
référencer un ouvrage et une unité, une source HTTPS, une zone, une devise, une période de validité
et une date de vérification. Une estimation sans bordereau publié applicable doit rester impossible.

## Hors périmètre

Cette livraison ne fournit ni moteur conversationnel, ni interface d'assistant, ni estimation, ni
planning automatique. Le prototype assistant antérieur à la réorientation de mission est conservé
séparément sur `wip/541-assistant-handoff` pour transmission à son futur responsable.

## Vérification

Les tests couvrent la migration complète, le contrat de schéma, RLS et grants, la hiérarchie et les
filtres, l'absence de cycle, l'absence de valeurs de métré implicites, l'absence de prix et l'API
réelle avec Auth/JWT sur Supabase jetable.
