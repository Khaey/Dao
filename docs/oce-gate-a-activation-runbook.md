# OCE Gate A — runbook d'activation de la passerelle privée (#58)

Document de préparation **sans effet** : rien ici n'est exécuté depuis le dépôt ou la CI. Chaque étape marquée 🔒 exige l'autorisation distincte du propriétaire (VPS/root, fermeture de :8080, secrets) et n'est jamais déduite de « l'autonomie » ou d'une CI verte. Source de vérité du comportement : `ops/oce-v1-gateway-host.py`, `ops/oce-v1-gateway.py`, `ops/oce-v1-gateway-qualify.py`, `ops/install-oce-gateway.sh`.

## 0. Déjà acquis (ne pas refaire sans cause nouvelle)
Audit #45, PoC #54, sauvegarde/restauration, pin de digest du runtime OCE, identité technique dédiée, tunnel/Access, code et CI de la passerelle, adaptateur serveur (lot 1), mapping/journal durables (lot 2), orchestration (lot 3).

## 1. Prérequis à constater (lecture seule)
| # | Contrôle | Où le voir |
|---|---|---|
| 1 | `main` vert, release DEV déployée contenant `ops/oce-v1-gateway*.py` | CI + `/dao-ops status` (#91) |
| 2 | Pin de digest actif : `/etc/dao-oce/runtime-pin.yml` ou Compose revu, image rendue == digest en cours | `plan` (ci-dessous) |
| 3 | Sauvegarde OCE récente et restauration prouvée | `docs/oce-backup-restore.md` |
| 4 | Identifiant technique `dao-oce-gateway@logiclab.fr` qualifié (éditeur, contrôle compensatoire) | contrôle de `install-oce-gateway.sh` |
| 5 | Chemin d'accès opérateur de remplacement vérifié (tunnel SSH / Access) vers le tableau de bord OCE | **à confirmer par le propriétaire** |
| 6 | `dao` n'a ni accès au socket Docker ni lecture du `.env` Compose | `plan` (`dao_docker_socket_access:false`) |

## 2. Installation (🔒 root/VPS) — n'ajoute rien d'actif
`ops/install-oce-gateway.sh` depuis la release exacte déployée : copie les binaires dans `/usr/local/libexec` et `/usr/local/sbin`, les unités systemd et la conf tmpfiles, crée `/var/lib/dao-oce-gateway` (0700, `dao-oce-gateway`) puis `daemon-reload`. **Aucun service démarré, Compose et accès démo inchangés.** Rejouable.

## 3. Plan non mutant (🔒 root, lecture seule)
`dao-oce-gateway-host plan` — vérifie fichiers installés, pin, santé OCE, absence d'accès Docker pour `dao`, puis imprime des booléens seulement. À lire :
- `public_8080_url_will_be_closed_on_apply` : `true` ⇒ l'URL publique `http://137.74.168.122:8080/dashboard` cessera de répondre ;
- `compose_env_hardening_required`, `loopback_bind_required` : durcissements que `apply` fera ;
- `gateway_service_active`, `egress_guard_active`, `gateway_socket_ready` : état initial.
Publier la sortie assainie sur #58. **S'arrêter ici** tant que la décision du §4 n'est pas donnée.

## 4. Décision propriétaire requise 🔒
Une phrase explicite couvrant : (a) la fermeture de l'URL publique :8080 au profit du loopback, (b) le chemin d'accès de remplacement vérifié (§1-5), (c) la fenêtre d'intervention. Sans elle, ne pas lancer `apply`.

## 5. Activation (🔒 root/VPS, après §4)
`dao-oce-gateway-host apply --acknowledge-public-demo-link-closes`. Séquence réelle :
1. durcit les droits du `.env` Compose (illisible pour `dao`), sauvegarde root-only `/etc/dao-oce/private/compose.env.pre-gateway` (0600) ;
2. `OE_BIND=127.0.0.1`, recrée **seulement** l'app OCE (`--pull never`), re-vérifie digest et labels Compose ;
3. active `dao-oce-egress-guard` (nftables : `dao` n'a aucun chemin TCP/8080 direct) puis `dao-oce-gateway` ;
4. prouve que le socket est prêt et que les contournements loopback et IP-conteneur sont refusés pour `dao` ;
5. re-vérifie santé OCE, login démo et pin.
Toute étape en échec déclenche le retour arrière automatique (§7).

## 6. Qualification live (🔒 root, après §5)
`dao-oce-gateway-qualify` : flux positif synthétique projet → WBS → planning → activités → dépendance → CPM/résumé, idempotence, opération inconnue/champs en trop refusés, mapping falsifié ou inter-projet refusé, révocation effective, contournements refusés. Sortie = booléens uniquement ; la publier assainie sur #58.

## 7. Retour arrière
- **Automatique** dans `apply` si une étape échoue : désactive les services qu'il a démarrés, restaure le `.env` depuis la sauvegarde, recrée l'app OCE avec le pin, re-vérifie le pin. Si la restauration échoue elle-même, il lève « rollback incomplete » : intervention manuelle root.
- **Manuel** (🔒 root) : `systemctl disable --now dao-oce-gateway dao-oce-egress-guard`, restaurer `compose.env.pre-gateway` en `.env` (propriétaire/mode d'origine), recréer l'app OCE avec `--pull never`, vérifier santé + pin + URL publique.
- **Côté D.A.O** : retirer `DAO_OCE_ENABLED` (l'adaptateur retombe sur `disabledGateway`, les flux commerciaux ne sont pas touchés) ; `revoke <projet> <lot>` coupe un lot sans arrêter la passerelle.

## 8. Après Gate A : branchement D.A.O (autonome, sans secret)
1. Vérifier `dao` ↔ socket `/run/dao-oce-gateway/gateway.sock` (uid `dao` seul) ; variables serveur `DAO_OCE_ENABLED=1`, éventuel `DAO_OCE_GATEWAY_SOCKET` — aucune valeur secrète, aucune dans l'app navigateur ni la CI.
2. Admission d'un **lot synthétique** (`authorize` root-only), puis `OceOrchestrator.sync` sur données fictives ; pas de donnée client réelle avant consentements et préparation validée.
3. Seulement ensuite : route serveur d'exposition du **résumé technique** (lecture seule, informatif), après validation des permissions. Aucune écriture sur contrats, paiements, attributions ou reçus.
4. Mettre à jour C4/Structurizr uniquement quand l'adaptateur est réellement livré **et** activé.

## 9. Limites assumées
Le moteur OCE ne va pas en PROD. Aucune date d'ouverture annoncée sans preuve réelle (§6). Les budgets de transport sont ceux du lot 1 (10 s, CPM 35 s, 3 tentatives bornées pour erreurs retryables, disjoncteur 5 échecs/30 s) — non mesurés en live avant la qualification.
