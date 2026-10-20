# Accord précontractuel V1 — P9-A1

Owner backend : DEV 2 [#345](https://github.com/Khaey/Dao/issues/345).
Owner UX : DOW [#346](https://github.com/Khaey/Dao/issues/346).

## Résultat

Après une attribution active et avant la création du contrat, le Client et
l’Artisan titulaire peuvent proposer, contre-proposer, accepter ou refuser une
version commune des conditions et du calendrier. Le parcours simple fonctionne
sans date, sous-lot ni échéancier. Les options avancées restent facultatives.

Chaque version :

- fige le vrai award, ses lots actifs, le montant TND en millimes, la version
  d’offre attribuée et les sous-lots proposés déjà existants ;
- possède un hash SHA-256 serveur et reste append-only ;
- contient uniquement des dates/durées, modalités d’exécution, mode
  d’échéancier informatif, échéances éventuelles et calendrier facultatif des
  sous-lots de l’offre attribuée ;
- porte toujours **non_engaging=true**, **legal_effect_enabled=false** et
  **contract_signed=false**.

Une contre-proposition crée une nouvelle version. Les acceptations d’une
ancienne version restent dans l’historique mais ne valent jamais pour la
nouvelle. L’état **agreed** exige une acceptation Client et une acceptation
Artisan sur le même **version_id** et le même hash.

Aucune commande ne modifie l’offre, l’attribution ou le contrat. Aucun paiement,
facture, réception, signature, dette ou mouvement financier n’est créé.

## API stable transmise à DOW

Route authentifiée : **GET|POST /api/contracts/agreements**.

### Lecture

**GET /api/contracts/agreements?award_id=<uuid>**

La réponse **{ data }** contient :

- **agreement** : null avant la première proposition, sinon
  { id, award_id, project_id, status, current_version_id, agreed_at,
  created_at, updated_at } ;
- **reference** : { award_id, project_id, currency, total_millimes, items[] }.
  Chaque item expose la ligne attribuée et ses sub_lots[], jamais une offre
  concurrente ;
- **current_version** : { id, version_no, content_hash, proposed_by,
  proposed_role, created_at, terms } ;
- **versions[]**, **acceptances[]**, **events[]** ;
- **permissions** : { party_role, can_propose, can_accept, can_reject } ;
- les drapeaux constants **non_engaging**, **legal_effect_enabled**,
  **contract_signed**.

Un tiers, concurrent, simple membre, Gestionnaire ou compte suspendu reçoit un
refus sans pouvoir déduire les conditions.

### Proposition ou contre-proposition

**POST /api/contracts/agreements**

~~~json
{
  "action": "propose",
  "award_id": "uuid",
  "base_version_id": null,
  "terms": {
    "planned_start_date": "2026-11-02",
    "duration_days": 30,
    "execution_terms": "Accès convenu à 08:00",
    "payment_mode": "weekly",
    "installments": [
      {
        "label": "Semaine 1",
        "due_date": "2026-11-09",
        "amount_millimes": 100000
      }
    ],
    "sub_lot_schedule": [
      {
        "node_key": "uuid",
        "start_date": "2026-11-02",
        "end_date": "2026-11-06",
        "duration_days": 5
      }
    ]
  },
  "idempotency_key": "uuid"
}
~~~

Pour la première version, **base_version_id** vaut null. Ensuite il doit être
exactement le **current_version.id** lu : une base obsolète renvoie un conflit.
Les modes autorisés sont **none**, **daily**, **weekly**, **monthly**,
**milestone**, **sub_lot**, **lot_end**, **project_end**. Si des échéances
chiffrées sont fournies, leur somme doit égaler le total attribué. Aucun montant
n’est inventé.

### Acceptation

~~~json
{
  "action": "accept",
  "agreement_id": "uuid",
  "version_id": "uuid",
  "idempotency_key": "uuid"
}
~~~

### Refus motivé

~~~json
{
  "action": "reject",
  "agreement_id": "uuid",
  "version_id": "uuid",
  "reason": "Date à revoir",
  "idempotency_key": "uuid"
}
~~~

## États et erreurs UX

| État | Sens |
| --- | --- |
| **negotiating** | Version courante proposée ; zéro ou une partie a accepté |
| **agreed** | Les deux parties ont accepté la même version |
| **rejected** | Une partie a refusé la version courante ; une nouvelle proposition reste possible |

Les erreurs **400** signalent une forme invalide, **403** un acteur non autorisé,
et **409** une version obsolète, une incohérence métier ou une acceptation déjà
enregistrée. DOW doit recharger le snapshot après un 409, ne jamais simuler une
acceptation locale et afficher en permanence « Conditions convenues — contrat
non signé ».

## Sécurité et concurrence

Les tables sont fermées au Data API. Seuls quatre RPC authentifiés sont exposés.
Chaque commande résout l’acteur avec **auth.uid()**, vérifie les memberships,
l’award actif et l’absence de contrat, sérialise avec le verrou projet, utilise
une clé idempotente et écrit des événements append-only. Une révision, un refus,
une acceptation ou une annulation d’award concurrente ne peut pas valider une
version périmée.
