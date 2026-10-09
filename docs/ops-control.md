# Contrôle OPS commun — #91

Les DEV, OPT et Pilot utilisent **DAO DEV operations** sur `main`, le même
compte machine `dao` et l'environnement protégé `dev`. Aucun compte VPS ou
secret individuel n'est nécessaire pour un nouveau Work. Le propriétaire
GitHub connecté est `Khaey` ; un autre acteur est refusé. L'agent doit avoir
un mandat pour l'opération demandée, même si le workflow la propose.

## Guide sans terminal

1. Lire le main réel, sa dernière CI/deploy, l'issue propriétaire et les
   checkpoints. Vérifier la release active avant une mutation partagée.
2. Publier sur **l'issue #91** un nouveau commentaire dont le contenu entier
   est `/dao-ops <opération>` avec un seul verbe du tableau ci-dessous.
   Le connecteur GitHub suffit : il n'a pas besoin de workflow_dispatch.
   Une édition, une PR, un autre numéro, un suffixe ou du texte libre est refusé.
   L'alternative est le menu Actions de DAO DEV operations, branche `main`.
3. Lire le nouveau run **DAO DEV operations**, son SHA, tentative et conclusion,
   puis les sorties expurgées de l'étape Execute fixed DEV operation.
   Un commentaire publié ne prouve pas l'exécution ; un run sauté ne la prouve pas.
4. Reporter dans l'issue propriétaire le lien du run, le résultat et les limites.
   Réutiliser une preuve inchangée ; ne pas rejouer backups/migrations/E2E
   validés pour tester l'accès. GitHub ne relance pas une session Work.

## Matrice des consommateurs

Tous les rôles utilisent le même workflow ; les différences ci-dessous
portent sur le mandat et les préconditions, pas sur des clés individuelles.

| Rôle agent | Opérations fixes | Préconditions | Preuve à conserver |
| --- | --- | --- | --- |
| DEV, OPT, Pilot actuels et futurs | `status`, `health`, `diagnostics`, `log-summary` | Scripts main transportés ; log-summary : helper DEV installé | Run + release/service/readiness ; diagnostics : hashes et grants booléens ; logs : compteurs sans messages |
| DEV/OPT chargé de récupération DEV | `restart`, `env-sync` | Accord sur la mutation partagée ; sudoers DEV existants ; env-sync : trois clés protégées disponibles | Run + smoke/status ; sync idempotent ou restauration de l'env précédente |
| OPT responsable maintenance, autres agents sous mandat explicite | `ops-status`, `ops-preflight`, `ops-upgrade`, `ops-rollback` | Bootstrap OPS ; upgrade : main/CI/admission explicite ; services concernés inactifs ; aucune dérive installée | Run + version actuelle/précédente, fichiers changés, CI et commentaire d'admission ; rollback : restauration vérifiée |
| DEV/OPT en lecture OCE | `oce-integration-inventory`, `oce-gateway-plan`, `backup-status`, `oce-status` | Helpers installés ; backup-status nécessite bootstrap OPS et état de backup existant | Métadonnées expurgées ; aucun nouveau backup/restore ou basculement |
| DEV 20, successeurs explicitement affectés à #58 | `oce-audit`, `oce-probe`, `oce-start`, `oce-stop` | Helper privé et provisionnement #58 ; start exige mandat de démarrage et audit favorable | Run du helper privé ; les secrets et la configuration restent privés |

`oce-audit` désigne ici **l'audit Access/Tunnel du helper privé**, comme le
workflow OCE private demo operations. L'ancien audit runtime/backup OCE reste
dans son workflow spécialisé et conserve ses preuves. Les workflows existants
de backup/restauration, identité, pin runtime et qualification gateway conservent
leur portée réelle : une validation sur runner ne constitue pas un contrôle
live du VPS. Ils ne deviennent pas des tâches à rejouer. Aucune migration,
restauration de DB partagée, bascule
gateway ou fermeture de `:8080` n'est ajoutée au contrôle commun.

