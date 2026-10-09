# D.A.O — Next Steps

## DEV 20 — OCE #58, terminer la correction du GET zones

Reprendre `fix/dev20-oce-zone-page-size` et le dernier checkpoint #58.
PR #105, CI/deploy main #429 et Pages #47 acquis ; les deux secrets ont été
consommés sans exposition par Cloudflare check #2, refus `ZONE_LOOKUP / HTTP_403`.
Ne pas rejouer cette requête identique. Le nouveau candidat corrige réellement
`per_page=100` vers le maximum GET `/zones` documenté 50, sans cause du 403
présumée ni changement de droits. Valider/livrer le candidat courant puis une
seule demande de contrôle sur cette nouvelle requête. Si le refus demeure,
correction du jeton via UI Cloudflare : permissions/périmètre, validité et IP,
puis reprise après fait nouveau. Aucun secret dans Work, CMD/TTY ou bootstrap.
L'audit complet exige encore `OCE_CLOUDFLARE_APPROVED_EMAILS` indépendant ;
provisionnement root via GitHub à préparer/revoir séparément, sans détourner
audit/status/env-sync. Aucun tunnel start, :8080 ou gateway-host apply.

Candidat réconcilié avec main `54bc4dc74404a76c3c3a0c7bc6c4edeae3801e39`
et la récupération #106 ; attendre la CI automatique du nouveau HEAD.

## OPT 20 — reprendre le diagnostic de déploiement #91 depuis GitHub

