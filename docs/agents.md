# D.A.O. — Registre des agents et responsabilités

**État vérifié au 28 octobre 2026.** Coordination courante : **[PILOT 13 — #511](https://github.com/Khaey/Dao/issues/511)**. Historique de passation : [PILOT 12 — #436](https://github.com/Khaey/Dao/issues/436). Une ancienne issue ouverte ou un agent enregistré ne signifie pas que sa session est en cours d'exécution. Les décisions récentes du propriétaire dans les issues priment sur les anciennes affectations.

## Coordination et travail encore ouvert

| Responsable | Mission | Statut vérifié |
| --- | --- | --- |
| **PILOT 13** | Coordination, vérification, arbitrages et suivi | [#511](https://github.com/Khaey/Dao/issues/511) **ouverte** ; pas d'intervention simultanée sur les fichiers d'un autre owner |

Les sujets produit encore ouverts sont des **backlogs**, pas des agents automatiquement lancés : [#523](https://github.com/Khaey/Dao/issues/523) (annulation des actions), [#505](https://github.com/Khaey/Dao/issues/505) (architecture/évolutions des connecteurs), [#383](https://github.com/Khaey/Dao/issues/383) (signature électronique à qualifier), [#507](https://github.com/Khaey/Dao/issues/507) (séquestre, étude seulement), [#299](https://github.com/Khaey/Dao/issues/299) (idées) et [#175](https://github.com/Khaey/Dao/issues/175) (suivi de régressions). Ne pas lancer une nouvelle exécution à partir de ces tickets sans owner explicite.

## Missions livrées ou sorties du périmètre actif

| Agent / fil | Chantier unique de référence | Bilan vérifié / limite |
| --- | --- | --- |
| **DEV 4** | [#515](https://github.com/Khaey/Dao/issues/515), centre Intégrations & API | **Clôturé V1** : #531/#532/#536 fusionnées ; backend, écran Admin existant, secrets Supabase Vault et contrôle Dropbox Sign TEST avec états honnêtes. [CI et déploiement DEV verts](https://github.com/Khaey/Dao/actions/runs/40712384109). Le succès du test fournisseur avec un compte sandbox autorisé n'est pas attesté ; aucun effet juridique/financier LIVE. **DEV 4 était seul owner backend + frontend + recette** depuis la décision du 28/10. |
| **Coordinateur Mission 2** (Claude Code) | [#423](https://github.com/Khaey/Dao/issues/423), Settings S1–S4 | **Clôturé** : PR #428 (S1), #435 (S2/S3), #437 (S4) fusionnées. Sorti définitivement de #515 après la passation à DEV 4. S5 non autorisé. |
| **Coordinateur Mission 1** (Claude Code) | [#419](https://github.com/Khaey/Dao/issues/419), suivi natif/Gantt | **Clôturé** ; écrans, sous-lots, dates, dépendances et Gantt livrés/recettés au périmètre documenté. |
| **Coordinateur UX transversal** (Claude Code) | [#387](https://github.com/Khaey/Dao/issues/387), « Chantier net » et parcours simplifiés | **Clôturé** pour les phases 1–4 ; nouveaux changements UX uniquement sur ticket séparé. |
| **UX Admin / Gestionnaire** (Claude Code) | [#441](https://github.com/Khaey/Dao/issues/441) | **Clôturé** : navigation, listes/détails, suivi terrain. PR documentaire de clôture [#537](https://github.com/Khaey/Dao/pull/537) fusionnée. |
| **OPT 4** | [#449](https://github.com/Khaey/Dao/issues/449) (phase initiale), [#476](https://github.com/Khaey/Dao/issues/476) (phase 2) | **Archivés/clôturés**. Monitor/Télégram suspendu, cron secondaire supprimé, diagnostics livrés. Verdict OCE **ACTIVE_BLOCKED** : ne pas mettre OCE en veille sans préconditions satisfaites, aucun gain VPS causal démontré. Corrections #520/#522 livrées et clôturées. |
| **DOW** | [#482](https://github.com/Khaey/Dao/issues/482), e-mails HTML | **Clôturé pour les e-mails métier** (#484/#487). Modèles Supabase Auth versionnés en local uniquement : application sur hébergement volontairement différée par le propriétaire. |
| **Coordinateur Mission 4** (Claude Code) | [#455](https://github.com/Khaey/Dao/issues/455), situations techniques | **Clôturé** ; ne pas confondre avec réception/signature/paiement juridiques. |
| **Coordinateur Mission 5** (Claude Code) | [#456](https://github.com/Khaey/Dao/issues/456), documents chantier V2 | **Clôturé** au périmètre livré. |
| **DEV 3** | [#425](https://github.com/Khaey/Dao/issues/425), réception technique P11 | **Clôturé** ; backend natif P10 historique [#409](https://github.com/Khaey/Dao/issues/409). |

Le fil Claude Code « Coordinateur Mission 1 » et le fil « Coordinateur Mission 2 » sont distincts. Il n'existe aucun agent « AUD 2 ».

## Agents historiques / en pause

| Agent(s) | État |
| --- | --- |
| COPILOT 4/5 | En pause après #410 et travaux Artisan/contrats antérieurs ; pas de COPILOT 6 lancé. |
| DEV 1/2, DEV 20, OPT 20, CH2, OPT et Chat20/21 | Historiques, terminés ou inactifs ; aucune reprise de branche implicite. |
| COP/TOW (Claude) et anciennes sessions DOW | Historiques/en pause ; la mission DOW #482 a été clôturée séparément. |
| PILOT 1 à 12 | Remplacés par PILOT 13 [#511](https://github.com/Khaey/Dao/issues/511) ; les tickets [#204](https://github.com/Khaey/Dao/issues/204) et [#436](https://github.com/Khaey/Dao/issues/436) restent des archives, pas des canaux actifs. |

## Règles d'exécution

- **Un chantier = un seul owner responsable de bout en bout** : backend, UI, tests, PR, fusion après les gates requis, déploiement DEV et recette ; une aide extérieure ponctuelle n'ouvre pas un second owner. [#515](https://github.com/Khaey/Dao/issues/515) est l'exemple de consolidation.
- **Autonomie sans GO répétitif** dans le périmètre déjà autorisé. Une attente CI, un commit local, une PR ouverte ou une absence de clé d'un fournisseur ne justifient pas d'arrêter les autres étapes. En revanche, **ne pas fusionner avec gates rouges** ni inventer un résultat.
- Chaque PR a une issue propriétaire `Owner issue: #N` pour le Monitor, et l'agent s'enregistre si nécessaire dans `.github/dao-monitor-agents.json`. **Monitor/Télégram PAUSED ne bloque pas les PR ou les déploiements**, conformément au périmètre autorisé.
- **Trois gates indispensables** : `backend-verify`, `frontend-build`, `Fresh schema, real Supabase integration, and FULL E2E`. Après fusion, vérifier **`deploy-dev` réellement SUCCESS** et la recette utile ; ne pas confondre E2E simulée et véritable test fournisseur.
- **Droits/secrets/effets réels** : le centre de connexions est réservé à `dao_admin` plateforme ; aucun partage de secrets ni élargissement de JWT/RLS. Signature engageante, paiements et escrow restent verrouillés sans nouvel arbitrage du propriétaire.
- Les anciennes PR ouvertes [#451](https://github.com/Khaey/Dao/pull/451) (documentation Monitor, owner historique #436) et [#263](https://github.com/Khaey/Dao/pull/263) (priorités Project, owner historique #204) nécessitent une **revue propre** ; ne pas les fusionner automatiquement. Les PR #534/#535, remplacées par #536, ont été fermées sans fusion.
- Une issue/commentaire GitHub **ne démarre pas** une session d'agent. Le propriétaire doit reprendre une session s'il veut qu'un agent exécute un nouveau travail. Les checkpoints et arbitrages transverses passent par [#511](https://github.com/Khaey/Dao/issues/511).

## Sources de travail

- Dépôt : `Khaey/Dao`, branche `main`. Lire [`CLAUDE.md`](../CLAUDE.md), ce registre, [`decisions.md`](decisions.md), [`architecture.md`](architecture.md) et [`WORK_CHECKPOINTS.md`](ai-context/WORK_CHECKPOINTS.md).
- Spécification Settings S0 et recoupement des candidats : [#423 — S0](https://github.com/Khaey/Dao/issues/423#issuecomment-6392554996) et [#423 — annexe](https://github.com/Khaey/Dao/issues/423#issuecomment-6392555206), résumé [`settings-engine.md`](product/settings-engine.md).
