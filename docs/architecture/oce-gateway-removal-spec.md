# Spécification : opérations de retrait de la passerelle OCE (suite de #325)

Owner issue: #325

Statut : **spécification alignée sur la décision produit du propriétaire (#325, 20/10/2026) ; aucune modification de code ni de passerelle.** Propriétaire de la
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

Variante B (seulement si OCE n'offre pas `DELETE`) : **reconstruction versionnée du planning GLOBAL du
projet**, jamais d'un lot isolé (le planning est unique, porté par le contexte `source.context_id`).
Principe : rotation du contexte global. La passerelle crée un nouveau planning technique, D.A.O y
rejoue **toutes** les WBS de lots, activités (lot et sous-lots attribués), dépendances inter-lots
effectives et le calcul ; le journal et les associations (`oce_sync_mappings`, ledger, empreintes)
sont rebasculés sur la nouvelle génération ; l'ancien planning est archivé, puis le nouveau est
déclaré « à jour » seulement après calcul réussi. Impacts : identifiants OCE changent, charge OPS
et fenêtre de reprise plus importantes, état `schedule_generation` dans la passerelle, aucune
écriture partielle visible (bascule atomique côté D.A.O). Choix : variante A si `DELETE` est
réellement supporté (plus petite option viable), B sinon, avec preuve par essai sur objets jetables.
Ne pas implémenter B avant cette preuve.

## 3. Côté D.A.O (après acceptation et déploiement de la passerelle)

1. `gatewayContract.ts` : `removeActivity`, `removeDependency` (constructeurs de requêtes
   `requests.*`, parseur `responses.removal`, chemins constants ; toujours aucune méthode générique).
2. `inMemoryGateway.ts` : double avec les mêmes préconditions (`activity_has_dependencies`,
   idempotence).
3. `projectPlanSync.ts` / orchestrateur : calculer `précédemment synchronisé − plan courant`
   (déjà suivi par `oce_record_object` : code + empreinte), retirer **dépendances puis activités**,
   puis `calculatePlanning`. Une étape en échec reprend à l'étape suivante au rejeu (journal durable
   existant).
4. Base : décisions de plan append-only (`seq`) : `replaced`/`withdrawn` d'un lien effectif, ajout
   d'un nouveau lien. Qui peut ajouter, retirer ou remplacer un lien confirmé : le Client
   propriétaire du chantier et la gestion D.A.O déjà habilitée sur ce chantier, via les contrôles
   existants de `decide_plan_link` ; **aucune extension des ACL/RLS**. L'Artisan propose seulement
   et ne modifie ni le planning effectif ni les offres d'autrui.
5. Une action métier unique « Modifier le lien » : retirer l'ancien lien, appliquer le nouveau et
   recalculer en une seule commande côté serveur (une confirmation lisible seulement pour un
   retrait pur ; aucune double confirmation pour une modification ordinaire). Commandes
   idempotentes et rejouables, sans altérer les révisions concurrentes.
6. Annulation ou réattribution **effective** d'un lot : réconciliation automatique du plan avec
   l'attribution de référence : retrait des dépendances puis des tâches `SL-…` devenues obsolètes,
   puis recalcul. L'historique commercial D.A.O n'est pas touché. Jamais de retrait d'une activité
   encore utilisée par une attribution active, ni sur une simple tentative d'annulation refusée.
7. Statuts visibles : « Mise à jour du planning… », « À réessayer » si OCE est indisponible,
   « À jour » **seulement** après synchronisation et calcul prouvés sur la nouvelle révision. Aucun
   retrait optimiste, aucune incohérence silencieuse. Le lien reste effectif tant que le retrait OCE
   n'est pas confirmé (`retract_pending`).
8. UI : depuis le Planning global, « Modifier le lien » / « Retirer le lien ». L'utilisateur ne voit
   ni codes techniques, ni WBS, ni passerelle, ni versions OCE. La mention « lien confirmé
   définitif » et `confirmed_link_final` ne disparaissent **qu'une fois la capacité de retrait
   réellement déployée et recettée** ; d'ici là le comportement livré (lien définitif) est inchangé.

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

## 7. Décisions

Tranchées par le propriétaire (#325, 20/10/2026) : souplesse et simplicité ; aucun lien irréversible
à terme ; droits de retrait = Client propriétaire + gestion D.A.O habilitée sur le chantier ;
annulation/réattribution effective réconcilie automatiquement le plan ; choix A/B laissé aux
responsables (plus petite option viable, avec preuve).

Reste **un seul prérequis ciblé, côté OPS (#91)** : vérifier sur l'instance OCE de DEV, par un
opérateur habilité et uniquement sur des objets **jetables**, que `DELETE` fonctionne pour les
relations et les activités avec l'identité technique de la passerelle (lecture de la spec OpenAPI
puis essai jetable). Toute modification de la passerelle déployée ou nouveau privilège OPS exigera
ensuite l'autorisation opérationnelle spécifique prévue ; la fusion de cette spécification ne
déploie rien.
