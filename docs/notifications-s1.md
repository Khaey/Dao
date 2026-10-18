# Centre de notifications internes S1 — #231

Owner : DAO DEV 20. Contrat initial au main
`76b207c791c7cce59b9dea1a05f07db8465b31ef` (18 octobre 2026).
Ce document distingue les objets existants des lots S1 en cours : il ne prouve
ni une migration DEV appliquée, ni une recette de fonctionnalité déjà déployée.

## État réel et séparation des canaux

`public.notifications` existe : UUID, date serveur, destinataire `user_id`,
`kind`, JSON `payload`, `read_at`. SELECT authenticated est limité au destinataire
et à son compte actif ; aucune écriture directe navigateur n'est accordée.
La messagerie #116 produit déjà `project_message` dans la transaction d'envoi,
avec IDs projet/conversation/message et href, **sans texte du message** ; sa clé
de commande rend l'envoi et la notification idempotents. Le marquage du fil
met déjà `read_at` à jour. Ne pas créer de deuxième émetteur de messages.

`public.notification_outbox` est un autre canal : livraison e-mail serveur,
payload métier et colonnes destinataire/message potentiellement sensibles.
S1 ne lit, ne modifie et ne republie jamais cette table, ses grants ou Resend.
Le CTA contextuel d'avis #221 n'est pas une notification persistée.

## Événements S1 et routes construites

| Catégorie | Événement serveur confirmé | Destinataire et droit vivant | Route construite |
| --- | --- | --- | --- |
| `review_approved` | Transition d'une version vers approved | Client confirmé du projet, compte actif et rôle client | `/app/projects/UUID/review` |
| `review_rejected` | Transition d'une version vers rejected | Même règle ; aucun motif privé copié | `/app/projects/UUID/review` |
| `invitation_received` | Création d'une invitation pending, non expirée | Compte existant, adresse Auth confirmée correspondant à l'invitation, rôle attendu, comptes actifs ; état pending encore valide à la lecture | `/app/invitations` |
| `invitation_accepted` | Transition pending → accepted, membership établi | Initiateur du projet actif, rôle de participation client/contractor toujours accepté ; aucun auto-envoi | `/app/projects/UUID` |
| `project_message` | Émetteur existant #116, aucune duplication | Destinataire historique ET `dao_private.conversation()` encore vrai ; appartient au workspace de sa participation | `/app/messages/UUID` |

Le payload des nouveaux événements est une allowlist d'identifiants de contexte,
du workspace destinataire et de la clé technique. Pas de nom, titre de chantier,
raison de refus, e-mail, téléphone, adresse, message, prix, jeton ou URL signée.
Les textes FR viennent d'un dictionnaire fixe ; aucune URL stockée n'est utilisée.
Un UUID ne confère jamais d'accès au dossier cible. Son écran conserve ses contrôles.

Un événement sur compte suspendu, projet archivé, invitation annulée/expirée ou
transition rejetée ne produit pas de nouvelle notification visible. Les droits
sont revérifiés à la lecture ET au marquage : révocation de membership, suspension
des participants, suppression du compte/contexte ou perte de rôle retirent
immédiatement la notification de la liste et du compteur. Historique conservé,
pas de purge destructive et pas de backfill aveugle des invitations passées.
Les messages existants ne sont visibles que si leur contexte vivant est autorisé.

## Auth, workspace et API prévus

Les futures façades publiques SECURITY INVOKER délèguent à des fonctions privées
à search_path vide. Actor exclusivement `auth.uid()`, pas de destinataire choisi
par le navigateur, pas de service-role sur ce chemin. Refus anon/JWT invalide ou
compte suspendu. Staff n'a aucun accès global : S1 ne crée pas de catégorie staff,
son centre est vide ; les comptes doubles restent dans leur espace courant réel.
Le workspace est résolu en SQL depuis les rôles et la préférence profil, validée
contre les rôles vivants ; aucun paramètre ne permet de forger un espace staff.

Commandes prévues : `my_notifications(p_limit,p_before,p_before_id,p_unread)`,
`my_unread_notification_count()`, `mark_my_notification_read(p_id)`.
Le marquage est idempotent et uniforme sur UUID tiers/inconnu : aucun oracle.
Pas de commande « tout lire » nécessaire au S1. Les fonctions de création
privées ne sont exécutables ni par anon ni par authenticated.

