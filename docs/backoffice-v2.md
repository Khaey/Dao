# Back-office V2 — contrat opérationnel (#64)

Les décisions A à P de #64 sont l’autorité métier. L’Admin intervient globalement ;
le Gestionnaire consulte les dossiers staff mais ne modifie que sa revue affectée.
Les identités réelles et les rôles cumulables restent issus de Supabase Auth/RLS.

## Parcours et autorisation

| Surface | Gestionnaire | Admin |
| --- | --- | --- |
| Revues / Chantiers | Claim atomique, mutation de sa revue, autres dossiers en lecture | Intervention globale, réaffectation motivée |
| Professionnels | Vérifier / refuser avec motif | Suspension motivée, réactivation vers pending, identité publique séparée |
| Clients | Profil, contacts, projets, collaborations et invitations | Suspension / réactivation du compte |
| Utilisateurs & rôles | Refus serveur | Rôles cumulables, invitation staff Auth standard, état et email confirmé |
| Publications / offres | Retrait motivé, comparaison et assistance sur ses dossiers | Même capacité globale |
| Historique | Affectations et actions propres autorisées | Global, plus statut de livraison des emails |

Le claim et les mutations publication/offre/award prennent le verrou du projet
avant les lignes enfants. Réaffectation et autorisation sont revérifiées au même
niveau. Les changements de rôles/comptes sérialisent l’invariant du dernier
Admin **actif**, y compris les écritures privilégiées. Aucun rôle ne se modifie
par un update navigateur. Les comptes suspendus sont exclus des lectures RLS
et des mutations même avec un JWT précédemment émis ; les helpers des lectures
SECURITY DEFINER appliquent aussi cet état. Aucun compte ou historique n’est supprimé.

## Versions et décomposition technique

Une édition staff assemble une nouvelle version du chantier puis la passe en
`dao_review`. Les lots inchangés réutilisent leur snapshot ; les lots/sous-lots
modifiés reçoivent de nouveaux snapshots avec l’auteur réel et la date serveur.
La composition et le contenu soumis sont figés. La version précédente conserve
son contenu et porte un lien de remplacement. L’affectation demeure durant les
révisions internes. L’option A autorise l’approbation directe par le staff affecté.
Les nouvelles soumissions client réinitialisent la prise en charge.

Un lot jamais publié peut être retiré de la nouvelle composition avec motif,
sans effacer l’ancienne version. Un lot publié passe exclusivement par le retrait
motivé de sa publication. Les sous-lots ont une identité stable, un ordre, un titre,
un périmètre et un budget optionnel en millimes. Ils sont copiés dans le snapshot
publié, visible aussi côté professionnel. Ils n’ont aucun rôle, offre ou award autonome.

| Identité authoritative DAO | Futur mapping OCE | État |
| --- | --- | --- |
| projects.id | Project | Préparation documentaire uniquement |
| project_requests.id | WBS root commercial | Identité stable malgré les versions |
| request_sub_lots.id | WBS child technique | Identité stable malgré édition/réordonnancement |
| Snapshot/version ID | Trace de synchronisation future | Aucun appel OCE dans #64 |

## Retrait et republication

`publication_lot_withdrawals` est append-only. Les sept motifs sont validés ;
« Autre » exige un commentaire non vide. Une attribution active bloque le retrait
avec « Annuler d’abord l’attribution ». Après annulation P2.1, le retrait ferme
les nouvelles lignes, soumissions de brouillons et attributions de cette publication.
Les offres et snapshots déjà soumis restent inchangés. Les professionnels ayant
soumis gardent accès à leur publication historique.

Les autres lots restent ouverts. Le retrait du dernier ferme la publication.
Une correction crée des versions nouvelles, exige l’approbation de la dernière
version, puis une nouvelle identité de publication. Une publication fermée ne
se réactive jamais. Plusieurs publications actives sont possibles uniquement
pour des lots commerciaux disjoints, sous verrou projet. Les nouvelles offres
sont rattachées à une publication : répondre à une republication ne remplace pas
l’offre courante d’un autre lot publié. Les anciens snapshots soumis ne sont pas
backfillés ; seuls les drafts/header dont la provenance est non ambiguë le sont.

L’assistance staff reprend les commandes P2.1, avec JWT réel, contexte de demande,
client/projet/lot/offre et `acting_for_client` dans l’audit. Les prix et contrats
ne sont pas modifiés hors du workflow existant.

## Emails après commit

L’outbox est créée dans la transaction métier pour soumission, claim, modification
structurelle, approbation, refus motivé, resoumission et retrait. Les destinataires
sont résolus depuis auth.users / projects côté serveur. Un retrait notifie aussi
les professionnels ayant soumis sur ce snapshot, sans identité/prix concurrents.

Le worker Node de Next démarre via instrumentation et traite les événements après
commit. Il utilise des leases SKIP LOCKED, un destinataire et message figés au
premier envoi, une clé Resend stable par événement et au plus cinq tentatives.
Une fenêtre de 23 heures évite de réutiliser la clé au-delà de la rétention Resend.
Un crash récupère la lease ; une panne fournisseur laisse la mutation métier
validée et un état pending/failed observable dans Historique (Admin seulement).
Le worker doit tourner dans le serveur Node persistant du VPS ; un hébergement
serverless nécessiterait un scheduler dédié. Il ne démarre pas pendant le build
et n’utilise aucune nouvelle clé d’environnement.

Les invitations staff utilisent Supabase Auth, son email standard et une activation
par le client Supabase. Le retour au site root déjà autorisé route le fragment
invite vers l’écran de choix du mot de passe. La préparation/finalisation est une
saga durable : une identité Auth créée après un échec temporaire est retrouvée
par email authoritative lors du retry. Aucun mot de passe n’est stocké par DAO.

## Validation et livraison

Local : tests backend, replay SQL/PGlite et suites collaboration héritées, build
frontend et découverte complète des 48 tests Playwright. Les courses réelles
(claim, retrait/soumission, retrait/award, dernier Admin, outbox) nécessitent la CI
Supabase disposable ; FULL E2E ne cible jamais DEV. #64 reste ouvert jusqu’à la
CI exacte de la PR, merge, migrations manquantes DEV, main/deploy et smoke final.
