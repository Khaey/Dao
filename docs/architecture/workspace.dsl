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
      compare = component "Comparaison offres P2" "Comparaison client par lot de la version soumise actuelle de chaque offre." "Next.js / RLS"
      awards = component "Attribution" "Attribution par lot ou package indivisible, fermeture aux offres, résultats confidentiels, annulation motivée et réattribution auditées." "Supabase RPC"

      manager = component "Back-office Gestionnaire V2" "Pilotage, affectation de revue, annuaires, historique et actions staff." "Next.js"
      notificationWorker = component "Emails de suivi après commit" "Outbox durable, leases, idempotence et retries bornés." "Next.js instrumentation / Resend"
      technicalSubLots = component "Sous-lots techniques" "Identités stables, versions et snapshot publié ; aucun award autonome." "PostgreSQL / RPC"
      managerClients = component "Clients et historique" "Contacts, collaborations, états et audit append-only autorisé." "Next.js / RPC / RLS"
      managerReview = component "File Revues" "Claim atomique, versions internes et décisions du gestionnaire affecté." "Next.js"
      managerPublications = component "File Publications" "Projets approuvés prêts à publier et registre des publications." "Next.js"
      managerProfessionals = component "Supervision professionnels" "Vérification, refus et administration des profils professionnels." "Next.js / RLS"

      api = component "API serveur" "Endpoints projects, publications, bids, awards, documents, profile, invitations et DAO." "Next.js Route Handlers"
      services = component "Services métier" "Project/Document/Invitation/Email services et validation serveur." "TypeScript"
      rpc = component "Façades RPC métier" "Commandes publiques contrôlées déléguant aux fonctions privées." "PostgreSQL RPC"
      email = component "Email invitation" "Authorization preflight, hash check, idempotence, HTML/text." "Resend transport"

      staffAdmin = component "Équipe D.A.O & permissions" "Invitation Auth standard, rôles cumulables, suspension et dernier Admin actif." "Next.js / RPC / Auth"
      settings = component "Paramétrage avancé" "Configuration clients/artisans/workflows/pays; hors V1." "Futur" "Planned"
      contracts = component "Contrats & exécution" "Contrat, jalons, versements, réception, réserves, avenants, résiliation, garantie." "P2/P3 futur" "Planned"
      subcontract = component "Sous-traitance entreprise" "Entreprise titulaire pouvant publier certains lots aux sous-traitants." "P3 futur" "Planned"
      sessionPolicy = component "Politique de session" "Timeout/re-auth plus strict pour staff/admin; politique à définir." "Futur sécurité" "Planned"
    }
  }

  supabase = softwareSystem "Supabase" "Plateforme externe fournissant Auth, PostgreSQL/RLS/RPC et Storage privé." "External"
  supabaseAuth = softwareSystem "Supabase Auth" "Sessions, JWT, inscription et password recovery." "External"
  supabaseDb = softwareSystem "Supabase PostgreSQL" "Données métier, fonctions, triggers et historique." "External"
  supabaseRls = softwareSystem "Supabase RLS / dao_private" "Frontière d'autorisation et helpers privés." "External"
  supabaseStorage = softwareSystem "Supabase Storage privé" "Documents et objets privés." "External"

  demoOwner = person "Propriétaire / invité OCE" "Identité Access nommément approuvée, indépendante des rôles D.A.O."
  oceDemo = softwareSystem "Démo OCE indépendante" "Runtime OCE existant ; comptes démo conservés ; aucune dépendance produit D.A.O." "External"
  ocePrivateAccess = softwareSystem "Accès privé démo OCE" "Préparé #58, non activé : Access OTP, e-mails exacts et Tunnel avec validation JWT Access." "External,Planned"
  demoOwner -> ocePrivateAccess "Cible de recette propriétaire/invités ; non activée"
  ocePrivateAccess -> oceDemo "Cible : Tunnel vers loopback:8080 ; sans bascule du port public" "Planned"

  resend = softwareSystem "Resend" "Transport des emails transactionnels." "External"

  supabase -> supabaseAuth "Fournit le service Auth"
  supabase -> supabaseDb "Fournit PostgreSQL/RPC"
  supabase -> supabaseRls "Fournit RLS/dao_private"
  supabase -> supabaseStorage "Fournit Storage privé"
  github = softwareSystem "GitHub" "Source de vérité, PR, Actions, Releases et CI/CD." "External"
  githubDevEnv = softwareSystem "GitHub Environment dev" "Stockage protégé des variables/secrets DEV consommés uniquement par les workflows autorisés." "External"
  cloudflareApi = softwareSystem "API Cloudflare OCE" "GET de zone/tunnel et audit Access/DNS/connecteur #58 ; distinct de l'accès démo non activé." "External"
  vps = softwareSystem "VPS DEV OVH" "Héberge dao-dev.logiclab.fr, dao-dev.service et /etc/dao/dao-dev.env." "External"
  workAgents = person "Agents DEV / OPT / Pilot" "Consomment les opérations fixes depuis GitHub ; aucun compte root individuel."
  rootMaintenance = softwareSystem "Maintenance root OPS" "Catalogue installé #91, admission main/CI/SHA et snapshots root ; cycle upgrade/rollback du contrôleur qualifié live sur une évolution réelle." "External"
  workAgents -> github "Commentaires owner exacts #91 ou Actions main selon mandat"
  workAgents -> github "Commentaires owner exacts #58 pour contrôle Cloudflare sur runner selon mandat"
  githubDevEnv -> github "Fournit les deux jetons OCE et la liste approuvée privée à la seule étape de contrôle #58"
  github -> cloudflareApi "GET main-only sous owner/dev ; aucun transfert VPS, credential écrit ou tunnel démarré"
  github -> rootMaintenance "Scripts de contrôle non-root main-only, indépendants du lien release ; maintenance exige CI verte et admission du SHA"
  rootMaintenance -> vps "Maintient et restaure le code des neuf copies root ; aucun secret/service/réseau modifié"

  client -> dao.web.shell "Utilise l'espace client"
  contractor -> dao.web.shell "Utilise l'espace artisan"
  reviewer -> dao.web.shell "Utilise le back-office"
  admin -> dao.web.shell "Utilise le back-office"

  dao.web.shell -> dao.web.auth "Oriente selon identité/rôles"
  dao.web.auth -> supabaseAuth "Login/register/recovery"
  dao.web.profile -> supabaseDb "Lit/écrit le profil autorisé"

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
  contractor -> dao.web.contracts "Participe à l’exécution" "Futur"

  reviewer -> dao.web.manager "Pilote les opérations"
  reviewer -> dao.web.managerReview "Traite les revues"
  reviewer -> dao.web.review "Décide sur les dossiers"
  reviewer -> dao.web.managerPublications "Supervise les publications"
  reviewer -> dao.web.publications "Supervise les publications"
  reviewer -> dao.web.managerProfessionals "Consulte les professionnels"
  admin -> dao.web.manager "Pilote avec droits admin"
  admin -> dao.web.staffAdmin "Gère comptes et rôles"
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
  dao.web.compare -> dao.web.awards "Prépare l'attribution"
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
  dao.web.rpc -> supabaseDb "Exécute fonctions/triggers"
  dao.web.rpc -> supabaseRls "Applique l'autorisation"
  dao.web.auth -> supabaseAuth "Résout auth.uid/JWT"
  dao.web.documents -> supabaseStorage "Stocke les objets privés"
  dao.web.services -> supabaseStorage "Émet signed URL après contrôle"
  dao.web.services -> dao.web.email "Envoie une invitation"
  dao.web.email -> resend "POST transactionnel"
  dao.web.rpc -> dao.web.notificationWorker "Enregistre un événement avec la mutation"
  dao.web.notificationWorker -> supabaseDb "Claim et complète les leases"
  dao.web.notificationWorker -> resend "Livre après commit avec clé stable"
  dao.web.staffAdmin -> supabaseAuth "Invite après préflight Admin"
  dao.web.staffAdmin -> dao.web.api "Commande comptes et rôles"
  dao.web.lots -> dao.web.technicalSubLots "Décompose le périmètre versionné"
  dao.web.technicalSubLots -> dao.web.publications "Fige la décomposition dans le snapshot"
  dao.web.manager -> dao.web.managerClients "Expose clients et historique"

  github -> githubDevEnv "Lit les variables/secrets protégés du déploiement DEV"
  githubDevEnv -> vps "Alimente env-sync via un payload éphémère hors artifact"
  github -> vps "Main validé : déploiement et contrôle OPS fixe sous identité dao ; secrets protégés, verrous et readiness"
  vps -> dao.web "Exécute la release DEV et restaure env + release si readiness échoue"
  github -> supabase "CI utilise une stack Supabase locale jetable, pas DEV" "CI"

  development = deploymentEnvironment "DEV" {
    deploymentNode "OVH VPS DEV" "dao-dev.logiclab.fr" "Ubuntu 24.04" {
      containerInstance dao.web
    }
  }
}

