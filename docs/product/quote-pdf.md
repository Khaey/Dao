# Export PDF des devis

L'endpoint privé existant `GET /api/bids/quote/export?version_id=<uuid>` génère un devis A4 à partir de la version et des lignes de prix visibles par le JWT appelant. La route, les règles RLS et le caractère informatif de l'offre restent inchangés.

## Présentation

- en-tête typographique D.A.O et identité professionnelle autorisée ;
- référence réelle de la version et du chantier, date et validité ;
- un bloc par lot avec périmètre, tableau des postes, montant proposé et délai ;
- totaux en TND à trois décimales, inclusions, exclusions, matériaux et conditions lorsqu'ils sont renseignés ;
- pagination A4, en-tête de tableau répété et pied de page numéroté ;
- caractères français conservés avec l'encodage PDF WinAnsi.

Le document ne présente jamais l'offre comme une attribution, un contrat, une signature ou une preuve de paiement. Le budget indicatif Client n'est pas repris comme montant proposé.

## Logos

Aucun asset de logo D.A.O ou d'entreprise approuvé n'est actuellement disponible dans le dépôt ou dans une projection publique fiable du profil. Le PDF utilise donc un en-tête typographique sobre. Un futur branchement de logo devra recevoir un asset déjà validé et autorisé par le modèle applicatif ; le générateur ne doit jamais télécharger une URL arbitraire, lire un objet de stockage privé sans contrôle, ni fabriquer un logo absent.
