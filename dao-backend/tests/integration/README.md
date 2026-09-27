# Supabase real integration

Run this test only against the disposable local Supabase stack. The test
refuses any URL other than `http://127.0.0.1:54321`.

```bash
supabase start
supabase db reset --local
status_env="$(supabase status -o env)"
export DAO_SUPABASE_URL="$(printf '%s\n' "$status_env" | sed -n 's/^API_URL="\{0,1\}\(.*\)"\{0,1\}$/\1/p')"
export DAO_SUPABASE_PUBLISHABLE_KEY="$(printf '%s\n' "$status_env" | sed -n 's/^ANON_KEY="\{0,1\}\(.*\)"\{0,1\}$/\1/p')"
export DAO_SUPABASE_SECRET_KEY="$(printf '%s\n' "$status_env" | sed -n 's/^SERVICE_ROLE_KEY="\{0,1\}\(.*\)"\{0,1\}$/\1/p')"
npm run test:integration:real
```

The test verifies Auth/JWT, RLS, RPCs, publication visibility, submitted bid
immutability, private Storage, and award uniqueness. It deliberately leaves
its rows and users in place; dropping the disposable local stack is the cleanup
boundary. Never point it at shared DEV or production.
