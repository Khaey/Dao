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

## Configuration Admin (S2)

- Écran `/app/dao/settings` (Admin) : Fonctions, Règles & délais, Exceptions, Référentiels, Simulation,
  Historique, Règles fixes.
- Écriture unique `admin_setting_command('set'|'clear', input)` : motif obligatoire, concurrence optimiste
  (`expected_override_id`), version incrémentée, événement append-only (`dao_private.setting_events`).
- Résolution : défaut < global (verrouillé = final) < espace < compte/chantier. Pour une capacité, les
  restrictions se cumulent ; une exception positive (Admin, échéance obligatoire) ne lève qu'un défaut.
  Les modes de publication ne peuvent qu'être réduits par exception. Les valeurs sont globales et bornées.
- Application serveur sur les nouvelles actions uniquement (triggers `settings_guard` et
  `settings_upload_size`) : invitations, publications, RFI, contre-propositions, offres multi-lots, devis PDF,
  devis détaillé, sous-lots proposés, option contrat (activation seulement), accord précontractuel, taille
  des fichiers. Les constantes 7 j, 30 j, 24 h, 20 messages/min et 30 j (avis) lisent désormais le réglage.
- Erreur de restriction : `42501`, message neutre, `hint = setting_restricted:<clé>`.
- `admin_preview_settings(user, workspace, project)` : « voir comme » sans données du compte.

## Délégations Gestionnaire (S4)

- Sans mandat, un `dao_reviewer` n'a aucun droit sur les paramètres (A8). Un Administrateur accorde un mandat
  daté et révocable (`admin_delegation_command('grant_mandate'|'revoke_mandate'|'assign_account'|'unassign_account')`,
  onglet « Délégations ») : fonctions délégables uniquement (A1), actions « restreindre » et/ou « lever ses propres
  restrictions », portées compte et/ou chantier, échéance obligatoire (un an au plus), motif obligatoire.
- Périmètre (A2) : comptes du portefeuille explicite (`dao_private.staff_account_assignments`) ou chantiers affectés
  (`review_assignments`). Jamais son propre compte.
- `manager_setting_command('set'|'clear', input)` passe par le même chemin audité que l'Admin, avec `mandate_id` :
  restriction uniquement (booléen `false` ou réduction stricte des modes), échéance obligatoire de 90 jours au plus
  (A7), jamais d'exception positive (A3), jamais de modification ou de levée d'une décision Admin ou d'un autre
  Gestionnaire.
- Révocation immédiate pour les nouvelles écritures ; les restrictions déjà posées restent visibles côté Admin
  jusqu'à leur échéance. Mandats et portefeuille ne sont jamais supprimés (seule la révocation est possible).
- Lecture : `my_settings_delegation()` (mandats, portefeuille, chantiers, restrictions posées) ; simulation
  `manager_preview_settings` limitée au périmètre. Écran `/app/dao/settings` (« Mes délégations ») visible seulement
  avec un mandat actif.
