# D.A.O — Espace Artisan / Entreprise

## DEV 2 #83 — livré

L’audit demandé sur le vrai `main` a été suivi dans
[#83](https://github.com/Khaey/Dao/issues/83). Le premier lot de correctifs a été
livré par la PR [#84](https://github.com/Khaey/Dao/pull/84), puis les décisions
DAO Pilot ont été livrées par la PR
[#109](https://github.com/Khaey/Dao/pull/109).

Le lot #83 est terminé. Ne pas recréer ses routes, sa migration ni ses RPC.
Le Back-office #64 et OCE #58 sont restés hors périmètre.

## Décisions appliquées

- Seuls les changements d’identité, d’activité et de métiers relancent la
  vérification D.A.O.
- Un compte Client + Artisan revient dans le dernier espace explicitement
  utilisé.
- L’espace Artisan comprend une vue globale « Mes offres », le retrait contrôlé
  d’une offre soumise non attribuée et la boîte « Mes invitations ».

## Comportements livrés

- Le tableau de bord Artisan présente les chantiers clients et les accès directs
  à « DAO disponibles », « Mes offres » et « Mes invitations ».
- Le profil professionnel est consultable et éditable. Une modification de la
  présentation, de l’expérience ou de la disponibilité conserve le statut.
  L’identité, le type d’activité ou les métiers font repasser un profil vérifié
  ou rejeté à `pending`. Une suspension reste suspendue.
- La navigation Client / Artisan est persistée côté serveur ; `/app` restaure
  le dernier espace et filtre le tableau de bord correspondant.
- « Mes chantiers » utilise les memberships autorisés et adapte son état vide au
  rôle Artisan.
- « DAO disponibles » reste consultable selon les règles de publication. Un
  professionnel non vérifié voit la raison du blocage et ne reçoit pas un faux
  formulaire d’offre actif.
- Les brouillons d’offre conservent exactement leurs lots sélectionnés et ne
  sont plus présentés comme des offres envoyées.
- « Mes invitations » liste les invitations associées à l’adresse Auth
  confirmée, sans exposer leur jeton, et permet l’acceptation ou le refus par
  commande contrôlée.
- « Mes offres » centralise versions, états et résultats. Une offre soumise
  courante, non attribuée, peut être retirée sans effacer son contenu ni son
  historique.

## Garanties techniques

La migration `20261009103053_artisan_workflows_v2.sql` porte les colonnes,
contraintes et RPC du second lot. Les commandes sensibles résolvent l’acteur par
`auth.uid()`, les droits anonymes sont refusés, les opérations sont auditées et
aucune clé privilégiée n’est exposée au navigateur.

Les preuves de CI, fusion, application unique de la migration DEV et déploiement
sont conservées dans #83 et #109. La messagerie chantier ultérieure a été livrée
séparément par #116 / PR #123.

## Reprise

Avant tout nouveau travail Artisan :

1. vérifier le `main`, les PR ouvertes et la dernière CI ;
2. relire #83/#109 et le présent document ;
3. traiter uniquement un défaut encore reproductible ;
4. demander DAO Pilot seulement si la correction exige une nouvelle règle métier ;
5. ne pas intervenir sur #64, #58, #112 ou les lots appartenant à un autre owner.
