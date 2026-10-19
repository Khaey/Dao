# Carnet d’exécution chantier — contrat P2.3

Owner issue: #289

## Périmètre déjà livré et conservé

- `projects.project_stage` et `projects.payment_status` restent le suivi global
  déclaratif piloté par `ProjectTracking.tsx` et `update_project_tracking`.
- `projects`, `project_requests`, `awards`, `award_items`, `project_members`,
  `documents`, `contracts` et leurs règles restent les sources d’autorité.
- Le carnet n’altère jamais l’attribution, le contrat, la réception, le paiement,
  la publication ou la synchronisation OCE.
- Les justificatifs sont des références contrôlées vers `documents`; aucun
  stockage ni chemin public supplémentaire n’est créé.

## Matrice d’autorisation

Les contrôles sont recalculés en base à chaque lecture et écriture. Un rôle global
ne remplace jamais une participation active au chantier.

| Acteur et contexte réel | Lire le carnet du lot | Déclarer progrès/intervention/jalon | Observer / contester | Voir un justificatif |
| --- | --- | --- | --- | --- |
| Client confirmé, membre accepté, compte actif, espace Client | Oui, sur son chantier | Non | Oui | Seulement si le RLS `documents` l’autorise |
| Artisan attributaire actif, membre accepté, compte et profil non suspendus, espace Contractor | Oui, sur ses lots attribués | Oui, sur ses lots attribués | Non | Seulement si le RLS `documents` l’autorise |
| Même utilisateur avec deux rôles | Selon `profiles.last_workspace` | Seulement en espace Contractor et s’il est attributaire | Seulement en espace Client et s’il est le Client confirmé | Selon les mêmes règles documentaires |
| Artisan accepté mais non attributaire, invité en attente, concurrent | Non | Non | Non | Aucun droit ajouté |
| Client d’un autre chantier | Non | Non | Non | Aucun droit ajouté |
| Gestionnaire / Admin sans participation métier | Non | Non | Non | Aucun droit ajouté |
| Membre révoqué, compte suspendu, profil artisan suspendu | Non | Non | Non | Aucun droit ajouté |
| Projet archivé, lot retiré, award annulé/inactif | Non | Non | Non | Aucun droit ajouté |

Un chantier est exploitable uniquement si `projects.client_id` et
`projects.confirmed_at` sont renseignés, si le Client possède toujours son
membership accepté et si le lot possède un `award_item.active = true` rattaché à
un award non annulé. L’artisan de l’award doit également posséder un membership
Contractor accepté sur ce chantier. Une attribution commerciale ne crée donc pas
à elle seule un accès au carnet.

## Modèle additif minimal

### `site_log_events`

Flux immuable par lot attribué. Chaque ligne porte `project_id`, `award_item_id`,
`request_id`, `actor_id`, l’horodatage serveur et une clé d’idempotence par
auteur. Trois types sont autorisés :

- `progress` : statut `not_started|in_progress|completed`, pourcentage `0..100`
  et motif borné obligatoire ;
- `intervention` : date de travaux, note bornée et pourcentage facultatif ;
- `milestone` : clé de flux serveur, titre, date cible facultative, statut
  `planned|in_progress|completed|cancelled` et note facultative. Chaque évolution
  ajoute une nouvelle ligne avec la même clé de flux.

Les contraintes par type empêchent les combinaisons de colonnes incohérentes.
Une progression à 100 % reste une déclaration sans effet juridique ou financier.

### `site_log_evidence`

Relation immuable entre un événement et un `documents.id` du même chantier.
L’écriture exige un document approuvé, partagé avec `project_members`, visible
par l’auteur selon la matrice existante. La lecture de la relation et du document
est réévaluée pour le lecteur; un document `owner_only` n’est jamais rendu visible
par le carnet.

### `site_client_observations`

Retour Client immuable lié à un événement : `acknowledged` ou `disputed`. Le
motif est obligatoire pour `disputed`. Cette ligne atteste uniquement une prise
de connaissance ou une observation et n’accepte ni travaux, ni réception, ni
paiement.

## Commandes et projection

- `site_execution_snapshot(project_id, before, limit)` retourne uniquement les
  lots autorisés, leur dernier état et une page d’événements; le curseur et la
  taille sont bornés.
- `record_site_progress(...)`, `record_site_intervention(...)`,
  `create_site_milestone(...)` et `update_site_milestone(...)` utilisent
  l’identité JWT, reverrouillent le projet et l’award, puis ajoutent une ligne.
- `record_site_observation(...)` est réservé au Client confirmé dans l’espace
  Client.
- La répétition exacte d’une clé d’idempotence rend le résultat déjà enregistré;
  sa réutilisation avec un autre payload est refusée.
- Les tables exposées ont RLS activé, privilèges explicites et aucune mutation
  directe pour `anon` ou `authenticated`. Les façades RPC publiques sont les
  seules voies d’écriture.

Les DTO n’exposent ni `object_path`, ni URL Storage, ni contenu de contrat, ni
offre concurrente. Les codes de type et de statut sont stables pour une future
projection OCE, mais aucune synchronisation ou opération OCE n’appartient à ce
lot.

## Transitions et invariants

- Le progrès est un journal de déclarations : toute nouvelle valeur ajoute un
  événement; une baisse ou une hausse est admise si elle est motivée, sans
  écraser l’historique.
- Un jalon passe par événements successifs. Un jalon `completed` ou `cancelled`
  est terminal; aucune réouverture implicite.
- Les interventions ne sont ni modifiées ni supprimées.
- Une observation Client ne modifie jamais l’événement observé.
- Triggers d’immutabilité : aucun `UPDATE` ou `DELETE` sur les trois tables du
  domaine, y compris avec une requête Data API authentifiée.

## Hors périmètre

Réception juridique, signature, pénalités, facturation, paiement, BOQ, mesures
certifiées, modification des contrats/awards, notification nouvelle et toute
interaction OCE/VPS restent exclus.
