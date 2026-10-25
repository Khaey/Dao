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
| Gouvernance | Utilisateurs & rôles, Paramètres D.A.O., Historique | — |
| Traçabilité | — | Historique (+ Mes délégations avec un mandat S4 actif, #437) |

Les URL et libellés de lien ne changent pas (ils sont assertés par les E2E). Les comptes
Client/Artisan gardent leur menu plat.

## Tableau de bord (`/app/dao`)

Titre commun « Pilotage D.A.O ». Admin : « À surveiller » (emails de suivi en échec parmi les 100
derniers, prêts à publier, publications actives, profils à vérifier), file de revue, « Gouvernance ».
Gestionnaire : file de revue d'abord, puis « Ensuite ». Deux listes courtes seulement : dossiers à
examiner, chantiers à publier.

## Étapes suivantes

2. Gabarit liste commun (en-tête, filtres, tableau desktop / cartes mobile).
3. Gabarit détail (actions sensibles séparées) ; Historique en onglets Journal / Emails.
4. Suivi terrain Gestionnaire : **gate**, aucun accès staff au suivi natif ni aux réserves aujourd'hui ;
   décision du propriétaire puis backend DEV 3 et écran Mission 1.
