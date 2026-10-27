# D.A.O. — Architecture actuelle et conventions

Vue courte et à jour (25/10/2026) pour démarrer une session. Les détails historiques et les
invariants approfondis restent dans [ai-context/ARCHITECTURE.md](ai-context/ARCHITECTURE.md) ;
la vue C4/Structurizr vivante est dans [architecture/](architecture/README.md)
(`workspace.dsl`, inventaire [INVENTORY.md](architecture/INVENTORY.md)).

## 1. Vue d'ensemble

```text
Navigateur ── Next.js 15 / React 19 (dao-frontend)
                 ├── pages /app/*            (espaces Client, Artisan, Gestionnaire, Admin)
                 └── Route Handlers /api/*   → adaptateur dao-backend/src/server/runtime.ts
                                               → services métier dao-backend/src/services
Supabase (Postgres + Auth + Storage) ── source de vérité ; RLS + RPC SECURITY DEFINER contrôlées
OCE (OpenConstructionERP) ── facultatif, via passerelle privée bornée ; jamais requis par le suivi natif
VPS DEV (dao-dev.logiclab.fr) ── Caddy + service dao-dev, déployé par GitHub Actions
```

- **Un seul runtime Next.js** : les Route Handlers importent l'adaptateur du backend ; les services
  ne sont pas recopiés ([DEV_DEPLOYMENT.md](../DEV_DEPLOYMENT.md)).
- Les opérations utilisateur s'exécutent avec le **JWT** reçu dans `Authorization` ; la clé secrète
  Supabase reste côté serveur (`DAO_SUPABASE_SECRET_KEY`) et n'est jamais exposée au navigateur.

## 2. Arborescence

| Chemin | Contenu |
| --- | --- |
| `dao-frontend/app/app/` | Pages applicatives : `projects`, `publications`, `artisan`, `awards`, `contracts`, `execution`, `native-execution` (Tableau/Gantt), `reviews`, `dao` (back-office/Admin), `settings`, `messages`, `notifications`, `invitations`, `profile`, `professionals` |
| `dao-frontend/app/api/` | Route Handlers (`awards`, `bids`, `contracts`, `projects`, `rfi`, `oce`, `documents`, …) |
| `dao-frontend/components/` | Composants par domaine (`client`, `artisan`, `precontract`, `contracts`, `execution-native`, `backoffice`, `rfi`, …) ; primitives dans `ui.tsx` |
| `dao-frontend/tests/` | Playwright desktop + mobile (configs `playwright*.config.ts`) |
| `dao-backend/src/services/` | Services métier (`AwardService`, `BidService`, `PrecontractAgreementService`, `Contract*Service`, …) |
| `dao-backend/src/server/` | Handlers HTTP partagés (suivi natif, sous-lots officiels, dates de lot, RFI, OCE, back-office…) et `runtime.ts` |
| `dao-backend/src/native-tracking/` | Contrat DTO du suivi natif, planning (CPM, cycles) et forecast |
| `dao-backend/src/settings/` | Catalogue typé des paramètres + synchronisation du miroir SQL |
| `dao-backend/src/oce/` | Client/orchestrateur de la passerelle OCE (facultatif) |
| `dao-backend/supabase/migrations/` | Migrations SQL horodatées `YYYYMMDDHHMMSS_nom.sql` ; `seed.sql`, `config.toml` |
| `dao-backend/tests/` | Tests unitaires, PGlite, intégration Supabase réelle |
| `ops/`, `scripts/`, `.github/workflows/` | Déploiement DEV, opérations contrôlées, CI, DAO Monitor |
| `docs/` | Documentation : ce fichier, [decisions.md](decisions.md), [agents.md](agents.md), [product/](product/README.md), `ai-context/` (historique) |

## 3. Modèle de données par domaine

| Domaine | Tables / RPC principales |
| --- | --- |
| Chantier et participation | `projects`, `project_versions`, `project_members`, invitations, `profiles` (`last_workspace`) |
| Lots | `project_requests` (+ versions), `request_sub_lots` / `request_sub_lot_versions` (sous-lots officiels Client) |
| Offres | `bids`, `bid_items` (immuables une fois soumis), lignes de devis, `bid_sub_lots` / `bid_sub_lot_links`, contre-propositions, RFI |
| Attribution | `awards`, `award_items` (`active`, `agreed_millimes`), RPC `award_bid_item_atomic` |
| Conditions et échéances | `precontract_agreements`, `precontract_agreement_versions`, `precontract_installment_events`, `native_installment_scope_*` |
| Contrats | `project_contract_settings`, `contracts`, `contract_items`, versions/parties/événements/archives |
| Planning natif | `native_execution_activities` (+ revisions, proposals, acceptances, commands), dépendances natives ; historique OCE `oce_lot_plans`, `project_plan_*` |
| Exécution | `site_log_events` (avancement, interventions, quantités/métrés), `site_client_observations`, `site_log_evidence` ; RPC `site_execution_snapshot_v2`, `record_site_*` |
| Dossier documentaire | `documents`, `document_grants`, `document_families`, `document_revisions`, `document_family_lots`, `document_dossier_events` ; RPC `document_dossier_v1`, `document_dossier_command_v1`, `document_file_control_v1` |
| Réception technique | `site_technical_inspections`, `site_technical_reserves`, leurs `*_events`, `site_technical_evidence` |
| Settings | `dao_private.setting_definitions` (miroir généré), RPC `my_effective_settings`, `dao_private.resolve_setting` |

