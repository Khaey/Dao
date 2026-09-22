# D.A.O — exécution DEV

## Architecture retenue

Le MVP utilise un seul runtime Next.js (`dao-frontend`). Les Route Handlers `/api/*` importent l’adaptateur existant de `dao-backend/src/server/runtime.ts`; les services métier ne sont pas recopiés. Supabase reste la source de vérité et les opérations utilisateur utilisent le JWT reçu dans `Authorization`.

`DAO_BACKEND_URL` n’est plus nécessaire. Les variables serveur sont conservées hors Git, notamment `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` et `DAO_SUPABASE_SECRET_KEY`. La clé secrète n’est jamais exposée au navigateur.

## CI/CD

Un push sur `main` lance `.github/workflows/ci.yml` : `npm ci`, tests backend/services/routes, PGlite, build frontend, puis Playwright desktop/mobile lorsque les secrets E2E sont configurés. Les screenshots, traces et rapports sont publiés comme artifacts. Le déploiement DEV ne démarre qu’après succès du job `verify`.

Secrets GitHub attendus : `DEV_SSH_HOST`, `DEV_SSH_USER` (valeur `dao`), `DEV_SSH_KEY` (clé privée dédiée dont la clé publique est installée pour `dao`), `DAO_SUPABASE_URL`, `DAO_SUPABASE_PUBLISHABLE_KEY` et `DAO_SUPABASE_SECRET_KEY`. Le job E2E génère ses comptes client, reviewer et artisan avec `github.run_id`/`github.run_attempt`, puis les supprime toujours après le test. Aucun credential E2E permanent n’est stocké. Le déploiement ne se connecte jamais en root.

## VPS

L’installation initiale se fait en une commande root, après avoir copié `ops/` sur le VPS : `DAO_DEPLOY_PUBLIC_KEY='ssh-ed25519 ...' bash ops/bootstrap-dev.sh`. Le script est idempotent : il crée/configure `dao`, `/opt/dao`, `/opt/dao/releases`, `/etc/dao`, installe le service, le Caddyfile, le sudoers minimal et le script de déploiement. Il vérifie les chemins réels de `node`, `npm`, `git` et `caddy`, puis ne modifie jamais WireGuard.

Compléter ensuite `/etc/dao/dao-dev.env` hors Git avec `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` et `DAO_SUPABASE_SECRET_KEY`. La clé privée reste uniquement dans les secrets GitHub Actions. Le fichier `/etc/sudoers.d/dao-dev` autorise à `dao` uniquement `systemctl restart/is-active/status dao-dev.service`; aucun sudo général n’est accordé.

Caddy expose `https://dao-dev.logiclab.fr` et reverse-proxy vers `127.0.0.1:3000`. Le service démarre automatiquement après reboot. WireGuard n’est pas modifié.

Logs : `journalctl -u dao-dev.service -f` et `journalctl -u caddy -f`.

## Rollback

Chaque déploiement est installé dans `/opt/dao/releases/<sha>` et `current` pointe vers la version active. Pour revenir à la précédente : `ln -sfn /opt/dao/releases/<sha-precedent> /opt/dao/current && systemctl restart dao-dev.service`.

## Procédure utilisateur

1. Demander une modification.
2. Pousser sur `main`.
3. Attendre CI verte puis le déploiement DEV.
4. Ouvrir `https://dao-dev.logiclab.fr`.
