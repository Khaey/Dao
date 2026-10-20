# Spécification : opérations de retrait de la passerelle OCE (suite de #325)

Statut : **proposition, aucune modification de code ni de passerelle.** Propriétaire de la
rédaction : DAO COP (#195). Décision et exécution : propriétaire du projet + OPS (#91), car le
fichier concerné (`ops/oce-v1-gateway.py`) est dans le périmètre OPS/OCE et son déploiement passe
par le manifeste figé `ops/ops-release.json`.

## 1. Problème

Le contrat actuel (`/v1/ensure-*`, `upsert-activity`, `ensure-dependency`, `calculate-planning`,
`planning-summary`) sait créer et modifier, jamais retirer. Conséquences livrées avec #325 :

1. Un lien inter-lots **confirmé est définitif** (`confirmed_link_final`, 422 `LINK_CONFIRMED_FINAL`) :
   le refuser après coup laisserait une dépendance fantôme dans OCE et fausserait le chemin critique.
2. Une **attribution annulée** ne retire pas les tâches `SL-…` déjà synchronisées.
3. Une sous-lot dont les dates disparaissent du plan reste dans OCE.

Contrainte aggravante : `verify_planning_scope` compare l'inventaire OCE à l'inventaire privé de la
passerelle (`row["activities"]`, `row["relationships"]`) et **refuse de calculer** (409
`planning_scope_contains_unmapped_*`) si les deux divergent. Un retrait fait ailleurs que par la
passerelle (par exemple à la main dans OCE) bloquerait donc le calcul. Le retrait doit passer par
la passerelle, qui met à jour son inventaire.

## 2. Opérations proposées (deux, pas de suppression générique)

| Chemin | Corps (exact, champs inconnus refusés) | Réponse |
| --- | --- | --- |
| `POST /v1/remove-dependency` | `dao_project_id`, `dao_lot_id`, `predecessor_activity_code`, `successor_activity_code` | `{ok:true, removed:bool}` |
| `POST /v1/remove-activity` | `dao_project_id`, `dao_lot_id`, `activity_code` | `{ok:true, removed:bool}` |

Pas de `remove-wbs` ni `remove-project` : la WBS d'un lot et le projet technique restent (leur
retrait relève de la révocation d'admission, déjà couverte).

### Règles (miroir de `ensure_*`)
- Même garde : `mapping_for` (couple `(projet, lot)` admis et non révoqué), verrou `StateLock`,
  validation `CODE_RE`, corps exact. Aucun chemin ni identifiant OCE fourni par l'appelant.
- **Seuls les objets de l'inventaire privé** sont retirables : l'identifiant OCE est lu dans
  `row["relationships"]` / `row["activities"]`, jamais fourni. Objet inconnu de l'inventaire →
  `removed:false` (idempotent), pas d'erreur.
- `remove-activity` est refusé en **409 `activity_has_dependencies`** si une relation de
  l'inventaire la touche ; l'appelant retire d'abord les dépendances (pas de cascade implicite).
- Ordre d'écriture : vérifier la propriété côté OCE (liste + `schedule_id` + `activity_code`, comme
  `upsert_activity`), `DELETE` côté OCE, **puis** retirer l'entrée de l'inventaire et `save_state`.
  Écriture ambiguë (`AmbiguousWrite`) : relire ; objet absent = succès, présent = 502
  `oce_write_ambiguous` (rejouable, idempotent).
- Journal : mêmes champs que les autres opérations (nom d'opération, résultat, durée, corrélation),
  sans corps ni identifiant. Une opération = un objet : aucune suppression en masse.
- `calculate-planning` reste la seule façon de recalculer ; il est rappelé après les retraits.

### Prérequis à vérifier avant toute implémentation
L'API OCE derrière la passerelle doit offrir `DELETE /api/v1/schedule/relationships/{id}` et
`DELETE /api/v1/schedule/activities/{id}` pour l'identité technique « editor ». **Je n'ai pas pu le
confirmer depuis le dépôt** (aucun appel de suppression n'existe dans la passerelle). OPS doit le
vérifier sur l'instance OCE de DEV (lecture de la spec OpenAPI, puis essai sur objet jetable de la
recette). Si l'API ne le permet pas, voir la variante B.

Variante B (si pas de DELETE) : reconstruire le planning du lot depuis zéro (nouvel enregistrement
de planning, ancien archivé). Plus lourd, change les identifiants OCE, et exige un état de passerelle
`schedule_generation`. À ne choisir que si A est impossible.

## 3. Côté D.A.O (après acceptation et déploiement de la passerelle)

1. `gatewayContract.ts` : `removeActivity`, `removeDependency` (constructeurs de requêtes
   `requests.*`, parseur `responses.removal`, chemins constants ; toujours aucune méthode générique).
2. `inMemoryGateway.ts` : double avec les mêmes préconditions (`activity_has_dependencies`,
   idempotence).
3. `projectPlanSync.ts` / orchestrateur : calculer `précédemment synchronisé − plan courant`
   (déjà suivi par `oce_record_object` : code + empreinte), retirer **dépendances puis activités**,
   puis `calculatePlanning`. Une étape en échec reprend à l'étape suivante au rejeu (journal durable
   existant).
