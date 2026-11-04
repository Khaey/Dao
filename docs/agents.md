# D.A.O. — Registre des agents et responsabilités

**État GitHub vérifié au 04 novembre 2026.** Coordination courante : **[PILOT 14 — #556](https://github.com/Khaey/Dao/issues/556)**. Passation complète : [PILOT 14](pilot/pilot-14-handover.md), [deux contre-audits indépendants](pilot/pilot-14-independent-reviews.md), [archives originales v1](pilot/audits/2026-11-03-second-avis-v1.md) et [v2](pilot/audits/2026-11-03-second-avis-v2.md). Historique : [PILOT 13 — #511](https://github.com/Khaey/Dao/issues/511) et [PILOT 12 — #436](https://github.com/Khaey/Dao/issues/436), **non actuels**. Les statuts ci-dessous sont un snapshot ; les issues ouvertes et sessions silencieuses **ne prouvent pas** qu'un agent exécute effectivement du travail.

## Coordination, missions ouvertes et derniers travaux clôturés

| Responsable | Mission | Statut vérifié |
| --- | --- | --- |
| **PILOT 14** | Stratégie produit, coordination des agents, arbitrages, vérification indépendante et passation officielle | [#556](https://github.com/Khaey/Dao/issues/556) **ouverte** ; rôle conservé sur décision propriétaire, ne pas réaffecter sans nouvel arbitrage |
| **DEV 5** | **P0** — métrés déterministes/révisionnés ; rebase, fusion et livraison DEV de [PR #550](https://github.com/Khaey/Dao/pull/550). Référentiel #541 déjà livré. | [#548](https://github.com/Khaey/Dao/issues/548) **OPEN**, reprise P0 demandée ; état session à confirmer. Trois gates verts sur ancien HEAD ne dispensent pas de revalidation après résolution des conflits. |
| **Coordinateur Mission 2** (Claude Code) | Administration versionnée du Référentiel BTP (six onglets, brouillons, RPC `btp_admin_*`) | [#547](https://github.com/Khaey/Dao/issues/547) **CLOSED**, DEV documenté ; disponible pour nouveau mandat **uniquement si session relancée**, sans reprendre #548/#555. |
| **Coordinateur Mission 1** (Claude Code) | Assistant BTP déterministe (règles), création de chantier et correction en langage naturel | [#543](https://github.com/Khaey/Dao/issues/543) **CLOSED**, livré/recetté DEV ; pas de LLM génératif. |
| **Coordinateur Mission 1** (Claude Code) | Base de prix sourcés et estimation non contractuelle `/app/projects/[id]/estimate` | [#551](https://github.com/Khaey/Dao/issues/551) **CLOSED**, DEV documenté, **0 prix réel vérifié** au snapshot ; disponible sous réserve de reprise de session. |

| **OPT 4** | **P0** — audit et parité du schéma Git ↔ Supabase DEV, notamment privilèges Vault, sans intervention PROD | [#555](https://github.com/Khaey/Dao/issues/555) **OPEN**, affectation inscrite ; **session non confirmée**, audit initial en lecture seule. |

Les sujets encore ouverts mais **non automatiquement affectés** incluent [#523](https://github.com/Khaey/Dao/issues/523) (annulations **REPORTÉES**), [#505](https://github.com/Khaey/Dao/issues/505) (architecture connecteurs), [#383](https://github.com/Khaey/Dao/issues/383) (signature à qualifier), [#507](https://github.com/Khaey/Dao/issues/507) (escrow/étude), [#395](https://github.com/Khaey/Dao/issues/395) (annuaire réel), [#396](https://github.com/Khaey/Dao/issues/396) (fixtures), [#299](https://github.com/Khaey/Dao/issues/299) (idées). [#175](https://github.com/Khaey/Dao/issues/175) est **CLOSED** (recette transactionnelle 14 étapes documentée). Une issue créée n'autorise aucune session supplémentaire sans décision explicite.

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
| PILOT 1 à 13 | Remplacés par PILOT 14 [#556](https://github.com/Khaey/Dao/issues/556) ; [#511](https://github.com/Khaey/Dao/issues/511), [#436](https://github.com/Khaey/Dao/issues/436) et [#204](https://github.com/Khaey/Dao/issues/204) sont historiques, pas le canal de coordination actuel. |

## Règles d'exécution

- **Un chantier = un seul owner responsable de bout en bout** : backend, UI, tests, PR, fusion après les gates requis, déploiement DEV et recette ; une aide extérieure ponctuelle n'ouvre pas un second owner. [#515](https://github.com/Khaey/Dao/issues/515) est l'exemple de consolidation.
- **Autonomie sans GO répétitif** dans le périmètre déjà autorisé. Une attente CI, un commit local, une PR ouverte ou une absence de clé d'un fournisseur ne justifient pas d'arrêter les autres étapes. En revanche, **ne pas fusionner avec gates rouges** ni inventer un résultat.
- Chaque PR a une issue propriétaire `Owner issue: #N` pour le Monitor, et l'agent s'enregistre si nécessaire dans `.github/dao-monitor-agents.json`. **Monitor/Télégram PAUSED ne bloque pas les PR ou les déploiements**, conformément au périmètre autorisé.
- **Trois gates indispensables** : `backend-verify`, `frontend-build`, `Fresh schema, real Supabase integration, and FULL E2E`. Après fusion, vérifier **`deploy-dev` réellement SUCCESS** et la recette utile ; ne pas confondre E2E simulée et véritable test fournisseur.
- **Droits/secrets/effets réels** : le centre de connexions est réservé à `dao_admin` plateforme ; aucun partage de secrets ni élargissement de JWT/RLS. Signature engageante, paiements et escrow restent verrouillés sans nouvel arbitrage du propriétaire.
- Les PR historiques [#451](https://github.com/Khaey/Dao/pull/451) et [#263](https://github.com/Khaey/Dao/pull/263) sont **signalées fermées par l'audit indépendant du 03/11** ; ne pas les annoncer comme ouvertes sans relecture GitHub. Les PR #534/#535 ont été fermées sans fusion, remplacées par #536.
- Une issue/commentaire GitHub **ne démarre pas** une session d'agent. Le propriétaire doit reprendre la session de l'agent concerné pour lancer le travail. Les checkpoints et arbitrages transverses passent désormais par **[PILOT 14 #556](https://github.com/Khaey/Dao/issues/556)** et par les issues propriétaires.

## Sources de travail

- Dépôt : `Khaey/Dao`, branche `main`. Lire [`CLAUDE.md`](../CLAUDE.md), ce registre, [passation PILOT 14](pilot/pilot-14-handover.md), [contre-audits](pilot/pilot-14-independent-reviews.md), [`decisions.md`](decisions.md), [`architecture.md`](architecture.md) et [`WORK_CHECKPOINTS.md`](ai-context/WORK_CHECKPOINTS.md).
- Spécification Settings S0 et recoupement des candidats : [#423 — S0](https://github.com/Khaey/Dao/issues/423#issuecomment-6392554996) et [#423 — annexe](https://github.com/Khaey/Dao/issues/423#issuecomment-6392555206), résumé [`settings-engine.md`](product/settings-engine.md).
