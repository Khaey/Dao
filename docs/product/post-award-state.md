# État post-attribution et décisions P2 suivantes

État factuel vérifié le 5 octobre 2026 sur `main`
`d56726c36241dde04940432355d7572ca16a8ea9`, après la PR #39.
La CI main #283 est verte, y compris schéma frais, reset/replay, intégration
Supabase réelle, E2E desktop/mobile et déploiement DEV.

Ce document est un cadrage. Il ne définit aucun nouveau comportement métier et
ne rend opérationnelle aucune capacité de contrat ou d'exécution.

## 1. Ce qui est opérationnel après la comparaison

| Couche | État actuel |
| --- | --- |
| Données | `awards` regroupe les attributions d'un projet pour un contractor. `award_items` rattache une offre immuable à un lot, avec prix convenu et indicateur `active`. `project_requests.status` passe à `awarded`. |
| Invariants | Une seule attribution active par lot (`one_active_award_per_request`). L'offre doit être la version soumise courante, non expirée. Le contenu soumis et l'identité de l'attribution restent immuables. |
| RPC | `public.award_bid_item_atomic(idempotency_key, bid_item_id)` dérive projet, contractor, lot et montant côté serveur. Il verrouille le lot, accepte seulement `open`/`reserved`, refuse un groupe indivisible multi-lots et écrit un `command_receipt`. L'ancien RPC à paramètres libres n'est plus exécutable par `authenticated`. |
| API/backend | `POST /api/awards` appelle `AwardService`, qui transmet seulement `bid_item_id` et `idempotency_key` au RPC sécurisé. |
| UI | La publication client affiche les versions d'offres soumises courantes par lot, triées par prix puis délai, demande confirmation et montre le lot retenu. Elle annonce explicitement qu'aucun contrat ni démarrage de travaux n'est créé. |
| Sécurité | Client propriétaire ou staff seulement pour attribuer. Client, contractor concerné et staff lisent l'attribution selon la RLS ; les concurrents restent isolés. |

Le RPC réutilise un même `award` pour les lots attribués au même contractor
dans un projet. Une attribution groupée indivisible est protégée par le schéma,
mais n'a pas encore de commande/UI d'attribution atomique de tout le groupe.

## 2. Capacités aval : réel, préparé ou absent

| Domaine | État réel |
| --- | --- |
| Contrat | **Préparé seulement.** Tables `contracts`, `contract_versions`, `contract_parties`; relation unique `contracts.award_id`; parties possibles `client`, `contractor`, `dao`; statuts `draft`, `review`, `ready`; lecture RLS. Aucun RPC de création/version/signature, aucune API, aucune UI et aucune création automatique. |
| États de transition | **Préparés seulement.** `awards.status` prévoit `confirmed`, `contracting`, `contracted`, `cancelled`; `project_requests.status` prévoit `contracted`. Aucun parcours contrôlé ne réalise ces transitions. |
| Jalons / tranches | **Absents.** Aucune table, RPC, API ou UI. |
| Paiements | **Suivi déclaratif seulement.** `projects.payment_status` (`not_set`, `unpaid`, `partial`, `paid`) est modifiable dans le suivi chantier. Il n'est lié ni à un montant, ni à un lot, contrat, jalon, mouvement financier ou justificatif. Ce n'est pas un ledger. |
| Avancement chantier | **Déclaratif global.** `projects.project_stage` suit `not_started`, `started`, `in_progress`, `completed`. Il ne déclenche ni contrat, ni paiement, ni réception. |
| Réception / réserves | **Absentes.** Le statut de lot `reserved` concerne la réservation d'un lot pour une invitation contractor ; ce n'est pas une réserve de réception. |
| Avenants | **Absents.** `contract_versions.content` est un conteneur JSON versionnable, mais aucun modèle d'avenant, acceptation ou effet sur prix/délais n'existe. |
| Résiliation / abandon / reprise | **Absents au niveau contractuel.** `awards.cancelled`, `award_items.active=false` et l'archivage/« abandon » du projet sont des possibilités techniques séparées, sans commande métier de résiliation, motif, conséquences ou reprise. |
| Garantie | **Absente.** Aucun objet, délai, point de départ, réclamation ou clôture. |
| Communication / audit | **Socle générique seulement.** `conversations`, `messages`, `notifications` et `audit_events` existent au schéma, sans parcours aval complet relié au contrat/exécution. L'attribution conserve son reçu d'idempotence et ses lignes horodatées. |

## 3. Dépendances et risques avant implémentation

