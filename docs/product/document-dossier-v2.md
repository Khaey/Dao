# Dossier documentaire de chantier V2 (P15 / Mission 5)

Issue propriétaire : [#456](https://github.com/Khaey/Dao/issues/456). Migration
`20261025200000_document_dossier_v2`. Ce n'est **ni une GED complète, ni un contrat signé, ni une
réception juridique**.

## Modèle

Couche **additive** au-dessus des fichiers privés existants (`documents`, bucket `dao-private`,
URL signées après contrôle JWT). Aucun document existant n'est modifié, requalifié ou partagé.

| Objet | Rôle |
| --- | --- |
| `document_families` | Un plan ou document suivi : intitulé, catégorie **facultative** (plan, pièce technique, photo, attestation, autre), visibilité `private` / `project` / `lots`, version optimiste |
| `document_revisions` | V1, V2, V3… d'une famille ; chaque révision pointe un fichier `documents` existant ; **append-only** ; la courante est la dernière, les autres sont « Remplacé » |
| `document_family_lots` | Rattachement facultatif à un ou plusieurs lots du chantier ; jamais supprimé, révoqué avec horodatage et auteur |
| `document_dossier_events` | Historique append-only : classement, nouvelle version, modification, contrôle du fichier, revue technique, commentaires |

## Droits (revérifiés en base)

- **Classer / déposer une nouvelle version / modifier le classement** : l'auteur du fichier, encore
  participant accepté du chantier. Une nouvelle version exige la révision courante attendue
  (sinon 409 et rechargement).
- **Lire une famille** : son auteur ; le Gestionnaire affecté (`manages_project`) ; le Client
  propriétaire si la visibilité est `project` ou `lots` ; les membres acceptés si `project` ; le
  **titulaire actif** d'un lot rattaché si `lots` (award item actif, y compris sans membership, ou
  membre d'équipe affecté au lot). Révocation, annulation ou suspension coupent l'accès immédiatement.
- **Lire le fichier** d'une révision : en plus des règles existantes, uniquement après le **contrôle du
  fichier** (`status='approved'`). Un lecteur voit la dernière version contrôlée, marquée « Remplacé »
  tant que la nouvelle est en contrôle.
- **Contrôle du fichier** (sortie de quarantaine) : Gestionnaire affecté ou Admin, valider ou refuser
  avec motif. Ce n'est pas une revue du contenu. Avant cette tranche, aucun chemin réel n'existait
  (tous les documents projet de DEV étaient `quarantined`).
- Un fichier versionné ne peut plus être supprimé ni re-partagé hors de sa famille ; un fichier déjà
  partagé aux membres ne peut pas être classé avec une visibilité plus étroite.

## Revue documentaire technique (non juridique)

Statut **dérivé par révision** : `À consulter` → `En revue` → `Observations émises` (dont « Correction
demandée ») / `Revu techniquement` ; toute révision non courante est `Remplacé`. Une nouvelle version
repart « À consulter » : **un visa ancien n'est jamais réutilisé**. Actions de revue : Client
propriétaire ou Gestionnaire affecté, jamais l'auteur de la révision, uniquement sur la révision
courante et contrôlée. Tout lecteur peut commenter. Aucun effet juridique, contractuel ou financier
(`legalEffect=false` dans l'historique).

## API

- `GET /api/documents/dossier?project_id=…[&request_id=…]` → `document_dossier_v1` (filtré côté
  serveur : un titulaire de lot ne voit que les familles de ses lots).
- `POST /api/documents/dossier` : `create_family`, `add_revision`, `update_family`, `start_review`,
  `observations`, `correction_requested`, `reviewed`, `comment`, `control_file` ; clé d'idempotence
  obligatoire ; 401/403/409 neutres.
- Dépôt et téléchargement : routes existantes `/api/documents/project*` (inchangées).

## Écrans

- Onglet « Documents » du chantier (`components/documents/ProjectDocumentsTab`) : dépôt existant,
  documents non classés (bouton « Classer »), familles avec badges version/revue/contrôle, filtres
  catégorie/lot/recherche/tri, versions précédentes, historique, aperçu PDF/image par URL signée.
- Page du lot attribué `/app/execution/[projectId]` : carte « Plans et documents du lot ».

## Différé / hors périmètre

Sous-lots d'exécution, dépôt par un titulaire non membre, lien depuis le suivi natif (mini-PR
coordonnée avec M4 #455), BIM/IFC/CAO, signature, visa engageant, réception juridique, paiement.

## Retour arrière

Migration additive : désactiver l'usage en retirant l'onglet/la carte suffit ; les tables restent
(historique conservé). La politique `documents.read_allowed` peut être restaurée à sa forme
précédente (branche `document_readable_in_family` retirée) sans perte de données.
