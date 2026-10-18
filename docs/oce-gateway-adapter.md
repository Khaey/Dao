# Adaptateur serveur D.A.O → passerelle OCE (#58, lot backend 1)

Propriétaire : DAO COP (#58). Ce lot livre **uniquement le client typé** de la passerelle privée
(`ops/oce-v1-gateway.py`) et son double de test. Aucune migration, aucune route HTTP D.A.O, aucun
appel réel : l'activation reste désactivée par défaut et dépend de gates distincts (VPS, réseau,
secrets, production).

## Principes
- La passerelle reste l'autorité (deny-by-default, admission par couple `(dao_project_id, dao_lot_id)`).
  Le client **n'a aucun jeton OCE** : il parle HTTP sur le socket Unix `/run/dao-oce-gateway/gateway.sock`
  (pair accepté = uid du runtime D.A.O). Aucun en-tête d'authentification n'est émis.
- **Pas de proxy générique** : neuf chemins constants (`/health`, `/ready`, `/v1/ensure-project`,
  `ensure-wbs`, `ensure-schedule`, `upsert-activity`, `ensure-dependency`, `calculate-planning`,
  `planning-summary`). Aucun chemin ni en-tête fournis par l'appelant.
- Validation locale identique à celle de la passerelle (UUID, `CODE_RE`, dates réelles, bornes, champs
  inconnus refusés) : une entrée invalide échoue en `invalid_request` **avant toute E/S**.
- Réponses parsées strictement (forme exacte, 1 Mio max) ; tout écart = `protocol`.
- Les identifiants OCE ne quittent jamais la passerelle ; D.A.O ne stocke que ses propres identifiants
  et les codes stables (`code` WBS, `activity_code`).

## Pannes et isolation
| Type | Cause | Retenté |
| --- | --- | --- |
| `disabled` | intégration éteinte (`DAO_OCE_ENABLED` ≠ `1`) | non, aucun réseau |
| `circuit_open` | 5 pannes consécutives, 30 s de refroidissement, 1 sonde | non |
| `unavailable` / `timeout` | socket absent, 5xx, écriture ambiguë | oui, 3 tentatives (100/200 ms) |
| `not_authorized` | 403 `mapping_not_authorized` | non |
| `conflict` | 409 (identité/propriété) | non |
| `invalid_request` / `rejected` / `protocol` | 400/411/413, autres 4xx, réponse invalide | non |

Toutes les écritures de la passerelle sont idempotentes et se réconcilient côté passerelle : rejouer
est sûr. `settleOce()` transforme tout échec en valeur : un parcours commercial D.A.O n'est jamais
interrompu par OCE.

## Configuration
`DAO_OCE_ENABLED=1` (opt-in) et `DAO_OCE_GATEWAY_SOCKET` (chemin absolu, défaut ci-dessus). Aucun secret.

## Hors lot (lots suivants)
Mapping durable + journal de synchronisation (migration en fichier, tests Auth/RLS sur base jetable),
orchestration `ensure-*`, résumé technique exposé dans D.A.O, plan d'activation de la passerelle
(Gate A non mutante). Aucune opération root/VPS/Cloudflare/secret n'est exécutée par ce lot.
