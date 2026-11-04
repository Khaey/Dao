# E2E environments

## Automated FULL E2E

The intended FULL Playwright target is the disposable Supabase CLI stack on a fresh GitHub-hosted runner. The job is configured to start PostgreSQL, Auth, Kong, PostgREST, and Storage; replay every migration in `dao-backend/supabase/migrations`; and load E2E-only territory rows from `dao-backend/supabase/seed.sql`. Storage object files live in the runner's local Storage container. The runner and its containers are discarded after the job, so Auth users, database rows, Storage metadata, and object files do not carry over to another campaign.

The app receives URL and keys read from that local stack at runtime. `verify-supabase-target.mjs` and the Playwright fixtures both require the exact endpoint `http://127.0.0.1:54321`; no DEV or production Supabase secrets are attached to the E2E job. Playwright runs the complete desktop and mobile projects with two workers by default; `PLAYWRIGHT_WORKERS` remains available for controlled comparisons. Worker state records resource IDs for leak accounting, while `cleanup-e2e.mjs` removes only those local tracking files. Submitted offers and immutable history remain intact until the disposable runner is discarded.

The first isolated run (#136) reached the fifth migration and failed in 58 seconds because the repository migration chain does not define `public.rls_auto_enable()`. It did not reach database reset verification or Playwright, so successful stack/reset/full-E2E timings are not yet available. As the before-isolation baseline, run #135's DEV Playwright step took 5m32s (the E2E job took 6m25s including setup and cleanup); that run failed during cleanup and must not be repeated against DEV.

## Environment choice

| Option | Time | Cost | Fidelity | Complexity | Security | Maintenance |
| --- | --- | --- | --- | --- | --- | --- |
| Supabase development branch | Branch creation and reset were not measured; branch was not created | The current estimate is USD 0.01344/hour (about USD 9.81 for 730 active hours), plus applicable storage/egress; no paid resource was created | Hosted Supabase services; the documented branch reset did not explicitly guarantee clearing Auth state and Storage object files | Low once provisioned, but reset semantics must be independently verified | Separate project reference and keys; persistent branch data requires a reliable reset boundary | A long-lived branch would accrue compute cost while active and require periodic migration upkeep |
| Supabase CLI on GitHub runner | First startup attempt took 58s and failed during migration 5; successful startup/reset/E2E times remain unmeasured | No persistent Supabase compute charge; GitHub Actions minutes and runner use apply | Uses the repo's Supabase CLI stack with real PostgreSQL, Auth, REST, Storage, and exact repository migrations; local-only geography seed supplies test reference data | Requires Docker, pinned CLI, and local configuration in CI | Fresh runner, local-only keys, exact endpoint guard, no DEV/production secrets | CLI version and local seed/config need normal repository maintenance |

Option B is selected as the isolation target. A persistent branch was not created because it has a recurring compute charge and the available reset documentation did not establish the required Auth and Storage object reset guarantees. Its first CI run is currently blocked by the migration prerequisite described above; do not fabricate a local schema or use shared DEV to bypass it.

## Shared DEV E2E history

Read-only inventory on 2026-09-26 found 47 Auth accounts with the E2E email prefix `dao-e2e-…@logiclab.invalid`, 58 projects owned by those accounts, and 42 submitted bid versions attached to E2E contractor accounts. These are historical shared-DEV records. Submitted bid versions and their content are protected by `submitted_version_immutable` and `submitted_bid_content_immutable`; they were not deleted, and those protections remain unchanged.

No new FULL E2E run may target shared DEV. CI E2E uses the disposable local stack; the normal DEV deployment and manual functional checks continue to use the application DEV environment. Whether to retain or rebuild the historical DEV data is a separate maintenance decision.

## DEV migration state

Read-only Supabase checks found migration `20260926092748_enforce_draft_withdrawal_and_approved_publication` present exactly once. Both `publish_project` and `withdraw_project_request` are available on DEV, and catalog codes `general_contractor`, `plumbing`, and `electrical` are active. The migration was not reapplied during this E2E isolation work.


## 58-test concurrency correction (2026-10-14)

Main run #540 passed backend and frontend verification but the FULL E2E job failed twice with four workers. The first attempt produced unrelated loading/navigation timeouts across five scenarios; the targeted retry failed in two different scenarios, including a page left on `Chargement du DAO…`. The same 58-test revision had passed on PR #143. This changing failure surface identifies runner/application saturation rather than one deterministic product regression.

The CI default is therefore restored to two workers for the expanded 58-test desktop/mobile campaign. Test count, projects, assertions, disposable Supabase target, migration replay and deployment gate are unchanged. Four workers remain opt-in through `PLAYWRIGHT_WORKERS` for measured experiments.

## Recette DEV dans GitHub Actions

Décision d'Ahmed (03/11/2026) : la recette navigateur sur le DEV partagé tourne dans GitHub Actions,
pas dans la session d'un fil. Cela économise le quota Claude et évite l'invite « Autoriser une fois »
qui apparaît quand une session lance un script qui se connecte à DEV avec un mot de passe. Cette
recette ne remplace pas le FULL E2E jetable ci-dessus : elle vérifie l'application **déployée**.

**Doctrine commune du 04/11/2026** : Work, Codex, Claude, DEV, OPT,
Coordinateurs et PILOT utilisent GitHub Actions comme outil d'execution de tests
reproductibles. Les agents restent responsables du code, des analyses, corrections et
des preuves. Les 3 gates obligatoires sur Supabase **jetable** ne sont pas remplaces
par la recette navigateur du **DEV deploye**. Lancer des recettes utiles, pas
rejouer un passage deja PASS sans changement ni question de validation.

**Protection des comptes partages** : `dev-recette.yml` contient un job
`branch-main-check` **sans secret** qui bloque les branches autres que `main`
avant de demarrer le job utilisant l'environnement `dev`. La protection
de l'environnement GitHub doit en plus restreindre **Deployment branches and tags**
aux refs de confiance strictement necessaires (Settings > Environments > dev)
pour empecher une branche qui modifie son propre workflow de contourner le garde.
**Important : l'environnement `dev` est partage par d'autres workflows** :
`dev-real-email.yml` fonctionne notamment sur les evenements de publication
(`release`, refs de tags), tandis que la CI et les operations DEV passent par main.
Ne pas limiter aveuglement tout l'environnement a `main` si cela rend les tests
email de release inoperants. Revoir les refs autorisees et les regles de protection
des tags, ou isoler les secrets `DAO_RECETTE_*` dans un environnement GitHub
dedie si une protection specifique aux recettes est requise. **Le reglage
administratif n'est pas attestable par cette PR**.
La gestion des utilisateurs est limitee aux comptes de test DEV. Il n'existe
actuellement **aucun environnement PROD**.

**Ce qui existe**

- Workflow `.github/workflows/dev-recette.yml` (« DAO DEV recette navigateur »), lancement manuel
  (`workflow_dispatch`) ou appel depuis un autre workflow (`workflow_call` + `secrets: inherit`).
  Cible figée sur <https://dao-dev.logiclab.fr> ; la config refuse toute autre URL. Pas de PROD.
- Config `dao-frontend/playwright.recette.config.ts`, scénarios dans `dao-frontend/tests/dev-recette/`.
  Projets `desktop` (1440 px) et `mobile` (375 px), un worker, aucune relance automatique.
- `smoke.spec.ts` : recette de base **en lecture seule** (tableau de bord des 5 rôles, accès Admin à
  Utilisateurs & rôles, refus d'administration pour Gestionnaire (« Administration réservée ») et Artisan (« Accès réservé au back-office »), API protégées en 401 pour
  un anonyme, débordement horizontal mobile).

**Comptes de test (secrets du dépôt)**

Ce sont des secrets de l'**environnement GitHub `dev`** (le job déclare `environment: dev`).
Réglages : <https://github.com/Khaey/Dao/settings/environments>, environnement `dev`. Un rôle sans secret est signalé
« non configuré » et ses scénarios échouent avec un message clair ; les autres rôles tournent.

| Rôle | Email | Mot de passe |
| --- | --- | --- |
| Admin | `DAO_RECETTE_ADMIN_EMAIL` | `DAO_RECETTE_ADMIN_PASSWORD` ou commun |
| Client A | `DAO_RECETTE_CLIENT_A_EMAIL` | `DAO_RECETTE_CLIENT_A_PASSWORD` ou commun |
| Client B (aussi Gestionnaire, `client` + `dao_reviewer`) | `DAO_RECETTE_CLIENT_B_EMAIL` | `DAO_RECETTE_CLIENT_B_PASSWORD` ou commun |
| Artisan A | `DAO_RECETTE_ARTISAN_A_EMAIL` | `DAO_RECETTE_ARTISAN_A_PASSWORD` ou commun |
| Artisan B | `DAO_RECETTE_ARTISAN_B_EMAIL` | `DAO_RECETTE_ARTISAN_B_PASSWORD` ou commun |

Le mot de passe commun est `DAO_RECETTE_PASSWORD` ; un mot de passe par rôle le remplace. Les secrets
`DAO_TEST_CLIENT_*` / `DAO_TEST_CONTRACTOR_*` existants servent aux fixtures email (`dev-real-email.yml`)
et ne sont pas utilisés ici.

**Garde-fous**

- Les connexions se font une fois dans `global-setup.ts` ; les sessions sont gardées hors du dossier
  publié puis effacées. Les tests utilisent `as(role)` et ne voient jamais de mot de passe.
- Pas de trace ni de vidéo (une trace contient les cookies). Le dépôt est public : les artefacts sont
  téléchargeables par tout compte GitHub connecté pendant 14 jours. Ne jamais capturer un écran qui
  affiche un secret, un jeton ou une donnée réelle.
- Le DEV est partagé : un scénario qui écrit doit créer sa propre fixture fictive, nommée
  `RECETTE jj/mm — … (test, ne pas traiter)`, et ne jamais supprimer ni réinitialiser des données. Pas de
  signature, paiement ou séquestre.
- Une seule recette à la fois (`concurrency: dao-dev-recette`).

**Méthode pour un fil**

1. Ajouter un scénario `dao-frontend/tests/dev-recette/<sujet>.spec.ts` dans sa PR, en important
   `test`, `expect`, `as`, `snap`, `waitForContent` depuis `./support` (exemple : `smoke.spec.ts`).
   Toujours attendre le contenu réel (`waitForContent` ou une assertion sur un texte) avant de
   conclure : `snap` refuse un écran encore en chargement (`aria-busy`). Les sélecteurs des
   specs `tests/e2e/` sont réutilisables.
2. Vérifier localement sans réseau : `cd dao-frontend && DAO_DEV_RECETTE=1 npx playwright test
   --config=playwright.recette.config.ts --list`.
3. Une fois la PR fusionnée et `deploy-dev` SUCCESS, déclencher le workflow **sur `main` uniquement**
   (onglet Actions, ou outil GitHub `actions_run_trigger` → `run_workflow`,
   `workflow_id: dev-recette.yml`, `ref: main`, inputs `specs`, `grep`, `appareils`).
   **Aucune recette authentifiée depuis une branche PR** : tester les specs par la CI isolée avant fusion.
4. Lire le résumé PASS / FAIL / UNTESTED du run (résumé du job ou fin des logs de l'étape
   « Résumé »), puis télécharger l'artefact `recette-dev-<run>-<tentative>` : `html/` (rapport
   Playwright), `captures/` (captures nommées `appareil-sujet.png`), `resultats.json`.
5. Rapporter sur l'issue propriétaire le lien du run et les verdicts, sans identifiant.
