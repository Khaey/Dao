# Moteur de paramètres D.A.O. (#423)

Conception validée : [spécification S0](https://github.com/Khaey/Dao/issues/423#issuecomment-6392554996),
arbitrages A1–A10 acceptés le 25/10/2026 ([#426](https://github.com/Khaey/Dao/issues/426)).

## Règles qui ne changent pas

- Une clé n'existe que dans `dao-backend/src/settings/catalog.ts`. La base en reçoit un miroir généré
  (`dao_private.setting_definitions`) ; aucune clé libre par interface, aucun JSON/SQL/JS arbitraire.
- Ajouter ou modifier une clé : éditer `catalog.ts`, incrémenter `SETTINGS_CATALOG_VERSION`, créer une
  **nouvelle** migration contenant le bloc `settings-catalog`, puis `npm run settings:sync -- <migration>`.
  Le test `settings-foundation.test.ts` échoue si la dernière migration diverge du code.
- Familles : capacité (fonction livrée autorisée ou non), valeur bornée, référentiel, choix fédéré
  (lu dans sa table d'origine, jamais écrit par le moteur). Les invariants (RLS, suspension, signature,
  devise, fiscalité, secrets) ne sont pas des paramètres.
- Le moteur ne peut que restreindre : il n'accorde jamais un droit refusé par JWT/RLS.

## Lecture (S1)

`rpc('my_effective_settings', { p_workspace, p_project_id })` renvoie en un appel :

```json
{ "catalog_version": 1, "version": 1, "workspace": "client", "project_id": null,
  "settings": { "bids.rfi": { "value": true, "state": "available", "source": "default" } } }
```

- `p_workspace` : `client`, `contractor` ou `staff`, uniquement si le rôle est détenu ; `null` = espace
  courant. Un compte double rôle est résolu dans l'espace demandé, jamais l'union.
- `p_project_id` : propriétaire ou participant (Client), participant ou soumissionnaire (Artisan),
  chantier affecté ou Admin (staff). Sinon `42501`, sans distinguer un chantier inexistant.
- `state` : `available`, `unavailable` (avec `reason` neutre : `restricted`, `not_configured`,
  `not_implemented`, `depends_on`) ou `owner_choice` (choix fédéré). `source` : `default` ou `owner`
  en S1. `owner_choice` accompagne une capacité combinée en ET avec le choix de l'Artisan.
- `version` est la clé de cache : elle change à chaque synchronisation du catalogue (et, à partir de S2,
  à chaque modification). Les commandes serveur relisent la base : une révocation est immédiate.

Les commandes métier utiliseront `dao_private.resolve_setting(key, user, workspace, project)` (interne,
non exposé). En S1 aucune commande ne l'applique encore : le comportement est inchangé.
