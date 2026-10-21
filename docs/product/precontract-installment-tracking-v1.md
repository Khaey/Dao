# Suivi informatif des échéances V1 — P9-A3

Owner backend : DEV 2 [#345](https://github.com/Khaey/Dao/issues/345).
Owner UX : DOW [#346](https://github.com/Khaey/Dao/issues/346).

## Portée

Ce contrat suit uniquement les échéances chiffrées d’une version d’accord
précontractuel acceptée par le Client et l’Artisan attributaire. Les montants,
dates et libellés sont relus depuis cette version immuable : aucune commande A3
ne peut les modifier.

Le parcours est facultatif. L’Artisan peut déclarer une somme « à présenter » ;
le Client peut la vérifier, la contester avec un motif, puis enregistrer une
autorisation après vérification. Une contestation permet une nouvelle
déclaration de l’Artisan. Une autorisation est terminale pour l’échéance et
reste une preuve déclarative.

Tous les retours portent les constantes suivantes :

- `informational_only: true` ;
- `money_moved: false` ;
- `payment_recorded: false` ;
- `debt_created: false`.

Il n’existe aucun état `paid`, facture, dette, virement, wallet, escrow ou appel
à un prestataire de paiement. `projects.payment_status` n’est ni lu ni modifié.

## API

Route authentifiée : **GET|POST `/api/contracts/installments`**.

### Lecture

`GET /api/contracts/installments?award_id=<uuid>` renvoie `{ data }` :

- `agreement_id`, `agreement_version_id`, `version_no`, `content_hash` ;
- `payment_mode`, `total_millimes`, `currency` ;
- `installments[]` avec `installment_no` (base 1), `label`, `due_date`,
  `amount_millimes`, `status`, `last_event` et les permissions `can_*` ;
- `events[]` append-only et `permissions.party_role`.

Les états exposés sont `pending`, `declared`, `verified`, `contested` et
`authorized`. La version utilisée est la plus récente ayant les deux
acceptations exactes. Une proposition plus récente encore en négociation ne
modifie pas cette référence ; dès qu’une nouvelle version est acceptée par les
deux parties, les commandes sur l’ancienne sont refusées comme obsolètes.

### Commande

~~~json
{
  "agreement_id": "uuid",
  "version_id": "uuid",
  "installment_no": 1,
  "event_type": "declared",
  "reason": null,
  "idempotency_key": "uuid"
}
~~~

Transitions autorisées :

| Acteur | Action | État requis | État produit |
| --- | --- | --- | --- |
| Artisan attributaire | `declared` | `pending` ou `contested` | `declared` |
| Client exact | `verified` | `declared` | `verified` |
| Client exact | `contested` | `declared` ou `verified` | `contested` |
| Client exact | `authorized` | `verified` | `authorized` |

`reason` est obligatoire pour `contested` et facultatif ailleurs. Chaque
commande est idempotente et sérialisée avec le verrou du chantier.

## Sécurité

L’accès est limité au Client exact et à l’utilisateur du profil Artisan de
l’attribution. Il exige un compte actif, une attribution non annulée, au moins
un lot toujours actif et un chantier non archivé. L’attribution suffit pour
l’Artisan : aucune appartenance d’équipe artificielle n’est créée. Concurrent,
tiers, ancien titulaire, compte suspendu, version non convenue et index hors
échéancier sont refusés.

La table d’événements est fermée au Data API, RLS activée et historique
append-only. Les façades authentifiées ne reçoivent jamais `actor_id`, montant,
devise ou état financier du navigateur.
