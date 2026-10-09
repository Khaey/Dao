# Profil professionnel enrichi — #112

Lot en cours sur `feat/opt20-professional-profile-112`, propriétaire DAO OPT 20.
La présence de ce document sur une branche ne signifie pas migration ou livraison DEV.

## Données et visibilité

`contractor_profiles` et la commande de profil #83 sont conservés. Le dossier
privé `contractor_profile_details` ajoute les coordonnées professionnelles,
le site HTTPS, les réseaux, la localisation du bureau, l'année de création,
les spécialités et les identifiants légaux déclarés. Le RNE est facultatif :
aucune obligation réglementaire nouvelle ni validation officielle n'est inventée.
Les zones utilisent `contractor_service_areas` ; les réalisations utilisent
`portfolio_projects` et `portfolio_assets` existants.

| Information | Professionnel propriétaire / staff actif | Client actif |
| --- | --- | --- |
| Identifiants fiscaux, RNE, identité légale, représentant | Dossier privé | Jamais |
| Pièces fiscales, immatriculation, assurance, diplôme, identité | Fichiers privés inspectés | Jamais |
| Présentation, métiers, ville, zones, expérience, disponibilité | Édition / revue | Fiche vérifiée et approuvée |
| Téléphone, WhatsApp, email, site, réseaux, adresse exacte | Choix explicite de visibilité | Consentement et fiche approuvée |
| Logo, photos, avant/après, brochure PDF | Quarantaine puis inspection/revue | Consentement, approbation et réalisation publiée |

Tous les consentements commencent à `false`, y compris pour les anciens
portfolios. Une approbation historique n'est pas une preuve de consentement
ou d'inspection. La projection publique est une liste explicite de champs ;
elle exclut identifiants Auth, données légales, chemins Storage et pièces privées.
La complétude indique les sections renseignées, jamais la vérification DAO.

## Commandes, modération et retrait

Les commandes RPC JWT contrôlent le propriétaire, le rôle et le compte actif.
Les décisions staff utilisent une révision attendue, un refus motivé et un audit
sans valeurs fiscales/contact. La publication de l'identité reste Admin uniquement,
en réutilisant la décision #64. La surface dossier PRO sera distincte du Directory
back-office partagé ; vérification et suspension restent les règles existantes.

Identité, activité, métiers, identifiants légaux et changement de pièce légale
relancent la vérification, sans lever une suspension. Les coordonnées, présentation,
disponibilité, site et médias nécessitent une revue de contenu sans remettre
arbitrairement la vérification à zéro. Modifier/masquer un portfolio ne supprime
pas son historique. Une réalisation déclarée n'est pas certifiée par DAO.

Storage `dao-private` reste privé ; aucun accès direct navigateur n'est ouvert.
Le serveur autorise un upload à chemin généré, non écrasable, de 20 Mo maximum.
Une finalisation serveur contrôle taille, signature JPEG/PNG/WebP/PDF et SHA-256.
Les PDF avec marqueurs de contenu actif usuels sont refusés. Ce contrôle n'est
pas un antivirus ni une validation de l'authenticité administrative ; le staff
consulte les pièces et prend la décision de vérification.

Les liens Storage de lecture, valables 20 secondes, sont consommés uniquement
par le serveur. Le navigateur reçoit les octets via une requête authentifiée,
`no-store`, sans capability de lecture réutilisable. Chaque demande et la fin
de lecture revérifient droits, consentement, état et révision. Un retrait bloque
les prochaines demandes ; il ne peut effacer une copie déjà téléchargée.
Les PDF sont servis en pièce jointe, avec `nosniff`.

## Qualification et livraison

Migration additive `20261009180000_professional_profile.sql`, jamais de reset DEV.
PGlite couvre la matrice RPC/RLS avec claims simulés. Les tests de handler couvrent
JWT, inspection, altération et retrait pendant une lecture. Auth/JWT/Storage réels
et E2E seront exécutés sur la stack CI jetable avant livraison. La migration DEV
nécessite une capacité Supabase authentifiée ; son exécution n'est pas encore prouvée.
