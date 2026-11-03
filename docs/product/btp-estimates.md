# Base de prix BTP sourcés et estimation budgétaire (#551)

Owner : **Coordinateur Mission 1** ([#551](https://github.com/Khaey/Dao/issues/551)). Réutilise le référentiel
de DEV 5 ([#541](https://github.com/Khaey/Dao/issues/541)) et consomme les métrés de DEV 5
([#548](https://github.com/Khaey/Dao/issues/548)) par contrat, sans second moteur de quantités.
L'administration du référentiel reste au Coordinateur Mission 2 ([#547](https://github.com/Khaey/Dao/issues/547)).

**Aucun prix n'est livré par cette mission.** Tant qu'aucune source réelle autorisée n'est saisie et
vérifiée, toute estimation en mode « référence » est **indisponible** et liste les informations à fournir.

## Audit anti-doublon (main@52dc370)

| Existant | Décision |
| --- | --- |
| `btp_price_books` / `btp_work_prices` (#541) : vides, sans type de prix, HT/TTC, TVA, licence, statut ni révisions | Non utilisés par le moteur ; laissés intacts (propriété #541/#547). |
| `btp_works`, `btp_units` : ids canoniques stables entre versions | Réutilisés : un tarif référence `(work_id, catalog_version_id, unit_code)`. |
| `project_assistant_scope_links` (#543) | Réutilisés comme périmètre (lignes « quantité inconnue »). |
| Métrés `btp_takeoffs` (#548) | Lus par contrat (révision **validée** seulement) si la table existe ; valeur envoyée par le client ignorée. |
| Offres/devis (`bid_items`, `bid_quote_lines`) | **Jamais** utilisés comme barème (prix négociés et confidentiels). |
| Budgets indicatifs saisis par le Client | Inchangés, non mélangés. |
| OCE | Aucune base de coûts exploitable ; OCE reste facultatif. |

## Modèle

- `btp_price_sources` (immuable) : code, éditeur, type (`official_publication`, `professional_body`,
  `supplier_catalog`, `market_survey`, `human_entry`, `test_fixture`), nature `real` ou
  `fictitious_test` (liée à `test_fixture`), URL HTTPS obligatoire hors saisie humaine/test, licence.
- `btp_price_items` : ouvrage canonique + unité **de l'ouvrage**, composante (`composite`, `material`,
  `labour`, `equipment`), pays, gouvernorat (vide = national), type `observed` ou `private_assumption`
  (hypothèse d'un chantier), statut `pending → verified | rejected`, `declared`, `retired`.
- `btp_price_item_revisions` (append-only) : montant ou fourchette en millimes, devise, base `HT`/`TTC`,
  taux de TVA explicite facultatif, inclusions déclarées (transport, marge… seulement si fournies),
  date d'observation, période de validité, localisation dans la source, conditions, auteur.
- `btp_price_events` : journal append-only (saisie, révision, vérification, rejet, retrait).
- `btp_estimates`, `btp_estimate_revisions` (append-only, empreintes SHA-256 des entrées et du
  résultat), `btp_estimate_events` (calcul, référence retenue, référence dépassée).

Cycle d'un tarif observé : un membre du staff D.A.O. (Admin ou relecteur) saisit ; **un Admin
différent de l'auteur** vérifie ou rejette (motif obligatoire). Une nouvelle révision repasse
`pending` ; la dernière révision vérifiée reste seule utilisée. Une hypothèse privée est saisie par
le Client propriétaire ou le Gestionnaire affecté, n'est jamais « vérifiée » et n'est utilisée que
sur demande explicite.

## Moteur (`dao_private.btp_estimate_compute`, règles `estimate-rules-v1`)

Lignes : ajoutées explicitement, métrés validés du chantier, ouvrages retenus par l'assistant.
Quantité : métré validé (#548) ou quantité **déclarée** avec référence (signalée non validée), dans
l'unité de l'ouvrage (aucune conversion). Sélection du tarif :

1. même ouvrage et même unité ; tarif vérifié non retiré ou hypothèse privée demandée ;
2. période de validité couvrant la date de référence ; devise TND (pas de taux de change sourcé) ;
3. priorité hypothèse privée demandée > gouvernorat du chantier > national ; jamais un autre gouvernorat ;
4. prix global prioritaire, sinon somme des composantes publiées (ligne signalée partielle) ;
5. observation la plus récente ; sources ex aequo = fourchette min–max ;
6. mode `simulation` : uniquement des données `fictitious_test` ; mode `reference` : uniquement `real`.

Montant de ligne = quantité × prix unitaire, arrondi au millime (demi supérieur) en arithmétique
entière ; HT et TTC séparés, conversion seulement avec le taux du tarif. État `complete` (toutes les
lignes chiffrées par un prix global), `partial` (le total est libellé « sous-total des seules lignes
chiffrées ») ou `unavailable` (aucun montant). Codes manquants : `quantity_missing`,
`quantity_not_validated`, `quantity_unit_mismatch`, `price_missing`, `price_out_of_validity_period`,
`price_currency_without_sourced_rate`, `price_unit_differs_from_work_unit`, `work_not_in_catalog`.
Aucune fourchette ni niveau de confiance arbitraire.

Le service TypeScript (`src/btp-estimate/engine.ts`) **revérifie** chaque montant et total en BigInt
et l'honnêteté de l'état ; l'écran affiche « Calcul revérifié » ou « Écart de calcul détecté ».

Une révision retenue comme référence (`approve`, refusée si l'estimation est indisponible) n'est
jamais modifiée : un recalcul crée une révision suivante, repasse le dossier en brouillon et
conserve la référence précédente (`approval_superseded`). Ce n'est **ni un devis, ni un engagement**.

## API (JWT obligatoire, `private, no-store`)

| Route | Effet |
| --- | --- |
| `GET /api/btp/prices[?project_id=]` | Sources + tarifs visibles (staff : tout ; autres : révisions vérifiées ; hypothèses privées du chantier si accès) |
| `POST /api/btp/prices` | `action` = `register_source` (Admin), `record` (staff, ou hypothèse privée), `verify` / `reject` (Admin ≠ auteur), `retire` ; `idempotencyKey` requise |
| `GET /api/btp/estimates?project_id=` | Estimations du chantier, historique, événements, métrés disponibles, contrôle arithmétique |
| `POST /api/btp/estimates` | `preview` (sans enregistrement, contrat utilisable par l'assistant #543), `calculate` et `approve` (clé idempotente, `expectedRevision`) |

Droits : Client propriétaire, Gestionnaire affecté (`manages_project`) et Admin. Les Artisans,
membres du chantier compris, et les autres Clients n'ont aucun accès. Tables en lecture RLS, aucune
écriture directe ; RPC `SECURITY DEFINER` derrière des façades `SECURITY INVOKER`. Erreurs : 400,
401, 403, 404, 409 (révision obsolète), 503.

## Écran

Fiche chantier → carte « Budget prévisionnel » → `/app/projects/<id>/estimate` : avertissement non
contractuel, ouvrages et quantités, mode référence ou simulation (badge « données fictives »),
hypothèses privées, totaux HT/TTC ou état indisponible, informations manquantes, sous-totaux par lot,
justification de chaque ligne (source, licence, date, zone, période, version du référentiel),
règles de calcul et historique des révisions.

## Hors périmètre / suites

Pas d'écran d'administration des tarifs (API seulement, point d'intégration pour #547), pas
d'import automatique, pas de taux de change, pas de prix issus des offres. Le raccordement aux
métrés #548 est contractuel ; sa recette réelle dépend de la fusion de #550.