Inventaire exhaustif des tables : [dao-backend/TABLES.md](../dao-backend/TABLES.md) (vérifier contre les migrations).

## 4. Conventions

**Sécurité**
- RLS activée sur toute table métier ; tables sensibles **fermées** et exposées via RPC contrôlées
  qui revérifient `auth.uid()`, rôle, participation, award actif, suspension et archivage.
- Erreurs d'autorisation neutres (`42501`) sans révéler l'existence d'un objet.
- Toute modification d'Auth/RLS s'accompagne de tests JWT **négatifs** (Client A/B, Artisan A/B,
  Gestionnaire habilité/non, double rôle, tiers).

**Données**
- Montants `bigint` en millimes TND ; arrondi explicite au millime.
- Versions immuables + événements append-only ; commandes avec clé d'idempotence (`command_receipt`) ;
  concurrence optimiste (version/horodatage) sur les objets éditables.
- Migrations **additives et idempotentes**, un fichier par changement, jamais de réécriture d'une
  migration publiée. Paramètres : modifier `catalog.ts`, incrémenter `SETTINGS_CATALOG_VERSION`,
  nouvelle migration, `npm run settings:sync -- <migration>`.

**Frontend**
- Une action principale par écran/état ; options facultatives révélées par « Ajouter… » ; pas de
  mode Simple/Avancé.
- États chargement / erreur / droits refusés toujours visibles ; jamais de faux vide ; `null` ≠ 0.
- Mobile 375 px et desktop ; navigation clavier.
- Espaces staff : menu groupé par intention (Dossiers, Relations, Gouvernance / Traçabilité), Admin et
  Gestionnaire distincts ; voir [ux/admin-gestionnaire-ia.md](ux/admin-gestionnaire-ia.md).
- Libellés en français ; vocabulaire : chantier, lot, sous-lot, offre, attribution, conditions,
  échéance, suivi, réserve.

**Git / PR**
- Branche par mission (`feat/…`, `fix/…`, `docs/…`, `chore/…`) ; corps de PR avec
  `Owner issue: #N` sur sa propre ligne ; petites PR cohérentes.

## 5. CI/CD et environnements

- Workflow `.github/workflows/ci.yml`. **Checks obligatoires** sur PR : `backend-verify`,
  `frontend-build`, `Fresh schema, real Supabase integration, and FULL E2E`.
- Le job FULL E2E démarre une pile Supabase locale **jetable**, applique toutes les migrations + seed,
  vérifie ledger et schéma, fait un reset/replay, puis intégration Auth/JWT/RLS/Storage réelle et
  Playwright desktop/mobile.
- Images Supabase : `ghcr.io` et `public.ecr.aws` limitent les pulls depuis les IP partagées des
  runners (`toomanyrequests`, `Data limit exceeded`), même authentifiés. `supabase start` passe par
  `.github/scripts/supabase-start-with-retry.sh` : registre **Docker Hub** d'abord (non limité sur
  les runners GitHub), puis `ghcr.io` (authentifié par le `GITHUB_TOKEN`, `packages: read`), puis
  `public.ecr.aws`. Nouvelle tentative **uniquement** sur limite de registre ; toute autre erreur
  (migration, seed) échoue immédiatement.
  Ne pas relancer en boucle un run rouge `toomanyrequests` : une seule relance suffit.
- Fast lane PR (`scripts/ci-fast-path.py`) : Markdown sous `docs/`, README/CHANGELOG, ou changement
  strictement cosmétique ; tout le reste (y compris `CLAUDE.md`/`AGENTS.md` racine) passe en `full`.
  Sur `main`, toujours `full`. Voir [ci-pr-fast-lanes.md](ci-pr-fast-lanes.md).
- `deploy-dev` : uniquement sur push `main` après succès des trois validations ; secrets dans
  l'environnement GitHub protégé `dev`.
- **DEV** : <https://dao-dev.logiclab.fr>, Supabase DEV `nmbpjdltirotoifwuzat`. Les migrations ne
  sont pas appliquées automatiquement par le merge : vérifier leur présence sur DEV.
- Opérations VPS : [platform-operations.md](platform-operations.md), [ops-control.md](ops-control.md).
  **Pas de PROD** dans le périmètre courant.
