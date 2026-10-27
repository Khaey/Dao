# D.A.O. — Agents, responsabilités et périmètres

État au **25 octobre 2026** (organisation fixée par le propriétaire, passation
[#436](https://github.com/Khaey/Dao/issues/436)), coordination reprise par **PILOT 13** le 27/10
([#511](https://github.com/Khaey/Dao/issues/511)). En cas d'écart, le dernier commentaire du
propriétaire ou de PILOT 13 sur #511 prime sur ce fichier ; mettre ce fichier à jour dans la PR suivante.

## Agents actifs

| Agent | Mission | Issues canoniques | Périmètre | Hors périmètre |
| --- | --- | --- | --- | --- |
| **PILOT 13** | Pilotage général, coordination, priorités, intégration (depuis le 27/10, après PILOT 12 #436) | [#511](https://github.com/Khaey/Dao/issues/511) | Triage, vérification PR/CI/déploiements DEV, conflits entre agents, ordre de fusion, checkpoints dans les issues des owners, registre de recette [#175](https://github.com/Khaey/Dao/issues/175) | Coder dans une mission qui a déjà un owner sans ordre du propriétaire |
| **Coordinateur — Mission 1** (Claude Code) | Frontend et UX du suivi natif P10 | [#419](https://github.com/Khaey/Dao/issues/419), parent [#408](https://github.com/Khaey/Dao/issues/408) | Écrans Client/Artisan/Gestionnaire du suivi natif, sous-lots officiels, formulaires « Ajouter… », dates, dépendances/jalons, Gantt, intégration des API P10/P11 dans l'interface (ex. PR #438 contrôles et réserves) | Backend/SQL du suivi (sauf coordination), Settings |
| **Coordinateur — Mission 2** (Claude Code) | Settings, droits et délégations | [#423](https://github.com/Khaey/Dao/issues/423), [#426](https://github.com/Khaey/Dao/issues/426), cadrage historique [#126](https://github.com/Khaey/Dao/issues/126) | Moteur de paramètres S1→S4 : catalogue typé, résolveur, écrans Admin, gating Client/Artisan, mandats Gestionnaire | S5 (non autorisé), activer OCE/BIM/HSE/Achats par toggle, rendre configurables RLS/signature/devise |
| **Coordinateur UX transverse** (Claude Code) | Simplification globale UX/UI (directive PILOT 12 du 26/10) : statuts et libellés vrais, entrée unique « Suivi du chantier », devis allégé, harmonisation « Chantier net » | [#387](https://github.com/Khaey/Dao/issues/387) | Libellés, compteurs, navigation et formulaires frontend des parcours Client/Artisan/Gestionnaire/Admin ; coordination avec Mission 1, UX Admin, DEV 4 et DOW | Backend, RPC, droits et persistance (DEV 4 : #485/#488/#489) ; e-mails HTML (DOW #482) |
| **UX Admin / Gestionnaire** (Claude Code) | Refonte UX/UI des espaces Admin et Gestionnaire | [#441](https://github.com/Khaey/Dao/issues/441) | Navigation staff, tableaux de bord `/app/dao`, gabarits liste/détail du back-office ([ux/admin-gestionnaire-ia.md](ux/admin-gestionnaire-ia.md)) | Règles métier, API/RLS, fichiers Settings (Mission 2) et suivi natif (Mission 1) |
| **Coordinateur — Mission 5** (Claude Code) | Dossier documentaire V2 (plans versionnés, partage par lot, revue technique) | [#456](https://github.com/Khaey/Dao/issues/456) | `components/documents/*`, onglet Documents de `projects/[id]`, API/services/migrations documentaires et tests | Composants du suivi natif (Mission 4 #455 : `NativeWorkSituations*`, `NativeExecutionLiveTable.tsx`), contrats, réception juridique |
| **DEV 3** | Backend P11 : réception technique et réserves | [#425](https://github.com/Khaey/Dao/issues/425) (P11 livré par PR #434), backend P10 [#409](https://github.com/Khaey/Dao/issues/409) (clos) | SQL, RPC, API, sécurité JWT/RLS et tests backend du suivi natif et de la réception technique | Composants React des Missions 1/2 ; réception juridique, garantie légale, paiement |

Les deux missions du coordinateur sont des **fils Claude Code distincts** ; il n'existe **aucun
agent « AUD 2 »** (libellé historique à ignorer).

## Agents historiques ou inactifs

Sauf **nouvelle affectation explicite du propriétaire**, ne pas leur attribuer de travail ni
reprendre leurs branches :

| Agent | Dernier périmètre connu | État |
| --- | --- | --- |
| COPILOT 4 / COPILOT 5 | Maquette #410, Artisan #356, précontrat UX #346, signature E1 #383 | En pause, #410 livré/archivé |
| DEV 20, OPT 20, Chat20/21 | Backlog [#395](https://github.com/Khaey/Dao/issues/395)/[#396](https://github.com/Khaey/Dao/issues/396), optimisation | Inactifs, backlog sans owner |
| DEV 1, DEV 2, OPT | Fondations P1/P2, contrats, précontrat #345, OCE #58/#301 | Historiques |
| CH2 | Multi-lots/contrats [#381](https://github.com/Khaey/Dao/issues/381) | Clos, ne pas reconstituer |
| COP #195, DOW #193, TOW #194 (Claude) | Audit, frontend/perf, E2E/CI | En pause quota |
| PILOT 1 → 12 | Coordination ([#89](https://github.com/Khaey/Dao/issues/89), [#154](https://github.com/Khaey/Dao/issues/154), [#180](https://github.com/Khaey/Dao/issues/180), [#204](https://github.com/Khaey/Dao/issues/204), [#436](https://github.com/Khaey/Dao/issues/436)) | Remplacés par PILOT 13 |

Les handoffs `docs/ai-context/PILOT*_HANDOFF_*.md` et l'en-tête historique de `AGENTS.md` décrivent
ces organisations passées ; ils ne sont pas l'état courant.

## Règles de coexistence

- **Une mission = un owner.** Personne n'édite la branche ou la PR d'un autre owner. Un besoin dans
  le périmètre d'un autre agent passe par son issue et, en cas de conflit, par PILOT 13 (#511).
- Chaque PR déclare `Owner issue: #N` sur sa propre ligne (attribution DAO Monitor, voir
  [dao-monitor.md](dao-monitor.md)). Un nouvel agent s'enregistre une fois dans
  `.github/dao-monitor-agents.json` avant sa première PR fonctionnelle.
- Contrat d'interface backend → frontend : DEV 3 publie le contrat API et la matrice de permissions
  dans son issue ; la Mission 1 le consomme sans modifier les RPC. Un nouvel écran (ex. réception)
  requiert une affectation explicite.
- Ordre de fusion Settings : S1 (#428, fusionnée) → S2/S3 (#435) → S4 (#437), chacune réalignée sur
  `main` avec les 3 gates verts sur son HEAD.
- Une issue ou un commentaire GitHub **ne démarre pas** une session d'agent ; seul le propriétaire
  lance ou reprend un fil.
- Checkpoint court sur l'issue propriétaire à chaque jalon : SHA `main`, HEAD de PR, tests/CI réels,
  changements, risque, prochaine étape. Format de reprise : [WORK_CHECKPOINTS.md](ai-context/WORK_CHECKPOINTS.md).

## Retrouver le dépôt et les documents (pour chaque nouvelle session)

- Dépôt : `Khaey/Dao`, branche par défaut `main`. Les sessions Claude Code du projet y ont accès via
  la connexion GitHub du projet ; si l'accès est refusé, le propriétaire reconnecte GitHub dans les
  réglages Claude.
- Point d'entrée : [`CLAUDE.md`](../CLAUDE.md) → ce fichier → [decisions.md](decisions.md) →
  [architecture.md](architecture.md) → [product/](product/README.md).
- Spécification Settings S0 et recoupement des 182 candidats : commentaires
  [#423](https://github.com/Khaey/Dao/issues/423#issuecomment-6392554996) et
  [#423](https://github.com/Khaey/Dao/issues/423#issuecomment-6392555206), résumé dans
  [product/settings-engine.md](product/settings-engine.md).
