# OCE #58 — diagnostic privé du bootstrap (DEV 20)

Le propriétaire a exécuté le bootstrap de main
`77cd7ba74d59069f0f8c2534e258ea7c9a2cab77`. Le helper/sudoers est installé ;
le provisionnement a retourné `BOOTSTRAP_CONFIGURATION_FAILED` après la saisie.
Cette sortie ne prouve ni un défaut de permissions API ni une configuration
particulière. Ne pas élargir les permissions ou répéter l'installation.

`scripts/oce-private-bootstrap-diagnose.py` est un diagnostic en lecture seule
du module déjà installé à `/usr/local/libexec/dao-oce-cloudflare.py`. Le lancer
dans le même terminal privé, sous le compte administrateur ordinaire, **sans
sudo**. Deux jetons sont demandés par saisie masquée ; ils restent uniquement
en mémoire. Aucun fichier de configuration ou secret n'est lu/écrit, aucune
commande système/service n'est lancée, aucun appel API Write n'est ajouté.

Le script vérifie les propriétaires et permissions du module et de ses parents,
refuse un terminal non interactif et réutilise les validations strictes de la
version root installée. Le résultat contient seulement une étape fixe, un code
d'erreur autorisé, un numéro de ligne et le SHA-256 du code installé. Aucun
jeton, e-mail, ID de compte, URL ou réponse API n'est affiché. Ne pas modifier
le module root pour désactiver les contrôles.

DEV 20 fournit une commande de téléchargement liée au commit exact de cette
branche après ses tests ciblés. Ce diagnostic non privilégié peut être exécuté
sans installer de nouvelle version root ou fusionner du code incomplet. Son
statut PASS est une vérification API en lecture seule : il ne remplace pas
`BOOTSTRAP_CONFIGURATION_READY`, ni audit/start/probe ou la recette navigateur.

| Étape | Prochain examen en cas d'échec |
| --- | --- |
| `ZONE_LOOKUP`, `ZONE_STATE` | Clé Read, compte/zone sélectionnés, accès réseau |
| `ACCESS_APPLICATION` | Application exacte et contrôles Access associés |
| `ACCESS_ORGANIZATION`, `OTP_PROVIDERS` | Organisation, fournisseur OTP et sélection dans l'application |
| `ACCESS_POLICY` | Une seule Allow avec la liste exacte d'e-mails nominative |
| `MANIFEST_VALIDATION`, `TUNNEL_TOKEN_BINDING` | Identifiants/format et jeton du seul tunnel approuvé |
| `TUNNEL_STATE`, `TUNNEL_CONFIGURATION` | Tunnel géré Cloudflare, route exacte/JWT/catchall |
| `DNS_RECORD` | CNAME unique proxifié vers le tunnel approuvé |

Le résultat expurgé permet d'instruire la correction ; ne jamais envoyer le
contenu des fichiers root, les jetons, captures de saisie ou réponses API.
Le défaut réel doit être identifié avant correction. :8080 est conservé ;
aucun gateway-host apply ou changement des permissions VPS. Preuves, SHA,
PR/tests et prochain checkpoint sont suivis dans l'issue #58. Les issues #83,
#85 et #87 et leurs branches restent hors périmètre.

## Résultat propriétaire et précision du diagnostic — 2026-10-09

Le premier résultat privé expurgé refuse `TUNNEL_TOKEN_BINDING`, module installé
SHA-256 `562cdef34ffd11abc243f3c5dd1f672dc395e258b1f8ab6200d3de454d3c4b07`,
identique à celui de la release initiale. Le numéro 29 désigne le helper
générique `require`, pas son appel précis. Les appels Access/organisation de
découverte ont passé ; l'audit complet Access/policy/ingress n'a pas commencé.

Le diagnostic distingue maintenant compte/tunnel différents, endpoint alternatif,
encodage et contrainte de taille. Il rapporte le site d'appel du refus et des
codes fixes, sans valeurs privées. Le validateur installé exige exactement
32 octets, alors que [l'API Cloudflare](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/methods/create/)
décrit un minimum de 32 octets pour le secret du tunnel. Cette incompatibilité
possible est prouvée sur fixture synthétique de 36 octets. Le second diagnostic
propriétaire a maintenant confirmé le refus exact
`INSTALLED_EXACT_32_BYTE_CONSTRAINT`, minimum 32 respecté, site d'appel ligne 62.
Compte, tunnel, schéma, endpoint et encodage ont passé les contrôles locaux.

La correction repository accepte désormais au moins 32 octets, sous la même
limite de taille totale de jeton, avec contrôle des IDs compte/tunnel, absence
d'endpoint alternatif, refus des champs supplémentaires/doublons et décodage
strict. Elle ne démontre pas la validité cryptographique du secret : Cloudflare
l'authentifie toujours au démarrage. Le diagnostic garde le support du module
ancien encore installé sur le VPS.

Avant activation : CI du commit exact, livraison/merge selon autorisation puis
mise à jour ciblée du seul module installé depuis la release revue. Cette
opération root reste distincte et exige l'autorisation spécifique propriétaire.
Ne pas réinstaller cloudflared/service/sudoers, modifier :8080 ou démarrer le
tunnel. Conserver une copie root privée du module antérieur, vérifier les hash
ancien/nouveau et l'arrêt du service, remplacer atomiquement, puis reprendre
le provisionnement guidé. Un refus ultérieur peut encore venir de l'audit
Access/policy/ingress : ces contrôles n'ont pas été contournés.
