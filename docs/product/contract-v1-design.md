# Contrat V1 — fondation non engageante

Décisions validées par DAO Pilot pour le lot P2.2-A, suivi dans
[#125](https://github.com/Khaey/Dao/issues/125). Cette tranche pose le modèle,
l'intégrité et l'isolation. Elle n'ouvre aucun parcours utilisateur de création,
revue, acceptation ou signature.

## Contrat canonique

- Un contrat correspond exactement à un `award`. Un award peut contenir
  plusieurs lots attribués au même contractor.
- Les lignes `contract_items` figent les lots actifs au moment de la préparation :
  version de demande, ligne d'offre, prix convenu en millimes, périmètre, durée,
  inclusions et exclusions. Leur somme est `contracts.total_millimes`.
- Les trois parties sont le client, le contractor titulaire et D.A.O. L'identité
  juridique D.A.O n'est pas inventée : la préparation technique exige un
  utilisateur administrateur actif et un nom juridique fourni côté service.
- La version 1 contient un JSON canonique marqué `non_engaging=true` et une
  empreinte SHA-256. Versions, parties, lignes, événements et archives sont
  append-only.

## États et exposition

Le vocabulaire cible est `draft → review → ready → awaiting_signatures → signed`.
P2.2-A crée seulement un `draft` verrouillé et non engageant. Aucun état suivant
n'est atteignable par une commande publique dans ce lot. La façade de préparation
est réservée au `service_role`; elle n'est appelée par aucune API ou interface.

La préparation est atomique et idempotente. Elle se sérialise avec l'annulation
d'attribution au niveau du chantier : soit l'annulation gagne, soit le contrat
est préparé, jamais les deux. La règle P2.1 interdisant l'annulation après
création d'un contrat reste inchangée.

## Accès

| Acteur actif | Lecture |
| --- | --- |
| Client partie | Oui |
| Contractor partie | Oui |
| Administrateur D.A.O | Oui |
| Gestionnaire/reviewer non administrateur | Non |
| Concurrent, autre client, compte suspendu | Non |

La RLS est recalculée à chaque lecture. Les écritures directes authentifiées
restent interdites. Le lot ne crée ni consentement juridique, ni signature,
ni PDF exécutoire, ni paiement, ni mouvement financier.

## Lots suivants bloqués par décision

P2.2-B/C devront définir la sortie contrôlée du brouillon, l'identité juridique
exacte de D.A.O, le contenu contractuel obligatoire, les acteurs habilités,
l'acceptation et le niveau de preuve. Rien dans cette fondation ne vaut accord
des parties ou autorisation de démarrer les travaux.