4. Base : décision de plan `withdrawn` (append-only, `seq`) pour un lien effectif ; le lien reste
   effectif tant que le retrait OCE n'est pas confirmé (`retract_pending`), puis devient `withdrawn`.
   Qui peut retirer : Client propriétaire ou gestion D.A.O, mêmes contrôles que `decide_plan_link`.
   `confirmed_link_final` disparaît seulement quand le retrait est réellement livré.
5. Annulation d'attribution d'un lot : retire les tâches `SL-…` de ce lot et les dépendances qui les
   touchent ; l'activité de synthèse du lot et la WBS restent.
6. UI : bouton « Retirer » sur un lien confirmé avec état « retrait en cours », jamais de retrait
   optimiste.

## 4. Sécurité et confidentialité
- Aucun nouveau privilège : même socket Unix, même uid pair, même identité technique OCE ; aucune
  opération root, VPS, Cloudflare ou secret.
- Un retrait ne peut viser que l'inventaire du couple admis ; révoquer l'admission empêche tout
  retrait (403). Aucune fuite inter-lots : le corps contient exactement un couple et des codes.
- Aucun contenu métier (noms, prix, offres) ne transite : seulement des codes stables.
- Risque principal : retrait par erreur d'un objet légitime. Atténuation : une opération = un
  objet, ordre imposé (dépendances d'abord), rejeu idempotent, décision D.A.O append-only et
  journalisée avant l'appel.

## 5. Tests exigés
- Passerelle (`scripts/tests/test_oce_gateway.py`) : retrait nominal, idempotence, objet inconnu,
  couple non admis (403), activité avec dépendances (409), écriture ambiguë puis relecture,
  inventaire cohérent après retrait (`verify_planning_scope` passe), corps avec champ inconnu.
- D.A.O unitaires (`oce-project-plan.test.ts`) : diff de retrait, ordre dépendances→activités,
  reprise après échec partiel.
- SQL (`project-plan-contract.sql`) : `withdrawn`, `retract_pending`, droits, append-only.
- Recette DEV (`run-global`, ≥3 lots, ≥2 dépendances inter-lots) : retirer f2 → chemin critique
  recalculé et différent ; annuler une attribution → tâches retirées ; rejouer → aucun changement ;
  nettoyage et révocation inchangés.
- E2E : le lien retiré disparaît du graphe et ne participe plus au chemin critique.

## 6. Déploiement et gates
Modification de `ops/oce-v1-gateway.py` ⇒ nouveau SHA-256 dans `ops/ops-release.json`, CI verte,
puis admission propriétaire sur #91 comme pour tout fichier OPS. Les migrations D.A.O restent
additives. Ordre : (1) passerelle + tests Python, (2) déploiement DEV par OPS, (3) contrat D.A.O +
double, (4) synchronisation + base, (5) UI, (6) recette. Rien n'est actif tant que le contrat D.A.O
n'appelle pas les nouvelles opérations ; l'état « lien définitif » reste en vigueur jusqu'à (4).

## 7. Décisions demandées
1. Propriétaire : accepter la variante A (deux opérations) ? 
2. OPS : confirmer que l'API OCE permet `DELETE` pour relations et activités (ou choisir B).
3. Propriétaire : qui peut retirer un lien confirmé (Client propriétaire + gestion D.A.O, ou gestion
   D.A.O seule) ?
4. Propriétaire : une annulation d'attribution doit-elle retirer automatiquement les tâches OCE
   (proposé : oui) ?
