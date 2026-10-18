# Messages & Assistance — contrat backend v1

Owner backend/API/RLS : DAO DEV 20, issue #271. Owner frontend/UX : DAO DOW,
issue #273. La centralisation concerne la navigation et l’interface ; elle ne
fusionne jamais les conversations privées de chantier avec le support D.A.O.

## Frontières de sécurité

- La messagerie Client–Artisan existante, ses tables, RPC, RLS et liens
  `/app/messages/[id]` restent inchangés. Le staff et l’assistant n’y gagnent
  aucun accès.
- Un ticket appartient à l’utilisateur dérivé du JWT. Aucun `user_id`, rôle,
  demandeur ou propriétaire fourni par le navigateur n’est accepté.
- La file support est réservée aux rôles vivants `dao_reviewer` et `dao_admin`.
  Le premier contrat d’affectation accepte uniquement `me`; une affectation par
  UUID arbitraire n’est pas exposée au navigateur.
- Le transfert depuis l’assistant contient seulement une route interne
  allowlistée et un identifiant de FAQ optionnel choisis par l’utilisateur. Il
  ne copie ni page, transcript, conversation, document, profil ou contact.
- Aucun fournisseur IA, e-mail, push, promesse de délai ou lecture globale
  n’est actif. Les textes sont des entrées non fiables, bornées et rendues
  comme texte par l’UI.

## DTO HTTP v1

Les statuts sont `open`, `waiting_staff`, `waiting_user`, `resolved`, `closed`.
Les catégories sont `account`, `project`, `offer`, `professional_profile`,
`technical`, `other`. Le sujet est limité à 120 caractères, un message à 4000,
une raison à 500. Les commandes de création/réponse exigent une clé
d’idempotence opaque de 16 à 128 caractères.

`SupportTicket` contient `id`, `reference`, `subject`, `category`, `status`,
`project_id`, `created_at`, `updated_at`, `last_message_at`, `unread_count` et
`assignee_label`. `requester_label` n’est présent que dans une réponse staff.
Aucun e-mail ni rôle interne n’est renvoyé. `SupportMessage` contient `id`,
`ticket_id`, `author_role` (`requester|staff|system`), `author_label`, `body` et
`created_at`.

Une page vaut `{items,next_cursor,total}`. Le curseur opaque et l’ordre stable
remplacent une pagination profonde par offset. Une erreur vaut
`{error,code}` avec `unauthenticated|forbidden|not_found|ticket_closed|invalid|
rate_limited|unavailable`.

## Routes versionnées

| Route | Acteur | Résultat / règle |
| --- | --- | --- |
| `GET /api/support/summary` | connecté | `{data:{unread,open}}` personnel |
| `GET /api/support/tickets` | connecté | page personnelle, filtres allowlistés |
| `POST /api/support/tickets` | connecté | création idempotente, propriétaire = JWT |
| `GET /api/support/tickets/:id` | propriétaire ou staff support | ticket + fil autorisé |
| `POST /api/support/tickets/:id/messages` | propriétaire ou staff support | message append-only idempotent |
| `POST /api/support/tickets/:id/read` | acteur autorisé | avance son propre marqueur de lecture |
| `GET /api/support/queue` | staff support | page staff distincte, jamais les fils chantier |
| `POST /api/support/tickets/:id/assign` | staff support | `{assignee:'me'}` seulement en v1 |
| `POST /api/support/tickets/:id/status` | staff support | raison obligatoire pour resolved/closed |

Toutes les réponses privées utilisent `Cache-Control: private, no-store` et
`Vary: Authorization`. Les RPC SQL futures dérivent l’acteur de `auth.uid()`,
revalident compte/rôle/projet, conservent les messages et événements append-only
et refusent `anon`, identités forgées, comptes suspendus et accès transversal.

## Livraison et activation

Ce lot fige le contrat pur et ses tests. Les tables/RPC/RLS et routes réelles
arrivent dans les lots suivants sur migrations additives testées avec JWT et
Supabase jetable. Leur fusion ne vaut ni migration DEV partagée ni activation
PROD. DOW peut aligner ses types et états UI sur ce contrat sans attendre les
écrans staff complets.
