<!-- ARCHIVE FIDÈLE DU TEXTE FOURNI PAR LE PROPRIÉTAIRE. Données et états datés du 03/11/2026 ; ne pas les traiter comme actuels sans revérification GitHub/DEV. -->

D.A.O. — Second avis indépendant
3 nov. 2026 · @Ahmed · analyse seule : aucun code, aucun ticket, aucune écriture sur DEV (lectures SQL uniquement).
Base vérifiée : main = 994b5a9, PR ouvertes #550 et #553, Supabase DEV (nmbpjdltirotoifwuzat) en lecture. Chaque point est marqué Prouvé (lien, SHA, requête), Hypothèse ou Non vérifié.
1. Verdict en cinq lignes
1. Le socle est réel et large : 105 migrations, 54 écrans, 89 routes API, trois gates CI de 12 à 17 min. La recette transactionnelle 14 étapes de #175 est déjà PASS sur DEV le 03/11.
2. Le P0 de PILOT 14 est périmé : l'échec CI de #550 a été corrigé 4 minutes après, et les trois gates sont verts sur le HEAD e5aed76. Le vrai blocage de #550 est un conflit de fusion avec main sur 5 fichiers.
3. Le plus gros risque technique n'est pas cité par PILOT 14 sous sa vraie forme : personne ne peut prouver que le schéma DEV correspond au dépôt. Les migrations DEV sont appliquées à la main, sous trois conventions de nommage, et 4 migrations DEV n'ont aucun fichier dans le dépôt.
4. La chaîne BTP ne produira aucun chiffre pour un vrai Client tant que deux décisions métier manquent : d'où viennent les prix et qui valide un métré quand aucun Gestionnaire n'est affecté. C'est une question de données et de rôles, pas de code.
5. Le registre des agents ne reflète plus la réalité : PILOT 14 n'a pas d'issue, #436 est fermée, des PR listées comme ouvertes sont fermées, #548 n'y figure pas.
2. Mon diagnostic propre (avant lecture de PILOT 14)
2.1 Livraison BTP du 03/11
Module
État vérifié
Preuve
Référentiel #541
TN-2026.1 publié : 20 lots, 20 ouvrages, 5 modèles de métré (40 / 10 lignes en base car le brouillon TN-2026.2 abandonné est conservé en retired)
Prouvé : requête DEV
Assistant #543
Livré, entrée visible sur « Nouveau chantier », 4 brouillons en base
Prouvé : projects/new/page.tsx, DEV
Administration #547
Livrée, migration appliquée (ledger 20261103210743)
Prouvé
Prix et estimation #551
Livrés, migration appliquée (ledger 20261103220755). 0 prix réel : 2 sources fictives « RECETTE #551 » seulement
Prouvé
Métrés #548 / PR #550
Code complet, 3 gates verts sur e5aed76, non fusionnable (mergeable_state: dirty). btp_takeoffs absente de DEV
Prouvé : run 41716736819
2.2 Ce que la chaîne BTP permet réellement aujourd'hui
• Pas d'écran des métrés. #550 ne livre côté front que la route /api/btp/takeoffs. Après fusion, un Client ne pourra créer un métré que par l'API. Prouvé : diff #550, seul fichier front = app/api/btp/takeoffs/route.ts.
• Un Client seul ne peut pas valider ses métrés. La validation exige manages_project (Admin, ou relecteur affecté au chantier). Sans Gestionnaire affecté, l'estimation lira au mieux des quantités « déclarées, non validées ». Prouvé : migration #550, lignes 313-320.
• Sans prix vérifié, l'estimation reste « indisponible » hors simulation. Et un prix n'est utilisable qu'après vérification par un Admin différent de son auteur : il faut deux Admin humains réellement actifs pour publier le moindre tarif. DEV compte 4 comptes dao_admin (comptes de test ou réels : non vérifié).
• Le contrat entre estimation et métrés est compatible (colonnes work_id, validated_revision, justification.result.value/unit). Prouvé par lecture croisée des deux migrations ; reste à recetter sur DEV après fusion.
2.3 Cohérence code ↔ schéma DEV (le vrai risque n°1)
• deploy-dev ne déploie que le frontend. Aucune migration n'est appliquée par la CI ; ce sont les fils qui les appliquent à la main via Supabase. Prouvé : ci.yml, job deploy-dev.
• Le ledger DEV mélange trois conventions : version = horodatage du fichier, version = horodatage d'application avec nom simple, ou nom suffixé par l'horodatage du fichier. Sur 105 fichiers, 63 se retrouvent par version, 84 par version ou nom, les 21 autres seulement par nom approximatif. Prouvé : requête sur supabase_migrations.schema_migrations.
• 4 migrations présentes sur DEV n'ont aucun fichier dans le dépôt : provider_connection_manifest_v2_backfill, provider_secret_vault_permissions_hotfix, provider_secret_put_vault_acl_hotfix, dropbox_sign_real_check_v3 (28/10, coffre de secrets #515). Prouvé. Hypothèse plausible : leur contenu a été replié dans les fichiers fusionnés de #515. Non vérifié : personne n'a comparé les définitions. Comme elles touchent les ACL du coffre de secrets, c'est la zone où une dérive coûterait le plus cher.
• Conséquence : la CI teste un schéma neuf rejoué depuis le dépôt, et DEV tourne sur un schéma assemblé à la main. Le schema-contract.sql existant ne peut pas être lancé tel quel sur DEV, car il vérifie les versions du ledger.
• La migration de #550 est datée 20261103203956, avant deux migrations déjà appliquées sur DEV (210000, 230000). Sans dépendance réelle entre elles, mais à renommer pour garder un ordre rejouable.
2.4 Sécurité et droits (points à contrôler, pas de faille prouvée)
• Les tables de métrés sont lisibles via can_view_project, qui inclut staff() = tout dao_admin ou dao_reviewer, sur tous les chantiers. C'est le prédicat historique du dépôt (septembre), donc cohérent, mais il s'écarte de l'invariant « un rôle global ne remplace jamais une participation au chantier ». À confirmer comme voulu, une fois, pour tout le périmètre BTP.
• manages_project change de sens selon le réglage dao.native_tracking_scope. Les nouveaux modules BTP en héritent. Non vérifié : valeur effective sur DEV.
• Écritures RPC-only, security definer avec search_path='', idempotence : conformes aux conventions. Prouvé par lecture de #550.
2.5 Gouvernance
• docs/agents.md est « vérifié au 28 octobre » et désigne PILOT 13 / #511. Aucune issue PILOT 14 n'existe : ses décisions ne sont tracées nulle part sur GitHub.
• #436 est fermée (archive PILOT 12). #451 et #263, listées comme PR à revoir, sont fermées. #548 / DEV 5 métrés est absent du registre.
• DEV 4 n'a pas de session active (checkpoint #511 du 03/11) : on ne peut pas lui affecter une campagne sans relancer une session.
2.6 CI
• Durée du workflow principal sur main : 12 à 17 min, une pointe à 35 min. Correct.
• Fragilité registre toujours présente : #553 vient d'échouer sur error from registry: Rate exceeded puis réseau Docker, sans lien avec son code. Prouvé : log du job FULL E2E de #553.
3. Vérification des faits de PILOT 14
Affirmation PILOT 14
Verdict
Preuve
#550 : run 41716080877, Supabase réel + FULL E2E en échec, cause = variables url/key/serviceKey
Exact mais périmé
Corrigé par e5aed76 (SUPABASE_* → DAO_SUPABASE_*), run 41716736819 : 3 gates SUCCESS à 21:27Z
« DEV 5 doit corriger ce blocage avant fusion »
Faux aujourd'hui
Le blocage actuel est un conflit avec main sur .github/dao-monitor-agents.json, runtime.ts, tests/local.mjs, tests/schema-contract.sql, docs/architecture.md
Tables tarifaires en double (btp_price_books/btp_work_prices vs btp_price_sources/btp_price_items)
Exact, déjà tranché, mais pas nettoyé
decisions.md §12 ter désigne déjà les nouvelles tables. Mais btp_catalog_snapshot (contrat v1 de l'assistant) expose encore priceSources lu dans l'ancienne table, et l'écran Versions de #547 compte priceBooks
20 ouvrages, 5 modèles de métré
Exact
DEV, version TN-2026.1
#383 et #507 ouverts
Exact

« Développer ensuite les avis vérifiés #213 »
Inexact
Les avis vérifiés sont livrés (PR #219, #223, #224, plafond #257 fusionnées ; 3 avis en base DEV). #213 reste ouvert pour la suppression de compte / RGPD
Recette multi-rôles complète à confier à DEV 4
Doublon
Recette transactionnelle 14 étapes déjà PASS le 03/11 (#175) ; DEV 4 sans session
« Problème P13 non appliqué sur DEV » comme exemple
Exact
Et la cause racine est plus large (§2.3)
4. Accords, désaccords, angles morts
D'accord avec PILOT 14
• Consolider plutôt qu'ajouter des modules ; un module vert isolé ne prouve pas un parcours.
• IA non autoritaire, calculs déterministes, objets métrés / estimation / devis / situations distincts.
• Aucun paiement, séquestre ni signature engageante avant partenaire et cadre juridique.
• Recette réelle de l'annuaire #395 avant tout travail commercial ; aucune note artificielle.
• OCE optionnel, sans mise en veille tant qu'aucune preuve d'innocuité.
En désaccord (argumenté)
1. Le P0 n'est pas la CI de #550 : il est corrigé. Le P0 est le rebase et la fusion. Garder l'ancien P0 ferait refaire un travail déjà fait.
2. La recette multi-rôles n'est pas à refaire : elle existe (#175). Il faut seulement lui ajouter le maillon BTP (assistant → métré → estimation) et le cas multi-rôles staff.
3. « Audit du modèle tarifaire » confié à Mission 2 est trop large : la décision est déjà écrite. Il reste un nettoyage précis de deux lectures de l'ancienne table, à faire par l'owner du référentiel.
4. La « vérification automatique du schéma » est la bonne idée, mais irréalisable telle que formulée : le ledger DEV ne permet pas de comparer par version. Il faut comparer les objets (tables, fonctions, politiques), pas le ledger.
Angles morts de PILOT 14
• Pas d'écran des métrés et pas de validation possible sans Gestionnaire : la chaîne n'a pas de chemin utilisateur.
• La règle des deux Admin pour publier un prix : condition d'exploitation, pas seulement de code.
• Les 4 migrations DEV sans fichier, dans la zone coffre de secrets.
• La dérive documentaire (PILOT 14 sans issue, registre au 28/10).
• La fragilité registre Docker toujours active (#553).
Mes propres angles morts
• Je n'ai fait aucune recette navigateur : l'état des écrans est déduit du code et de la base.
• Je n'ai pas comparé fonction par fonction le schéma DEV au dépôt.
• Je n'ai pas évalué la performance des nouveaux RPC BTP ni la qualité métier des 20 ouvrages.
5. Mon plan priorisé
Priorité
Action
Owner proposé
Critère de fin
P0
Rebaser #550 sur 994b5a9, résoudre les 5 conflits, renommer la migration après 20261103230000, 3 gates verts sur le nouveau HEAD, fusion, application DEV, recette « estimation lit un métré validé »
DEV 5 (#548)
btp_takeoffs présente sur DEV, estimation complete en mode simulation à partir d'un métré validé
P1
Contrôle de schéma DEV après déploiement : variante en lecture seule de schema-contract.sql (tables, fonctions, politiques, sans le ledger), puis comparaison unique des 4 migrations sans fichier
PILOT (technique)
Rapport de différences vide, ou correctifs listés
P1
Décision Ahmed : source réelle des prix (fournisseur, licence, fréquence) et deux Admin vérificateurs
Ahmed
Une première source réelle saisie et vérifiée
P1
Décision Ahmed : qui valide un métré sans Gestionnaire affecté (Admin D.A.O., ou le Client avec mention « non vérifié ») et écran minimal des métrés dans le chantier
Ahmed, puis DEV 5
Un Client peut aller de l'assistant à une estimation sans passer par l'API
P1
Retirer priceSources (ancienne table) du snapshot et le compteur priceBooks de l'écran Versions, révoquer la lecture des deux tables vides sans les supprimer
Owner référentiel
Plus aucune lecture de btp_price_books dans le code
P1
Remettre docs/agents.md à jour (PILOT 14 et son issue, #548, PR fermées, #436 archive)
PILOT 14
Registre daté du jour
P2
Étendre la recette #175 au maillon BTP et au cas staff multi-rôles
Mission 1
Recette PASS publiée
P2
Recette réelle de l'annuaire #395, puis recentrer #213 sur la suppression de compte
À désigner
Recette PASS publiée
P2
Registre Docker : appliquer le plan B déjà prouvé (SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io) si l'échec se répète
Owner CI
Deux semaines sans échec registre
P3
LLM de l'assistant, signature #383, séquestre #507
Ahmed
Décisions explicites
6. Décisions qui reviennent à Ahmed
1. Source des prix et engagement de deux Admin vérificateurs.
2. Validation des métrés sans Gestionnaire affecté.
3. Lecture globale des données chantier par dao_reviewer : confirmer que c'est voulu pour les données BTP.
4. Canal de coordination : créer une issue PILOT 14 ou garder #511.
7. Combien reste-t-il avant une mise en PROD ?
Mon estimation : environ 80 % du fonctionnel d'un MVP est fait, mais seulement environ 50 % de ce qu'il faut pour une PROD. Ces deux pourcentages sont des estimations de ma part, pas des mesures. Ce qui manque surtout, c'est l'environnement de production lui-même, pas des fonctionnalités.
Domaine
Vérifié aujourd'hui
Reste avant PROD
Estimation
Cœur marketplace : chantier, lots, offres, attribution, contrat non engageant
Livré, recette 14 étapes PASS sur DEV le 03/11 (#175)
Recette réelle de l'annuaire #395
Quasi prêt, quelques jours
Suivi d'exécution : planning, activités, situations, réception technique
Livré et clos (#419, #455, #425)
Rien de bloquant connu
Prêt au périmètre livré
Admin, Settings, Intégrations
Livrés (#423, #515, #547)
Comparer les 4 migrations du coffre de secrets avec le dépôt
1 à 2 jours
BTP : référentiel, assistant, métrés, estimation
4 modules sur 5 sur DEV ; métrés en PR #550
Fusionner #550, un écran des métrés, des prix réels sourcés
Code : 1 à 2 semaines. Données de prix : dépend de la source, inconnu
Signature, paiement, séquestre
Non engageants seulement (#383, #507 ouverts)
Partenaire, cadre juridique tunisien
Plusieurs mois. Pas nécessaire pour une première PROD sans argent
Environnement PROD
Inexistant : un seul projet Supabase (DEV), aucun workflow de déploiement PROD
Projet PROD, pipeline de migrations automatique, sauvegardes, supervision, nom de domaine et e-mails réels
2 à 3 semaines, avec tes décisions (hébergement, budget)
Juridique et données personnelles
Suppression de compte encore ouverte (#213)
CGU, politique de confidentialité, déclaration des données personnelles en Tunisie, suppression de compte
Hors code : dépend d'un juriste
Sécurité
RLS et JWT présents partout, pas de faille prouvée
Revue sécurité globale avant ouverture au public, test de charge
1 semaine
Ma lecture : une première PROD « mise en relation et suivi de chantier, sans argent ni signature engageante » est réaliste en 4 à 6 semaines de travail consolidé. Cela suppose que tu tranches vite l'hébergement PROD et le cadre juridique. L'estimation BTP chiffrée peut sortir après, quand une vraie source de prix existe. Paiement et séquestre viennent bien plus tard.
Ce qui est vérifié : les livraisons, la recette #175, l'absence d'environnement PROD (un seul projet Supabase, aucun workflow PROD). Ce qui est estimé : les pourcentages et les durées.