# OCE #58 — contrôles Cloudflare sans terminal

Le workflow **DAO OCE Cloudflare check** consomme les secrets de l'environnement
protégé `dev` sur un runner GitHub. Il effectue uniquement des GET Cloudflare ;
il ne contacte pas le VPS et n'écrit aucune configuration. Les helpers root
installés, sudoers, services et exposition de `:8080` ne sont pas modifiés.
Le démarrage du tunnel et `gateway-host apply` restent des mandats distincts.

## Déclenchement fixe

Le propriétaire `Khaey` publie un **nouveau** commentaire sur l'issue #58 dont
le contenu entier est `/dao-oce check` ou `/dao-oce audit`. Le connecteur GitHub
peut le publier sous mandat ; aucun terminal n'est requis. Le menu Actions du
workflow offre les mêmes deux opérations sur `main`. Une édition, une PR, un
autre acteur/dépôt/numéro/branche ou un suffixe est refusé. Les requêtes sont
validées avant l'étape qui reçoit les secrets ; aucun texte libre n'est exécuté.

| Opération | Secrets protégés nécessaires | Preuve et limite |
| --- | --- | --- |
| `check` | `OCE_CLOUDFLARE_API_TOKEN`, `OCE_CLOUDFLARE_TUNNEL_TOKEN` | Zone logiclab.fr Active, correspondance structurelle compte/tunnel et lecture du tunnel approuvé ; aucune preuve de politique Access ni d'authentification du secret par une connexion |
| `audit` | Les deux précédents + `OCE_CLOUDFLARE_APPROVED_EMAILS` | Audit existant complet : OTP, liste e-mail exacte, absence de bypass/app concurrente, DNS et garde JWT au connecteur ; aucune recette utilisateur authentifié ni écriture root |

Le tunnel approuvé est l'identifiant public
`0a42e8b3-1f74-4b3b-8440-e54efe20145a`. Le compte est découvert depuis la zone
approuvée, puis comparé au jeton ; il n'est pas choisi depuis un jeton arbitraire.
Le jeton du tunnel est uniquement sa valeur, sans commande d'installation.
Les IDs compte et tunnel restent stricts, l'endpoint alternatif refusé, la taille
limitée et le secret décodé d'au moins 32 octets. Cette validation structurelle
ne prouve pas que Cloudflare acceptera le secret lors d'une connexion.

Pour l'audit, enregistrer dans **Settings → Environments → dev → Add secret**
la liste indépendante des e-mails autorisés, séparés par des virgules, sous
`OCE_CLOUDFLARE_APPROVED_EMAILS`. Ne pas la publier dans l'issue ou le dépôt.
Les e-mails découverts dans la politique Cloudflare ne constituent pas une
approbation du propriétaire. Sans cette entrée privée, `audit` s'arrête avec
`APPROVED_EMAILS_MISSING` ; `check` reste utilisable avec les deux jetons.

## Diagnostic et reprise

Les seules sorties fournisseur sont des codes/stages fixes et des booléens.
Aucun jeton, e-mail, manifeste, URL d'erreur, header ou corps de réponse n'est
imprimé. Les secrets sont fournis à une seule étape, en mémoire ; aucun fichier
de credential, artifact ou transfert SSH. Le client existant refuse les
redirections et proxies hérités ; GET limité, réponses/pagination bornées,
timeout par requête 15 secondes, échéance totale 240 secondes, aucun retry.

Pour un refus HTTP 401/403 du GET en cours, le runner lit au maximum
16 Kio + 1 octet de la réponse d'erreur, en mémoire uniquement, puis ferme la
réponse. Aucun appel fournisseur supplémentaire. Il publie seulement :

- `provider_error_format` : `CLOUDFLARE_JSON`, `NON_JSON`, `UNEXPECTED_JSON`,
  `TOO_LARGE` ou `UNREADABLE` ;
- `provider_error_codes` : sous-ensemble de la liste fermée
  `6003, 6111, 9103, 9106, 9107, 9109, 10000`, sans interpréter leur cause ;