## Lire la récupération d'un déploiement échoué

Le gestionnaire d'erreur du déploiement émet un JSON `deploy_recovery` sans
chemin, valeur d'environnement, corps HTTP ou exception brute. Il conserve le
statut d'échec initial : une récupération réussie ne rend pas la CI verte.

| Champ | Valeurs fermées et portée |
| --- | --- |
| `deploy_recovery` | `complete`, `incomplete`, `not_needed` ; `complete` exige restauration applicable, restart, readiness et cleanup réussis |
| `original_status` | Code numérique de l'erreur ou du signal capturé ; les erreurs de récupération ne le remplacent pas |
| `release` | `unchanged`, `restored`, `no_previous`, `failed` ; aucun précédent disponible n'est présenté comme restauré |
| `environment` | `unchanged`, `restored`, `failed`, `unverified` ; aucune valeur ou sauvegarde n'est publiée |
| `restart` | `not_needed`, `complete`, `failed` ; une seule tentative de récupération, sans nouvelle permission |
| `readiness` | `not_checked`, `passed`, `failed` ; passe HTTP locale unique après restore/restart favorables |
| `cleanup` | `complete`, `failed` ; fichiers temporaires du déploiement seulement |

L'échec d'une étape ne coupe plus les étapes suivantes applicables. La release
candidate après activation échouée est conservée ; le lien précédent est remis
atomiquement si possible. Le contrôle HTTP utilise le vérificateur revu de la
candidate avec `--once`, car une ancienne release peut ignorer cette option.
Le déploiement normal et `health` conservent leurs attentes de démarrage.
Le test unique vérifie les trois mêmes routes locales sans donnée ni identité.
Une tentative env-sync qui échoue avant un résultat reconnu donne `unverified`,
jamais une garantie d'environnement inchangé. Elle ne déclenche pas une
restauration aveugle d'une ancienne sauvegarde.

Lire le JSON et la première erreur dans le run exact. En cas de récupération
incomplète, utiliser `status`, `health` ou `log-summary` par le contrôle commun
pour un constat nouveau ; le seul champ `failed` ne prouve pas une cause de
permission/réseau. `restart`/`env-sync` exigent toujours une coordination sur DEV
et le mandat existant. Ne pas enchaîner des mutations spéculatives, rejouer une
migration/backup ni demander une série de commandes VPS au propriétaire.
`ops-rollback` restaure le code des helpers ; ce n'est pas une restauration de
release applicative, de données ou de secrets.

