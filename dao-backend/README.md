# D.A.O — Backend MVP

Le backend D.A.O utilise Next.js/TypeScript, Supabase PostgreSQL, Auth, Storage privé et RLS. Cet état correspond à la validation du 21/09/2026.

## État local au 27/09/2026

- DEV contient les migrations jusqu’à `20260926092748_enforce_draft_withdrawal_and_approved_publication` ;
- le mapping local des 21 migrations correspond aux versions de l’historique DEV ;
- la migration répétée `20260921013710_secure_award_and_bid_documents_v2.sql` est conservée pour reproduire le ledger historique ; son `CREATE OR REPLACE` et ses ACL rendent sa réapplication idempotente ;
- tests services/routes : 10/10 ;
- replay PGlite complet sans stub RLS : 96/96 ;
- le build frontend et la découverte des 14 tests Playwright passent ;
- le test d’intégration Supabase réelle est réservé au stack local jetable et n’a pas encore été exécuté dans cette session, faute de runtime Docker-compatible.
- parcours frontend artisan branché sur les RPC d’offre ;
- aucune clé privilégiée dans le navigateur.

La tranche Priority 1 ajoute les commandes serveur de profil, correction après rejet, archivage, détails privés, documents de projet et propositions IA mock. Les dates de fin de projet/version/publication sont facultatives et validées côté PostgreSQL. Le compte peut cumuler les rôles client et contractor sans que le navigateur ne fournisse une identité d’autorité.

## Sécurité

Les opérations métier utilisent le JWT utilisateur et les RLS. Le secret serveur est réservé aux opérations Storage privilégiées après autorisation RLS. Aucun `service_role` n’est exposé au navigateur. Les façades `public.create_bid_draft`, `public.upsert_bid_item`, `public.submit_bid_version` et `public.award_request_atomic` délèguent leur logique sensible à `dao_private`.

Les offres sont créées avec `public.create_bid_draft`, leurs lignes sont enregistrées avec `public.upsert_bid_item`, puis figées par `public.submit_bid_version`. Ces commandes résolvent le contractor depuis `auth.uid()`, vérifient l’accès à la publication et refusent toute soumission après la deadline.

## Commandes

```bash
npm install
npm test
npm run test:local
npm run test:integration:real
```

Le test réel utilise uniquement le Supabase local jetable à `http://127.0.0.1:54321`. Il laisse ses fixtures, y compris les offres soumises immuables, en place ; la destruction de la stack constitue la frontière de nettoyage. Il utilise uniquement :

```text
DAO_SUPABASE_URL
DAO_SUPABASE_PUBLISHABLE_KEY
DAO_SUPABASE_SECRET_KEY
```

Ne jamais placer leurs valeurs dans GitHub. Voir [`BLUEPRINT.md`](./BLUEPRINT.md) et [`TABLES.md`](./TABLES.md).

La Draft PR exécute les validations backend, frontend, le replay Supabase frais, l’intégration réelle locale et les 14 tests Playwright desktop/mobile sur deux workers. Supabase reste local au runner. `deploy-dev` ne peut démarrer que sur un `push` vers `main` après le succès de l’E2E ; le cleanup applicatif retire uniquement les fichiers de suivi worker.