Lecture HTTP GET `/api/notifications?limit=20&unread=false&cursor=…`,
PATCH `/api/notifications` avec seulement `{id: UUID}` ; JWT réel vérifié côté
serveur puis propagé au client DB. Toutes les réponses sont `private, no-store`,
sans logging de payload/acteur. Les erreurs sont des codes/copies fixes, jamais
le message brut SQL, les paramètres, les tokens ou une URL signée.

Observation S1 : compteurs mémoire agrégés des requêtes/erreurs et signal serveur
`notifications_error` pour les erreurs UNAVAILABLE, avec catégorie fixe et nombre
total d'erreurs uniquement. Aucun identifiant, contenu, URL ou message brut dans
ce signal. L'observateur est substituable en test ; sa panne ne change pas le
résultat d'une commande. Pas d'endpoint public de métriques ni de fournisseur ajouté.

Pagination 1–50, ordre `(created_at DESC,id DESC)`, curseur composé
`created_at~id` conservant les microsecondes PostgreSQL, aucune pagination offset
instable. Liste, existence de page suivante et compteur utilisent le même filtre
d'autorisation et le même snapshot de commande ; index destinataire/chronologie,
pas de requête HTTP par notification. Filtre non-lu et lecture individuelle
rechargent les données serveur ; le compteur ne se déduit pas de la seule page.
Projection publique : `{rows:[{id,kind,title,created_at,read_at,href}],
unread_count,workspace,next_cursor}`. La projection SQL intermédiaire expose
seulement `{id,kind,target_id,created_at,read_at}` et un booléen `has_more`.

## Création, risques et reprise

Triggers additifs sur les transitions confirmées de versions et invitations ;
création dans la transaction métier, une clé stable `(événement,destinataire)`
avec index unique pour les nouveaux événements. Aucune modification des commandes
d'attribution/contrats/paiements, des règles métier, de l'outbox ou de l'émetteur
messages. Rollback d'une commande = rollback de la notification. Un retry métier
ou un UPDATE sans transition ne crée pas de nouveau signal.

**Revue sécurité indépendante DAO COP obligatoire sur tout SQL/permission avant
fusion.** Base réelle/JWT et FULL E2E uniquement sur Supabase jetable de CI.
Aucune migration appliquée directement sur DEV/PROD. Si DEV n'a pas le nouveau
schéma, UI en erreur temporaire explicite, jamais compteur zéro inventé.
Rollback non destructif : revenir à l'UI précédente sans supprimer l'historique ;
la désactivation éventuelle de nouveaux triggers suit une migration revue et un
circuit d'exploitation distinct. Aucun e-mail/push réel envoyé par ce chantier.

## UX et recette

Page `/app/notifications`, en session seulement : liste FR, dates serveur,
lu/non lu, filtres Tous/Non lus, Charger plus, compteur global réel, états vide,
chargement, erreur et Réessayer. Pas de copie de données métier privées. Les
requêtes obsolètes sont ignorées après changement de filtre/session/workspace ;
pas de cache local durable de notifications. Hors ligne : erreur claire et retry,
pas de faux succès de lecture. Actions clavier/lecteur d'écran, cibles ≥44 px,
1440/390/375 px, aucun débordement horizontal. `RoleNav.tsx` reste à OPT3/#222 ;
menu dans un lot isolé après fusion/réconciliation de son HEAD.

| Preuve | État au lot A |
| --- | --- |
| Contrat pur : routes allowlistées, expurgation, curseur/précision, limites, 0/1/50 | Tests ajoutés, exécution consignée dans la PR |
| SQL réel : Client A/B, Artisan, double rôle, staff, anon, suspendu, UUID tiers, révocation, rollback, doublon | À réaliser au lot B ; PGlite ne remplace pas les JWT réels |
| 100+ notifications : pagination exhaustive, compteur, idempotence de lecture et événement | À réaliser au lot B |
| UX desktop/mobile 0/1/N, erreur réseau/retry, lecture/navigation, workspace, suspension | À réaliser au lot C, FULL E2E conservé |
| Revue COP sur SQL et 3 checks exact-HEAD | Gates avant fusion du lot B |
| Migration DEV et recette live | Non appliquée, non testée ; circuit distinct requis |
