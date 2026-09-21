# D.A.O — Révision R3 avant GO

Cette révision remplace les trois migrations précédemment proposées. Elle comporte quatre migrations, 43 tables applicatives et des tests. Les versions SQL précédentes n'ayant pas été déployées dans cette session, le socle est régénéré pour une base neuve. Si une autre personne les a déjà exécutées ailleurs, NE PAS remplacer son historique : préparer des migrations ALTER après comparaison.

## Résultats réels

63 contrôles PASS / 0 FAIL exécutés sur PGlite 0.5.8 (PostgreSQL embarqué WebAssembly). Les quatre migrations ont réellement été exécutées dans ce moteur, avec un schéma minimal simulant les interfaces auth.uid(), auth.users et Storage.

Ce ne sont PAS des tests sur Supabase. Aucune validation de signature JWT n'a eu lieu. Les utilisateurs sont des identités SQL synthétiques, pas six comptes Supabase Auth. Le détail exact des assertions et de leur résultat se trouve dans tests/local-results.json.

Non exécutés : reset d'un projet Supabase, migrations sur Supabase, seed géographique réel, création des comptes Auth, tests HTTP par vrais JWT, véritable concurrence entre deux connexions, émission/consommation d'un signed upload et analyse de fichiers. Aucun accès Supabase DEV n'est configuré dans cette session ; aucun projet n'a été réinitialisé.

Le moteur local ne permet pas de prouver la concurrence multi-session. Le rejet séquentiel d'une deuxième attribution (SQLSTATE 23505) est observé, mais ne remplace pas ce test. GO non prononcé.

## Corrections

1. RLS des enfants explicites : bid_items, bid_groups, bid_group_items et bid_documents appellent dao_private.bid_version. project_reviews appelle project_version ; ai_proposals appelle ai_run ; award_items appelle award. Chaque prédicat vérifie l'identité, le rôle DAO ou la relation propriétaire/prestataire autorisée. SECURITY DEFINER à search_path vide, références qualifiées, exécution publique révoquée puis accordée aux seuls rôles requis. Aucun paramètre user_id contrôlable par l'appelant : auth.uid() reste l'identité de référence.

2. bids est invisible au client tant qu'aucune version n'a submitted_at. Le statut retiré/expiré ne suffit plus à faire apparaître un brouillon jamais soumis. L'auteur voit ses brouillons. Les versions effectivement soumises restent consultables par les parties après retrait. Les professionnels concurrents ne voient ni enveloppe, ni versions, ni prix, groupes ou fichiers. DAO constitue un rôle de modération de confiance explicitement distinct.

3. contractor_profiles : contractor_type (artisan/company/general_contractor/independent_professional), public_presentation, years_experience, availability, available_from, public_trade_name, public_slug, public_identity_status. business_name reste l'identité de gestion ; le DTO public doit sélectionner uniquement les champs commerciaux approuvés. Aucun contact privé ajouté à la projection publique.

4. Portfolio indépendant des projets clients : portfolio_projects et portfolio_assets. Un portfolio publié n'est visible publiquement que si le professionnel est vérifié et son identité commerciale approuvée. Médias en quarantaine invisibles aux tiers ; les octets restent privés dans Storage. Aucune adresse client copiée automatiquement.

5. projects et project_versions : project_type, surface_m2, desired_start_date, indicative_budget_millimes. Les champs de projects décrivent le brouillon courant ; ceux des versions sont les valeurs révisées ; publications contient une copie approuvée pour diffusion. Budget et surface sont facultatifs, numériques et bornés par contraintes. Publication obligatoire à partir d'une version approuvée via commande serveur, à développer après GO.

6. publications : published_at, submission_deadline, closed_at et contrôles chronologiques. closed_at obligatoire exactement lorsque status=closed. published_at désigne la publication initiale de cette révision ; une nouvelle révision crée une nouvelle publication.

