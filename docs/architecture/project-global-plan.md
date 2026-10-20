# Planning global du projet (#325)

D.A.O reste la source de vérité ; OCE (passerelle privée) calcule le chemin critique. Personne ne se connecte à OCE.

- **Attribution** : toujours PAR LOT (`award_items`). Les sous-lots et liens d'un Artisan (`bid_sub_lots`, `bid_sub_lot_links`) sont des propositions.
- **Effectif** : un lien FS (latence 0) n'entre dans le planning qu'après attribution des lots concernés ET confirmation du Client / de la gestion D.A.O (`project_plan_link_decisions`, append-only, dernière décision gagnante). Un lien qui fermerait une boucle est refusé (`dependency_cycle`).
- **Graphe commun** : `dao_private.project_plan_data(project)` = lots (plans de lot prêts), sous-lots datés des offres retenues, liens et états (`effective`, `awaiting_confirmation`, `unresolved`, `rejected`). Les extrémités `lot` et `official_sub_lot` se résolvent vers l'activité de lot / le sous-lot retenu qui référence le sous-lot officiel.
- **Contexte OCE** : `project_plan_contexts.context_id` joue le rôle de « lot » dans l'admission exacte `(dao_project_id, dao_lot_id)` de la passerelle ; `oce_sync_mappings` accepte un lot du projet OU son contexte. La révision du contexte (+1 par plan de lot, attribution ou décision) sert de génération d'idempotence.
- **Synchronisation** : `ProjectPlanSynchronizer` (`src/oce/projectPlanSync.ts`) → un seul graphe (WBS par lot, activité de lot `summary`, tâches par sous-lot daté, dépendances FS) via `OceOrchestrator`. Résultat (durée, codes critiques) enregistré dans `project_plan_results` si la révision est courante.
- **API / écran** : `/api/oce/project-plan` (GET graphe, POST décision ou relance) ; composant `ProjectGlobalPlan` dans l'onglet Suivi du projet.
- **Confidentialité** : lecture et décision réservées au Client propriétaire et à la gestion D.A.O ; aucun Artisan n'y accède.
