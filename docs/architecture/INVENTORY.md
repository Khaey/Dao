# D.A.O — Guide de lecture de l'architecture visuelle

Ce document complète `workspace.dsl` avec une lecture orientée produit.

## Vues Structurizr

| Vue | Utilité |
| --- | --- |
| `Landscape` | Voir D.A.O dans son environnement global : utilisateurs, Supabase, Resend, GitHub et VPS |
| `SystemContext` | Comprendre qui utilise D.A.O et ses dépendances externes |
| `ProductMap` | Carte détaillée des domaines métier actuellement présents dans l'application |
| `ClientWorkspace` | Parcours et composants côté Client |
| `ContractorWorkspace` | Parcours Artisan / Entreprise |
| `Backoffice` | Back-office Gestionnaire/Admin et extensions prévues |
| `SecurityData` | Auth → API → services → RPC → RLS/DB/Storage |
| `Roadmap` | Éléments en cours ou futurs, sans les confondre avec le runtime actuel |
| `ClientProjectFlow` | Création projet → lots → documents → revue |
| `CorrectionFlow` | Rejet → correction via nouvelle version → resoumission |
| `ExistingTeamFlow` | Client avec équipe existante → lots principaux → invitations |
| `PublicationBidFlow` | Approbation → publication → offre artisan |
| `AwardFlow` | Comparaison/attribution atomique par lot |
| `ManagerFlow` | Pilotage du Gestionnaire V1 |
| `DocumentAccessFlow` | Contrôle d'accès et signed URL pour document privé |
| `DevDeployment` | Déploiement actuel sur le VPS DEV |

## Statut fonctionnel

### Actuel / présent dans le produit

- Auth client / contractor / reviewer / admin
- récupération de mot de passe
- profils
- projets / versions
- lots réels / versions de lots
- budgets techniques en millimes
- documents privés
- informations chantier confidentielles
- membres chantier
- invitations
- confirmation/refus/révocation
- création client avec équipe existante
- 1 invitation contractor = 1 lot principal au moment de l'onboarding
- affectation ultérieure d'un contractor accepté à d'autres lots
- revue client → D.A.O
- rejet motivé / correction par nouvelle version
- approbation
- publications public / targeted / invite-only
- offres / versions / soumission
- isolation concurrentielle
- fondation d'attribution atomique par lot
- Back-office Gestionnaire V1
- Resend invitation email V1
- CI avec Supabase local jetable
- DEV sur VPS OVH

### En cours / préparé mais non considéré terminé

- comparaison client des offres par lot (travail P2 / ancienne PR #27 à réconcilier avec le main)

### Futur explicitement décidé

- gestion détaillée de l'équipe interne D.A.O
- permissions fines internes
- Settings avancés / moteur de configuration
- politique de session et réauthentification staff/admin
- contrats
- jalons/tranches
- financement/versements et ledger financier
- suivi avancé exécution
- réception / réserves
- avenants
- résiliation / reprise
- garantie
- sous-traitance par une entreprise titulaire (P3)
- éventuelle évolution SaaS/multi-tenant, différée

## Frontières à ne pas mélanger

```text
Projet
!= Version projet
!= Lot
!= Version lot
!= Publication
!= Offre
!= Attribution
!= Membership chantier
```

Une invitation ou un membership n'est jamais une attribution marketplace.

Un `contractor` global n'est pas nécessairement seulement un soumissionnaire :
le rôle joué sur un chantier dépendra à terme du contexte du projet/lot.

## Sécurité structurante

```text
Utilisateur
  ↓
Supabase Auth / JWT
  ↓
Next.js UI / API
  ↓
Services métier
  ↓
RPC contrôlées
  ↓
RLS / dao_private
  ↓
PostgreSQL / Storage privé
```

La visibilité UI n'est jamais la frontière de sécurité.

Restent non configurables comme simples Settings :

- RLS et isolation des données
- interdiction de s'auto-promouvoir admin
- historique immuable soumis/rejeté
- confidentialité des offres concurrentes
- confidentialité des documents privés
- invariant d'une attribution active par lot
- intégrité du futur ledger financier

## Principe de maintenance

Si une PR change un acteur, un domaine métier, une intégration, une frontière
de sécurité, un workflow structurant ou le déploiement, elle doit revoir aussi
`workspace.dsl`.

Le diagramme doit montrer l'état réel et distinguer visuellement tout élément
`InProgress` ou `Planned`.
