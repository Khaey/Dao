# Notifications S2 — préférences, échéances et tri

Owner : DAO DEV 20, issue #243. Ce contrat complète S1 sans modifier son
historique. Il décrit le comportement à implémenter et tester ; sa présence ne
signifie ni migration DEV, ni scheduler actif, ni recette utilisateur live.

## Socle S1 observé

| Catégorie | Déclencheur confirmé | Visibilité vivante | Workspace |
| --- | --- | --- | --- |
| `review_approved` | version de dossier passée à `approved` | projet non archivé, propriétaire actif, version toujours approuvée | Client |
| `review_rejected` | version passée à `rejected` | mêmes contrôles, version toujours rejetée | Client |
| `invitation_received` | invitation créée `pending` et non expirée | destinataire Auth confirmé, rôle attendu, émetteur membre actif | Client ou Artisan |
| `invitation_accepted` | transition `pending → accepted` et adhésion créée | initiateur et membre accepté toujours autorisés | espace de l’initiateur |
| `project_message` | envoi métier existant #116 | conversation et participation encore autorisées | Client ou Artisan |

`dao_private.notification_visible` reste l’unique filtre commun à la liste, au
compteur et au marquage. Staff ne reçoit aucun accès global. Une notification
historique devient invisible dès que le compte, rôle, workspace, projet,
invitation ou conversation ne satisfait plus les droits vivants. Les payloads
ne contiennent que des UUID et le workspace ; les titres et routes sont
reconstruits par allowlist.

## Règles S2

Les cinq événements S1 restent transactionnels et visibles lorsqu’ils sont
autorisés. Ils ne dépendent d’aucune préférence : masquer un rappel facultatif
ne doit jamais masquer une approbation, un rejet, une invitation reçue ou
acceptée, ni un message.

La seule préférence S2 initiale est `invitation_expiring`, booléenne et séparée
par utilisateur et workspace `client|contractor`. Valeur par défaut proposée :
activée, afin d’aider sans créer de canal externe. Le réglage n’accepte ni texte
libre, contact, fuseau, identifiant de projet, secret ou rôle staff. L’utilisateur
double rôle possède deux lignes indépendantes ; changer de workspace ne copie
pas la préférence de l’autre espace.

Le seul rappel initial justifié est une invitation arrivant à échéance :

- état `pending`, projet non archivé et `expires_at` strictement futur ;
- échéance dans les prochaines 24 heures, calculée sur des instants UTC ;
- destinataire actif possédant encore `expected_role`, workspace identique ;
- émetteur encore membre actif et autorisé ;
- préférence du workspace activée ;
- revalidation atomique de tous ces faits au moment de l’insertion.

La sévérité fixe est `action_required`, car accepter ou refuser l’invitation est
une action réelle. Elle ne signifie pas urgence juridique. L’échéance peut être
affichée depuis `expires_at`, sans titre de chantier, nom, e-mail, lot, message,
document ou URL stockée. La route reste `/app/invitations`.

La clé stable est
`invitation_expiring:<invitation_uuid>:24h`, unique avec le destinataire.
Un retry ou deux workers concurrents produisent au plus une notification.
Acceptation, refus, révocation, expiration, archivage, suspension, perte du rôle
ou préférence OFF avant l’insertion donnent zéro sortie. Après insertion, le
filtre de visibilité vivant masque le rappel si l’état devient invalide ; aucune
purge destructive ni backfill historique.

## Sélection, volume et exploitation

Le moteur futur sépare deux commandes :

1. un dry-run privé, borné, qui retourne uniquement des compteurs agrégés ;
2. une génération privée transactionnelle qui verrouille/revalide la ligne,
   insère avec la clé idempotente et ne journalise aucune identité ou payload.

Le navigateur ne peut appeler aucune de ces commandes. Le traitement est borné
par lot, ordonné par `(expires_at,id)`, et utilise un index partiel sur les
invitations `pending`. Un lot de 100+ fixtures doit conserver un plan indexé et
un coût linéaire. Aucun cron, secret, service-role, VPS, e-mail, SMS, push,
WhatsApp ou fournisseur n’est activé par le code S2. L’activation sur une base
partagée suit une autorisation technique distincte après migration vérifiée.

## API et UX prévues

Les préférences et « tout marquer comme lu » utilisent des RPC personnelles
fondées uniquement sur `auth.uid()` et le workspace vivant. « Tout lire » ne
modifie que les notifications actuellement visibles de l’espace courant, reste
idempotent et ne révèle ni UUID étranger ni volume caché.

La liste ajoute le filtre `Action à traiter` aux filtres Toutes/Non lues. Une
action requise se distingue visuellement de l’état lu/non lu. Compteur, filtre,
pagination, changement de workspace, déconnexion, focus, erreur/retry et
navigation allowlistée conservent les garanties S1. Cibles tactiles ≥44 px,
clavier, lecteur d’écran et largeurs 1440/390/375 restent obligatoires.

## Matrice de validation

| Cas | Sortie attendue |
| --- | --- |
| pending, active, rôle/workspace corrects, `0 < expires_at-now ≤ 24h`, préférence ON | un candidat expurgé |
| exactement 24 h | candidat ; au-delà de 24 h | aucune sortie |
| expirée, acceptée, refusée, révoquée ou projet archivé | aucune sortie |
| préférence OFF, compte suspendu, rôle perdu, émetteur non membre | aucune sortie |
| retry/concurrence | même clé, une seule insertion |
| timestamp sans fuseau, UUID invalide, payload arbitraire | rejet fermé, aucune fuite |

Tests du lot A : contrat pur et fixtures synthétiques. Les lots suivants doivent
ajouter PGlite, plans SQL, base Supabase jetable avec JWT Client A/B, Artisan,
double rôle, staff, anon et suspendu, puis E2E desktop/mobile. Une preuve CI
jetable ne vaut jamais activation du scheduler ou recette authentifiée DEV.

## Mécanisme livré, activation volontairement absente

La migration additive `20261018061000_invitation_expiry_reminders_s2.sql`
implémente deux fonctions **privées** :
`dao_private.dry_run_invitation_expiry_reminders` et
`dao_private.generate_invitation_expiry_reminders`. Leurs droits sont révoqués
à `public`, `anon`, `authenticated` et `service_role`. Le dry-run ne retourne que
`eligible` et la limite demandée ; la génération retourne seulement `generated`
et `has_more`. Aucun identifiant, e-mail ou payload n'est journalisé ou renvoyé.

La génération verrouille un lot avec `FOR UPDATE SKIP LOCKED`, revalide toutes
les conditions après verrouillage et s'appuie sur l'unicité `(user_id,event_key)`.
L'index partiel `(expires_at,id) WHERE status='pending'` borne le scan. Une
exécution manuelle contrôlée par le propriétaire de la fonction sur une base
jetable suffit aux tests ; aucun appel navigateur, endpoint, cron, secret,
service-role, workflow GitHub, VPS ou scheduler n'est fourni. Une future
activation devra définir séparément l'identité d'exécution, la fréquence, le
monitoring agrégé et le rollback, puis recevoir une autorisation dédiée avant
toute écriture sur DEV partagé ou PROD.