Branche `chore/opt20-deploy-recovery-91`, base initiale
269b7018dc18f55a5c6f725246e1d4b4f5c7e580 (CI/deploy #424 vert), réconciliée
avec main efe86f584343e06553157c4a121f3c270cac8cbb en conservant #104/#107/#108
Monitor, #105 DEV 20 et #84 Artisan. Lire le dernier checkpoint [#91](https://github.com/Khaey/Dao/issues/91)
pour HEAD/PR/CI/deploy réels ; si la livraison est marquée achevée, ne pas
réexécuter les tests ou opérations. Les 16 tests ciblés couvrent les nouvelles
fautes sur fichiers temporaires ; aucun test ne justifie une panne DEV réelle.

Pour une future erreur de déploiement, lire `deploy_recovery` dans son run :
erreur initiale conservée, résultats distincts lien/env/restart/readiness/
cleanup. Une readiness en passe unique échouée indique seulement l'absence de
preuve HTTP à cet instant. Utiliser les lectures fixes du contrôle commun pour
un constat nouveau, coordonner toute mutation ; garder la borne D-023 en cas
de cause ambiguë. Les routes/attentes de déploiement normal sont préservées.

La preuve post-fusion attendue est le déploiement normal au SHA exact, pas une
injection de panne VPS. Une CI automatique pending se suit sans relance ; un
checkpoint final vert est acquis. Pas de nouvel ops-upgrade/bootstrap/rollback
root pour ce script non catalogué ; pas de DB/backup/migration ou code OCE,
produit/Auth/RLS. #58/#83/#64/#93 restent à leurs owners. Reprise uniquement
depuis le HEAD publié, sans hook crash/Stop/quota Work.

## WORK OPT — Monitor #93, complément sur le corps réel de #104

PR #107 corrige le titre et les marqueurs de silence. La reprise avec le
corps GitHub **complet** de #104 prouve aussi des exemples `Réfs #91` en code
Markdown, à distinguer de la vraie déclaration `Refs #93`. Branche propre
`chore/monitor-owner-code-examples-93` : références dans les exemples de code
ignorées, vrais conflits toujours refusés. 39 tests locaux et rejeu hors ligne
du corps réel + SHA de #104 PASS, sans nouvel envoi historique. Résultats exacts
et limite téléphone dans [#93](https://github.com/Khaey/Dao/issues/93).


## WORK OPT — qualification Monitor #93 (2026-10-09)

Branche propre `chore/monitor-watchdog-marker-93`, depuis main vérifié
`e24cb6074b5236a25a17bc74d5d683091595479a`. Le propriétaire confirme la
réception Telegram : #105/#429 et #84/#432 sont nominatifs, mais #104/#426
restent « non identifié ». Le titre de #104 cite des PR non enregistrées et
interrompt la lecture de `Refs #93` ; ce défaut résiduel est corrigé. Le
watchdog accepte désormais seulement le marqueur exact du bot Actions :
ni commentaire non autorisé ni collision d'identifiant ne masque le silence.
35 tests Monitor locaux PASS. Résultats CI/fusion et preuve finale :
[#93](https://github.com/Khaey/Dao/issues/93). Registre #93 = DAO Pilot 3,
WORK OPT exécutant ; #85 suspendue, #91/#58/#83 intacts.


## DEV 2 #83 — valider les correctifs Artisan, puis arbitrer les règles nouvelles

Publier `feat/artisan-space-completion`, exécuter la CI exacte et ne fusionner que verte. Le lot est frontend et tests uniquement : aucune migration, aucun changement Auth/RLS et aucune intervention sur #64 ou #58. Après livraison, le DAO Pilot doit arbitrer séparément la règle de re-vérification des profils édités, l'espace par défaut des doubles rôles, l'intérêt d'une boîte globale d'invitations/offres et un éventuel retrait d'offre soumise. Ne pas transformer ces questions en comportement implicite. Preuves et décisions : [#83](https://github.com/Khaey/Dao/issues/83), avec le détail dans [l'audit](../artisan-space-audit.md).

## DEV 20 — OCE #58, vérifier les secrets sans terminal

Reprendre `fix/dev20-oce-actions-check` et le dernier checkpoint #58. Observer
les CI du candidat courant, réconcilier main puis livrer dans le mandat #58.
Déclencher une fois `/dao-oce check` : cela constate présence/utilisabilité des
deux jetons déclarés et le refus fournisseur éventuel, sans VPS. Conserver run,
SHA, tentative et diagnostic ; un PASS ne constitue pas l'audit Access complet.
Pour `/dao-oce audit`, ajouter la liste owner indépendante dans le secret privé
`OCE_CLOUDFLARE_APPROVED_EMAILS` via l'interface GitHub, sans la republier.

Si le 403 demeure, corriger uniquement le contrôle Cloudflare constaté puis
recontrôler après changement réel. Si les gates passent, préparer le verbe root
de provisionnement distinct et son grant précis, avec admission/installations
revues ; le contrôle runner ne les installe pas. Aucun nouveau CMD/TTY, ancien
bloc de saisie ou bootstrap OPS : instruction propriétaire courante. Aucun start,
gateway-host apply ou fermeture :8080 sans mandat distinct. Les anciennes étapes
terminal ci-dessous sont historiques et ne s'appliquent plus à cette reprise.

## OPT 20 — transport de récupération #91 livré, reprendre ses preuves

PR #102 fusionnée au main source 5e551b0dea87a49977f170f3466d71088defe27c ;
CI/deploy #422 / 37905181405 et Pages #45 SUCCESS. Le transport de quatre
scripts non-root indépendant du lien current est qualifié par un unique
ops-status [#58 / 37905759566](https://github.com/Khaey/Dao/actions/runs/37905759566),
tentative 1 SUCCESS, staging/SCP/dispatch et nettoyages runner/hôte verts.
Ne pas refaire cette lecture, le bootstrap ou le cycle de maintenance des
helpers pour une nouvelle session ou une publication documentaire. Les liens
cassés/absents sont qualifiés sur fichiers fictifs seulement ; pas de panne
VPS, restauration applicative/DB/config ou redeploy d'ancien SHA.

Code durable : `chore/opt20-ops-recovery-91`, HEAD
7437039065ba0e1bf67d8a51be3a3231828ba755. Suivi documentaire :
`chore/opt20-ops-recovery-proof-91` ; lire les derniers checkpoints
[#91](https://github.com/Khaey/Dao/issues/91) pour sa livraison exacte.
Catalogue/root inchangé : version rev-642376a…, previous=bootstrap, neuf copies
intègres, aucune transaction pendante ; aucun ops-upgrade requis pour ces docs.

#91 reste ouverte pour un nouvel écart réellement observé dans le mandat
global ou une consigne Pilot, pas pour rejouer les lots livrés. Conserver la
séparation #58/DEV 20, #83/DEV 2, #64 et #93 ; pas de fournisseur/start OCE,
gateway-host apply, fermeture :8080, restauration de DB ou nouveaux droits
implicites. Reprise depuis le dernier HEAD GitHub, sans hook crash/quota Work.

## OPT 20 — premier lot #91 livré, reprendre les acquis

PR #96/#99/#100 fusionnées ; main source admis
642376a21ac79558745e3c0b99d1c7ea2c7d154e, CI/deploy #418 SUCCESS.
Le cycle live preflight #41, upgrade #42, rollback #45, remise admise #47,
status #48 et hash/grants #49 est acquis. **Ne pas refaire le bootstrap ni cette
qualification à inputs inchangés**, même après une nouvelle session Work ou
la publication documentaire sur `chore/opt20-ops-live-proof-91`. Le contrôleur
installé est rev-642376a…, previous=bootstrap ; neuf copies intègres, aucune
transaction en attente. Lire les derniers checkpoints de [#91](https://github.com/Khaey/Dao/issues/91)
pour la livraison exacte du suivi documentaire et le prochain mandat Pilot.

Une évolution future réelle du catalogue exige une branche propre depuis le
main vérifié, manifeste régénéré, contrôles/CI pertinents puis admission du SHA
après sa **dernière** CI main verte. Preflight, absence de dérive et services
concernés inactifs restent requis avant remplacement ; conserver les versions
et preuves. Un no-op ne crée pas de version précédente. Un refus impose un
diagnostic expurgé et un fait nouveau avant reprise, sans boucle ni bypass.
La maintenance restaure le code, jamais les configurations, secrets ou données.
Matrice et preuves dans [OPS control](../ops-control.md).

#91 reste ouverte pour le périmètre global, pas pour rejouer le lot livré.
Les sections DEV/historiques ci-dessous sont préservées ; leur ancienne mention
d'un bootstrap OPS absent est dépassée. #85/#87 acquis, #58 à DEV 20, #83 à DEV 2,
#64/#93 distincts. Fournisseur/READY/start OCE restent le mandat #58.

## DEV 20 — reprise OCE #58 après le nouveau refus

Reprendre `fix/dev20-oce-provisioning-session` et les checkpoints #58 : #90/#397
sont livrés, ne pas les refaire ni rejouer leur CI. Valider/livrer la session
privée qui indique stage/reason/ligne/hash, puis fournir un seul lancement court
du provisionnement mis à jour depuis un commit immuable vérifié. Ne pas relancer
le long remplacement du validateur déjà proposé : il refuse un module ou une
sauvegarde déjà présents. Une nouvelle saisie initiale reste requise, car une
tentative refusée ne conserve pas les jetons. Pendant la session, corriger
uniquement le contrôle indiqué côté Cloudflare puis Entrée pour réauditer sans
ressaisie ; ne pas prétendre que le défaut vient forcément des permissions.
Autorisation propriétaire reçue pour les droits nécessaires OCE, à appliquer
selon la preuve du refus. Opérations usuelles Actions après READY, sans nouveau
sudo générique, service, bascule :8080 ou gateway-host apply. #91 reste à OPT 20.
Le bootstrap OPS encore absent peut suivre dans la même session administrateur,
séquentiellement, via son bloc approuvé #91 ; il est indépendant de READY OCE
et ne nécessite aucun remplacement du module Cloudflare par #95.
## DEV 20 — débloquer uniquement le bootstrap OCE #58

Reprendre PR #90 / `fix/dev20-oce-bootstrap-diagnostic` et les résultats réels
de #58. Le helper est déjà installé : ne pas le réinstaller ou élargir les
permissions. Cause du refus confirmée par le diagnostic propriétaire : secret
plus long que 32 octets, respectant le minimum Cloudflare, rejeté par notre
contrainte exacte. Accord propriétaire reçu pour fusion #90, déploiement
normal Actions et mise à jour root ciblée/provisionnement. Réconcilier le
main #92 en conservant toutes ses modifications, observer la CI du nouveau
HEAD, puis fusionner vert et vérifier le déploiement main exact. Fournir
un seul bloc administrateur groupé pour le module et la saisie privée avec
l'audit complet ; ne jamais lancer start après un audit en échec. :8080 et
gateway apply restent bloqués sans accord distinct. #83/#85/#87 intacts.

## OPT 20 — reprise SCP #85, 2026-10-09

Lire les derniers checkpoints de [#85](https://github.com/Khaey/Dao/issues/85)
avant d'agir : ils font foi pour la PR, le HEAD, la CI et la mesure finale.
Relais explicite sur `chore/ci-dev-single-transfer` ; WORK OPT ne travaille pas
en parallèle jusqu'au handback. #87/#88 terminés séparément, aucun travail à refaire.

À ce snapshot de préparation, observer une fois la CI automatique du candidat
SCP avec les mêmes gates et quatre workers. Le déploiement reste exclusivement
sur main : aucun secret DEV sur une PR, aucune nouvelle voie de déploiement.
Après validation et fusion autorisée, comparer l'upload groupé aux deux SCP
#383 (19 s) et #391 (18 s), puis deploy total (35 s / 41 s). Distinguer la
construction du conteneur, les autres étapes, les runners et l'arrondi des
horodatages GitHub ; ne pas attribuer toute variation de CI au SCP.
Vérifier release au SHA exact, artefact vérifié, service actif, HTTP smoke,
env-sync et nettoyages. En cas d'échec, diagnostiquer sans rejouer les contrôles
déjà verts à entrées identiques. Conserver les décisions rejetées et toutes
les sections DEV ; aucun #58/#83/#64, Auth/RLS ou privilège VPS dans ce chantier.

## OPT 20 — finish only Work continuity #87

Read [#87](https://github.com/Khaey/Dao/issues/87) and
[PR #88](https://github.com/Khaey/Dao/pull/88) for the exact published HEAD and
current delivery state. Resume `chore/opt20-work-checkpoints-87` only while
it is still this task's owned active branch. The guide and five fictitious
recovery cases are delivered; do not reconstruct them or rerun unchanged proofs.
Observe the final candidate's mandatory automatic checks, preserving the
initial #388 runner-port failure as history; review latest main/PR overlaps.
Keep incomplete/blocked work draft. Deliver/merge only within authorization
and green checks; a documentation merge still triggers the existing main CI
and DEV deployment, so honor any task restriction on deployment before merging.
Record the final outcome on #87 without creating a commit just to repeat CI
metadata. If #87/PR #88 is already complete, there is no new OPT 20 task here.

For new sessions use [WORK_CHECKPOINTS.md](WORK_CHECKPOINTS.md), including its
short startup message and owner-issue template. OPT #85, DEV 20 #58, DEV 2 #83
and Back-office #64 stay with their owners; the older next steps below do not
authorize OPT 20 to take them over.
## DEV #64 — livrer le correctif UX, puis intégrer les retours manuels

Poursuivre la branche `fix/backoffice-v2-usability` depuis le main vérifié `c38e4ca…`. Observer sa CI exacte sans rejouer les contrôles pour des entrées inchangées, corriger uniquement les échecs prouvés, fusionner vert et vérifier main/deploy. Ce correctif est frontend uniquement : ne rejouer aucune migration et ne modifier ni Auth/RLS ni OCE/#58 ni contrats/#61. Garder #64 ouvert pour les corrections que le pilote annoncera après ses tests manuels ; tracer chaque observation, sa cause, sa correction et la preuve de validation. Les preuves finales de #68 restent valides pour son périmètre. Voir [audit de reprise](../backoffice-v2-followup.md).

## OPT #58 — finish private deny-by-default gateway

Backup/restore, live immutable digest, technical identity rotation/revocation,
private gateway implementation and the direct-Compose digest correction are
merged. Routine VPS execution is now **GitHub Actions only**.

1. Merge the VPS-operations automation change only with normal CI and targeted
   platform checks green.
2. Perform one final root-only bootstrap of the reviewed `dao-dev-admin`
   helper/sudoers if required. This is the last expected chat-driven root
   command for #58; it only installs the bounded operation and changes no OCE
   service/bind/demo state.
3. After that bootstrap, use `DAO DEV operations -> oce-gateway-plan` or the
   automatic post-main-deploy plan. Do not request repetitive SSH commands.
4. Keep gateway host `apply` blocked until the operator separately approves
   replacing the current public OCE:8080 browser path with a verified alternate
   access path. Demo accounts/login remain preserved.
5. Only after approved activation, run the fixed live gateway qualification and
   record sanitized evidence in #58. Durable product sync/journal orchestration
   remains later DEV work.

No #45/#54 replay, no new backup outage, and no product/Auth/RLS change.

## Active DEV — finish #64 delivery

Read live #64 and PR #68 first. CI #318 already passed real independent-session races, schema/reset, backend and builds; its remaining failure was FULL E2E (38/48). Confirm the targeted accessibility/interaction correction on the automatic candidate CI, including all 48 desktop/mobile E2E; merge only green. Apply only the single missing atomic DEV migration once, verify main/deploy and controlled DEV smoke, then record SHA/runs/migrations and close #64. No OCE call, contract implementation or separate #65/#66/#67 execution. See [back-office V2](../backoffice-v2.md).

## OPT #58 — finish backup validation, then operator maintenance window

The root inventory helper is installed and the host preflight is complete.
Do not request either again or rerun audit #45 / PoC #54. The owned branch
`chore/oce-v1-host-preflight` contains the coherent backup/restore operation.

1. Observe normal PR CI and the new disposable Docker backup/restore job.
   Reconcile actual main and open DEV ownership, then merge the validated OPT
   change within existing authorization and verify its main CI/deploy.
2. Give the operator the exact reviewed deployed release installer and
   `dao-oce-backup plan`. The separate `start` command explicitly starts a
   temporary OCE outage; [the runbook](../oce-backup-restore.md) defines recovery,
   scope and safe status evidence. No production restore is exposed.
3. After successful real backup/isolated restore, continue root-controlled
   runtime configuration and immutable pin, followed by the approved private
   gateway. Complete writer census, application recovery, identity rotation,
   denied operations/mapping isolation and direct-call bypass qualification.

Current exact publication/CI/operator evidence is in [#58](https://github.com/Khaey/Dao/issues/58).
Preserve D.A.O product/Auth/RLS and DEV PR #68. There is no READY DEV handoff.
The older installation/diagnostic requests below are superseded.

## OPT #58 — active operator diagnostic checkpoint

The helper installation requested below has now succeeded. The two Compose
sources are ubuntu-owned 0664 beneath ubuntu-owned 0775 checkout directories.
Do not ask for installation again or change their ownership recursively.

Run the pinned, reviewed `ops/oce-v1-preflight.py` from
`chore/oce-v1-host-preflight` as ubuntu; the [host preflight note](../oce-v1-host-preflight.md)
and latest #58 comment contain its limits and operator invocation. After the
sanitized output, continue topology-specific backup/restore and controlled
runtime configuration/pin work on this owned branch. Finish a coherent PR and
normal CI/merge cycle for the implementation. The standalone operator diagnostic
is locally tested but has not yet been run on the VPS or merged. Preserve
D.A.O product/Auth/RLS and the existing OCE checkout; no READY DEV handoff.

## Active OPT — continue #58 through its host prerequisite

The private bounded gateway is approved in #58. Audit #45 and PoC #54 are
finished; do not rerun them or request the gateway decision again.

1. Finish the normal PR/CI/merge cycle for `chore/oce-v1-inventory`, then verify
   main CI/deploy. Read #58 for the resulting exact SHA and workflow evidence.
2. An operator with existing root access installs the reviewed helper once and
   runs `oce-integration-inventory`; see the exact commands and limits in
   [OCE integration operations](../oce-integration-operations.md).
3. Use the sanitized inventory to prepare the real topology-specific backup,
   isolated restore, immutable pin and private gateway. Keep unresolved DB,
   writer and caller-bypass checks explicit; no blind production writes.
4. Qualify identity rotation/revocation, mapping isolation, denied operations,
   direct OCE bypass and resilience before a READY handoff to DEV in #58.

The gateway is a compensating control, not native OCE least privilege. D.A.O
must never receive its underlying editor credential. Do not touch DEV's product
branches or implement Phase 2 prematurely. The following PoC approval section
is historical and superseded by #54/#58.

## OCE audit #45 complete — next action requires product approval

Do **not** repeat the OCE discovery/audit runs. The final evidence is in
[issue #45](https://github.com/Khaey/Dao/issues/45) and audit #5
(`37560361477`).

Current recommendation: **hybrid, conditional GO for one isolated PoC**.
D.A.O remains the business authority; OCE is only a candidate technical engine.

The next OCE step is not automatic. Only after explicit DAO Pilot approval,
open a separate PoC issue scoped to:
`D.A.O project → one commercial lot → OCE project → WBS → activities → planning`.
Use synthetic/non-sensitive data, explicit identifier mapping and idempotent
sync/recovery. Do not include contracts, payments, ledger, legal reception or
production user provisioning.

Before any production integration, resolve these gates:
- AGPL/commercial-license review for the intended deployment/integration model;
- coherent OCE DB + /data backup and a real restoration test;
- deploy OCE by immutable digest rather than floating `latest`;
- qualify/install only the converters actually required by the PoC (live audit:
  DWG healthy; RVT/IFC/DGN converter packages absent; IFC fallback not qualified);
- define non-admin service/user mapping and revocation without sharing D.A.O
  Auth/JWT secrets;
- benchmark real workload and resize/isolate OCE if BIM/planning exceeds the
  current 2 vCPU / ~4 GiB / ~40 GiB host envelope.

Do not update C4/Structurizr merely because the audit recommends an architecture.
Update `workspace.dsl` only when an actual D.A.O↔OCE integration design is
approved for implementation.

> Verify path, branch, HEAD, remote SHA and working tree before every resumed
> phase. Resume from the last published checkpoint, never from an older checkout.

## Active WORK DEV — #44 P2.1

P2.1 code is complete in [PR #47](https://github.com/Khaey/Dao/pull/47).
Corrected product head `bc2611b6db33e7441811d496fbf0a95ef9fc4f23` is validated
by CI #292 (`37530250664`, attempt 1): fresh/reset, 21/21 real integration
and 40/40 FULL E2E; Architecture #23 (`37530250637`) is green.

The final documentation checkpoint must pass its automatic exact-head CI,
then merge under issue #44 authorization, apply missing DEV migration
`20261006203956`, verify main CI/deploy and Architecture Pages. Read the latest
[issue #44 execution record](https://github.com/Khaey/Dao/issues/44) and live
main first: it records the final merge SHA, workflow runs and migration result.
If #44 is closed with green main/deployment evidence, P2.1 is finished; do not
repeat it. No subsequent product phase is authorized by this checkpoint.

Do not repeat PR #39, touch other Work PRs, start contracts/execution, reset
shared DEV or rewrite history.

The older next-scope descriptions below are historical where superseded by
issue #44. Its validated business decisions are the active instruction.

## Product handoff — P2 comparison and per-lot attribution complete

The current verified `main` is
`c01eac228210b65108e6273a6393f2de82aae036`. Main CI #287 and DEV deployment
are green. P2 offer comparison and explicit per-lot attribution are operational
after PR #39; do not recreate or duplicate that work.

The next product scope is the contract/execution domain only after an explicit
DAO Pilot decision. Do not infer contract, milestone, financial ledger,
reception, amendment, termination or warranty transitions from the existing
foundation tables.

Back-office follow-ups also require explicit product rules before work starts:

- internal user and role administration;
- contractor verification approval/refusal lifecycle;
- catalogues and platform settings;
- publication suspension/closure administration beyond existing commands.

## Autonomy DEV V3 — next phases

### V3-A — release-triggered real email validation (merged)

PR #28 adds `release: published` to `DAO DEV real email E2E`. The workflow
keeps `workflow_dispatch` as a fallback, waits for the green `DAO CI and DEV
deploy` run for the same commit, and uses a read-only Actions API guard to skip
a previously successful run for that SHA. The shared `dao-dev-test-scope`
concurrency group remains in place, so fixture reset and email validation
cannot overlap. Observe this path on the next intentionally published release.

### V3-B — automatic environment availability (implemented)

The normal main-only DEV deployment now assembles the protected `dev`
environment secrets into a run-scoped private payload, transfers it outside
the immutable artifact, and passes it to the existing root `env-sync` helper
under the host deployment lock. Only the managed Resend/public-URL keys are
updated; the helper preserves all other values and keeps
`/etc/dao/dao-dev.env` at `root:dao / 0640`. Stale-main validation runs before
sync. A readiness failure restores both the previous environment and release;
runner/VPS payload cleanup is attempted in `always()` paths. The manual
`DAO DEV operations` `env-sync` command remains the recovery path.

### V3-D — routine technical autonomy (next)

After V3-B, remove only repetitive manual operations that have a bounded,
read-only or rollback-safe implementation. Keep `workflow_dispatch` recovery
paths and stop on any new product, Auth, RLS, migration or architecture choice.

## Protected real DEV email test

The protected workflow can still be launched manually from GitHub Actions on
`main`:

`DAO DEV real email E2E` → `Run workflow`

The workflow has no credential inputs. It injects the four TEST credential
secrets from Environment `dev`, resets only TEST-owned mutable resources,
executes the real client → invitation email → contractor acceptance path, and
resets the same bounded scope in an `always()` cleanup step. It emits only
sanitized PASS/FAIL output; no session state, token, screenshot or trace is
published.

## V3-C handoff

The permanent TEST DEV fixture mechanism is the dedicated `DAO DEV TEST
fixtures` workflow on `main`:

1. `provision` reconciles the protected client and contractor Auth identities,
   roles and fixture profiles.
2. `verify` performs real password login for both accounts and asserts the
   contractor remains `pending` / `draft`.
3. `reset` archives only projects owned or initiated by those two identities
   and revokes their pending invitations; it preserves immutable history.
4. `mailbox-smoke` sends a real Resend marker to the contractor alias. Confirm
   receipt in `ahmedhattab.pro@gmail.com` before using the mailbox for product
   validation.

No credential value belongs in this file. The only documented identifiers are
the two aliases and the controlled mailbox. WORK DEV can now run the real
email invitation flow with these accounts and hand the received link through
the normal acceptance journey.

## Handoff — new ChatGPT conversation

The next conversation must start by reading, in order:

1. `PROJECT_CONTEXT.md`
2. `ARCHITECTURE.md`
3. `BUSINESS_RULES.md`
4. `DECISIONS.md`
5. `CURRENT_STATE.md`
6. `NEXT_STEPS.md`
7. `AUTONOMOUS_EXECUTION.md`

Then verify live GitHub `main`, the latest completed main CI and any open PRs
before acting. Never resume from an older SHA copied from chat history.

Current product implementation is already complete on main
`352d2a13ee124d0bfa2b8d5247bc8f0b78ac8483` with CI #222 green:
client existing-team creation supports multiple artisan rows on one screen,
minimum one artisan, one real principal lot per invited artisan, atomic
project/lots/invitations creation, principal-lot reservation, automatic
principal-lot assignment on acceptance, and later assignment of additional
lots to an accepted contractor.

The documentation-only PR #21 updates the AI context to this state. If it is
still open, finish it only after its exact current HEAD CI is green. It contains
no product/schema/runtime change.

The next product work must not recreate the existing-team/principal-lot feature.
Continue only from an explicit new user decision or from a real bug observed on
the deployed flow.

## Current product next steps — 2026-10-03

Verified main `352d2a13ee124d0bfa2b8d5247bc8f0b78ac8483`; CI #222 and
DEV deploy are green.

1. Treat **client existing team + principal lots** as completed. Do not recreate
   its schema, atomic RPC, principal-lot invitation binding or E2E coverage.
2. For any manual DEV check, validate one multi-artisan creation:
   each artisan has name/email/trade/title/budget, each receives a distinct
   principal lot invitation, and acceptance attaches that contractor member to
   the corresponding lot.
3. Validate the follow-up path separately: create another lot after acceptance
   and assign the already accepted contractor from the Lots tab. This is an
   additional project participation assignment, not a bid/award.
4. Preserve the MVP rule **1 invitation = 1 principal lot**. Do not add
   multi-select lots to invitation onboarding unless product explicitly changes
   this rule.
5. Preserve minimum 1 artisan/lot only for the `client_existing_team` flow.
   Marketplace-first client projects may still prepare lots without known
   professionals.
6. Permanent shared-DEV TEST accounts/reset automation remains a separate OPT
   concern and must not weaken Auth/RLS or expose credentials.

Historical instructions below are retained only for traceability.

## Current WORK OPT next steps — 2026-10-02 Europe/Paris

Verified main `990f65f916638431e05aa3733fffcb6cd8f103c5`; main CI #188 and
deploy-dev are green. PR #10 remains open and untouched at
`fc51a90fbd92271d9d6be18d479a9f2962ee3486`.

1. Keep the installed VPS helper as the source of truth for DEV operations:
   `/usr/local/sbin/dao-dev-admin` is present, `env-sync` is available,
   and VPS access is no longer a blocker.
2. The only remaining OPT prerequisite is one protected, authorized DEV Auth
   administration channel for the permanent TEST client/contractor credential
   pairs. Do not place credentials in Git, docs, workflow inputs or logs.
3. After that prerequisite is supplied, provision one TEST client and one TEST
   contractor through standard Auth administration; the contractor must use
   the expected signup status `pending`. Record only non-secret IDs/labels in
   an access-controlled manifest and implement a bounded reset for owned
   scenario resources.
4. Until provisioning is authorized and secret-backed, keep
   `bash scripts/reset-dev-fixtures.sh --plan` as the only supported reset.
   FULL E2E continues to use the disposable local Supabase stack.

No product, RLS, Auth or business code changes are authorized in this phase.

## Historical WORK DEV checkpoint — superseded by merged PR #8

The remaining text preserves the prior collaboration checkpoint as history.
Do not resume its branch or execute its old “merge PR #8” instructions:
PR #8 and #9 are already merged; use live main/PR/CI evidence.

Historical active branch: `feat/project-collaboration-invitations`.
Verified main: `965054db897f18794b9f745bf86f397dea34b4d9`, latest main CI #171 green.
Product decisions: `COLLABORATION_DESIGN.md` and the final product supplement.

## Completed — do not recreate

- Model/backfill and schema contract: `f16bc61a6561ecbb9894e662218d279e368c6528`.
- Controlled RPCs, invitation lifecycle, memberships, private/document rights,
  backend/RLS and real integration test source: `d91fb0af21689ef850188f84213e7305ffdfb0b5`.
- Common Mes chantiers, separate DAO disponibles, client/contractor dashboard,
  simple creation, invitation/auth return, team/documents/tracking UX:
  `2273344b167fc814407099404d377010377ac930`.
- Existing E2E compatibility: `e31f1bf6c1da6aeaa6cd8847cbde802144ab9f04`.
- Independent client/team/mixed lots and contractor/client E2E:
  `6eb02c15aa4f3d370ca46ab02bd3883762b739e1`.
- Invitation roles, revocation, decline and isolation E2E:
  `abcca1c468448077bb7b3a26da5ef3aae53dd5ca`.
- Signup invitation return and external redirect rejection:
  `11872b3c85ce816d0da82f531abaffc2146bb5b2`.
- Shared/private documents, explicit permission and revoked-member downloads:
  `12846d9a6d6a1a108c316836a82c5618a5f2d729`.
- Current local checks: 20/20 backend, 140/140 PGlite and migration/RLS checks,
  shared schema contract, frontend production build (45 routes), TypeScript,
  diff check and discovery of 34 executions in 13 files. Discovery is not execution.
- CI #174 (`36801932429`) on `a923f5c3aeb6d9228e0caca7be23ab93b2285aee`:
  backend/build, fresh schema, reset/replay, real Auth/JWT/RPC/RLS/Storage/
  concurrency and 34/34 desktop/mobile E2E green; all old coverage preserved.
  The async-permission test and mobile list overflow are fixed and validated.

## Remaining — next small phase

1. Merge PR #8 only after checks on its exact current HEAD are green.
   The final pre-merge documentation checkpoint only records #174's results;
   no product/test/migration change and no repeated local build is needed.
   Never use shared DEV as a replacement for the disposable CI stack.
2. Read logs/artifacts before every failure correction; audit other occurrences
   of the same cause. Preserve all old tests and useful assertions. Each small
   validated correction must be committed, published and remotely confirmed.
3. Merge only when all mandatory checks and coverage are green. Verify exact
   new main, inspect the confirmed DEV migration ledger, apply missing SQL once
   only if needed, and verify deploy-dev and DEV desktop/mobile.
4. Confirm `DEPLOY_BUILD source=verified_ci_artifact` and measure warm VPS
   dependency caches. Update the verified state and stop; no P2/P3.

Never commit `dao-frontend/tsconfig.tsbuildinfo`. Never reset, restore, clean,
stash or discard unsaved collaboration changes. Keep at most one small phase
between pushes and independently confirm the remote SHA after every checkpoint.

Stop for a real product contradiction, data-loss/security risk, conflicting DEV
migration, ambiguous root cause, the same cause after two corrections, or three
consecutive CI failures in the same functional area. If the environment or
checkout changes, stop coding and recover the expected remote branch first.


## Email V1 completion

1. Publish the tested checkpoint and PR; verify the exact remote SHA. Check
   the complete CI on its current HEAD: backend, build, fresh Supabase/schema
   contract, reset/replay, real integration and all 38 E2E executions.
2. Inspect failure logs/artifacts before changing anything. Keep the 34 old
   E2E cases and their assertions. The provider must remain mocked in CI.
   No DEV email, migration, RLS/Auth change or bypass for a failing test.
3. Report the PR/CI and external setup. No automatic merge is requested in
   this phase. Do not claim real delivery until tested with a TEST mailbox.
4. Configure Resend/domain and server-only `RESEND_API_KEY`, `DAO_EMAIL_FROM`,
   `DAO_PUBLIC_URL` out-of-band in `/etc/dao/dao-dev.env`, per
   `DEV_DEPLOYMENT.md`. No secret in Git/chat/logs; no Supabase Auth SMTP change.
5. After a separately authorized merge/deployment, test real receipt and
   acceptance with an authorized TEST mailbox. No resend after reload in V1.

Stop if a DB migration, RLS change, Auth change or new product choice is
required. Do not commit `dao-frontend/tsconfig.tsbuildinfo`. Never discard
unsaved work. Read current PR state rather than using historical checkpoints.
