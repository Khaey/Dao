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

## Incident 18/10/2026 — échec Gate B et correction d'activation

Le run [#39143985110](https://github.com/Khaey/Dao/actions/runs/39143985110)
a échoué avec `gateway activation failed and rollback incomplete`. Les
contrôles read-only après échec [#39144303439](https://github.com/Khaey/Dao/actions/runs/39144303439)
ont retrouvé OCE sain, bind public inchangé, guard/gateway/socket inactifs.
Le smoke DEV [#39144377729](https://github.com/Khaey/Dao/actions/runs/39144377729)
est PASS. Ces vérifications ne prouvent pas le chemin exact qui a échoué.

**Correction soumise à CI, non preuve de réparation live** : l'activation fige
les chemins Compose et le digest immuable *avant* mutation et les réutilise
pendant le rollback, même si un conteneur a été partiellement recréé ou a
disparu. Le rollback tente indépendamment l'arrêt de chaque service et la
restauration Compose, puis vérifie état OCE, digest, bind initial et services.
Le délai maximum du wrapper root (900 s), du transport SSH (17 minutes pour
`oce-gateway-apply`) et du job (20 minutes) laisse un budget au pire cas
(montée Compose 120 s + attente santé 180 s, puis rollback : arrêts, montée
120 s, attente santé 180 s et deux contrôles de 20 s).
Les futurs échecs retournent uniquement les codes fermés `phase` et
`rollback`, la liste fermée `rollback_failures` et une `trace` d'étapes
`[étape, issue, secondes arrondies à 5]` — jamais stdout/stderr, chemins,
valeurs ni adresses.

### Après le 2e échec (`compose_recreate` + `multiple_failed`, #39168572760)

Diagnostic sur code, sans log brut ni accès VPS : les deux échecs durent
~180 s, soit deux attentes de santé complètes de 75 s plus les montées Compose.
Hypothèse la plus cohérente : **l'app OCE met plus de 75 s à répondre à
`/api/health` après recréation**, l'attente d'`apply` expire, le rollback
refait la même recréation, expire de la même façon, puis son contrôle final
était **instantané** et jugeait un conteneur encore en démarrage comme raté
(`multiple_failed`), alors que le `plan` suivant le trouvait sain. Ce n'est
**pas prouvé** : la correction ci-dessus ne fait que (1) attendre 180 s,
(2) attendre le contrôle final de rollback (20 s) au lieu d'un test unique,
(3) dire précisément quelle étape échoue (`compose_up` : `ok|nonzero|timeout|error`,
`health_wait`, chaque sous-étape `rb_*` et `post_*`).

`dao-oce-gateway-host plan` (`/dao-ops oce-gateway-plan`, lecture seule)
expose maintenant `app_diagnostics` : état du conteneur app (`running|exited|…`),
santé Docker (`starting|healthy|unhealthy|none`), nombre de redémarrages
(max 99), OOM, code de sortie, uptime arrondi à la minute, latence de
`/api/health` arrondie à 100 ms et disponibilité de `docker compose`. Aucun
log, label, environnement ni adresse.

Ordre avant toute nouvelle tentative : fusionner, admettre le SHA, installer
(`ops-preflight` puis `ops-upgrade`, autorisation propriétaire), lancer
`oce-gateway-plan` pour lire `app_diagnostics`, et seulement ensuite demander
une décision expresse pour un nouvel `oce-gateway-apply`. Aucun troisième
`apply` n'est autorisé par ce document.

**STOP** : ne pas relancer `apply` avec la version installée précédente.
Le merge et le déploiement applicatif DEV ne remplacent **pas** l'upgrade
root installé. Avant toute seconde tentative : revue/CI verte sur HEAD exact,
upgrade OPS root via le mécanisme de release manifest signé/haché, contrôle
`ops-status` et nouveau `oce-gateway-plan`, puis décision de reprise de
maintenance et qualification live distincte. Si `rollback` n'est pas
`verified`, considérer la disponibilité OCE non garantie et utiliser le
runbook de récupération root sans réessayer l'activation.
