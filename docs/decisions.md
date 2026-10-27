# D.A.O. — Décisions métier et techniques validées

Registre **consolidé par domaine** des décisions en vigueur au 25 octobre 2026, reconstitué depuis
les issues GitHub, les PR fusionnées, les migrations et la documentation du dépôt. Il ne remplace pas
les sources : chaque ligne renvoie à l'issue ou au document qui fait foi. L'historique numéroté
(D-001 → D-046) et les décisions d'organisation passées restent dans
[ai-context/DECISIONS.md](ai-context/DECISIONS.md) ; les règles métier détaillées dans
[ai-context/BUSINESS_RULES.md](ai-context/BUSINESS_RULES.md).

**Règle de priorité** : décision explicite et récente du propriétaire > ce registre > documents
historiques. Une décision nouvelle s'ajoute ici dans la PR qui l'implémente (ou la documente),
avec sa source.

Légende : **Livré** = fusionné sur `main` ; **Cadré** = décidé, pas (entièrement) implémenté ;
**Hors GO** = interdit sans nouvelle décision du propriétaire.

---

## 0. Principes transverses

| Décision | État | Source |
| --- | --- | --- |
| GitHub `Khaey/Dao` est la source durable du contexte ; les passations sont des instantanés. | Livré | D-001, [#436](https://github.com/Khaey/Dao/issues/436) |
| **Un seul parcours progressif, pas de mode Simple/Avancé.** Sous-lots, dates, dépendances, jalons, métrés et échéancier sont des options indépendantes révélées par « Ajouter… » ; leur absence n'impose ni étape ni écran vide. Un grand chantier peut rester simple, un petit être détaillé. | Livré (UX P10) | [#408 arbitrage 24/10](https://github.com/Khaey/Dao/issues/408#issuecomment-6387947204), [#410](ux/410-tableau-natif.md) — supersède la notion « Simple/Avancé » de [#387](https://github.com/Khaey/Dao/issues/387) |
| **Option de saisie ≠ paramètre métier** : le choix contrat ON/OFF et les autorisations globales restent des réglages explicites et sécurisés. | Livré | #408, [#387](https://github.com/Khaey/Dao/issues/387) |
| **Aucun effet juridique ou financier automatique** sans décision explicite : ni signature, réception juridique, garantie, facture, dette, paiement ni mouvement d'argent déclenchés par le système. | Permanent | #61, #125, #345, #425 |
| **OCE est facultatif** : D.A.O. reste la source de vérité ; le suivi natif fonctionne sans OpenConstructionERP. OCE reste opérationnel en comparaison pendant la transition, sans suppression brutale ni nouvelle tâche OCE automatique. | Livré (P10) | [#408](https://github.com/Khaey/Dao/issues/408), D-019, D-041, [#58](https://github.com/Khaey/Dao/issues/58) |
| Montants en **TND millimes entiers** ; pas de taxe, devise ou somme déduite implicitement. | Permanent | D-014 |
| Versions soumises/acceptées **immuables**, historiques **append-only**, commandes **idempotentes**, pas de suppression d'archives. | Permanent | BUSINESS_RULES §16 |
| Les états déclaratifs ne se confondent jamais : avancement déclaré ≠ vérification Client ≠ réception ≠ échéance autorisée ≠ argent versé. | Permanent | [#408 spec gelée §8](https://github.com/Khaey/Dao/issues/408#issuecomment-6388003011) |
| **Statuts vrais, nommés et par lot** : `client_review` = « En attente de validation D.A.O. » (jamais « Validation client ») ; l'état des conditions est lu par attribution (« Conditions convenues / à convenir ») et les liens nomment le lot (« Conditions — Plomberie ») ; « À faire » ne liste que les actions de l'utilisateur, les attentes sont séparées ; la complétude du dossier ne compte que l'obligatoire (budget et documents affichés comme facultatifs). | Livré (phase 1 UX) | [#387](https://github.com/Khaey/Dao/issues/387), [#483](https://github.com/Khaey/Dao/issues/483) |
| Erreurs visibles : un échec de lecture n'affiche jamais « aucun chantier / aucune offre » ; `null` (non renseigné) ≠ `0 %`. | Livré | #405, #408 |

## 1. Chantier, rôles et espaces

| Décision | État | Source |
| --- | --- | --- |
| Rôles globaux : `client`, `contractor` (Artisan/entreprise), `dao_reviewer` (Gestionnaire), `dao_admin`. Un rôle admin ne s'auto-attribue pas. | Livré | ARCHITECTURE §4, BUSINESS_RULES §17 |
| Compte **double rôle** : agit dans l'espace explicitement sélectionné (`profiles.last_workspace`), jamais l'union des droits. | Livré | D-043, #289, #428 |
| **Un seul modèle de chantier** ; participation (« Mes chantiers ») et marketplace (« DAO disponibles ») sont séparées. Un rôle global ne remplace jamais une participation au chantier. | Livré | D-029, BUSINESS_RULES §21 |
| Client avec **équipe existante** : 1 Artisan invité = 1 lot principal réel ; aucune publication ni appel d'offres imposé ; l'acceptation crée la participation, pas d'award ni de contrat. | Livré | BUSINESS_RULES §23 |
| Invitations : jeton aléatoire stocké haché, expirant, révocable, usage unique ; l'email transporte la même invitation (aucun détail privé). | Livré | BUSINESS_RULES §21–22 |
| Isolation : un Artisan ne voit jamais les offres, prix, groupes ou documents d'un concurrent ; connaître un ID ne contourne pas l'autorisation. | Permanent | BUSINESS_RULES §17–18 |
| Gestionnaire (`dao_reviewer`) : back-office sur le périmètre staff/chantiers affectés ; peut **préparer ou proposer** (avec auteur, motif, version), jamais accepter à la place du Client ou de l'Artisan ni modifier un accord accepté. | Livré / P10 | D-038, D-042, #408 §5 |
| Messagerie privée liée aux memberships actifs, append-only, sans accès staff automatique. | Livré | D-044, #116 |

## 2. Projet, lots et sous-lots officiels

| Décision | État | Source |
| --- | --- | --- |
| `project` = chantier global ; `project_request` = **lot**, unité publiable, offrable et attribuable. Ne pas fusionner ces concepts. | Permanent | BUSINESS_RULES §1 |
| Au moins **un lot réel** avant revue ; pas de lot implicite/virtuel « Projet complet ». | Livré | D-025, BUSINESS_RULES §12 |
| Workflow : brouillon → soumission → **revue D.A.O.** → approuvé/rejeté ; une version rejetée reste historique, correction = nouvelle version. Publication sur les snapshots approuvés. | Livré | BUSINESS_RULES §4–6 |
| Modes de publication : publique, ciblée, sur invitation ; révocation immédiate. | Livré | BUSINESS_RULES §18 |
| Budgets **indicatifs** ; un écart budget global / somme des lots avertit sans bloquer. | Livré | BUSINESS_RULES §13 |
| **Sous-lots officiels du Client** (`request_sub_lots` + versions) créés **avant publication** ; chaque remplacement crée une nouvelle version de lot ; l'Artisan ne les modifie pas. Dates prévues du lot facultatives. | Livré | PR #418/#421, migration `20261025100000_client_official_sub_lot_api` |

## 3. Offres (devis)

| Décision | État | Source |
| --- | --- | --- |
| Une offre peut couvrir plusieurs lots ; **package indivisible** possible (tout ou rien). | Livré | BUSINESS_RULES §2, D-040 |
| Devis structuré par lignes de prix (arrondi au millime) ; offre soumise **immuable**, modification = nouvelle version. | Livré | migration `bid_quotes_v1`, #367 |
| Export **PDF du devis** privé, jamais présenté comme attribution, contrat, signature ou paiement. | Livré | [product/quote-pdf.md](product/quote-pdf.md), #367 |
| **Sous-lots techniques proposés par l'Artisan** dans son offre (`bid_sub_lots` + liens FS) : facultatifs, référencent les sous-lots officiels sans les modifier, somme des budgets ≤ prix proposé, aucun award par sous-lot. | Livré | #325, migration `bid_sub_lots` |
| Questions techniques (RFI) pendant la consultation, avec accès aux documents en attente contrôlé. | Livré | migrations `technical_rfi`, `rfi_pending_document_access` |
| **Négociation par lot** : contre-proposition de montant opt-in ; les `bid_items` soumis ne sont jamais réécrits ; seul le montant convenu de l'award reflète une proposition acceptée. | Livré | #406 (#175), migration `bid_counter_proposals` |
| Notifications : Client notifié à la soumission d'une offre ; résultats et décisions notifiés par lot. | Livré | #403, #404 |

## 4. Attribution

| Décision | État | Source |
| --- | --- | --- |
| Attribution **atomique par lot** via RPC serveur (`award_bid_item_atomic`) ; **un seul award actif par lot** (`one_active_award_per_request`). | Livré | [product/post-award-state.md](product/post-award-state.md) |
| Un Artisan peut gagner plusieurs lots d'un chantier ; plusieurs Artisans sur un même chantier ; lots suivis en parallèle (ouverts, en négociation, en exécution, en réception). | Livré | #381, #408 |
| Lot attribué fermé aux nouvelles offres ; concurrents « Non retenus » (`not_selected`), jamais « rejetés ». | Livré | D-040, #44 |
| Annulation motivée et auditée, réouverture du lot, réattribution par nouvelles identités ; bloquée si un contrat existe. | Livré | D-040 |
| L'award **ne fait pas** de l'Artisan un membre du chantier : ses droits sont **par lot gagné actif**. | Livré | [product/contractor-multilot-dossier-381.md](product/contractor-multilot-dossier-381.md) |
| Vue de regroupement chantier × Artisan en **lecture** seule. | Livré | #381 |

## 5. Conditions précontractuelles et échéances (paiements)

| Décision | État | Source |
| --- | --- | --- |
| **Accord Client–Artisan facultatif** après attribution, avant contrat : versions immuables hachées, contre-propositions, acceptation des deux parties sur la même version. Non engageant (`non_engaging=true`, `legal_effect_enabled=false`, `contract_signed=false`). | Livré | D-045, [#345](https://github.com/Khaey/Dao/issues/345), [product/precontract-agreement-v1.md](product/precontract-agreement-v1.md) |
| Modes d'échéancier : `none, daily, weekly, monthly, milestone, sub_lot, lot_end, project_end` ; somme des échéances chiffrées = prix attribué. | Livré | #345, #408 |
| **Suivi informatif des échéances** (A3) : Artisan déclare « à présenter », Client vérifie/conteste/autorise ; `informational_only`, `money_moved=false`, `payment_recorded=false`, `debt_created=false`. Ordre d'événements déterministe. | Livré | [product/precontract-installment-tracking-v1.md](product/precontract-installment-tracking-v1.md), #377, #397 |
| **Rattachement d'une échéance** à un lot/sous-lot/jalon/période via un avenant versionné accepté (`native_installment_scope_*`) ; ne change jamais l'état de paiement. | Livré | #409 N4 |
| Statut de paiement global du chantier (`payment_status`) **déclaratif** ; aucun séquestre, ledger ou paiement réel. Jalon, tranche, financement et décaissement restent des concepts séparés (futur ledger en partie double). | Livré / Hors GO | BUSINESS_RULES §15, §21 |

## 6. Contrats

| Décision | État | Source |
| --- | --- | --- |
| **1 contrat technique = 1 award** (plusieurs lots du même Artisan possibles) ; tripartite Client / Artisan / D.A.O. (LogicLab Tunisie) ; versions canoniques hachées SHA-256, append-only. | Livré | D1–D10 [#61](https://github.com/Khaey/Dao/issues/61), [#125](https://github.com/Khaey/Dao/issues/125), [product/contract-v1-design.md](product/contract-v1-design.md) |
| Contrat **OFF par défaut**, activé par le Client propriétaire par chantier avant la première attribution ; si ON, brouillon non engageant préparé dans la transaction de l'award. Représentant D.A.O. explicitement désigné, jamais déduit. | Livré | D-046, #390, #391 |
| Validation D.A.O. uniquement jusqu'à `ready` ; avenants simples non engageants ; consultation privée. | Livré | #174, #178, D-042 |
| **Signature électronique** : checklist en lecture seule (E1) uniquement ; fournisseur, preuves et revue juridique tunisienne non acquis. Aucun état `signed`. | Hors GO | [#383](https://github.com/Khaey/Dao/issues/383), [product/contract-electronic-signature-v1.md](product/contract-electronic-signature-v1.md) |

## 7. Planning (dates, dépendances, Gantt)

| Décision | État | Source |
| --- | --- | --- |
| Hiérarchie : **Projet → Lot → Sous-lot (retenu ou officiel, facultatif) → Activité d'exécution (facultative, post-award)**. Seuls les sous-lots de l'offre retenue deviennent base de travail ; `bid_sub_lots` restent immuables. | Livré | [#408 spec](https://github.com/Khaey/Dao/issues/408#issuecomment-6388003011), #409 |
| Activités d'exécution post-award versionnées, propositions acceptées par les parties (`native_execution_activit*`). | Livré | #409 N2, #410, #416 |
| Dates par provenance : devis proposé, **baseline convenue** (accord), prévision révisable, réel ; une prévision ne réécrit jamais une date acceptée. Activité sans date visible au Tableau, absente du Gantt. | Livré | #408 §7 |
| Dépendances **Fin→Début, latence 0** en V1 ; graphe acyclique validé serveur ; liens inter-lots confirmés par le Client ; CPM natif (chemin critique, prévision, retard) sans OCE. Liens mixtes lot↔activité ne dégradent pas le forecast. | Livré | #413/#415/#422/#427, #433 |
| **Une seule entrée « Suivi du chantier »** (`/app/native-execution/[id]`) : sections Lots et planning (Tableau/Gantt, dates, sous-lots, dépendances, jalons, contrôles, situations), Carnet de chantier (avancement, interventions), Documents, Conditions ; chaque section n'apparaît que si les droits serveur répondent. `/app/execution/[id]` redirige vers le Carnet. Le planning global/OCE est replié comme option dans l'onglet « Suivi du chantier » de la fiche. Aucun module supprimé. | Livré (phase 2 UX) | [#387](https://github.com/Khaey/Dao/issues/387) |
| Tableau et Gantt lisent **une seule source** ; Gantt de lecture accessible depuis « Mes chantiers ». | Livré | #414, #420, #427 |
| Planning global OCE (`project_plan_*`) : historique/comparaison, jamais affiché comme calcul natif. | Livré | #325, #408 audit |

## 8. Exécution, métrés et avancement

| Décision | État | Source |
| --- | --- | --- |
| Carnet d'exécution **par award item actif** : avancement 0–100 motivé, interventions, jalons, **quantités/métrés** déclarés par l'Artisan ; Client prend connaissance ou conteste. Append-only, horodaté serveur. | Livré | P2.3 [#289](https://github.com/Khaey/Dao/issues/289), [site-execution-design.md](site-execution-design.md) |
| Justificatifs = références vers des `documents` approuvés partagés au chantier ; un document `owner_only` n'est jamais exposé. | Livré | #289 |
| **100 % déclaré, jalon terminé ou prise de connaissance ≠ réception, paiement ou modification du contrat.** | Permanent | #289, #408, #425 |
| `project_stage` global déclaratif distinct du carnet par lot. | Livré | BUSINESS_RULES §21, §24 |
| **Situations de travaux techniques (P12)** : quantités par période et par Artisan, lignes multi-lots du même Artisan ; Artisan crée / modifie / soumet / retire, Client démarre la revue, demande une correction, **valide techniquement** (0 admis) ou conteste ; Gestionnaire affecté ne fait que suggérer. Quantités en milli-unités physiques (≠ millimes TND). Aucune facture, dette ni paiement. Panneau « Situations de travaux » du suivi natif. Une intervention du carnet **ne crée pas** de situation ; l’Artisan peut rattacher explicitement à une ligne ses interventions de la période (même lot et unité, quantité = somme exacte, revérifiée par le serveur) et ses justificatifs approuvés partagés. | Livré (backend #443, UI P14) | [#440](https://github.com/Khaey/Dao/issues/440), [#455](https://github.com/Khaey/Dao/issues/455) |

## 9. Réception technique et réserves (P11)

| Décision | État | Source |
| --- | --- | --- |
| Inspections et **réserves techniques par lot attribué actif** (`site_technical_inspections`, `site_technical_reserves`, événements et preuves privées) ; indépendantes du contrat ON/OFF ; historique append-only, concurrence optimiste, pagination. | Livré (backend #434, UI en cours #438) | [#425](https://github.com/Khaey/Dao/issues/425) |
| Lecture des contrôles et réserves par l'**Artisan attributaire actif** sans participation `project_members` (les attributions de la place de marché n'en créent pas) : même règle que le suivi natif (`site_contractor_award_item`), participation révoquée toujours refusée. | Livré | [#516](https://github.com/Khaey/Dao/issues/516) |
| États de réserve : `open`, `correction_declared`, `recheck_requested`, `resolved_confirmed`, `reopened`, `withdrawn`. Client signale → Artisan corrige avec preuve → Client confirme ou rouvre. Aucun silence ne vaut accord. | Livré | #425 |
| **Réception technique ≠ réception juridique** : pas de PV juridique, transfert de risques, retenue ou départ de garantie, paiement à réception. Garantie V0 = liens informatifs seulement. | Hors GO | #425 |

## 9 bis. Dossier documentaire (P15)

| Décision | État | Source |
| --- | --- | --- |
| Familles de documents **versionnées** (V1, V2…) au-dessus des fichiers privés existants ; une seule version courante, les autres « Remplacé » ; révisions et historique append-only ; documents existants ni requalifiés ni partagés. | Livré | [#456](https://github.com/Khaey/Dao/issues/456), [product/document-dossier-v2.md](product/document-dossier-v2.md) |
| Partage **par lot** : visibilité `lots` = Client + titulaire **actif** de chaque lot rattaché (award actif ou membre affecté) ; filtrage serveur ; révocation/suspension immédiate. | Livré | #456 |
| **Contrôle du fichier** (quarantaine → validé/refusé) par le Gestionnaire affecté ou l'Admin uniquement ; aucune auto-approbation. | Livré | #456 |
| **Revue documentaire technique** (À consulter, En revue, Observations émises, Revu techniquement, Remplacé) par le Client ou le Gestionnaire affecté, jamais l'auteur ; une nouvelle version ne réutilise jamais un visa ancien ; **aucun effet juridique, contractuel ou financier**. | Livré | #456 |
| Plans **DWG** acceptés pour les documents de chantier uniquement (devis, RFI, profils inchangés) : stockage privé, téléchargement par URL signée en pièce jointe, **aucun aperçu ni interprétation du contenu** ; plafond = `uploads.max_file_mb` (1–20 Mo), au-delà de 20 Mo non autorisé sans étude stockage/transport. | En PR | [#464](https://github.com/Khaey/Dao/issues/464) |

## 10. Paramètres (Settings)

| Décision | État | Source |
| --- | --- | --- |
| Trois portées distinctes : plateforme (Admin), chantier, utilisateur (préférences personnelles existantes #165 réutilisées). | Cadré | [#387](https://github.com/Khaey/Dao/issues/387), [#165](https://github.com/Khaey/Dao/issues/165) |
| Catalogue **typé en code** (`dao-backend/src/settings/catalog.ts`) avec miroir SQL généré ; familles : capacité, valeur bornée, référentiel, choix fédéré. Le moteur **ne peut que restreindre**, jamais accorder un droit refusé par JWT/RLS. | Livré (S1 #428) | [product/settings-engine.md](product/settings-engine.md) |
| Non paramétrables : RLS, suspension, signature, devise TND/millimes, fiscalité, secrets. | Permanent | #423 S0 |
| Première tranche de 23 réglages ; 92 modules futurs `implemented=false` invisibles. | Cadré | [#423 recoupement](https://github.com/Khaey/Dao/issues/423#issuecomment-6392555206) |
| **Arbitrages A1–A10 validés** (25/10) : « supprimer » = restreindre les nouvelles actions (l'existant reste lisible et terminable) ; effet prospectif ; bornes (soumission 7–90 j/30, invitation 1–30 j/7, rappel 1–72 h/24, messages 5–60/min/20, avis 0–90 j/30) ; exception positive Admin seul avec motif et échéance ; restrictions Gestionnaire ≤ 90 j ; Gestionnaire seulement par **mandat explicite** en S4, `dao_reviewer` seul n'a aucun droit Settings ; segments reportés ; message neutre à l'utilisateur. | Validé | [#426](https://github.com/Khaey/Dao/issues/426), [spécification S0](https://github.com/Khaey/Dao/issues/423#issuecomment-6392554996) |
| Ordre S1 → S2 (Admin) / S3 (gating Client/Artisan) → S4 (mandats Gestionnaire). **S5 non autorisé** ; pas d'activation OCE/BIM/HSE/Achats par toggle. | En cours (#435, #437) | [#423](https://github.com/Khaey/Dao/issues/423), #436 |
| Plafond de téléversement : 20 Mo dans le code vs 50 MiB dans `config.toml` ; à aligner dans un correctif séparé après vérification, sans hausse aveugle. | Cadré | A6, #436 |
| **Référentiel métiers** (#465) : table `trades` unique ; référentiel initial élargi (clés `trade_*`) ; l'Admin ajoute/renomme (id et code conservés, motif, journal `setting_events`) et active/désactive ; Client/Artisan peuvent **proposer** un métier absent (texte privé, 5/jour), jamais publié sans décision Admin (rattachement à un métier existant ou création). | En PR | [#465](https://github.com/Khaey/Dao/issues/465) |
| **Modération paramétrable par catégorie** (#463), catalogue v2 : `moderation.portfolio_edit_review` (global, Admin, défaut ON = revue actuelle). OFF : la modification d'une réalisation **déjà publiée** reste en ligne si consentement, vérification, fiche approuvée et compte actif. Jamais paramétrables : nouvelle réalisation, identité publique, données légales/vérification, fichiers/photos, suspension, RLS. Effet prospectif. Les modifications éditoriales et de coordonnées restent publiées sans revue depuis #307. | En PR | [#463](https://github.com/Khaey/Dao/issues/463) |

## 11. Technique, qualité et livraison

| Décision | État | Source |
| --- | --- | --- |
| Correction à la cause racine, pas de hack de test ; ne jamais désactiver/sauter un test pour obtenir du vert. | Permanent | D-003, D-004, D-023 |
| **3 checks obligatoires** : `backend-verify`, `frontend-build`, `Fresh schema, real Supabase integration, and FULL E2E` ; fast lane docs/cosmétique sans contournement ; `deploy-dev` seulement sur push `main` après succès. | Livré | [ci-pr-fast-lanes.md](ci-pr-fast-lanes.md), D-026/D-027 |
| FULL E2E sur pile Supabase **jetable** ; la base DEV partagée n'est jamais réinitialisée ; pas de comptes factices créés en DEV partagé sans autorisation. | Permanent | D-026, #436 |
| Migrations **additives et idempotentes** ; vérifier le ledger DEV avant application ; une migration mergée n'est pas attestée appliquée. | Permanent | #409, #436 |
| Performance : mesurer avant/après ; lints Supabase = pistes à qualifier, pas d'index en masse ; préférer un RPC de projection consolidé à des appels N+1. | Cadré | [#408 perf](https://github.com/Khaey/Dao/issues/408#issuecomment-6388919006), D-028 |
| **Design cible « Chantier net »** (validé le 2026-10-26) : Inter + chiffres tabulaires, encre/sable/teal (argile = marque seulement), trois arrondis `control`/`card`/`panel`, bordures plutôt qu'ombres, statuts via `Badge` de `components/ui.tsx`. Apports B (Admin/Gestionnaire : tableaux denses) et C (Client/Artisan : mobile d'abord). Mise en œuvre écran par écran, un seul parcours. Livré : actions principales en teal (`Button` et boutons codés, `hover:bg-tealdark`; états sélectionnés et avatars restent sombres), menu Admin sombre, barre du haut desktop (`TopBar` : Aide + cloche; pas de recherche globale faute d'API), tableau des publications Admin dense. | En cours (#387 phase 4) | `dao-frontend/tailwind.config.ts`, `components/ui.tsx` |
| Pas de modification WireGuard pour du travail applicatif ; opérations VPS via workflows contrôlés. | Permanent | D-018, [ops-control.md](ops-control.md) |

## Questions ouvertes (ne pas trancher sans le propriétaire)

- Signature électronique : fournisseur, niveau de signature, preuves, revue juridique tunisienne (#383).
- Réception juridique, garanties légales, retenues, paiement à réception (#425 non-objectifs).
- Paiements réels, séquestre, ledger financier, fiscalité.
- Écran de réception/réserves au-delà de #438 : affectation explicite requise.
- Idées non arbitrées : registre central [#299](https://github.com/Khaey/Dao/issues/299), à ne pas transformer en tickets exécutables sans arbitrage.