7. Intégrité DB renforcée : clés étrangères composites propagent project_id et contractor_id de bids vers bid_versions puis bid_items ; request_id doit correspondre à request_version_id. award_items référence simultanément son award et son bid_item avec les mêmes projet, professionnel et demande. Les FK protègent aussi contre les erreurs service_role. L'index unique partiel interdit deux attributions actives par demande. Identité d'une ligne attribuée immuable ; réactivation contrôlée. Une offre obsolète, expirée, non soumise ou une attribution annulée n'est pas admissible.

8. Groupes indivisibles : contrainte différée au COMMIT, toutes les lignes du groupe doivent appartenir à la même attribution active. Les lignes d'offres soumises, groupes et compositions sont immuables. Cela permet une transaction multi-demandes sans états intermédiaires visibles.

9. Fichiers d'offre : bid_documents référence la version exacte et le même projet/professionnel, sans passer par document_grants. Espaces de chemins distincts : project/{project_id}/..., bid/{bid_version_id}/..., portfolio/{portfolio_project_id}/... ; une pièce jointe d'offre ne peut pas être pointée accidentellement comme document de projet partageable. Le statut de scan peut évoluer, l'identité du fichier ne peut pas être déplacée.

## Limites encore couvertes par les commandes métier

Les migrations renforcent l'intégrité demandée ; elles ne constituent pas toute l'application. Restent à développer et tester après GO : contrôle métier/zone/visibilité lors d'une offre, validation client + DAO avant publication, limite de soumission, prise en compte de la version courante des demandes, allocation exacte des remises, audit complet des mutations, idempotence des commandes, anti-spam et contrôle d'accès aux endpoints privilégiés.

La clé service_role contourne RLS ; les lectures utilisateur doivent employer leur JWT. Les endpoints privilégiés vérifient explicitement l'acteur et ne proposent aucun CRUD générique. Les documents d'offre ne doivent jamais être renvoyés sur la seule base de project_id. Aucun secret dans le navigateur.

## Upload privé — contrat de fonctionnement confirmé

1. L'utilisateur appelle un endpoint serveur avec type de fichier, taille annoncée et ressource cible (projet, version d'offre ou portfolio).
2. Le serveur vérifie le JWT, les droits sur cette ressource, les limites et le statut métier ; il refuse toute cible arbitraire et choisit un chemin unique dans le namespace adéquat.
3. Création d'une réservation/métadonnée en quarantaine. Le serveur émet un signed upload pour ce chemin précis, sans upsert, ou relaie lui-même l'upload. Jamais de service_role transmis au navigateur.
4. Le navigateur utilise uniquement ce ticket. Le bucket impose aussi limite de taille et liste MIME ; les valeurs déclarées par le navigateur ne suffisent pas à valider le fichier.
5. Finalisation serveur : vérifier présence, taille réelle, signature du format, contenu malveillant et suppression d'EXIF si applicable. Un fichier n'est approuvé et partageable qu'après contrôle. Tickets non utilisés/fichiers orphelins nettoyés par tâche serveur.
6. Téléchargement : nouvelle autorisation sur le parent exact, statut approved, puis URL signée de lecture de courte durée. Une URL déjà délivrée peut rester valide jusqu'à son expiration ; ne pas prétendre à une révocation immédiate.

La migration Storage crée des policies restrictives interdisant SELECT/INSERT/UPDATE/DELETE direct sur dao-private pour anon/authenticated, même en présence d'une policy permissive sans rapport. Service Storage et signed upload doivent être testés sur Supabase réel. Le fichier de test local simule une policy permissive large pour vérifier que la barrière restrictive fonctionne au niveau PostgreSQL.

## Compte unique et sous-traitance

user_roles est une relation N:N logique : unique(user_id,role), et non unique(user_id). client et contractor peuvent coexister ; le test local vérifie les deux rôles sur le même auth.users.id. Deux espaces utilisent la même session ; les droits dépendent de la relation à chaque ressource, pas seulement de l'espace ouvert.

Une personne qui est client d'un projet peut légitimement voir ses offres reçues même si elle est artisan ailleurs. Cela ne lui donne aucun droit sur les offres concurrentes d'un projet où elle intervient uniquement comme professionnel. Les tests distinguent ces cas.

