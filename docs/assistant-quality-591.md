# Qualification des propositions de l'assistant — #591

Le test comparatif utilise le snapshot publié `TN-2026.3` lu sur DEV pour #578
(11 lots, 29 ouvrages) et l'adaptateur `mapDaoCatalog`. C'est un contrôle
déterministe local sur ce snapshot, distinct d'une recette navigateur DEV.

| Description | Avant : ouvrages retenus | Après : ouvrages retenus | À confirmer / limite |
| --- | --- | --- | --- |
| Maison neuve à Sousse, 180 m² R+1 | 11, sur 7 lots | 11, sur 7 lots | Base indicative de construction, études et dimensions encore à vérifier. |
| Appartement à rénover, **uniquement** salle de bain | 10, sur 6 lots, dont toiture, isolation extérieure et électricité | 1 (« Équipements sanitaires »), sur 1 lot | Le besoin exact de plomberie, carrelage ou dépose reste à préciser par le client. |
| Réparer une fuite dans une salle de bain | 1 (« Équipements sanitaires »), alors que la fuite ne prouve pas la pose d'un équipement | 0 ; correspondance consultable, question sur l'élément précis | `other` reste le type de projet stocké : le schéma actuel ne possède pas `repair`. Ne pas traduire silencieusement en rénovation. |
| Refaire la peinture d'une chambre, sans toucher à la salle de bain | 9, sur 6 lots | 1 (« Préparation des supports et peinture »), sur 1 lot | La surface et l'état du support ne sont pas déduits. |
| « Je veux faire des travaux » | 0 | 0 | Demande du type de travaux avant de choisir un ouvrage. |

**Règle de sélection.** Pour une rénovation, l'applicabilité du catalogue
affiche des possibilités mais ne vaut pas acceptation du périmètre commercial.
Seuls les éléments explicitement reconnus ou retenus par le client sont cochés.
La construction neuve et l'extension conservent la base indicative existante,
sauf si le client écrit « uniquement ». Une réparation reste sans ouvrage coché
tant que le type précis de travail n'est pas confirmé ; les candidats reconnus
restent visibles à choisir manuellement. Les droits, IDs, versions, unités et
calculs n'ont pas changé.

**Limite métier.** Les alias du catalogue lient parfois une *pièce* à un
ouvrage (ex. « salle de bain » → « Équipements sanitaires »). Le moteur par
mots-clés ne peut pas déduire qu'une fuite nécessite cet ouvrage. Une
proposition cochée n'est jamais un diagnostic professionnel. Une recette
authentifiée mobile/PC doit vérifier la compréhension des choix avant clôture.

# Retour utilisateur du 15/11 — salle de bain

La formule courte « salle de bain rénovation » ne confirmait qu'un ouvrage
« Équipements sanitaires » ; les travaux possibles étaient cachés parmi les
autres lots. La proposition présente désormais, sans les cocher, les ouvrages
publiés liés à une rénovation de salle de bain : dépose sélective, réseaux
eau/évacuation, équipements sanitaires et carrelage/faïence. Le Client choisit
chaque ouvrage ; l'API rattache alors ses vrais lot et sous-lot. Une pièce seule
ne vaut pas commande d'équipements. Étanchéité de toiture, électricité et
isolation ne sont pas présumées. Il n'y a ni quantité ni prix déduit.
