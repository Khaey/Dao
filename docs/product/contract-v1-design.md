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

### Activation par chantier après #390

Le défaut reste OFF. Le Client propriétaire actif fixe le choix avant la
première attribution active via une commande JWT/RLS auditée. L'activation est
refusée tant que D.A.O n'a pas configuré explicitement un représentant
`dao_admin` actif de **LogicLab Tunisie** ; aucune identité n'est choisie par
ordre de création ou rôle implicite.

Un trigger différé sur la création de l'award attend l'insertion de toutes les
lignes, puis appelle la fondation interne dans la même transaction. La création
de l'award, son reçu idempotent, les lignes et le brouillon sont donc validés
ensemble ou annulés ensemble. OFF crée uniquement une trace technique
`disabled` et n'appelle pas la fondation. Les retries de la commande d'award ne
réexécutent pas le trigger et ne créent jamais un second contrat.

Le choix s'applique aux nouveaux awards seulement. Un lot remporté plus tard
reste un nouvel award et prépare son propre contrat ; le dossier chantier ×
Artisan est une projection UI qui ne fusionne ni ne réécrit les snapshots.

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

Le choix d'un prestataire de confiance (NGSign et DigiGO/TUNTRUST restent des
candidats), le document juridique définitif et l'activation de l'effet juridique
restent un lot séparé, après preuve d'homologation et validation juridique.
Aucun paiement ni démarrage des travaux n'est déclenché par P2.2-B.

## P2.2-C — propositions d'avenant non engageantes

DAO Pilot a validé le 15 octobre 2026 le périmètre suivant dans #174 :

- seul le Client partie au contrat peut initier une proposition ;
- la proposition peut clarifier le périmètre sans changer les lots, proposer un
  delta de montant en millimes et proposer une date/durée ;
- le Client et le Prestataire donnent chacun leur accord sur la même version,
  puis D.A.O effectue le contrôle final ;
- chaque partie peut refuser avec un motif et D.A.O peut annuler avec un motif
  avant son contrôle final ; aucune expiration automatique n'est ajoutée ;
- le résultat reste `non_engaging` et `legal_effect_enabled=false`.

Une proposition est un objet distinct. Elle référence la version contractuelle
de base et son hash, possède sa propre version canonique/hashée, ses accords et
ses événements append-only. Sa validation ne modifie jamais le contrat initial,
son total, ses lots, l'attribution ou les dates exécutoires. Un ajout/retrait de
lot, un changement de partie, une réattribution, des taxes/frais/acomptes, un
paiement, un jalon, une réception, une garantie ou une résiliation restent hors
périmètre.

Les commandes sont réservées au service : la base vérifie néanmoins l'identité
du Client initiateur, les parties exactes, les comptes actifs et l'administrateur
D.A.O. Les parties et l'administrateur D.A.O actif peuvent lire ; les simples
membres du chantier, concurrents, tiers, anonymes et comptes suspendus restent
isolés. Aucun écran utilisateur ni document présenté comme signé ou applicable
n'est livré par cette fondation.

## P2.2-D — consultation privée en lecture seule

Le lot #178 expose les fondations P2.2-A/B/C sans ajouter de commande métier.
Deux routes authentifiées permettent de lister les contrats visibles et de
consulter un dossier précis. Elles utilisent exclusivement le client Supabase
portant le JWT de l'utilisateur : la RLS existante reste l'autorité, sans
`service_role`, sans droit dérivé d'une simple participation au chantier et
sans élargissement Gestionnaire.

La réponse serveur est une projection explicite. Elle montre le montant et les
lots de référence, les parties, la version/hash, les statuts, accords techniques
et événements autorisés. Elle ne renvoie jamais les hashes de preuve, références
fournisseur, métadonnées internes ou chemins Storage. Un UUID non visible est
traité comme introuvable afin de ne pas révéler l'existence d'un contrat.

L'interface `/app/contracts` et `/app/contracts/[id]` est responsive et
strictement en lecture seule. Elle sépare le montant contractuel de référence
des deltas/totaux/dates proposés par les avenants et affiche en permanence
« Non signé — aucun effet juridique » et « Proposition d'avenant — non
engageante ». Aucun bouton ne crée, accepte, refuse, annule, modifie ou signe.