views {
  systemLandscape "Landscape" "Vision globale acteurs, D.A.O, Supabase, Resend et exploitation." {
    include client contractor reviewer admin dao supabase resend github githubDevEnv vps
    autoLayout lr
  }

  systemLandscape "OpsControl" "Premier lot OPS #91 : bootstrap, grants et cycle de maintenance du code qualifiés live." {
    include workAgents github githubDevEnv vps rootMaintenance
    autoLayout tb
  }

  systemLandscape "OceCloudflareChecks" "Contrôles Cloudflare #58 sur runner ; provisionnement root et activation restent séparés." {
    include workAgents github githubDevEnv cloudflareApi
    autoLayout tb
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
    include dao.web.bids dao.web.compare dao.web.awards
    include dao.web.manager dao.web.managerReview dao.web.managerPublications dao.web.managerProfessionals dao.web.managerClients dao.web.notificationWorker dao.web.technicalSubLots
    include dao.web.api dao.web.services dao.web.rpc dao.web.email
    include supabaseAuth supabaseDb supabaseStorage supabaseRls resend
    autoLayout lr
  }

  component dao.web "ClientWorkspace" "Détail de l'espace Client." {
    include client
    include dao.web.auth dao.web.projects dao.web.lots dao.web.privateDetails dao.web.documents
    include dao.web.teamCreation dao.web.invitations dao.web.collaboration
    include dao.web.review dao.web.publications dao.web.compare dao.web.api dao.web.services dao.web.rpc
    include supabaseAuth supabaseDb supabaseStorage supabaseRls
    autoLayout lr
  }

  component dao.web "ContractorWorkspace" "Détail de l'espace Artisan / Entreprise." {
    include contractor
    include dao.web.auth dao.web.profile dao.web.marketplace dao.web.bids
    include dao.web.invitations dao.web.collaboration dao.web.api dao.web.services dao.web.rpc
    include supabaseAuth supabaseDb supabaseRls
    autoLayout lr
  }

  component dao.web "Backoffice" "Détail du Back-office Gestionnaire/Admin V1 et extensions futures." {
    include reviewer admin
    include dao.web.auth dao.web.manager dao.web.managerReview dao.web.managerPublications dao.web.managerProfessionals
    include dao.web.review dao.web.publications dao.web.staffAdmin dao.web.settings
    include dao.web.api dao.web.services dao.web.rpc
    include supabaseAuth supabaseDb supabaseRls
    autoLayout lr
  }

  component dao.web "SecurityData" "Frontières sécurité/data: Auth, API, RPC, RLS et Storage privé." {
    include client contractor reviewer admin
    include dao.web.auth dao.web.api dao.web.services dao.web.rpc dao.web.documents dao.web.email
    include supabaseAuth supabaseDb supabaseRls supabaseStorage resend
    autoLayout lr
  }

  component dao.web "Roadmap" "Capacités en cours/futures clairement séparées de l'opérationnel." {
    include dao.web.contracts dao.web.subcontract
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
    dao.web.rpc -> supabaseDb "Fige la version/snapshots"
    autoLayout lr
  }

  dynamic dao.web "CorrectionFlow" "Rejet puis correction sans mutation historique." {
    reviewer -> dao.web.managerReview "Ouvre le dossier"
    reviewer -> dao.web.review "Refuse avec motif"
    dao.web.review -> dao.web.api "Soumet la décision"
    dao.web.api -> dao.web.services "Valide et orchestre"
    dao.web.services -> dao.web.rpc "Enregistre la décision"
    client -> dao.web.projects "Voit le motif"
    client -> dao.web.projects "Crée/corrige un nouveau draft"
    client -> dao.web.review "Resoumet"
    autoLayout lr
  }

  dynamic dao.web "ExistingTeamFlow" "Création client avec artisans connus et lots principaux." {
    client -> dao.web.teamCreation "Saisit chantier + lignes artisans/lots"
    dao.web.teamCreation -> dao.web.invitations "Prépare les invitations liées aux lots principaux"
    dao.web.invitations -> dao.web.api "Envoie la préparation"
    dao.web.api -> dao.web.services "Valide et orchestre"
    dao.web.services -> dao.web.rpc "Crée atomiquement projet/lots/invitations"
    dao.web.rpc -> supabaseDb "Persiste le tout"
    dao.web.services -> dao.web.email "Envoie l'invitation"
    dao.web.email -> resend "Livre l'email"
    contractor -> dao.web.invitations "Accepte"
    dao.web.invitations -> dao.web.api "Soumet l'acceptation"
    dao.web.api -> dao.web.services "Valide l'acceptation"
    dao.web.services -> dao.web.rpc "Active membership + lot principal"
    autoLayout lr
  }

  dynamic dao.web "PublicationBidFlow" "Publication, offre et confidentialité." {
    reviewer -> dao.web.publications "Supervise le projet approuvé"
    dao.web.publications -> dao.web.api "Demande la publication"
    dao.web.api -> dao.web.services "Valide et orchestre"
    dao.web.services -> dao.web.rpc "Publie les snapshots autorisés"
    contractor -> dao.web.marketplace "Voit une publication autorisée"
    contractor -> dao.web.bids "Crée puis soumet son offre"
    dao.web.bids -> dao.web.api "Soumet la commande d'offre"
    dao.web.api -> dao.web.services "Valide l'offre"
    dao.web.services -> dao.web.rpc "Versionne et fige"
    dao.web.rpc -> supabaseRls "Isole concurrents et données privées"
    client -> dao.web.compare "Compare les offres soumises actuelles"
    autoLayout lr
  }

  dynamic dao.web "AwardFlow" "Clôture, attribution atomique et réattribution." {
    client -> dao.web.compare "Sélectionne un lot ou package"
    dao.web.compare -> dao.web.awards "Demande l'attribution"
    dao.web.awards -> dao.web.api "Soumet la demande"
    dao.web.api -> dao.web.services "Valide et orchestre"
    dao.web.services -> dao.web.rpc "Commande atomique"
    dao.web.rpc -> supabaseDb "Ferme les lots et historise les résultats"
    dao.web.rpc -> supabaseRls "Empêche les accès non autorisés"
    autoLayout lr
  }

  dynamic dao.web "ManagerFlow" "Back-office Gestionnaire V2." {
    reviewer -> dao.web.manager "Ouvre le pilotage"
    dao.web.manager -> dao.web.managerReview "Accède aux revues"
    reviewer -> dao.web.review "Traite les dossiers"
    dao.web.review -> dao.web.api "Soumet la décision"
    dao.web.api -> dao.web.services "Valide et orchestre"
    dao.web.services -> dao.web.rpc "Claim/versionne la revue affectée"
    dao.web.rpc -> supabaseRls "Autorise Admin ou gestionnaire affecté"
    reviewer -> dao.web.managerPublications "Supervise les publications"
    reviewer -> dao.web.managerProfessionals "Consulte les professionnels"
    autoLayout lr
  }

  dynamic dao.web "DocumentAccessFlow" "Téléchargement d'un document privé." {
    client -> dao.web.documents "Demande le document"
    dao.web.documents -> dao.web.api "Demande une URL signée"
    dao.web.api -> dao.web.services "Vérifie acteur et droits"
    dao.web.services -> dao.web.rpc "Vérifie les droits métier"
    dao.web.rpc -> supabaseRls "Contrôle l'accès"
    dao.web.services -> supabaseStorage "Crée URL signée"
    autoLayout lr
  }

  component dao.web "ExecutiveOverview" "Vue d’ensemble simplifiée pour le pilotage global de D.A.O, sans détails techniques." {
    include client contractor reviewer admin
    include dao.web.projects dao.web.lots dao.web.collaboration
    include dao.web.review dao.web.publications dao.web.marketplace
    include dao.web.bids dao.web.compare dao.web.awards
    include dao.web.contracts dao.web.subcontract
    autoLayout lr
  }

  deployment * development "DevDeployment" "Déploiement DEV actuel : artifact vérifié, env-sync protégé/idempotent, readiness et rollback env+release." {
    include *
    autoLayout lr
  }

  styles {
    element "Person" {
      shape person
      background #084c61
      color #ffffff
    }
    element "Software System" {
      background #177e89
      color #ffffff
    }
    element "Container" {
      background #4f6d7a
      color #ffffff
    }
    element "Component" {
      background #d9e4e8
      color #14252b
    }
    element "External" {
      background #6c757d
      color #ffffff
    }
    element "InProgress" {
      background #d9a441
      color #14252b
    }
    element "Planned" {
      background #eeeeee
      color #666666
      opacity 55
    }
  }
}

configuration {
  scope softwaresystem
}
}
