# OPS : accès au dépôt privé — préparation #91 / dépendance #58

Cette préparation répond au mandat Pilot du 14 octobre 2026 dans #91
(commentaire 6169120601). Elle ne constitue ni une installation root ni une
autorisation d'ajouter des droits sudo. Le contrôleur installé au checkpoint
6165555450 reste `rev-30eca599839f82cc0bb44e05f00e978ae0c5d703`.

## Périmètre de lecture

Le contrôleur utilise exclusivement GET sur
`https://api.github.com/repos/Khaey/Dao` avec les routes exactes suivantes :

| Route | Usage | Permission du jeton |
| --- | --- | --- |
| `/git/ref/heads/main` | Vérifier main avant admission et écriture | Contents: Read |
| `/actions/runs` avec branche main, événement push, SHA exact et page bornée | CI officielle verte | Actions: Read |
| `/issues/91` et ses commentaires paginés bornés | Admission propriétaire postérieure à la CI | Issues: Read |
| `/contents/ops/ops-release.json?ref=<SHA>` | Manifeste figé | Contents: Read |
| `/contents/<source du catalogue>?ref=<SHA>` | Octets Python vérifiés par taille et SHA-256 | Contents: Read |

Les contenus sont demandés avec `application/vnd.github.raw+json` à l'API.
Aucune requête vers raw.githubusercontent.com, URL de téléchargement fournie
par une réponse, autre dépôt ou autre endpoint. Aucune redirection HTTP suivie,
même sur le même domaine ; les proxies issus de l'environnement sont désactivés.
Les vérifications TLS restent celles de la bibliothèque standard.

Créer un **fine-grained PAT**, propriétaire de ressource Khaey, sélection de
dépôts **Only select repositories → Dao**, permissions Contents, Actions et
Issues **Read uniquement**, Metadata Read implicite ; aucune permission Write,
Administration ou organisation. Fixer une expiration courte selon la politique
du propriétaire et préparer la rotation avant échéance. Ne pas utiliser un PAT
classic, le jeton Cloudflare ou une clé SSH.

Le format local `github_pat_...` ne prouve ni la sélection du dépôt, ni la durée
de validité, ni les droits effectifs du jeton. Ces paramètres doivent être revus
dans GitHub par le propriétaire avant provisionnement. Les requêtes de lecture
ne permettent pas de prouver l'absence de droits d'écriture ; le contrôleur ne
tente jamais une mutation pour la tester.

## Stockage et rotation

Chemin fixe `/etc/dao-ops/github-read-token` : fichier régulier root, mode 0600,
un seul lien physique, sans lien symbolique ; répertoire `/etc/dao-ops` root
0700, ancêtres root non inscriptibles par les autres comptes. Une fin de ligne
LF est tolérée, aucun autre espace ni retour chariot. Lecture bornée à 256
octets ; ouverture O_NOFOLLOW/O_NONBLOCK et contrôle sur le descripteur.

Ce credential reste hors du catalogue OPS, des snapshots, de Git, des artefacts,
de `/opt/dao`, des arguments, des variables d'environnement et des logs. Il est
relu à chaque requête, sans cache persistant. `ops-status`, rollback et
backup-status ne lisent pas ce jeton. Les codes fixes distinguent absence,
format invalide, permissions locales dangereuses et échec HTTP ; aucune URL,
réponse, entête ou exception contenant le jeton n'est publiée.

Rotation par le canal root revu : sous les verrous d'exploitation habituels,
écrire le nouveau jeton dans un temporaire root 0600 du même répertoire root
0700, fsync puis remplacement atomique et fsync du répertoire. Ne pas modifier
le fichier en place pendant une opération. Vérifier par une lecture/preflight
autorisée, puis révoquer l'ancien jeton dans GitHub. Pas de copie durable de
l'ancien secret. En cas de fuite, révoquer immédiatement ; un rollback du code
ne restaure ni ne réactive un credential. Après révocation/expiration, une erreur
401/403/404 arrête la maintenance ; aucune reprise anonyme ni demande de droits
plus larges n'est automatique.

## Amorçage séparé : proposition à revoir avant exécution

Le compte Actions `dao` n'a pas de droit d'installation root générique. Le
contrôleur ancien n'accepte ni secret sur stdin ni credential sur chemin fixe.
Un secret ajouté dans l'environnement GitHub ne suffit donc pas à réparer
l'installation existante. Aucun workflow, nouveau grant ou installateur n'est
ajouté par cette PR. Le vieux `install-ops-admin.sh` est réservé à une première
installation et **ne doit pas être rejoué** : garder le ledger et ses snapshots.

