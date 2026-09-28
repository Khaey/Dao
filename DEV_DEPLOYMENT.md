# D.A.O — exécution DEV

## Architecture retenue

Le MVP utilise un seul runtime Next.js (`dao-frontend`). Les Route Handlers `/api/*` importent l’adaptateur existant de `dao-backend/src/server/runtime.ts`; les services métier ne sont pas recopiés. Supabase reste la source de vérité et les opérations utilisateur utilisent le JWT reçu dans `Authorization`.

`DAO_BACKEND_URL` n’est plus nécessaire. Les variables serveur sont conservées hors Git, notamment `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` et `DAO_SUPABASE_SECRET_KEY`. La clé secrète n’est jamais exposée au navigateur.

## CI/CD

Un push sur `main` lance `.github/workflows/ci.yml` : tests backend/services/routes, PGlite, build frontend, Supabase local jetable, intégration réelle, puis Playwright desktop/mobile. Les screenshots, traces et rapports sont publiés comme artifacts. `deploy-dev` reste limité à un push sur `main` après succès de ces validations.

Sur `main`, le build frontend utilise les variables publiques de l’environnement GitHub `dev` et publie un artifact de release. Les PR utilisent une configuration de validation sans secrets et ne publient pas d’artifact déployable. Le build E2E avec Supabase local (`127.0.0.1:54321`) reste séparé et n’est jamais réutilisé pour DEV.

Le paquet frontend contient `.next` sans son cache de compilation et un manifeste sans valeur de secret. Avant de réutiliser `.next`, le VPS vérifie le SHA du commit, le hash du lockfile frontend, la version majeure de Node, le build ID et l’empreinte des deux variables `NEXT_PUBLIC_SUPABASE_*` contre `/etc/dao/dao-dev.env`. Tout écart déclenche un build VPS avec la configuration locale au serveur.

### Première mesure réelle sur main

Le run [#158](https://github.com/Khaey/Dao/actions/runs/36411292612), après le merge de la PR #3 (`e0bbcdd19c29d46821d19ba2d56e8868b676eb9d`), a utilisé l’artifact vérifié : le log VPS contient `DEPLOY_BUILD source=verified_ci_artifact`. Aucun build frontend n’a été lancé sur le VPS. Le job de déploiement a duré 44s, dont 24.41s pour SSH; le workflow complet a duré 239s, et merge → service actif 231.38s. Par rapport au run #155, le workflow a gagné 47s et le déploiement environ 41s. Le cache de dépendances VPS était froid : backend et frontend ont tous deux été installés.

Le VPS a terminé avec `dao-dev.service` actif et le SHA attendu. La sonde HTTP depuis l’environnement Work a reçu un 502 TLS du proxy sortant, donc elle n’a pas validé la réponse publique de l’application. Les timings détaillés figurent dans `docs/ai-context/CURRENT_STATE.md`.

Secrets GitHub attendus : `DEV_SSH_HOST`, `DEV_SSH_USER` (valeur `dao`), `DEV_SSH_KEY` (clé privée dédiée dont la clé publique est installée pour `dao`), `DAO_SUPABASE_URL`, `DAO_SUPABASE_PUBLISHABLE_KEY` et `DAO_SUPABASE_SECRET_KEY`. Le job E2E génère ses comptes client, reviewer et artisan avec `github.run_id`/`github.run_attempt`, puis les supprime toujours après le test. Aucun credential E2E permanent n’est stocké. Le déploiement ne se connecte jamais en root.

## VPS

L’installation initiale se fait en une commande root, après avoir copié `ops/` sur le VPS : `DAO_DEPLOY_PUBLIC_KEY='ssh-ed25519 ...' bash ops/bootstrap-dev.sh`. Le script est idempotent : il crée/configure `dao`, `/opt/dao`, `/opt/dao/releases`, `/etc/dao`, installe le service, le Caddyfile, le sudoers minimal et le script de déploiement. Il vérifie les chemins réels de `node`, `npm`, `git` et `caddy`, puis ne modifie jamais WireGuard.

Compléter ensuite `/etc/dao/dao-dev.env` hors Git avec `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` et `DAO_SUPABASE_SECRET_KEY`. La clé privée reste uniquement dans les secrets GitHub Actions. Le fichier `/etc/sudoers.d/dao-dev` autorise à `dao` uniquement `systemctl restart/is-active/status dao-dev.service`; aucun sudo général n’est accordé.

Caddy expose `https://dao-dev.logiclab.fr` et reverse-proxy vers `127.0.0.1:3000`. Le service démarre automatiquement après reboot. WireGuard n’est pas modifié.

Logs : `journalctl -u dao-dev.service -f` et `journalctl -u caddy -f`.

## Rollback

Chaque déploiement est préparé dans un répertoire versionné par SHA et tentative avant de remplacer atomiquement `/opt/dao/current`. Les `node_modules` sont réutilisés dans un cache indexé par hashes de `package.json`/lockfile, versions de Node/npm et plateforme, sans modifier les dépendances d’une release existante. Le service ne redémarre qu’après préparation complète. Si le redémarrage ou le contrôle `systemctl is-active` échoue, le script repointe `current` vers la release précédente et redémarre celle-ci. Les cinq releases les plus récentes sont conservées.

Pour un rollback manuel, repérer une release précédente sous `/opt/dao/releases/`, puis remplacer atomiquement le lien et redémarrer le service :

```bash
ln -s /opt/dao/releases/<release-precedente> /opt/dao/.current-rollback-manual
mv -Tf /opt/dao/.current-rollback-manual /opt/dao/current
sudo -n /usr/bin/systemctl restart dao-dev.service
sudo -n /usr/bin/systemctl is-active dao-dev.service
```

## Procédure utilisateur

1. Demander une modification.
2. Pousser sur `main`.
3. Attendre CI verte puis le déploiement DEV.
4. Ouvrir `https://dao-dev.logiclab.fr`.
