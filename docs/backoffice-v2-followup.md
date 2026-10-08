# Back-office V2 — reprise fonctionnelle #64

Le pilote signale des corrections restantes et prévoit de transmettre d’autres retours après ses tests manuels. #64 a été rouvert. Le succès de #68, ses 48 E2E et sa migration unique restent acquis ; ils ne constituent pas une validation exhaustive de l’usage réel.

Base de cette reprise : main `c38e4ca137bd5997cc2e0876108a5ce486f7453a`, CI/main/deploy #343 SUCCESS. Branche `fix/backoffice-v2-usability`. Aucun changement backend, schema/RLS/Auth, aucune migration ni opération OCE.

| Défaut constaté | Correction candidate | Validation ciblée |
| --- | --- | --- |
| Le dashboard transmet `status=approved`, ignoré par Chantiers | Filtres URL lus ; seuls les chantiers approuvés avec lots publiables sont affichés par ce raccourci | E2E existant renforcé |
| Compteur projets limité à la première page et versions historiques ; archives comptées | Pagination du reader autorisé ; une version courante par chantier ; priorité au statut archivé | TypeScript et CI ; garde logique revue |
| Profils à vérifier mélange vérification et identité publique | Compte seulement pending, lien vers la liste filtrée, identité séparée | Revue code et CI |
| Cartes de professionnels sans action | Lien vers la recherche préremplie du dossier | Revue code et CI |
| Nom du gestionnaire absent du détail | Profil lu sous JWT/RLS et nom affiché | E2E existant renforcé |
| Édition proposée sur toute version approuvée | Édition seulement en revue ou après retrait, en accord avec le serveur | E2E existant renforcé |
| Lot déjà publié retirable depuis la composition de revue | Commande désactivée avec explication ; lot encore publié non éditable | E2E existant renforcé |
| Nouveau lot ajouté impossible à enlever avant enregistrement | Suppression locale du nouveau lot, sans mutation métier | E2E existant renforcé |
| Fermer l’éditeur conserve des saisies non enregistrées | Réinitialisation depuis le snapshot serveur à chaque ouverture/fermeture | E2E existant renforcé |
| Aucun lien du back-office vers documents/équipe du chantier | Accès au chantier complet existant, mêmes permissions | E2E existant renforcé |
| Historique : filtres par UUID et sujets de sous-lots absents | Sélecteurs avec noms des acteurs/dossiers ; noms des sous-lots sous RLS ; lot/publication filtrables dans un chantier | E2E existant renforcé |
| États/types/visibilité/emails affichés en anglais | Libellés contextuels français, sans confondre refus de profil et corrections de dossier | TypeScript et CI |
| Fiche professionnelle trop sommaire | Responsable, présentation, expérience, nom public et disponibilité existants affichés | Revue code et CI |

TypeScript local PASS ; aucune assertion antérieure supprimée, aucun scénario/viewport supprimé, aucun skip/retry/sleep/force ajouté. Les 48 exécutions existantes couvrent davantage de comportements ; la découverte n’est pas une preuve d’exécution. Les preuves exactes PR/main/deploy sont consignées dans #64 après obtention.

Lecture DEV de l’outbox : un événement `staff_project_updated` est `sent`, sans erreur. Ceci atteste un état d’envoi enregistré, pas la réception boîte mail ni tous les parcours de statut. Aucun email de test envoyé par cette reprise.

## Suite des retours manuels

La liste ci-dessus n’est pas présumée exhaustive. Conserver #64 ouvert pendant le retour manuel annoncé par le pilote. Pour chaque retour : surface/acteur, action réelle, résultat observé et attendu, cause identifiée, correction et preuve. Ne pas déduire une nouvelle règle métier d’un symptôme d’interface.
