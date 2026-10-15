<!-- Canonical handoff: https://github.com/Khaey/Dao/issues/180 -->
<!-- Snapshot only. Never infer present CI/OPS statuses from this file. -->

# DAO Pilot 6 — Passation opérationnelle depuis Pilot 5

> **Handoff daté : 15 octobre 2026 (Europe/Paris)**. Ce document est un snapshot, pas une preuve temps réel permanente. **Source de vérité : le vrai `main`, CI/deploy exact SHA, PR ouvertes, puis issues et derniers checkpoints de leurs owners.** Le propriétaire autorise la préparation de Pilot 6, pas une fusion forcée ni une opération OPS dangereuse.

## 1. Démarrage obligatoire de Pilot 6

1. Lire **cette issue**, [Pilot 5 #154](https://github.com/Khaey/Dao/issues/154) et ses derniers commentaires, `AGENTS.md`, `docs/ai-context/README.md`, `AUTONOMOUS_EXECUTION.md` et la passation GitHub versionnée `docs/ai-context/PILOT6_HANDOFF_20261015.md` **si déjà fusionnée**.
2. Contrôler `refs/heads/main`, dernières CI **sur ce SHA**, statut du job `deploy-dev`, PR ouvertes, fiches #175/#161/#58/#91/#178/#115. **Ne pas rejouer tests ou migrations sur un SHA déjà validé** sans changement réel.
3. Maintenir 1 owner par issue et 1 branche par PR ; ne pas pousser sur les branches des autres agents. Un commentaire, ticket ou nouveau nom ne démarre **jamais** une session ChatGPT Work.
4. Donner des checkpoints GitHub courts et fondés : HEAD, tests, livraison/limites, prochaine action. Ne pas promettre de travail asynchrone ou un accès VPS si absent.

## 2. État technique vérifié au transfert

- Dépôt privé : [Khaey/Dao](https://github.com/Khaey/Dao), tableau [Projects #3](https://github.com/users/Khaey/projects/3/views/1).
- **Main vérifié : `ba76a581c63f371796dedce65589819fd2d7ad48`** (merge P2.2-C / PR #176).
- [CI/main/deploy #38655942639](https://github.com/Khaey/Dao/actions/runs/38655942639) **COMPLETED/SUCCESS** à ce SHA (backend, frontend, schéma frais, intégration Supabase, E2E **64/64**, deploy-dev). Cela **ne prouve pas** l'absence de régression manuelle Client.
- Déploiement applicatif depuis dépôt privé réparé via PR #153 ; **ne pas confondre** avec l'installation du contrôleur root OPS. [PR #150](https://github.com/Khaey/Dao/pull/150) a été fusionnée, mais son code source sur main **n'est pas une preuve** que le contrôleur root est installé, que le credential privé est provisionné, ou que `oce-gateway-apply` a réussi.
- Synchronisation automatique du [Command Center](https://github.com/users/Khaey/projects/3/views/1) via PR #167 / workflow DAO Projects Sync, secret `DAO_PROJECTS_TOKEN` déjà configuré et premier cycle réel réussi ; attention expiration/rotation du PAT, **ne jamais demander sa valeur dans le chat**.
- GitHub Monitor/Telegram actifs ; attribution vient du registre officiel et des PR `Owner issue: #N`, **pas de l'auteur GitHub partagé Khaey**.

## 3. PRIORITÉ 1 — régressions Client réelles #175

[Issue #175](https://github.com/Khaey/Dao/issues/175) / [PR #177](https://github.com/Khaey/Dao/pull/177) (OPEN, non déployée), HEAD contrôlé `59e24c13d66551d13c9bc69a86f95dfe1feb5373`. Le propriétaire a fourni **3 captures** et donné `Terminé, GO` sur **4 anomalies** :
1. Annuaire : message interne « Aucun professionnel actuellement publiable... » exposé au Client → wording simple.
2. Annuaire : design, espace vide et composants incohérents avec le thème Client → harmonisation responsive.
3. Chantier / Lots : boutons Modifier/Dupliquer/Retirer géants/déformés → actions compactes/alignées et accessibles.
4. Revue DAO : « Dates » non remplies mais accès/soumission possible → brouillons incomplets autorisés, **dates début ET fin exigées pour soumettre**, contrôle UI + RPC serveur, sans changement rétroactif.

La PR #177 contient des modifications UI, tests E2E et migration additive. [CI sur HEAD #38654932510](https://github.com/Khaey/Dao/actions/runs/38654932510) : **64/66 E2E PASS, 2 FAIL** desktop/mobile dans `collaboration-client-team.spec.ts:50` : ancienne fixture sans dates, bouton Soumettre désormais désactivé **correctement**. [Diagnostic exact](https://github.com/Khaey/Dao/pull/177#issuecomment-6181121134) déjà publié : **renseigner réellement les dates dans la fixture/parcours**, ne jamais réactiver la soumission sans dates, supprimer le test, réduire la couverture ou contourner le SQL. La branche est en retard sur main ; revue / correction par son owner, CI FULL sur nouveau HEAD, merge puis CI/main/deploy et **nouvelle recette manuelle propriétaire**.
**Priorité : ne pas disperser la correction Client entre plusieurs agents ; ne pas réinitialiser DEV partagé.**

## 4. Agents ACTIFS et frontières — ne plus confondre les identités

- **DAO Pilot 6** = nouveau coordinateur dès que sa session est ouverte et son registre intégré. **Pilot 5 = historique** dans #154.
- **DAO DEV 2 RESTE ACTIF** : a livré #83 Artisan, #116 Messagerie, #125 P2.2-A, #142 P2.2-B, #174 P2.2-C. Nouvelle mission [#178](https://github.com/Khaey/Dao/issues/178) **P2.2-D : consultation strictement read-only de contrats et propositions d'avenants**, pas de signature/paiement. [PR Pilot #179](https://github.com/Khaey/Dao/pull/179) pour enregistrer #178→DEV2 était **OPEN, CI FULL encore en cours** au snapshot (Monitor + Project sync réussis). Ne pas la considérer fusionnée sans contrôle.
- **DAO Chat 21 a remplacé uniquement CHAT 20** ; responsable de [#161](https://github.com/Khaey/Dao/issues/161) et [#64](https://github.com/Khaey/Dao/issues/64) ensuite. #161 **A livré** PR #164 ; **D livré DEV** PR #171 / [CI main #38653167949](https://github.com/Khaey/Dao/actions/runs/38653167949) SUCCESS ; **C [PR #172](https://github.com/Khaey/Dao/pull/172) OPEN/DRAFT**, HEAD `fdcd7c5b98ec93c809deedb5f549590f932121c2`, [CI #38654630575](https://github.com/Khaey/Dao/actions/runs/38654630575) SUCCESS mais **revue sécurité indépendante SECURITY DEFINER/JWT avant READY/merge impérative** ; **B aperçu privé owner-only NON LIVRÉ / ancien contrôle de sécurité bloquant** : ne pas contourner. PR #166/#168 sont anciens brouillons/sources de travail, éviter les merges doublons. #64 ne faire que l'audit des reliquats après #161.
- **DAO OPT 20 EST TOUJOURS ACTIF**, owner [#91](https://github.com/Khaey/Dao/issues/91) OPS transverse et étude **lecture seule** [#126](https://github.com/Khaey/Dao/issues/126). **NE PAS CRÉER OPT 21** : le propriétaire a corrigé explicitement une confusion précédente ; [PR #173](https://github.com/Khaey/Dao/pull/173) a été **fermée sans fusion**, #91 reste OPT20.
- **DAO DEV 20** responsable d'[OCE #58](https://github.com/Khaey/Dao/issues/58) et du chantier technique privé #150/root OPS distinct ; ne pas lui attribuer la stabilisation Client sans arbitrage.
- **DAO OPT 2** : [#115](https://github.com/Khaey/Dao/issues/115) audit UX/revue authentifiée restante ; PR #144 navigation responsive livrée DEV. [#165](https://github.com/Khaey/Dao/issues/165) « Paramètres personnels pour tous » distinct de #126 et uniquement selon GO S1/owner disponible.
- **DAO Chat 1** : homepage #146 / PR #170 livrée ; [#156](https://github.com/Khaey/Dao/issues/156) parcours Client, suite de recette manuelle distincte. Ne pas prétendre qu'il est automatiquement owner de #175/PR177.
- **AUD 1 arrêté**, homepage réutilisée par Chat 1, pas de nouveau chantier AUD. **Chat 20 arrêté**, historiques préservés #137.

## 5. OCE — outil type Primavera P6, avancement RÉEL

- Outil **OpenConstructionERP (OCE)**, installation OVH/VPS existante. [#45 audit architecture](https://github.com/Khaey/Dao/issues/45) CLOSED, [#54 PoC synthétique réel](https://github.com/Khaey/Dao/issues/54) CLOSED : mapping projet → lot → WBS → activités/dépendances → planning/CPM évalué.
- **[#58 intégration V1](https://github.com/Khaey/Dao/issues/58) OPEN** : adapter serveur, mapping durable `dao_project_id↔oce_project_id`, `request_id↔wbs_id`, code activité stable, retry/idempotence, summary technique. Pas de module Primavera dans l'UI, pas de production BIM/IFC/finance, aucune autorité OCE sur prix, attribution, contrat, paiement ou réception.
- **GATE OPS** : [#91](https://github.com/Khaey/Dao/issues/91) coordonné par OPT20 ; le dépôt privé a causé un blocage distinct sur contrôleur root. [PR #150](https://github.com/Khaey/Dao/pull/150) intégrée au code, mais accès root/credential installé, admissions SHA, tunnel, sauvegarde/restauration et gateway apply **NON attestés comme terminés**. Le dernier apply connu [run #38396335189](https://github.com/Khaey/Dao/actions/runs/38396335189) a **échoué** ; ne pas rejouer à l'aveugle, ni solliciter token/secret en chat, ni créer de droit root automatique.
- **Action Pilot 6** : relire les derniers checkpoints #58/#91, établir le besoin de permission/credential/revue et le chemin de bootstrap strict documenté dans `docs/ops-private-repository.md`. N'exécuter les opérations mutantes qu'après les conditions de sécurité et autorisations spécifiques. Continuer les diagnostics read-only et les travaux code indépendants.

## 6. Contrats et limites juridiques

P2.2-A/B/C livrés techniquement, **seulement modèles/accords/avenants NON engageants**. **Pas de contrat signé opposable, pas de prestataire e-sign définitivement choisi, pas de PDF exécutoire, pas de paiement/escrow**. En P2.2-D #178, lecture seule et filtrage strict des parties. Ne pas activer `signed` ou `legal_effect_enabled=true` sans lot et validation juridique explicite, preuves d'identité/mandats/clauses, et régime applicable tunisien.

## 7. PR ouvertes / collisions au snapshot

- **#179** registre #178 DEV2 : owner Pilot 5, ne pas fusionner avant [CI #38658112140](https://github.com/Khaey/Dao/actions/runs/38658112140) entièrement verte. Réconcilier main si avancé, puis vérifier Project #3.
- **#177** Client #175 : CI rouge et retard main, correction ciblée et recette prioritaire.
- **#172** Artisan C : CI FULL verte sur ancien main, **revue indépendante sécurité requise**, draft, ne pas la déclarer prête.
- **#166/#168** : anciens PR Chat20 conservés, **ne pas fusionner** en parallèle des remplaçantes.
- **#34/#46** : PR documentaires historiques très anciennes, à recadrer/fermer uniquement après comparaison de leurs changements avec main, pas de merge aveugle.

## 8. Paramètres, UX, qualité et gouvernance

- **#126 Paramètres ADMIN globaux** = étude OPT20 **sans GO développement** ; ne pas toucher aux règles RLS, devise TND, taxes, pays/MENA/finance par défaut. **#165 paramètres personnels** = lot S1 distinct déjà cadré.
- Priorité **qualité utilisateur réelle** : ne pas considérer FULL E2E vert équivalent à recette réelle. Stabiliser Client #175, puis revue Artisan/Gestionnaire/Admin avec captures, reproduction, tests négatifs, CI, smoke et confirmation utilisateur.
- **Aucune réaffectation d'agent par interprétation d'un message ambigu.** Le propriétaire a clarifié : Chat20→21 OUI, OPT20→21 NON, DEV2→3 NON. Les anciens checkpoints contraires sont supersédés. Avant nouvelle bascule, demander confirmation si nécessaire.
- Règles de sécurité permanentes : pas de secrets en Git/chat/logs ; pas de reset DEV/prod ; pas de E2E sur DB partagée ; pas de bypass RLS/SQL/permission ou des refus outil ; actions root/contractuelles sensibles nécessitent gates spécifiques. Économiser quotas, ne pas faire de polling CI en boucle sans besoin.

## 9. Ordre conseillé de la première session Pilot 6

1. **Préflight GitHub ciblé** : main/CI/deploy, PR #179/#177/#172 et checkpoints #175/#161/#58/#91/#178. Résoudre en priorité #177 sans réécrire son code.
2. **Clore les PR d'organisation après CI** (#179 si vert, éviter doublon avec mise à jour registre Pilot6).
3. Organiser **revue sécurité indépendante** #172 ; ne pas forcer le passage READY.
4. Suivre DEV2 #178, Chat21 #161 B/C puis #64, OPT2 #115, OPT20 #91/#126 et DEV20 #58, sans interrompre leurs sessions.
5. Avancer OCE uniquement dans le canal OPS borné et sur preuves. Planifier ensuite un audit fonctionnel manuel transversal et fermeture documentée de #175 quand le propriétaire valide la recette.

**Handoff publié volontairement sans inventer l'état futur des CI ouvertes.** La nouvelle session Pilot6 doit reprendre ce ticket, non demander à l'utilisateur de recopier l'historique.

