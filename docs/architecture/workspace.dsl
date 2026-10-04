workspace "D.A.O" "Architecture C4 vivante de la plateforme D.A.O" {
!identifiers hierarchical

model {
  client = person "Client" "Crée et pilote ses chantiers, lots et publications."
  contractor = person "Artisan / Entreprise" "Participe aux chantiers et répond aux D.A.O autorisées."
  reviewer = person "Gestionnaire D.A.O" "Traite les revues, publications et files opérationnelles."
  admin = person "Administrateur D.A.O" "Dispose du back-office avec capacités sensibles supplémentaires."

  dao = softwareSystem "D.A.O" "Plateforme construction/rénovation, marketplace et workflow chantier." {
    web = container "Application Web + API" "Interface responsive et API serveur." "Next.js / React / TypeScript" {
      auth = component "Auth & rôles" "Connexion, inscription, récupération et navigation par rôle." "Supabase Auth"
      projects = component "Chantiers" "Projet, versions, statut et archivage." "Next.js"
      lots = component "Lots" "Lots réels versionnés, budgets et métiers." "Next.js / RPC"
      documents = component "Documents privés" "Storage privé et accès signé après autorisation." "Supabase Storage"
      collaboration = component "Collaboration" "Membres, invitations et affectation aux lots." "Next.js / RPC"
      review = component "Revue D.A.O" "Soumission, rejet motivé, correction et approbation." "Next.js / RPC"
      publications = component "Publications" "Public, targeted et invite-only sur snapshots approuvés." "Next.js / RPC"
      offers = component "Offres" "Création, versioning, soumission et confidentialité." "Next.js / RPC"
      awards = component "Attribution" "Attribution atomique par lot." "Supabase RPC"
      manager = component "Back-office Gestionnaire V1" "Pilotage, revues et supervision opérationnelle." "Next.js"
      email = component "Email transactionnel" "Invitations envoyées côté serveur." "Resend"
      services = component "Services métier" "Validation serveur et orchestration des RPC/RLS." "TypeScript"

      compare = component "Comparaison offres P2" "Comparaison client des offres soumises par lot." "En attente" { tags "InProgress" }
      staff = component "Équipe & permissions" "Administration interne future, contrôlée côté serveur." "Futur" { tags "Planned" }
      settings = component "Settings avancés" "Moteur de configuration futur; V1 reste simple." "Futur" { tags "Planned" }
      execution = component "Contrats & exécution" "Jalons, paiements, réception, avenants, garantie." "Futur P2/P3" { tags "Planned" }
      subcontract = component "Sous-traitance" "Entreprise titulaire ouvrant certains lots à des sous-traitants." "Futur P3" { tags "Planned" }
    }
  }

  supabase = softwareSystem "Supabase" "Auth, PostgreSQL, RLS, RPC et Storage privé." { tags "External" }
  resend = softwareSystem "Resend" "Emails transactionnels." { tags "External" }
  github = softwareSystem "GitHub Actions" "CI, E2E jetable et déploiement DEV." { tags "External" }
  vps = softwareSystem "VPS DEV OVH" "Héberge dao-dev.logiclab.fr." { tags "External" }

  client -> dao.web.projects "Gère ses chantiers"
  client -> dao.web.lots "Gère ses lots"
  client -> dao.web.documents "Gère ses documents"
  client -> dao.web.collaboration "Invite son équipe"
  client -> dao.web.review "Soumet/corrige son DAO"
  client -> dao.web.publications "Publie après approbation"
  client -> dao.web.compare "Compare les offres" "P2"

  contractor -> dao.web.collaboration "Rejoint les chantiers autorisés"
  contractor -> dao.web.publications "Consulte les D.A.O autorisées"
  contractor -> dao.web.offers "Soumet ses offres"

  reviewer -> dao.web.manager "Pilote D.A.O"
  reviewer -> dao.web.review "Examine et décide"
  admin -> dao.web.manager "Pilote avec droits admin"
  admin -> dao.web.staff "Gère l'équipe" "Futur"
  admin -> dao.web.settings "Paramètre la plateforme" "Futur"

  dao.web.projects -> dao.web.lots "Structure en lots réels"
  dao.web.projects -> dao.web.review "Soumet une version"
  dao.web.review -> dao.web.publications "Rend publiable après approbation"
  dao.web.publications -> dao.web.offers "Ouvre la réponse professionnelle"
  dao.web.offers -> dao.web.compare "Alimente la comparaison"
  dao.web.offers -> dao.web.awards "Alimente l'attribution"
  dao.web.awards -> dao.web.execution "Déclenche le futur cycle contractuel" "Futur"
  dao.web.execution -> dao.web.subcontract "Permet la sous-traitance contrôlée" "Futur"

  dao.web.auth -> dao.web.services "Résout identité/droits"
  dao.web.projects -> dao.web.services "Commandes chantier"
  dao.web.lots -> dao.web.services "Commandes lot"
  dao.web.documents -> dao.web.services "Accès documents"
  dao.web.collaboration -> dao.web.services "Commandes collaboration"
  dao.web.review -> dao.web.services "Décisions de revue"
  dao.web.publications -> dao.web.services "Commandes publication"
  dao.web.offers -> dao.web.services "Commandes offre"
  dao.web.awards -> dao.web.services "Attribution atomique"
  dao.web.manager -> dao.web.services "Opérations staff"
  dao.web.services -> supabase "Auth/JWT, PostgreSQL/RLS, RPC, Storage"
  dao.web.services -> dao.web.email "Demande l'envoi"
  dao.web.email -> resend "Envoie les emails"
  github -> vps "Déploie la release vérifiée"
  vps -> dao.web "Exécute l'application DEV"

  development = deploymentEnvironment "DEV" {
    deploymentNode "OVH VPS DEV" "dao-dev.logiclab.fr" "Ubuntu 24.04" {
      containerInstance dao.web
    }
  }
}

views {
  systemLandscape "Landscape" "Vision globale utilisateurs, D.A.O et dépendances." {
    include client contractor reviewer admin dao supabase resend github vps
    autoLayout lr
  }

  systemContext dao "SystemContext" "Contexte fonctionnel D.A.O." {
    include *
    autoLayout lr
  }

  component dao.web "ProductMap" "Carte globale des domaines métier actuels." {
    include client contractor reviewer admin
    include dao.web.auth dao.web.projects dao.web.lots dao.web.documents
    include dao.web.collaboration dao.web.review dao.web.publications
    include dao.web.offers dao.web.awards dao.web.manager dao.web.services dao.web.email
    include supabase resend
    autoLayout lr
  }

  component dao.web "Roadmap" "Fonctions en cours ou futures, séparées du runtime actuel." {
    include dao.web.compare dao.web.awards dao.web.execution dao.web.subcontract dao.web.staff dao.web.settings
    autoLayout lr
  }

  dynamic dao.web "ClientFlow" "Du chantier à la publication." {
    client -> dao.web.projects "Crée le chantier"
    dao.web.projects -> dao.web.lots "Crée au moins un lot réel"
    client -> dao.web.documents "Ajoute les documents"
    client -> dao.web.review "Soumet"
    reviewer -> dao.web.review "Approuve ou refuse"
    dao.web.review -> dao.web.publications "Ouvre la publication après approbation"
    autoLayout lr
  }

  dynamic dao.web "InvitationFlow" "Invitation et collaboration chantier." {
    client -> dao.web.collaboration "Prépare l'équipe"
    dao.web.collaboration -> dao.web.services "Crée l'invitation contrôlée"
    dao.web.services -> supabase "Persiste et autorise"
    dao.web.services -> dao.web.email "Demande l'email"
    dao.web.email -> resend "Envoie l'invitation"
    contractor -> dao.web.collaboration "Accepte et rejoint"
    autoLayout lr
  }

  dynamic dao.web "OfferFlow" "Publication, offre et attribution." {
    contractor -> dao.web.publications "Ouvre une D.A.O autorisée"
    contractor -> dao.web.offers "Soumet son offre"
    dao.web.offers -> dao.web.services "Versionne et fige"
    dao.web.services -> supabase "Protège les données"
    client -> dao.web.compare "Compare" "P2"
    dao.web.compare -> dao.web.awards "Prépare l'attribution" "P2"
    autoLayout lr
  }

  dynamic dao.web "ManagerFlow" "Back-office Gestionnaire V1." {
    reviewer -> dao.web.manager "Ouvre le pilotage"
    dao.web.manager -> dao.web.services "Charge les files autorisées"
    dao.web.services -> supabase "Lit via staff/RLS"
    reviewer -> dao.web.review "Traite les dossiers"
    reviewer -> dao.web.publications "Supervise les publications"
    autoLayout lr
  }

  deployment * development "DevDeployment" "Déploiement DEV actuel." {
    include *
    autoLayout lr
  }

  styles {
    element "Person" { shape person background #084c61 color #ffffff }
    element "Software System" { background #177e89 color #ffffff }
    element "Container" { background #4f6d7a color #ffffff }
    element "Component" { background #d9e4e8 color #14252b }
    element "External" { background #6c757d color #ffffff }
    element "InProgress" { background #d9a441 color #14252b }
    element "Planned" { background #eeeeee color #666666 opacity 55 }
  }
}

configuration { scope softwaresystem }
}
