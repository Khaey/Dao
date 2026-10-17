# D.A.O — PILOT 6 → PILOT 7 : passation vérifiée (17 octobre 2026)

> **DÉCISION DU PROPRIÉTAIRE : PILOT 6 termine sa session (limite de conversation). DAO PILOT 7 reprend le pilotage de D.A.O. avec autonomie continue.** Cette issue est le point de reprise canonique. Les références datées sont un snapshot : **revérifier live main, jobs, PR et commentaires** au premier tour, ne pas refaire les travaux livrés. GitHub n'ouvre pas automatiquement une session Work/Cowork.

## A. Décisions non négociables du propriétaire

1. **Vitesse, autonomie, résultat livré.** Chaque agent mandaté exécute ses opérations ordinaires de A à Z (diagnostic borné → branche → code → tests → PR → CI → fusion autorisée → vérification) **sans trois validations humaines, ni demandes “GO” à répétition**. Les checkpoints informent, ne bloquent pas. PILOT 7 supprime les obstacles, pas les étapes de sécurité. Limitations incontournables : permissions, Auth/RLS, secrets, changements métier/juridiques, migration destructive, VPS/root/Cloudflare/OCE, production, publicité du dépôt, obligations GitHub CI/ruleset.
2. **UX premium, parcours visibles en premier** : priorité DOW ; pas d'ESLint/Prettier/restructuration globale à la place de l'UX. Qualité réelle desktop 1440 et mobile 390/375, pas simplement tests verts. Pas de redesign du login rejeté (PR #191 puis revert #192).
3. **Équipe 20+ mise en pause jusqu'à décision contraire** : **DEV 20, OPT 20, Chat 20, Chat 21**. Aucun nouvel owner/mission/watchdog pour ces sessions ; les acquis restent sur GitHub. Transferts déjà décidés : DEV20→DEV2 (#187/#58) ; OPT20→COP (#126 cadrage seul) ; Chat21→Chat1 (#161 Artisan) et OPT3 (#64 Back-office). Historique fermé 20+ ne doit pas être relancé. Les tickets clos historiques #91/#112/#120/#124/#137 n'autorisent pas la réactivation du vieux propriétaire.
4. Un seul owner par périmètre, une branche par chantier ; **ne pas écraser les branches/PR des autres**. Maîtriser quota : préflight court, vérifier le bon SHA, réutiliser les tests et preuves exactes, un seul checkpoint utile, ne pas polller les CI déjà SUCCESS.

## B. Vrai main + DEV vérifiés à la passation

- Repo : https://github.com/Khaey/Dao ; **main exact `d47767f86df75fa966727d3d0e510a54b4883d3b`**, fusion [PR #197](https://github.com/Khaey/Dao/pull/197) (autonomie/CLAUDE.md/Skills, registre agents). [CI main + deploy DEV #39030069515](https://github.com/Khaey/Dao/actions/runs/39030069515) **COMPLETED/SUCCESS**, y compris backend, frontend, intégration Supabase + FULL E2E, `deploy-dev` SUCCESS ; [Monitor #39030069456](https://github.com/Khaey/Dao/actions/runs/39030069456) SUCCESS. Ne pas retenir les SHA anciens des checklists.
- **P0 transport SSH résolu réellement** : [PR #188](https://github.com/Khaey/Dao/pull/188) → [#200](https://github.com/Khaey/Dao/pull/200) → [#201](https://github.com/Khaey/Dao/pull/201) MERGED. OpenSSH natif, empreinte `DEV_SSH_HOST_FINGERPRINT` vérifiée fail-closed, fichiers privés 0700/0600. #201 réconcilie `/opt/dao/ops-incoming` OPS historique (0755) vers privé (0700) après ownership/symlink checks. Preuve [CI+deploy main #38996179929](https://github.com/Khaey/Dao/actions/runs/38996179929) SUCCESS + [status OPS lecture seule #38996686712](https://github.com/Khaey/Dao/actions/runs/38996686712) SUCCESS, service active et bonne release. **L'ancien gel #188 n'existe plus. Ne PAS redemander l'empreinte ni réauditer l'incident.**
- Notes : DAO DEV operations OPS de #91 reste un workflow distinct et les mandats root/OCE ne sont pas généralisés ; #187 reste ouvert pour protections/audit de sécurité résiduels, sans requalifier ce transport comme rouge.

## C. Organisation et missions réelles (état du registre main)

| Mission | Owner | État / première action |
| --- | --- | --- |
| **#203 — UX S2 création chantier Client** | **DAO DOW** | **Priorité produit #1.** Nouveau chantier, deux parcours Client : recherche marketplace / équipe existante. Scope `app/projects/new/page.tsx`, conflit potentiel `CollaborativeProjectForm.tsx` avec Artisan Chat1. Autonome, pas de COP PASS/BLOCK humain obligatoire ; tests/visuels/CI avant sa propre livraison. |
| **#198 — UX S1 Mes chantiers/détail/revue DAO** | **DAO DOW** | **LIVRÉE** PR #202 → main `aae746d233b207c3fc0b197ebb3cd667a9ca547f`, [CI+DEV #38997924909](https://github.com/Khaey/Dao/actions/runs/38997924909) SUCCESS. COP a ensuite **vraiment testé 1440/390/375** et constaté **un seul défaut UX précis à corriger** : labels du « Parcours du dossier » coupés en milieu de mot à 375/390 dans `ProjectUi.tsx` (cf. commentaire #6233558974). Régression mineure à router à DOW sans bloquer S2. Éviter de redévelopper S1. |
| **#193 — performance frontend générique** | DOW | **Pause au profit de UX #203** ; ne pas relancer un chantier ESLint/refactor général. |
| **#194 — CI/E2E** | **DAO TOW** | Tests/optimisation mesurée, ne pas diminuer E2E/Auth/RLS, ne pas relancer en doublon #85 déjà mesuré. |
| **#195 et #126** | **DAO COP** | Conseil technique indépendant, S0 Paramètres globaux **lecture seule**, analyse architecture/sécurité ; **COP n'est PAS approbateur UX obligatoire de DOW**. Aucune implémentation globale #126 autorisée. |
| **#115 / #64** | **DAO OPT 3** | Reprise recettes authentifiées Client/Artisan/Admin/Gestionnaire, reliquat Gestionnaire seul, Admin, clés techniques, historique ; ne pas refaire revue DAO historique PASS. Le titre ancien « OPT 2 » #115 est dépassé : registre = OPT3. |
| **#165 — Paramètres personnels 4 rôles** | **DAO OPT 3** | WIP préexistant sur branche `chore/opt3-165-personal-settings-s1` commit `a8dcee236274d4a214280bcd316ba3e63bfcf2b4` ; build/TS PASS, 80 tests découverts, E2E nouveaux **UNTESTED**. **La PR #182 (ancien onboarding OPT3) est maintenant obsolète en partie : #197 fusionnée enregistre déjà #115/#165/#64 sur main**. Vérifier/réconcilier avant fermer #182 ; permettre à OPT3 de finir la vraie PR fonctionnelle, sans recommencer WIP. |
| **#161 Artisan C/D et lot B / PR #185** | **DAO Chat 1** | Chat21 suspendu. Lots fonctionnels déjà livrés à ne pas refaire, #185 **DRAFT UI seule** : n'exposer aucune donnée média privée avant gates backend/RLS/privacy, ne pas contourner SQL bloquée. Chat1 peut réaliser contrôles Supabase DEV SELECT-only avec ses habilitations existantes. |
| **#58 OCE intégration** | **DAO DEV 2** | Successeur de DEV20, aucun démarrage/bascule OCE, changement :8080/root/Cloudflare sans gates Access/VPS explicites. |
| **#187 sécurité résiduelle** | **DAO DEV 2** / PILOT7 coordination | Transport déploiement réparé ; revoir uniquement les autres constats encore ouverts (protections GitHub/environnement, workflows OPS distincts), sans répéter Gitleaks/historique et tests PASS. DEV2 quota/sessions limités ; pas de faux travail en arrière-plan. |
| **#61 Contrats P2.2** | Owner à contrôler dans derniers checkpoints | Décisions tripartites existantes : LogicLab Tunisie envisagée/choisie pour lancement tunisien, client+prestataire puis validation DAO, signature preuve encore à cadrer avant engagements juridiques. Ne pas autoriser seul des changements engageants, consulter propriétaire pour décisions légales. |
| **#175 recette régressions DEV** | PILOT7 triage et agents propriétaires | Signalisations UX/fonctionnelles du propriétaire, preuves reproductibles, ne pas les déclarer corrigées seulement parce que CI verte. |
| **#186 workflow rouge historique** | COP 1 / PILOT7 | Requalifier à partir de la CI récente verte. Ne pas reconstruire un incident clos depuis snapshots du 15 octobre. |

**Enregistrement main après #197** : DOW #193/#198/#203, TOW #194, COP #195/#126, DEV2 #58/#187, OPT3 #64/#115/#165, Chat1 #161. Watchdogs de l'équipe 20+ OFF sur missions reprises/historiques. Ne pas relancer #197.

## D. PR ouvertes et collision de branches (snapshot à revérifier)

- **#199 DRAFT** : ancien Projects Sync / registre, base très en retard sur main ; **réconcilier avec #197 déjà fusionnée** sans réassigner à des agents 20+.
- **#182 OPEN** : anciennes écritures registre OPT2→OPT3 déjà portées par #197 ; comparer diff utile puis fermer comme supersédée si aucun reste.
- **#196 OPEN** : ancienne documentation « autonomie universelle » doublonne #197 ; **éviter fusion brute** (ancienne anomalie de `\\n` littéraux signalée) ; vérifier uniquement un delta utile.
- **#185 DRAFT** : Artisan aperçu privé, owner actuel Chat1 ; pas de merge sans confidentialité prouvée.
- **#166 et #168 DRAFT** : anciennes PR Chat20, changements partiellement déjà livrés par #172 et main ; CoPilot1 doit comparer et fermer comme supersédées **seulement si le delta utile est intégré**. Ne pas réactiver Chat20.
- **#179, #46, #34 OPEN** : anciennes passations/docs techniques ; triage différé, aucune fusion aveugle.
- **#202/#197/#201/#200/#188** : déjà MERGED. Aucun nouveau code/CI pour refaire ces livraisons.

## E. Première heure de PILOT 7 — exécution autonome

1. Vérifier `main` + derniers deux runs `DAO CI and DEV deploy` et DAO Monitor, statut DEV, PR/branches propriétaires. Si même SHA/inputs, réutiliser les passes ; pas de nouvelle CI.
2. Lire **cette issue** et `docs/ai-context/PILOT7_HANDOFF_20261017.md` (si doc versionnée), puis `AGENTS.md`, `CLAUDE.md`, `AUTONOMOUS_EXECUTION.md`, `WORK_CHECKPOINTS.md`, éventuellement Pilot5 #154 / Pilot6 #180, seulement passages pertinents.
3. **Maintenir la priorité #203 DOW** en livraison, notifier uniquement du correctif visuel mineur S1 `DossierSteps` et séparations des fichiers partagés ; **aucune triple validation**, COP avis facultatif.
4. **Débloquer OPT3 #165** (onboarding déjà présent main), mettre fin au faux blocage de la vieille PR #182 après réconciliation, puis tests E2E et propre PR Paramètres. Préserver `RoleNav` ownership.
5. **Trier les anciennes PR** #199/#182/#196/#166/#168 de manière bornée, faire converger les propriétaires existants ; ne pas jouer à « tout merger ».
6. **Prioriser la recette fonctionnelle** #115/#64/#161/#175 avec preuves PASS/FAIL/UNTESTED ; pas de nouvelle exposition médias privés, ni bascule OCE.
7. Laisser les autres agents agir de A à Z ; publier résultats et blocages authentiques. Le propriétaire ne veut ni attentes répétées, ni sessions épuisées dans le reporting.

## F. Questions seulement si réellement nécessaires

Pas de question sur GO pour code, tests, CI, PR ou UX dans scope. Une nouvelle autorisation du propriétaire est nécessaire en cas de nouveau risque réel hors mandat : sécurité/Auth/RLS, juridiques et signatures engageantes, root/OCE/Cloudflare/PROD, dépenses, ouverture dépôt ou suppression irréversible. **Maintenir le dépôt dans son état courant de visibilité ; ne pas le rendre public par défaut.** Le propriétaire a demandé d'éviter toute triple validation UX.

## G. Documents et liens

- [PILOT6 issue #180](https://github.com/Khaey/Dao/issues/180) (historique).
- [UX S2 #203](https://github.com/Khaey/Dao/issues/203), [UX S1 #198](https://github.com/Khaey/Dao/issues/198), [livraison PR #202](https://github.com/Khaey/Dao/pull/202).
- [Sécurité #187](https://github.com/Khaey/Dao/issues/187), [staging #201](https://github.com/Khaey/Dao/pull/201).
- [Registre et Skills #197](https://github.com/Khaey/Dao/pull/197).
- [Recette #115](https://github.com/Khaey/Dao/issues/115), [Paramètres #165](https://github.com/Khaey/Dao/issues/165), [Artisan #161](https://github.com/Khaey/Dao/issues/161), [OCE #58](https://github.com/Khaey/Dao/issues/58).
- [DEV/OPS #91](https://github.com/Khaey/Dao/issues/91), [back-office #64](https://github.com/Khaey/Dao/issues/64).

**PASSATION : PILOT 6 cesse la coordination active au lancement de PILOT 7. PILOT 7 devient le coordinateur unique, sans redemander une autorisation d'exécution de routine.**

_Ce snapshot correspond à l'issue canonique [#204](https://github.com/Khaey/Dao/issues/204). Toujours relire les données GitHub live._