- **Granularité contractuelle :** un `award` agrège aujourd'hui plusieurs lots
  d'un projet pour un même contractor, tandis que `contracts.award_id` est
  unique. Le modèle préparé implique donc au plus un contrat par award, et
  potentiellement un contrat multi-lots par contractor.
- **Fin de mise en concurrence :** attribuer un lot ne ferme pas la publication
  et ne clôt pas les offres concurrentes. Les commandes d'offre vérifient la
  publication et sa deadline, pas le statut `awarded` du lot. Il faut définir
  quand un lot cesse d'accepter de nouvelles offres et quand une publication
  multi-lots se ferme.
- **Annulation et réattribution :** le schéma permet de désactiver une ligne et
  prévoit `cancelled`, mais aucun workflow autorisé/audité ne définit motif,
  droits, notifications, effet contractuel ou réattribution.
- **Offres indivisibles :** l'intégrité empêche une attribution partielle, mais
  la commande actuelle refuse le groupe plutôt que d'attribuer tous ses lots.
- **Contrat générique :** `contract_versions.content` n'a pas de schéma métier
  canonique. Le contenu, le calcul de hash, les signataires, les preuves et la
  valeur d'une signature doivent être définis avant d'exposer des mutations.
- **RLS contrat :** les versions et parties sont lisibles par les parties du
  contrat. Leur création devra donc être atomique pour éviter un contrat sans
  parties ou un accès incomplet.
- **Séparation à préserver :** membership chantier, affectation directe d'un
  artisan à un lot et award marketplace restent trois concepts distincts.
  Le suivi déclaratif `project_stage` / `payment_status` ne doit pas piloter le
  ledger, le contrat ou la réception.

## 4. Décisions métier nécessaires

1. **Contrat :** un contrat par contractor/projet, par award ou par lot ? Les
   lots ajoutés après signature rejoignent-ils le contrat ou exigent-ils un
   avenant ? D.A.O est-il partie contractante, tiers de confiance ou témoin ?
2. **Conclusion du marché :** quels états et actions suivent l'attribution :
   acceptation contractor, retrait, annulation, réattribution, fermeture du lot
   et fermeture de la publication ? Quels motifs et délais sont obligatoires ?
3. **Offres groupées :** faut-il permettre l'attribution atomique d'un groupe
   indivisible et comment comparer son prix/remise à des offres par lot ?
4. **Contrat et preuve :** contenu obligatoire, version de référence, ordre des
   signatures, refus/expiration, identité des signataires et niveau de preuve
   électronique attendu.
5. **Exécution :** jalons par contrat ou par lot, responsables de validation,
   preuves, états, dépendances et effet d'un retard ou d'un refus.
6. **Paiement :** simple échéancier déclaratif ou ledger financier ; payeur,
   bénéficiaire, montants, devise/arrondis, acomptes, retenues, justificatifs,
   annulations et rapprochement. Aucun encaissement/escrow ne doit être déduit.
7. **Réception :** réception par lot ou globale, acteurs, réception provisoire/
   définitive, réserves, délais de levée et effet sur solde/garantie.
8. **Avenant / résiliation / reprise :** qui initie et accepte, quels champs
   peuvent changer, quels effets sur prix/délais/jalons/paiements, et comment
   préserver l'historique immuable.
9. **Garantie :** type, durée, point de départ, périmètre par lot, déclaration
   d'incident, correction et clôture.

## 5. Découpage P2 proposé après décisions

1. **P2.1 — Clôture d'attribution :** cycle du lot après award, fermeture des
   offres, annulation/réattribution auditée et attribution des groupes
   indivisibles. Ce lot stabilise la frontière avant contrat.
2. **P2.2 — Contrat V1 :** contrat issu d'un award, parties atomiques, contenu
   structuré/versionné, revue et acceptation explicite, sans paiement réel.
3. **P2.3 — Exécution V1 :** jalons/tranches et preuves d'avancement rattachés
   au contrat/lot, toujours sans mouvement financier.
4. **P2.4 — Réception V1 :** réception, réserves et levée des réserves ; point
   de départ explicite de la garantie.
5. **P2.5 — Changements et sortie :** avenants, résiliation/abandon et reprise,
   avec historique et effets déterministes.
6. **P2.6 — Paiements :** à lancer seulement après décision sur ledger,
   fournisseur de paiement éventuel et responsabilité financière de D.A.O.
7. **P2.7 — Garantie :** suivi des garanties et incidents après réception.

Le prochain lot recommandé est **P2.1**, car il ferme les ambiguïtés laissées
entre award, offres et publication sans engager encore le contrat, la signature
ou les flux financiers.
