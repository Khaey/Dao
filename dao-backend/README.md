# D.A.O — Backend MVP

Le backend D.A.O utilise Next.js/TypeScript, Supabase PostgreSQL, Auth, Storage privé et RLS. Cet état correspond à la validation du 21/09/2026.

## État validé

- migrations Supabase jusqu’à `202609210005_public_rpc_facades.sql` ;
- services/routes compilés ;
- tests services/routes : 7/7 ;
- suite PGlite : 68/68 ;
- test autonome Supabase réel : 1 test, 1 pass, 0 fail avec les trois variables configurées ;
- aucun frontend commencé.

## Sécurité

Les opérations métier utilisent le JWT utilisateur et les RLS. Le secret serveur est réservé aux opérations Storage privilégiées après autorisation RLS. Aucun `service_role` n’est exposé au navigateur. Les façades `public.submit_bid_version` et `public.award_request_atomic` délèguent leur logique sensible à `dao_private`.

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
