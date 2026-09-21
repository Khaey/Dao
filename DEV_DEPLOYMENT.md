# D.A.O — exécution DEV

## Architecture retenue

Le MVP utilise un seul runtime Next.js (`dao-frontend`). Les Route Handlers `/api/*` importent l’adaptateur existant de `dao-backend/src/server/runtime.ts`; les services métier ne sont pas recopiés. Supabase reste la source de vérité et les opérations utilisateur utilisent le JWT reçu dans `Authorization`.

`DAO_BACKEND_URL` n’est plus nécessaire. Les variables serveur sont conservées hors Git, notamment `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` et `DAO_SUPABASE_SECRET_KEY`. La clé secrète n’est jamais exposée au navigateur.

## CI/CD

Un push sur `main` lance `.github/workflows/ci.yml` : `npm ci`, tests backend/services/routes, PGlite, build frontend, puis Playwright desktop/mobile lorsque les secrets E2E sont configurés. Les screenshots, traces et rapports sont publiés comme artifacts. Le déploiement DEV ne démarre qu’après succès du job `verify`.

Secrets GitHub attendus : `DEV_SSH_HOST`, `DEV_SSH_USER`, `DEV_SSH_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DAO_SUPABASE_SECRET_KEY`, `PLAYWRIGHT_CLIENT_EMAIL`, `PLAYWRIGHT_CLIENT_PASSWORD`, `PLAYWRIGHT_TRADE_ID`.

## VPS

Installer le service `ops/dao-dev.service` et le `Caddyfile` sur le VPS, avec un fichier `/etc/dao/dao-dev.env` lisible uniquement par l’utilisateur de service. Caddy expose `https://dao-dev.logiclab.fr` et reverse-proxy vers `127.0.0.1:3000`. WireGuard n’est pas modifié.

Logs : `journalctl -u dao-dev.service -f`.

## Rollback

Chaque déploiement est installé dans `/opt/dao/releases/<sha>` et `current` pointe vers la version active. Pour revenir à la précédente : `ln -sfn /opt/dao/releases/<sha-precedent> /opt/dao/current && systemctl restart dao-dev.service`.

## Procédure utilisateur

1. Demander une modification.
2. Pousser sur `main`.
3. Attendre CI verte puis le déploiement DEV.
4. Ouvrir `https://dao-dev.logiclab.fr`.
