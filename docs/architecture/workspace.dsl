workspace "D.A.O" "Architecture C4 vivante de la plateforme D.A.O" {

    !identifiers hierarchical

    model {
        client = person "Client" "Crée et pilote ses chantiers, lots, documents et publications."
        contractor = person "Artisan / Entreprise" "Participe aux chantiers autorisés et répond aux D.A.O."
        reviewer = person "Gestionnaire D.A.O" "Supervise les revues, publications et profils professionnels."
        admin = person "Administrateur D.A.O" "Administre les capacités internes sensibles et le paramétrage autorisé."

        dao = softwareSystem "D.A.O" "Plateforme de construction, rénovation, marketplace et workflow chantier." {
            web = container "Application Web + API" "Interface responsive et API serveur D.A.O." "Next.js 15 / React 19 / TypeScript" {
                auth = component "Auth & navigation par rôle" "Connexion, inscription, récupération et navigation selon les rôles." "Supabase Auth / Next.js"
                projects = component "Chantiers & lots" "Projets, versions, lots réels, documents et informations privées." "Next.js / TypeScript"
                collaboration = component "Collaboration chantier" "Membres, invitations, confirmation client et affectation aux lots." "Next.js / TypeScript"
                marketplace = component "Marketplace D.A.O" "Publications, offres versionnées, comparaison et attribution." "Next.js / TypeScript"
                backoffice = component "Back-office Gestionnaire" "Revues, supervision des publications, clients et artisans/entreprises." "Next.js / TypeScript"
                services = component "Services & commandes métier" "Validation serveur, RPC métier et orchestration des accès." "TypeScript / Supabase RPC"
                email = component "Email transactionnel" "Envoi serveur des invitations D.A.O avec idempotence." "Resend API"
            }
        }

        supabase = softwareSystem "Supabase" "Auth, PostgreSQL, RLS, RPC et Storage privé." {
            tags "External"
        }
        resend = softwareSystem "Resend" "Transport des emails transactionnels." {
            tags "External"
        }
        github = softwareSystem "GitHub Actions" "CI, E2E jetable, contrôles et déploiement DEV." {
            tags "External"
        }

        client -> dao.web.projects "Prépare et suit ses chantiers"
        client -> dao.web.collaboration "Invite et collabore avec son équipe"
        client -> dao.web.marketplace "Publie et traite les offres autorisées"

        contractor -> dao.web.collaboration "Rejoint et travaille sur les chantiers autorisés"
        contractor -> dao.web.marketplace "Consulte les D.A.O et soumet ses offres"

        reviewer -> dao.web.backoffice "Pilote les opérations D.A.O"
        admin -> dao.web.backoffice "Administre les fonctions internes autorisées"

        dao.web.auth -> dao.web.services "Résout l'identité et les droits"
        dao.web.projects -> dao.web.services "Exécute les commandes chantier"
        dao.web.collaboration -> dao.web.services "Exécute les commandes de collaboration"
        dao.web.marketplace -> dao.web.services "Exécute les commandes publication/offre/attribution"
        dao.web.backoffice -> dao.web.services "Exécute les commandes staff autorisées"
        dao.web.services -> supabase "Utilise Auth/JWT, PostgreSQL/RLS, RPC et Storage privé"
        dao.web.services -> dao.web.email "Demande les notifications transactionnelles"
        dao.web.email -> resend "Envoie les emails transactionnels"
        github -> dao.web "Construit, valide et déploie les releases vérifiées"

        development = deploymentEnvironment "DEV" {
            deploymentNode "OVH VPS DEV" "Hébergement de dao-dev.logiclab.fr" "Ubuntu 24.04" {
                containerInstance dao.web
            }
        }
    }

    views {
        systemLandscape "Landscape" "Vue globale de D.A.O et de ses dépendances." {
            include *
            autoLayout lr
        }

        systemContext dao "SystemContext" "Acteurs et systèmes externes autour de D.A.O." {
            include *
            autoLayout lr
        }

        container dao "Containers" "Conteneurs applicatifs et dépendances runtime." {
            include *
            autoLayout lr
        }

        component dao.web "WebComponents" "Domaines fonctionnels principaux de l'application D.A.O." {
            include *
            autoLayout lr
        }

        dynamic dao.web "ClientProjectFlow" "Flux principal de préparation d'un chantier client." {
            client -> dao.web.projects "Crée et complète le chantier et ses lots"
            dao.web.projects -> dao.web.services "Soumet les commandes validées"
            dao.web.services -> supabase "Persiste avec contrôle JWT/RLS/RPC"
            autoLayout lr
        }

        dynamic dao.web "InvitationFlow" "Invitation réelle d'un artisan/entreprise sur un chantier." {
            client -> dao.web.collaboration "Crée une invitation sur un lot principal"
            dao.web.collaboration -> dao.web.services "Demande l'émission contrôlée"
            dao.web.services -> supabase "Crée et vérifie l'invitation"
            dao.web.services -> dao.web.email "Demande l'envoi transactionnel"
            dao.web.email -> resend "Envoie le lien d'invitation"
            contractor -> dao.web.collaboration "Accepte et rejoint le chantier"
            dao.web.collaboration -> dao.web.services "Confirme l'acceptation"
            dao.web.services -> supabase "Active le membre et son affectation"
            autoLayout lr
        }

        dynamic dao.web "ManagerReviewFlow" "Revue d'un dossier par le Gestionnaire D.A.O." {
            client -> dao.web.projects "Soumet une version avec ses lots"
            dao.web.projects -> dao.web.services "Demande la soumission en revue"
            dao.web.services -> supabase "Fige l'état de revue"
            reviewer -> dao.web.backoffice "Examine la version et ses lots"
            dao.web.backoffice -> dao.web.services "Approuve ou refuse avec motif"
            dao.web.services -> supabase "Enregistre la décision et l'historique"
            autoLayout lr
        }

        deployment * development "DevDeployment" "Déploiement actuel de l'application D.A.O en DEV." {
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
            relationship "Relationship" {
                color #586069
            }
        }
    }

    configuration {
        scope softwaresystem
    }
}
