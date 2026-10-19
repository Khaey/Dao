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

## Orchestration (lot 3, #58)

`OceOrchestrator.sync(ref, plan)` pushes one lot planning in a fixed order: project → WBS → schedule → activities → dependencies → CPM calculation. The plan is validated locally first (unique stable codes, known WBS and activity references, real dates, no self/duplicate dependency, no cycle), with no I/O on failure.

- Every write goes through the durable journal (`oce_begin_sync` / `oce_finish_sync`) with a deterministic idempotency key derived from the canonical content hash: replay is a no-op, a changed object produces a new key, a failed step is retried from where it stopped, a concurrent run is reported as `in_progress`.
- Objects are tracked by stable D.A.O codes and content hash only (`oce_object_changed` / `oce_record_object`): unchanged objects cost no gateway call.
- Failures record only the error kind/code (never message, payload or OCE identifier); the run stops at the first failure and reports it.
- `summary(ref)` is the read-only technical summary; it never writes to D.A.O data.
- Not wired to any route or scheduler yet: exposure in D.A.O follows once permissions are validated.

## Technical summary route (#58, read-only)

`GET /api/oce/planning-summary?project_id=<uuid>&lot_id=<uuid>` returns the gateway's `planning-summary` for one lot. It is **not displayed anywhere yet** and stays `503 OCE_DISABLED` until `DAO_OCE_ENABLED=1`.

- **Who may read (v1):** the Client who owns the project, and D.A.O project management (`dao_admin`, or the reviewer assigned to the project). Professionals, other members, unassigned reviewers and strangers are refused. Extending to project members is an explicit owner decision, not implied.
- **When:** only for a lot of that project, not withdrawn, in a non-archived project, whose mapping is *admitted* (`oce_summary_access`, decided by the database from the caller's JWT, live roles and account status).
- **Same refusal everywhere:** unauthorized, unknown, wrong pair, archived, withdrawn, revoked or not admitted all answer `403 FORBIDDEN`; the gateway is not called. Strict query (exactly the two UUIDs), GET only, `Cache-Control: private, no-store`.
- **Nothing sensitive:** no OCE identifier, URL, body or credential in answers or logs; no privileged client; a gateway outage answers `503 UNAVAILABLE` and affects no other D.A.O function. One gateway client per process keeps the circuit breaker state.
- Tests: `oce-planning-handler.test.ts` (handler) and `oce-summary-access-real.test.ts` (real JWT roles, admission/revocation/withdrawal/archiving/suspension).

## Déclencheur serveur automatique (#301)

D.A.O pilote, OCE calcule, D.A.O affiche : aucun compte Admin ou Client ne se connecte à OCE, l'identité technique reste dans la passerelle.

- **Source de vérité** : `oce_lot_plans` (migration `20261019130000`) — dates de début/fin du lot saisies explicitement par le Client propriétaire ou la gestion D.A.O du projet. Un plan `ready` exige les deux dates ; rien n'est inventé (une WBS, une activité, aucune dépendance).
- **Déclenchement** : `PUT /api/oce/lot-plan` avec `ready=true` enregistre via RPC (JWT utilisateur) puis lance `LotPlanSynchronizer` côté serveur (idempotent, journal durable, coalescé par lot). Un échec n'affecte jamais l'enregistrement du plan.
- **Supervision** : `GET /api/oce/lot-plan?project_id&lot_id` → état `not_requested | pending | synced | failed` (code d'erreur assaini). `POST /api/oce/lot-plan` relance (admin / relecteur assigné uniquement).
- **Extensible** : le plan est un `OcePlan` ; plannings détaillés, jalons et carnet de chantier ajoutent des WBS/activités/dépendances sans changer le déclencheur ni le contrat de la passerelle.
- **Autorisation passerelle** : l'`authorize` du lot reste une opération root distincte (hors de ce code).
