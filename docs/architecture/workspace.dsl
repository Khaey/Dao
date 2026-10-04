workspace "D.A.O" "Architecture C4 vivante et détaillée de la plateforme D.A.O" {
!identifiers hierarchical

model {
  client = person "Client" "Crée, fait revoir, publie et suit ses chantiers."
  contractor = person "Artisan / Entreprise" "Participe aux chantiers autorisés et répond aux D.A.O."
  reviewer = person "Gestionnaire D.A.O" "Traite les revues et supervise publications/professionnels."
  admin = person "Administrateur D.A.O" "Dispose du back-office avec capacités sensibles supplémentaires."

  dao = softwareSystem "D.A.O" "Plateforme construction/rénovation, marketplace et workflow chantier." {
    web = container "Application Web + API" "Interface responsive et API serveur." "Next.js 15 / React 19 / TypeScript" {
      shell = component "Shell applicatif & RoleNav" "Navigation selon rôles et accès aux espaces client, artisan et D.A.O." "Next.js"
      auth = component "Auth" "Login, register client/contractor, forgot/reset password, invitation return." "Supabase Auth"
      profile = component "Profils" "Profil utilisateur, contractor profile, statuts public/verification." "Next.js / Supabase"

      projects = component "Chantiers" "Création, édition, versions, statut, avancement et archivage." "Next.js / API / RPC"
      lots = component "Lots / project_requests" "Lots réels versionnés; métier, périmètre, budget et retrait logique." "Next.js / RPC"
      privateDetails = component "Informations privées" "Adresse exacte, accès, téléphone, email privés." "Next.js / RLS"
      documents = component "Documents" "Upload Storage privé, grants et signed URLs après autorisation." "Next.js / Supabase Storage"

      collaboration = component "Collaboration chantier" "Membres, rôles projet, permissions privées et affectation aux lots." "Next.js / RPC"
      invitations = component "Invitations chantier" "Token one-shot hashé, expiration, preview, accept/refuse/revoke." "Next.js / RPC"
      teamCreation = component "Création avec équipe existante" "Création atomique projet + lots principaux + invitations." "Next.js / RPC"

      review = component "Revue D.A.O" "Soumission client, revue staff, rejet motivé, correction et approbation." "Next.js / RPC"
      publications = component "Publications" "Publication de snapshots approuvés: public, targeted, invite-only." "Next.js / RPC"
      marketplace = component "DAO disponibles" "Découverte artisan des publications autorisées." "Next.js / RLS"

      bids = component "Offres / bids" "Brouillon, items, versioning, pièces et soumission immuable." "Next.js / RPC"
      compare = component "Comparaison offres P2" "Comparaison client par lot des offres soumises." "En attente PR #27" "InProgress"
      awards = component "Attribution" "Attribution atomique par lot avec une seule attribution active." "Supabase RPC"

      manager = component "Back-office Gestionnaire V1" "Landing interne, files de revue, publications et supervision professionnelle." "Next.js"
      managerReview = component "File Revues" "Dossiers client_review/dao_review et décisions staff." "Next.js"
      managerPublications = component "File Publications" "Projets approuvés prêts à publier et registre des publications." "Next.js"
      managerProfessionals = component "Supervision professionnels" "Lecture des profils artisans/entreprises." "Next.js / RLS"

      api = component "API serveur" "Endpoints projects, publications, bids, awards, documents, profile, invitations et DAO." "Next.js Route Handlers"
      services = component "Services métier" "Project/Document/Invitation/Email services et validation serveur." "TypeScript"
      rpc = component "Façades RPC métier" "Commandes publiques contrôlées déléguant aux fonctions privées." "PostgreSQL RPC"
      email = component "Email invitation" "Authorization preflight, hash check, idempotence, HTML/text." "Resend transport"

      staffAdmin = component "Équipe D.A.O & permissions" "Utilisateurs internes, droits fins, activation/révocation et audit." "Futur" "Planned"
      settings = component "Paramétrage avancé" "Configuration clients/artisans/workflows/pays; hors V1." "Futur" "Planned"
      contracts = component "Contrats & exécution" "Contrat, jalons, versements, réception, réserves, avenants, résiliation, garantie." "P2/P3 futur" "Planned"
      subcontract = component "Sous-traitance entreprise" "Entreprise titulaire pouvant publier certains lots aux sous-traitants." "P3 futur" "Planned"
      sessionPolicy = component "Politique de session" "Timeout/re-auth plus strict pour staff/admin; politique à définir." "Futur sécurité" "Planned"
    }
  }

  supabase = softwareSystem "Supabase" "Fondation data et sécurité D.A.O." {
    authService = container "Auth" "Sessions, JWT, inscription et recovery." "Supabase Auth"
    database = container "PostgreSQL" "Données métier, fonctions, triggers, historique et ledger de migrations." "PostgreSQL"
    storage = container "Storage privé" "Documents de projets et objets privés." "Supabase Storage"
    rls = container "RLS / dao_private" "Frontière d'autorisation et helpers privés." "PostgreSQL RLS" 
  }

  resend = softwareSystem "Resend" "Transport des emails transactionnels." "External"
  github = softwareSystem "GitHub" "Source de vérité, PR, Actions, Releases et CI/CD." "External"
  vps = softwareSystem "VPS DEV OVH" "Héberge dao-dev.logiclab.fr et dao-dev.service." "External"

  client -> dao.web.shell "Utilise l'espace client"
  contractor -> dao.web.shell "Utilise l'espace artisan"
  reviewer -> dao.web.shell "Utilise le back-office"
  admin -> dao.web.shell "Utilise le back-office"

  dao.web.shell -> dao.web.auth "Oriente selon identité/rôles"
  dao.web.auth -> supabase.authService "Login/register/recovery"
  dao.web.profile -> supabase.database "Lit/écrit le profil autorisé"

  client -> dao.web.projects "Gère ses chantiers"
  client -> dao.web.lots "Gère ses lots"
  client -> dao.web.privateDetails "Gère les infos privées"
  client -> dao.web.documents "Gère les documents"
  client -> dao.web.teamCreation "Crée avec équipe existante"
  client -> dao.web.collaboration "Gère l'équipe chantier"
  client -> dao.web.review "Soumet/corrige le DAO"
  client -> dao.web.publications "Publie après approbation"
  client -> dao.web.compare "Compare les offres" "P2"

  contractor -> dao.web.marketplace "Consulte les DAO autorisées"
  contractor -> dao.web.bids "Prépare/soumet ses offres"
  contractor -> dao.web.invitations "Accepte/refuse une invitation"
  contractor -> dao.web.collaboration "Travaille sur un chantier accepté"

  reviewer -> dao.web.manager "Pilote les opérations"
  reviewer -> dao.web.managerReview "Traite les revues"
  reviewer -> dao.web.managerPublications "Supervise les publications"
  reviewer -> dao.web.managerProfessionals "Consulte les professionnels"
  admin -> dao.web.manager "Pilote avec droits admin"
  admin -> dao.web.staffAdmin "Gère l'équipe" "Futur"
  admin -> dao.web.settings "Configure la plateforme" "Futur"

  dao.web.projects -> dao.web.lots "Structure en lots réels"
  dao.web.projects -> dao.web.privateDetails "Porte les informations confidentielles"
  dao.web.projects -> dao.web.documents "Porte les documents"
  dao.web.projects -> dao.web.review "Soumet une version"
  dao.web.teamCreation -> dao.web.invitations "Crée une invitation par lot principal"
  dao.web.invitations -> dao.web.collaboration "Active la participation après acceptation"
  dao.web.review -> dao.web.publications "Rend publiable après approbation"
  dao.web.publications -> dao.web.marketplace "Expose uniquement les publications autorisées"
  dao.web.marketplace -> dao.web.bids "Permet une offre autorisée"
  dao.web.bids -> dao.web.compare "Alimente la comparaison"
  dao.web.bids -> dao.web.awards "Alimente l'attribution"
  dao.web.awards -> dao.web.contracts "Déclenche le cycle contractuel" "Futur"
  dao.web.contracts -> dao.web.subcontract "Permet la sous-traitance contrôlée" "Futur"

  dao.web.manager -> dao.web.managerReview "Expose les files de revue"
  dao.web.manager -> dao.web.managerPublications "Expose les publications"
  dao.web.manager -> dao.web.managerProfessionals "Expose la supervision pro"

  dao.web.projects -> dao.web.api "Appelle les routes serveur"
  dao.web.lots -> dao.web.api "Appelle les routes/RPC"
  dao.web.documents -> dao.web.api "Upload/download contrôlé"
  dao.web.invitations -> dao.web.api "Issue/revoke/send"
  dao.web.review -> dao.web.api "Décision de revue"
  dao.web.publications -> dao.web.api "Publication"
  dao.web.bids -> dao.web.api "Cycle offre"
  dao.web.awards -> dao.web.api "Attribution"
  dao.web.profile -> dao.web.api "Mise à jour profil"

  dao.web.api -> dao.web.services "Valide et orchestre"
  dao.web.services -> dao.web.rpc "Exécute les commandes métier"
  dao.web.rpc -> supabase.database "Exécute fonctions/triggers"
  dao.web.rpc -> supabase.rls "Applique l'autorisation"
  dao.web.auth -> supabase.authService "Résout auth.uid/JWT"
  dao.web.documents -> supabase.storage "Stocke les objets privés"
  dao.web.services -> supabase.storage "Émet signed URL après contrôle"
  dao.web.services -> dao.web.email "Envoie une invitation"
  dao.web.email -> resend "POST transactionnel"

  github -> vps "Déploie uniquement main validé"
  vps -> dao.web "Exécute la release DEV"
  github -> supabase "CI utilise une stack Supabase locale jetable, pas DEV" "CI"

  development = deploymentEnvironment "DEV" {
    deploymentNode "OVH VPS DEV" "dao-dev.logiclab.fr" "Ubuntu 24.04" {
      containerInstance dao.web
    }
  }
}

views {
  systemLandscape "Landscape" "Vision globale acteurs, D.A.O, Supabase, Resend et exploitation." {
    include client contractor reviewer admin dao supabase resend github vps
    autoLayout lr
  }

  systemContext dao "SystemContext" "Qui utilise D.A.O et de quels systèmes dépend la plateforme." {
    include *
    autoLayout lr
  }

  component dao.web "ProductMap" "Carte fonctionnelle détaillée de ce qui existe aujourd'hui." {
    include client contractor reviewer admin
    include dao.web.shell dao.web.auth dao.web.profile
    include dao.web.projects dao.web.lots dao.web.privateDetails dao.web.documents
    include dao.web.teamCreation dao.web.invitations dao.web.collaboration
    include dao.web.review dao.web.publications dao.web.marketplace
    include dao.web.bids dao.web.awards
    include dao.web.manager dao.web.managerReview dao.web.managerPublications dao.web.managerProfessionals
    include dao.web.api dao.web.services dao.web.rpc dao.web.email
    include supabase.authService supabase.database supabase.storage supabase.rls resend
    autoLayout lr
  }

  component dao.web "ClientWorkspace" "Détail de l'espace Client." {
    include client
    include dao.web.auth dao.web.projects dao.web.lots dao.web.privateDetails dao.web.documents
    include dao.web.teamCreation dao.web.invitations dao.web.collaboration
    include dao.web.review dao.web.publications dao.web.compare dao.web.api dao.web.services dao.web.rpc
    include supabase.authService supabase.database supabase.storage supabase.rls
    autoLayout lr
  }

  component dao.web "ContractorWorkspace" "Détail de l'espace Artisan / Entreprise." {
    include contractor
    include dao.web.auth dao.web.profile dao.web.marketplace dao.web.bids
    include dao.web.invitations dao.web.collaboration dao.web.api dao.web.services dao.web.rpc
    include supabase.authService supabase.database supabase.rls
    autoLayout lr
  }

  component dao.web "Backoffice" "Détail du Back-office Gestionnaire/Admin V1 et extensions futures." {
    include reviewer admin
    include dao.web.auth dao.web.manager dao.web.managerReview dao.web.managerPublications dao.web.managerProfessionals
    include dao.web.review dao.web.publications dao.web.staffAdmin dao.web.settings
    include dao.web.api dao.web.services dao.web.rpc
    include supabase.authService supabase.database supabase.rls
    autoLayout lr
  }

  component dao.web "SecurityData" "Frontières sécurité/data: Auth, API, RPC, RLS et Storage privé." {
    include client contractor reviewer admin
    include dao.web.auth dao.web.api dao.web.services dao.web.rpc dao.web.documents dao.web.email
    include supabase.authService supabase.database supabase.rls supabase.storage resend
    autoLayout lr
  }

  component dao.web "Roadmap" "Capacités en cours/futures clairement séparées de l'opérationnel." {
    include dao.web.compare dao.web.awards dao.web.contracts dao.web.subcontract
    include dao.web.staffAdmin dao.web.settings dao.web.sessionPolicy
    autoLayout lr
  }

  dynamic dao.web "ClientProjectFlow" "Création d'un chantier jusqu'à la revue." {
    client -> dao.web.projects "Crée le chantier"
    dao.web.projects -> dao.web.lots "Crée au moins un lot réel"
    client -> dao.web.documents "Ajoute les documents"
    client -> dao.web.privateDetails "Ajoute les infos privées"
    client -> dao.web.review "Soumet la version"
    dao.web.review -> dao.web.api "Demande la transition"
    dao.web.api -> dao.web.services "Valide"
    dao.web.services -> dao.web.rpc "Commande métier"
    dao.web.rpc -> supabase.database "Fige la version/snapshots"
    autoLayout lr
  }

  dynamic dao.web "CorrectionFlow" "Rejet puis correction sans mutation historique." {
    reviewer -> dao.web.managerReview "Ouvre le dossier"
    reviewer -> dao.web.review "Refuse avec motif"
    dao.web.review -> dao.web.rpc "Enregistre la décision"
    client -> dao.web.projects "Voit le motif"
    client -> dao.web.projects "Crée/corrige un nouveau draft"
    client -> dao.web.review "Resoumet"
    autoLayout lr
  }

  dynamic dao.web "ExistingTeamFlow" "Création client avec artisans connus et lots principaux." {
    client -> dao.web.teamCreation "Saisit chantier + lignes artisans/lots"
    dao.web.teamCreation -> dao.web.api "Envoie la préparation"
    dao.web.api -> dao.web.rpc "Crée atomiquement projet/lots/invitations"
    dao.web.rpc -> supabase.database "Persiste le tout"
    dao.web.services -> dao.web.email "Envoie l'invitation"
    dao.web.email -> resend "Livre l'email"
    contractor -> dao.web.invitations "Accepte"
    dao.web.invitations -> dao.web.rpc "Active membership + lot principal"
    autoLayout lr
  }

  dynamic dao.web "PublicationBidFlow" "Publication, offre et confidentialité." {
    reviewer -> dao.web.publications "Supervise le projet approuvé"
    dao.web.publications -> dao.web.rpc "Publie les snapshots autorisés"
    contractor -> dao.web.marketplace "Voit une publication autorisée"
    contractor -> dao.web.bids "Crée puis soumet son offre"
    dao.web.bids -> dao.web.rpc "Versionne et fige"
    dao.web.rpc -> supabase.rls "Isole concurrents et données privées"
    client -> dao.web.compare "Compare les offres soumises" "P2 en attente"
    autoLayout lr
  }

  dynamic dao.web "AwardFlow" "Attribution atomique par lot." {
    client -> dao.web.compare "Sélectionne une offre" "P2"
    dao.web.compare -> dao.web.awards "Demande l'attribution"
    dao.web.awards -> dao.web.rpc "Commande atomique"
    dao.web.rpc -> supabase.database "Verrouille et crée l'attribution"
    dao.web.rpc -> supabase.rls "Empêche les accès non autorisés"
    autoLayout lr
  }

  dynamic dao.web "ManagerFlow" "Back-office Gestionnaire V1." {
    reviewer -> dao.web.manager "Ouvre le pilotage"
    dao.web.manager -> dao.web.managerReview "Accède aux revues"
    dao.web.managerReview -> dao.web.services "Charge via staff()"
    dao.web.services -> supabase.rls "Autorise le périmètre staff"
    reviewer -> dao.web.managerPublications "Supervise les publications"
    reviewer -> dao.web.managerProfessionals "Consulte les professionnels"
    autoLayout lr
  }

  dynamic dao.web "DocumentAccessFlow" "Téléchargement d'un document privé." {
    client -> dao.web.documents "Demande le document"
    dao.web.documents -> dao.web.api "Demande une URL signée"
    dao.web.api -> dao.web.services "Vérifie acteur et droits"
    dao.web.services -> supabase.rls "Contrôle l'accès"
    dao.web.services -> supabase.storage "Crée URL signée"
    autoLayout lr
  }

  deployment * development "DevDeployment" "Déploiement DEV actuel sur VPS." {
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
