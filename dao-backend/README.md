# D.A.O — Backend MVP

Le backend D.A.O utilise Next.js/TypeScript, Supabase PostgreSQL, Auth, Storage privé et RLS. Cet état correspond à la validation du 21/09/2026.

## État validé

- migrations Supabase jusqu’à `202609220006_bid_rpc_hardening.sql` ;
- services/routes compilés ;
- tests services/routes : 8/8 ;
- suite PGlite : 77/77 ;
- test autonome Supabase réel : 1 test, 1 pass, 0 fail avec les trois variables configurées ;
- parcours frontend artisan branché sur les RPC d’offre ;
- aucune clé privilégiée dans le navigateur.

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

Le test réel autonome crée et supprime ses propres comptes et fixtures. Il utilise uniquement :

```text
DAO_SUPABASE_URL
DAO_SUPABASE_PUBLISHABLE_KEY
DAO_SUPABASE_SECRET_KEY
```

Ne jamais placer leurs valeurs dans GitHub. Voir [`BLUEPRINT.md`](./BLUEPRINT.md) et [`TABLES.md`](./TABLES.md).

Le parcours E2E DEV est lancé par GitHub Actions après `verify`. La CI provisionne un client, un reviewer et un artisan jetables, exécute Playwright desktop/mobile, publie les screenshots/trace en artifacts, puis supprime uniquement les données de ce run avec `if: always()`.
