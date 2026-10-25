# Espaces Admin et Gestionnaire — architecture d'information

Mission [#441](https://github.com/Khaey/Dao/issues/441). Refonte UX **sans changement de règle métier,
d'API ni de droit** : le menu montre, le serveur (JWT/RLS) décide.

## Principe

- **Admin** (`dao_admin`) = gouverner la plateforme : supervision, paramètres, comptes et rôles,
  délégations, audit, intervention globale sur les revues.
- **Gestionnaire** (`dao_reviewer` seul) = faire avancer les dossiers : sa file de revue, chantiers,
  publications, relations professionnels/clients, assistance.

## Menu (`dao-frontend/app/app/RoleNav.tsx`)

| Groupe | Admin | Gestionnaire |
| --- | --- | --- |
| (sans titre) | Tableau de bord | Tableau de bord |
| Dossiers | Revues, Chantiers, Publications, Mes contrats | Revues, Chantiers, Publications |
| Relations | Professionnels, Clients, Avis, Assistance | Professionnels, Clients, Avis, Assistance |
| Gouvernance | Utilisateurs & rôles, Historique | — |
| Traçabilité | — | Historique |
| Compte (bas du menu) | **Paramètres** (onglets « Mon compte » / « Plateforme D.A.O. »), Déconnexion | **Paramètres** (onglets « Mon compte » / « Mes délégations » si mandat S4 actif), Déconnexion |

Les URL ne changent pas. **Une seule entrée de paramètres** (décision du propriétaire, 25/10) :
`/app/settings` et `/app/dao/settings` sont deux onglets de « Paramètres » (`components/SettingsTabs.tsx`) ;
la page ne reprend aucun raccourci déjà présent dans le menu (pas de « Vos espaces ») et la ligne
d'identité en bas du menu n'est plus un second lien vers le compte. Les comptes Client/Artisan gardent
leur menu plat.

## Tableau de bord (`/app/dao`)

Titre commun « Pilotage D.A.O ». Admin : « À surveiller » (emails de suivi en échec parmi les 100
derniers, prêts à publier, publications actives, profils à vérifier), file de revue, « Gouvernance ».
Gestionnaire : file de revue d'abord, puis « Ensuite ». Deux listes courtes seulement : dossiers à
examiner, chantiers à publier.

## En-tête et listes (`components/backoffice/PageChrome.tsx`)

- `StaffHeader` : fil d'Ariane, sur-titre = groupe du menu, titre, phrase d'usage, action principale.
  Utilisé par Revues, Chantiers, Publications, Professionnels, Clients, Utilisateurs & rôles, Historique ;
  Avis, Assistance et Fiches professionnelles portent le même sur-titre « Relations ».
- `StaffTabs` : vues sœurs d'un domaine (Professionnels : « Comptes et vérification » / « Fiches et médias »).
- Liste type (Chantiers, Publications) : barre de recherche/filtres `role="search"`, compteur et
  « Réinitialiser les filtres », erreur avec « Réessayer », squelette, vide expliqué ; Publications en
  tableau sur desktop et liste compacte sur mobile.

## Fiche détail et Historique

- Fiche « Dossier du compte » (Professionnels, Clients, Utilisateurs) : en-tête avec badges d'état,
  puis sections Informations, Vérification et visibilité (Vérifier / Refuser), Dossiers liés,
  Rôles cumulables, et un bloc « Actions sensibles » réservé à l'Admin (suspendre, réactiver,
  identité publique). Mêmes commandes et confirmations qu'avant.
- Historique : onglets « Journal des actions » / « Emails de suivi » (`/app/dao/history/emails`),
  affichés à l'Admin seul car la file d'emails est réservée à l'Admin côté RPC. La tuile d'emails
  en échec du tableau de bord pointe vers cet onglet.

## Étapes suivantes

4. Suivi terrain Gestionnaire : **gate**, aucun accès staff au suivi natif ni aux réserves aujourd'hui ;
   décision du propriétaire puis backend DEV 3 et écran Mission 1.