general_contractor désigne une entreprise générale répondant au client ; ce champ ne crée pas une chaîne de sous-traitance. Phase 2 pourra ajouter une entité d'organisation, ses membres et des engagements entre professionnels, reliés aux périmètres/contrats stables. Aucun rôle de sous-traitant, table, écran, partage automatique ou workflow de sous-traitance n'est créé maintenant.

## Exécution et reproductibilité

Les scripts de test nécessitent Node.js et les dépendances du package.json. Depuis le dossier : npm install, puis npm run test:local. Les dépendances épinglées sont des outils de test, pas une décision de stack produit. Le test local recrée une base mémoire jetable ; il ne touche aucune base distante.

Les deux scripts d'intégration fournis restent NON EXÉCUTÉS : tests/supabase-jwt.mjs et tests/concurrent-awards.mjs. Ils ne font aucun reset implicite. Les fixtures réelles doivent être créées d'abord dans le projet DEV identifié. Ils utilisent des fichiers de configuration locaux exclus de tout partage ; ne jamais coller des mots de passe, JWT ou clés service_role dans le chat.

Variables : DAO_SUPABASE_URL, DAO_CONFIRMED_DEV_URL (égalité explicite), DAO_SUPABASE_PUBLISHABLE_KEY, DAO_TEST_FIXTURES, DAO_TEST_CREDENTIALS ; DAO_DEV_DATABASE_URL pour la concurrence SQL. Aucune valeur secrète incluse dans ce dossier.

Le fichier credentials contient les six identités {clientA,clientB,proA,proB,general,admin}, chacune {email,password}. Le fichier fixtures contient users avec leurs UUID Auth, bids.proA/proB avec id/version/items[]/group/groupItem/document ; draftBid appartenant à general, review et aiProposal du projet clientA, awardItem attribué à proA. concurrency.first/second contiennent les six paramètres SQL (award,project,contractor,request,bid_item,millimes) d'une demande fraîche non attribuée.

Le runner JWT exige des contrôles positifs : un résultat vide sur un jeu inexistant ne peut pas faire passer le test. Le test de concurrence exige une attente de verrou réellement observée entre deux sessions indépendantes ; le second doit échouer avec 23505 après commit du premier. Il conserve la première attribution dans le projet DEV : utiliser des fixtures jetables spécifiques à ce test.

## Procédure restante sur Supabase DEV

Identifier et rendre accessible un projet dédié jetable. Vérifier l'URL/ref de développement et l'absence de données à conserver avant reset. Appliquer les quatre migrations dans l'ordre. Ne pas appliquer le bootstrap local : Supabase fournit auth et storage.

Seed de test : seulement métiers DAO déjà validés (plomberie et électricité pour les offres multi-demandes), puis territoire officiellement vérifié nécessaire. Les UUID métiers sont internes, sans prétendre à des codes NAT. Pour le territoire, importer un extrait officiel documenté et conserver source/date ; aucun seed administratif non vérifié n'est fourni. Les pages INS consultées décrivent les nomenclatures mais ne donnaient pas les lignes nécessaires dans le contenu accessible.

Créer six vrais comptes via Auth Admin : client A, client B, plombier A, plombier B, entreprise générale, admin DAO ; attribuer en backend les rôles, vérifier les professionnels, donner aussi client à plombier A. Préparer deux projets, offres brouillons/soumises, groupe divisible et indivisible, documents autorisés/quarantaine, portfolios privés/publiés. Exécuter les scripts JWT et concurrence, puis signed upload réel et scan. Les demandes de tests restent bloquées jusqu'à cet accès ; aucun résultat Supabase n'est inventé.

## Sources

- RLS Supabase : https://supabase.com/docs/guides/database/postgres/row-level-security
- Storage : https://supabase.com/docs/guides/storage/security/access-control
- Référentiel géographique INS, édition 2012 (à ne pas considérer comme seed 2026 complet) : https://www.ins.tn/publication/classification-nationale-des-unites-administratives
- NAT INS : https://www.ins.tn/publication/nomenclature-dactivites-tunisienne-de-2009-nat
