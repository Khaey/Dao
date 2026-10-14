# Contrat V1 — fondation et acceptation contrôlée

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

## P2.2-B — acceptation paramétrable et neutre

DAO Pilot a validé le 13 octobre 2026 les règles suivantes :

- D.A.O est portée par **LogicLab Tunisie** pour le lancement tunisien ; son
  représentant habilité reste une donnée contrôlée, jamais une identité déduite ;
- une version immuable reçoit séparément l'accord du client et du prestataire,
  puis un administrateur D.A.O effectue le contrôle final ;
- l'abandon avant validation est réservé à D.A.O, exige un motif et conserve
  tout l'historique ;
- une acceptation simple produit un dossier de preuve technique, mais n'est
  jamais présentée comme une signature qualifiée ;
- l'effet juridique est techniquement bloqué jusqu'à validation des clauses,
  de l'homologation et du fournisseur par un juriste tunisien.

Le mode est figé par contrat (`disabled`, `trusted_simple`, `qualified`,
`hybrid`) sans imposer de fournisseur. Il pourra être alimenté plus tard par
des paramètres de pays, type de chantier ou seuil.
P2.2-B n'invente aucun seuil. Seul le service de confiance peut ouvrir le cycle,
enregistrer une preuve déjà vérifiée, valider ou annuler : aucun RPC authentifié
ne peut déclarer lui-même qu'une preuve est correcte.

`contract_acceptances` rattache l'accord à la version et à son acteur. La base
conserve une empreinte SHA-256 de la preuve et des métadonnées non secrètes ;
elle ne conserve jamais un code OTP en clair. Dans P2.2-B, l'activation de
l'effet juridique est refusée par la base : le contrôle final conduit à
`ready`, et non à `signed`.

P2.2-C devra choisir puis intégrer un prestataire de confiance (NGSign et
DigiGO/TUNTRUST restent des candidats), produire le document définitif et
définir les conditions d'activation juridique après preuve d'homologation et
validation juridique. Aucun paiement ni démarrage des travaux n'est déclenché
par P2.2-B.