La revue d'amorçage doit désigner un opérateur et un canal disposant déjà de
l'autorité root (console d'administration protégée ou canal root existant
explicitement validé). Ce canal n'est pas disponible à DEV 20 à ce checkpoint.
Il ne faut ni emprunter un helper hors de son usage, ni exposer le dépôt pour
contourner cette limite. Le propriétaire n'a pas à relayer des commandes de
routine : après cet amorçage unique, les opérations reviennent à GitHub #91.

Séquence proposée à approuver séparément :

1. Revue de la PR et de ses tests, fusion autorisée, puis CI/main/deploy verts
   sur le SHA exact. Si main avance ou la CI échoue, arrêter. Conserver la
   preuve des droits du PAT sans sa valeur. Prévoir une fenêtre sans opération
   OPS/deploy concurrente et les moyens de retour arrière.
2. Via le canal root approuvé, provisionner le credential selon les contraintes
   ci-dessus. Obtenir **le contrôleur candidat uniquement**, au SHA de main
   revu, par une lecture GitHub authentifiée. Le copier dans un répertoire root
   privé 0700, fichier root 0600, et vérifier son SHA-256 indépendamment contre
   le manifeste/version revu avant toute exécution. Ne pas exécuter un checkout
   ou manifeste modifiable par dao, ni du code d'une PR non fusionnée.
3. Publier `/dao-ops approve <SHA-main>` sur #91 après CI verte. L'opérateur root
   exécute le candidat vérifié avec Python isolé (`-I`), d'abord `status`, puis
   `preflight`. Le candidat constate l'ancien état installé et vérifie lui-même
   les gates main/CI/admission, hashes, absence de dérive et services inactifs
   pour les seuls helpers changés. Aucun réamorçage du ledger.
4. Après revue du preflight, le même candidat root exécute `upgrade`. Réutiliser
   son journal/snapshot transactionnel normal ; il installe la release admise,
   valide le contrôleur installé et garde l'ancienne version pour rollback.
   Ne pas copier le binaire directement par-dessus l'installation : ce serait
   une dérive par rapport au snapshot. Aucune modification des grants autorisée
   par ce plan ; un résultat inattendu interrompt l'amorçage.
5. Vérifier par `/dao-ops ops-status` via Actions : `installed_match=true`,
   `pending_transaction=false`, version attendue. Retirer la copie candidate
   root temporaire. Le jeton reste au seul chemin fixe protégé.
6. En cas d'échec avant upgrade, installation inchangée. En cas d'échec pendant
   upgrade, utiliser la récupération existante et ses snapshots sous contrôle
   root ; ne jamais effacer le journal pour forcer une reprise. Un retour vers
   l'ancien contrôleur rétablit le code mais **pas** l'accès au dépôt privé.
   Status/rollback restent indépendants de GitHub. Coupure/SIGKILL : pas de
   garantie de rollback automatique, contrôler le journal avant toute suite.

Seulement après ces preuves, reprendre le cycle borné #58 déjà autorisé :
nouveau main/CI/admission si nécessaire, preflight/upgrade/status, puis la
tentative gateway et ses contrôles. Le présent lot ne démarre aucun tunnel ni
passerelle et ne modifie pas la configuration OCE.

## Qualification reproductible et limites

`python3 -m unittest scripts.tests.test_ops_control scripts.tests.test_ops_private_github`
vérifie les fichiers synthétiques absents/invalides, modes/owner, liens/FIFO,
rotation atomique, allowlist complète avant lecture du secret, GET/entêtes,
absence de proxy, redirections 301/302/303/307/308 via serveur local, erreurs
API et exceptions privées, bornes de réponse, admission, hashes, rollback et
absence de secret dans stdout/stderr. La CI découvre ce nouveau module dans
les contrôles plateforme existants ; aucun vrai jeton/VPS utilisé par les tests.

Ces tests ne prouvent pas les droits d'un futur PAT, son provisionnement sur
VPS, ni l'installation root. Ces preuves doivent venir de l'amorçage approuvé.
Les tests complets et les protections existantes restent obligatoires.

Références officielles :
- [Contenu de dépôt et média raw](https://docs.github.com/en/rest/repos/contents)
- [Exécutions Actions et permissions](https://docs.github.com/en/rest/actions/workflow-runs)
- [Permissions des fine-grained PAT](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