Les nouveaux cas sont qualifiés sur fichiers fictifs : lien/env/restart/HTTP/
cleanup refusés, absence de précédente release, code initial et redaction.
La livraison et le déploiement normal du source exact sont suivis dans
[#91](https://github.com/Khaey/Dao/issues/91). Aucune panne live n'est provoquée.
Un SIGKILL, une panne hôte ou un arrêt brutal Work n'est pas intercepté par ce
handler ; la reprise Work reste celle du dernier HEAD réellement publié.

## Maintenance des copies root

### Récupération sans lien de release active

Le workflow transporte depuis son checkout main quatre scripts publics fixes
(`dao-operations.sh`, `dev-status.sh`, `validate-dev.sh`,
`dao-ops-diagnostics.py`) sous `/opt/dao/ops-incoming/<run>-<attempt>/scripts`.
Le routeur est exécuté comme `dao` depuis ce répertoire, sans `cd current`.
Ainsi un lien `/opt/dao/current` absent ou cassé n'empêche plus d'atteindre les
helpers déjà installés, notamment `ops-status` et `ops-rollback`. `status` peut
alors signaler une release non vérifiée ; `health` continue de vérifier le vrai
service local. Cela ne restaure pas automatiquement la release applicative,
la DB ou les secrets et ne permet pas d'activer une ancienne révision.

Les 18 verbes, contrôle owner/main/dev, identité SSH et verrous restent les
mêmes. Aucun script transporté n'est exécuté en root : les appels sudo gardent
leurs chemins/arguments littéraux. Les helpers root ne sont pas remplacés par
le transport ; manifeste et admission de maintenance restent indépendants.
Le JSON privé existe seulement pour `env-sync`, hors artefact GitHub, avec le
même mode 0644 éphémère pour le conteneur SCP puis 0600 avant consommation.
Les nettoyages `always()` retirent le répertoire exact run/attempt sur runner
et hôte, y compris après échec ; une coupure empêchant le cleanup peut laisser
un résidu limité à ce répertoire, sans promesse d'intercepter toute interruption.

Qualification livrée par PR #102 au main source
`5e551b0dea87a49977f170f3466d71088defe27c`, après CI/deploy
[#422](https://github.com/Khaey/Dao/actions/runs/37905181405) et Pages #45 verts.
Les 23 tests ciblés couvrent les liens fictifs absent/cassé, le transfert tar
relatif, les modes et nettoyages. L'unique lecture live `ops-status`
[#58 / 37905759566](https://github.com/Khaey/Dao/actions/runs/37905759566), tentative 1
SUCCESS, prouve staging quatre scripts/SCP/dispatch/helper installé et tous les
nettoyages runner/hôte. État : rev-642376a…, previous=bootstrap, neuf copies
intègres, aucune transaction pendante, secrets_read=false ; payload env-sync
sauté. La preuve live concerne le transport sur DEV sain, pas une panne réelle.
Ne pas rejouer ce run ou le cycle de maintenance acquis pour une nouvelle
session ou des docs sans changement du transport. Preuves finales dans
[#91](https://github.com/Khaey/Dao/issues/91).

Le routeur `scripts/dao-operations.sh` est non privilégié. Il n'exécute en root
que les chemins/arguments littéraux accordés. Les mutations DEV et OPS partagent
la concurrence Actions du déploiement et le verrou `/opt/dao/.deploy.lock`.
Le gestionnaire **installé** `/usr/local/sbin/dao-ops-admin` utilise Python isolé,
des chemins fixes et des verrous root communs avec les helpers DEV/OCE.
Il ne charge ni script ni manifeste depuis `/opt/dao/current`.

Le catalogue fermé dans `ops/dao-ops-admin.py` couvre les neuf fichiers Python
gérés. Seuls les fichiers **déjà installés** sont maintenus ; les fichiers
absents sont signalés, jamais installés implicitement. Il n'installe pas de
binaire cloudflared, unité systemd, sudoers additionnel, configuration ou secret.
Il ne démarre aucun service. Toute modification des sources du catalogue doit
mettre à jour `ops/ops-release.json` avec `python3 scripts/build-ops-release.py`
dans la même PR ; un test vérifie ce manifeste.

Pour admettre une version : revue de la PR, fusion autorisée, **CI main verte
du SHA exact**, puis nouveau commentaire propriétaire sur #91 dont tout le
contenu est `/dao-ops approve <SHA-main-40-caractères>`. Ce commentaire ne
déclenche aucune opération. `ops-preflight` et `ops-upgrade` relisent main,
le dernier run du workflow CI officiel, puis cette admission datée après sa
réussite. Le téléchargement HTTPS est limité à ce dépôt/SHA immuable, sans
redirection ; chaque fichier doit correspondre au manifeste SHA-256 et être
du Python syntaxiquement valide. Main est revérifié avant toute écriture.
Un nouveau run CI ou une avancée de main invalide l'admission précédente.

Les snapshots, manifestes et journal résident sous `/var/lib/dao-ops`, root
0700/0600 ; les exécutables restent root 0755. Un snapshot est publié seulement
quand complet. Avant remplacement, un journal durable garde la version à
restaurer. Une validation du nouveau contrôleur échouée restaure automatiquement
les anciens octets/état. Après interruption entre deux copies, `ops-status`
signale le journal et `ops-rollback` restaure depuis les copies root, sans
GitHub ni réseau. `ops-upgrade` refuse tant que cette récupération est pendante.
Une dérive extérieure, un hash invalide ou un service concerné actif bloque
l'écriture. Le rollback porte sur **le code des helpers**, pas leurs données,
configurations ou migrations. Une release modifiant leur format persistant
doit prévoir sa compatibilité ; une admission n'en est pas une preuve.

Une correction root menée par DEV 20 doit précéder le bootstrap, qui adopte
les octets réellement installés. Après bootstrap, utiliser la maintenance
commune pour les changements approuvés ; un changement manuel ultérieur est
signalé comme dérive et nécessite un arbitrage, jamais un écrasement silencieux.

### Refus de maintenance expurgés

Le contrôleur distingue un verrou root occupé (`OPS_LOCK_BUSY`), un statut HTTP
GitHub de sa liste fermée (`GITHUB_HTTP_403`, `GITHUB_HTTP_429`, etc.) et une
erreur réseau/timeout (`GITHUB_NETWORK_UNAVAILABLE`). Les autres statuts HTTP
donnent `GITHUB_HTTP_ERROR`. Aucun corps, header, URL ou message d'exception
n'est publié. Les redirections restent refusées, les durées et protections
inchangées. Un HTTP 403 ne prouve pas à lui seul un défaut de permission.

Un verrou occupé exige un fait nouveau sur la fin de l'opération concurrente,
pas un contournement ou une boucle de retries. Une erreur encore indéterminée
reste `OPERATION_FAILED/details withheld` ; conserver le statut et la limite.
Ces codes améliorent un prochain diagnostic après mise à jour admise ; ils ne
déterminent pas rétroactivement la cause des anciens refus #30/#34.

## Bootstrap unique — terminé, ne pas rejouer

Le propriétaire a exécuté le bloc immuable de PR #96 le 2026-10-09 : neuf
copies adoptées et sudoers validé, sans service ni secret modifié. Les Actions
[#16](https://github.com/Khaey/Dao/actions/runs/37893592552) et
[#17](https://github.com/Khaey/Dao/actions/runs/37893942786), tentative 1 SUCCESS,
confirment le contrôleur root, les cinq grants, `bootstrap_required:false`,
`current:bootstrap`, `installed_match:true`, neuf fichiers gérés,
`previous:null` et aucune transaction pendante. Cette installation ne dépend
pas de READY Cloudflare #58 et ne doit plus être demandée à un nouveau Work.
Le cycle de maintenance a ensuite été qualifié sur une évolution réelle ;
voir les runs de la section Qualification et reprise.

Le protocole initial, désormais historique, téléchargeait **deux fichiers**
depuis un SHA main revu et vert dans un répertoire temporaire root 0700 :
`ops/dao-ops-admin.py` et `ops/install-ops-admin.sh`. Le bloc exact, SHA et leurs
deux SHA-256 sont publiés dans #91 après validation ; ne jamais substituer
`main` mutable aux URLs. Vérification des hashes avant `bash`, puis installation
du contrôleur root et d'une règle sudoers validée par visudo pour seulement
`status / preflight / upgrade / rollback / backup-status`.
Le verbe bootstrap n'est pas accordé à `dao`. Aucune autre copie installée,
configuration, credential, service ou permission n'était remplacée.

Préconditions : propriétaire root présent, compte dao et helper DEV existants,
absence du nouveau helper/état/sudoers, chemins root non modifiables par dao,
coordination avec #58 et absence de mutation concurrente. Résultat attendu :
`OPS_BOOTSTRAP_READY`, état `bootstrap` adopté depuis les copies effectives.
Ces préconditions concernent l'installation initiale, pas une nouvelle session
Work. La suite passe **par Actions** : admission du SHA vert, preflight,
upgrade si nécessaire, puis confirmation de la version. Qualifier le rollback
sur une évolution approuvée réelle, sans service concerné actif.
Si tous les octets sont déjà identiques, upgrade est un no-op : aucune preuve
de rollback live ne doit être inventée.

Un échec normal avant publication du sudoers retire seulement les fichiers OPS
nouvellement créés. Une coupure brutale pendant le bootstrap peut laisser un
état incomplet : la reprise majeure reste administrateur, après inspection
privée des **trois nouveaux chemins OPS uniquement**, sans supprimer les helpers
DEV/OCE, secrets ou backups. Ne pas élargir sudo pour contourner une panne.

## Secrets et fournisseurs

DEV_SSH_KEY et les secrets de déploiement restent dans Environment dev ; les
agents ne les téléchargent pas. Env-sync conserve son payload privé éphémère,
suppression runner/hôte et restauration protégée. Les logs publics contiennent
des compteurs et des codes fixes, jamais les messages du journal ou les erreurs
brutes des fournisseurs.

Pour #58, le propriétaire a choisi GitHub Secrets et exclut désormais CMD/TTY.
Le [workflow Cloudflare sur runner](oce-cloudflare-actions.md) reçoit deux jetons
et, pour l'audit complet, la liste privée indépendante d'e-mails approuvés.
GET uniquement, aucun contact VPS ni écriture root. Ce chemin reste distinct
des 18 opérations communes et de la maintenance code-only : aucun nouveau
grant root, provisioning implicite ou détournement de env-sync/audit/status.
Le provisionnement initial depuis GitHub nécessite encore une capacité root
distincte revue/installée ; ne pas redemander les anciens blocs terminal ou
le bootstrap OPS terminé. Un secret déjà provisionné n'est pas redemandé à
chaque Work ; une CI verte ne prouve ni sa présence ni Access/Tunnel READY.

## Qualification et reprise

Le premier lot est qualifié live au SHA source
`642376a21ac79558745e3c0b99d1c7ea2c7d154e` de PR #100, après dernière CI main
[#418](https://github.com/Khaey/Dao/actions/runs/37897760282) SUCCESS et admission
owner 6076369263. Le contrôleur est la seule évolution de code du catalogue.

| Preuve Actions, tentative 1 SUCCESS | Résultat |
| --- | --- |
| [Preflight #41](https://github.com/Khaey/Dao/actions/runs/37898487723) | Seul contrôleur différent ; aucun fichier absent |
| [Upgrade #42](https://github.com/Khaey/Dao/actions/runs/37898617882) / [status #43](https://github.com/Khaey/Dao/actions/runs/37898784030) | Version admise installée ; snapshot précédent bootstrap, neuf copies intègres |
| [Rollback #45](https://github.com/Khaey/Dao/actions/runs/37899006657) / [status #46](https://github.com/Khaey/Dao/actions/runs/37899153297) | Code bootstrap restauré et vérifié ; récupération ordinaire, aucune panne forcée |
| [Remise admise #47](https://github.com/Khaey/Dao/actions/runs/37899331901) / [status #48](https://github.com/Khaey/Dao/actions/runs/37899568438) | current=rev-642376a…, previous=bootstrap, installed_match=true, aucune transaction pendante |
| [Diagnostics #49](https://github.com/Khaey/Dao/actions/runs/37899837321) | Root-controlled, cinq grants vrais, bootstrap_required=false, secrets_read=false |

Hash installé confirmé :
`0998ca3e64ce1ba61512d9768333fed9528341155540d5bca661e39f077ad8d6`.
Ces preuves portent sur le code installé, sans changement des configurations,
secrets, services, réseau ou données. Les anciens refus #30/#34 gardent une
cause inconnue ; la réussite ultérieure ne leur attribue pas une cause.
Les 19 tests sur fichiers fictifs prouvent aussi la récupération du journal
après interruption, pas un crash VPS réel. Ne pas rejouer ces acquis pour
tester l'accès, une nouvelle session ou une publication de docs sans changement
du catalogue. #91 reste ouverte pour le périmètre global/prochain mandat.
En cas de crash/quota Work, reprendre le dernier HEAD publié/checkpoint selon
[WORK_CHECKPOINTS.md](ai-context/WORK_CHECKPOINTS.md), jamais des edits locaux
non sauvegardés. Aucun arrêt brutal Work n'est intercepté automatiquement.
