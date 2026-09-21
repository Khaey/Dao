# Supabase real integration

Run from the VPS with disposable DEV fixtures only:

```bash
export DAO_SUPABASE_URL="https://<project>.supabase.co"
export DAO_SUPABASE_PUBLISHABLE_KEY="<publishable-key>"
export DAO_SUPABASE_SECRET_KEY="<server-only-secret-key>"
export DAO_TEST_CLIENT_EMAIL=... DAO_TEST_CLIENT_PASSWORD=...
export DAO_TEST_ARTISAN_EMAIL=... DAO_TEST_ARTISAN_PASSWORD=...
export DAO_TEST_DUAL_EMAIL=... DAO_TEST_DUAL_PASSWORD=...
export DAO_TEST_OTHER_EMAIL=... DAO_TEST_OTHER_PASSWORD=...
npm run test:integration:real
```

For fixture-level assertions also export the nine `DAO_TEST_*_ID` values
listed in `supabase-real.test.ts`. Credentials, JWTs and service keys must
remain only in the VPS environment and must never be committed.