- `provider_error_labels` : correspondance exacte avec les libellés prédéfinis
  `FORBIDDEN`, `AUTHENTICATION_ERROR`, `INVALID_REQUEST_HEADERS`,
  `INVALID_ACCESS_TOKEN`, `ACCESS_DENIED` ; aucun texte fournisseur libre ;
- `provider_unrecognized_code` et `provider_zone_documentation` : booléens.
  La documentation est comparée uniquement à l'URL connue de GET `/zones` ;
  aucune URL retournée n'est affichée ou suivie.

Le JSON exige `success:false`, de 1 à 16 objets d'erreur et des clés uniques.
Codes non autorisés, chaînes numériques, booléens, floats, détails imbriqués,
headers, messages libres et URLs sont exclus. Lecture/parsing/fermeture en
échec conservent le refus HTTP initial. Une erreur générique ne prouve pas que
le jeton est expiré, invalide ou privé d'un droit particulier. Un corps qui
ne correspond pas à l'enveloppe attendue ne devient pas un diagnostic Cloudflare
JSON. Ce traitement n'affaiblit aucune validation d'accès.

Un `HTTP_403` à `ZONE_LOOKUP` constate uniquement le refus du GET des zones.
La recherche utilise `per_page=50`, maximum documenté par GET `/zones`.
Cette correction de paramètre ne prouve pas la cause du 403 précédent :
le contrôle d'autorisation fournisseur demeure une gate indépendante.
Examiner dans Cloudflare les permissions Read, le périmètre Zone/Account,
l'expiration et les restrictions IP du jeton. Ne pas en déduire une cause unique
ni élargir aveuglément les droits. Si un jeton est remplacé dans GitHub,
déclencher une nouvelle demande après ce changement réel ; ne pas répéter une
preuve réussie pour des entrées inchangées.

Le workflow référence `dev`. Un secret du même nom dans cet environnement a
priorité sur celui du dépôt ; la présence d'un secret ne prouve pas sa validité
ni l'identité de sa valeur avec un jeton affiché dans Cloudflare. Le propriétaire
a confirmé le 2026-10-10 avoir remplacé `OCE_CLOUDFLARE_API_TOKEN` dans `dev` ;
le contrôle [#59 / 38011927486](https://github.com/Khaey/Dao/actions/runs/38011927486)
reste `ZONE_LOOKUP / HTTP_403`. Les droits visibles dans le formulaire étaient
déjà présents, sans correction de droits déclarée. Ne pas lui faire ajouter
aveuglément les mêmes permissions ou répéter une requête identique. Le candidat
`fix/dev20-oce-http-diagnostics` apporte le diagnostic expurgé ci-dessus ; sa
validation/livraison et le contrôle réel enrichi sont suivis dans
[#58](https://github.com/Khaey/Dao/issues/58).

Après déclenchement, conserver dans #58 le run, SHA, tentative, conclusion et
diagnostic expurgé. Un commentaire accepté ou une CI verte ne prouve pas que
les secrets existent ou que le contrôle fournisseur est réussi.

## Provisionnement root : étape séparée

Ce workflow résout le diagnostic sans terminal, pas le provisionnement initial.
Les opérations root existantes `audit/probe/status/start/stop` ne peuvent pas
recevoir ni enregistrer les jetons GitHub. Une écriture future exige un verbe
root distinct, une permission littérale revue, l'audit complet avec e-mails
indépendants, une admission de maintenance et une preuve d'installation.
Ne pas détourner `audit`, `status` ou `env-sync`, ni demander de rejouer le
bootstrap OPS déjà livré. La préférence propriétaire du 2026-10-09 exclut la
reprise des anciens blocs CMD/TTY. L'absence de ce nouveau chemin est un blocage
explicite, jamais une invitation à transmettre les jetons dans la conversation.

Sources : [secrets Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
[GET zones](https://developers.cloudflare.com/api/resources/zones/methods/list/),
[GET tunnel](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/methods/get/)
et [création/périmètre du jeton](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).
Voir aussi les [403 Cloudflare enrichis](https://developers.cloudflare.com/changelog/post/2026-08-20-contextual-403s/)
et la [priorité des secrets GitHub](https://docs.github.com/en/actions/reference/security/secrets).
