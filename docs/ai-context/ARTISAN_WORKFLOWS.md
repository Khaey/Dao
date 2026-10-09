# D.A.O — Espace Artisan / Entreprise

## DEV 2 #83 — lot validé

Après le premier lot livré par la PR #84, DAO Pilot a validé trois règles :

- seuls l'identité, l'activité et les métiers relancent la vérification D.A.O ;
- un compte Client + Artisan revient dans le dernier espace explicitement utilisé ;
- le lot suivant comprend la vue globale Mes offres, le retrait d'une offre
  soumise et la boîte Mes invitations.

La branche `feat/artisan-workflows-v2`, issue
[#83](https://github.com/Khaey/Dao/issues/83), PR
[#109](https://github.com/Khaey/Dao/pull/109), implémente ces décisions. Elle a
été réconciliée avec le main réel `54bc4dc74404a76c3c3a0c7bc6c4edeae3801e39`
sans reprendre ni modifier le Back-office #64 ou OCE #58.

## Comportements livrés

- Profil professionnel éditable. Le nom public, la présentation, l'expérience
  et la disponibilité conservent le statut ; l'identité, le type d'activité et
  les métiers font repasser un profil vérifié ou rejeté à `pending`. Une
  suspension reste suspendue.
- Navigation Client / Artisan persistée côté serveur pour les comptes à double
  rôle. `/app` restaure cet espace puis filtre le tableau de bord correspondant.
- Mes invitations liste les invitations du compte Auth confirmé, sans exposer
  leur jeton, et permet l'acceptation ou le refus via une commande contrôlée.
- Mes offres fournit une vue globale par publication avec statut, résultat et
  historique. Une offre soumise courante et non attribuée peut être retirée ;
  son contenu reste conservé et audité, puis une nouvelle version peut être créée.

La migration `20261009103053_artisan_workflows_v2.sql` contient les colonnes,
contraintes et RPC nécessaires. Les commandes sensibles résolvent l'acteur par
`auth.uid()`, les droits `anon` sont révoqués et aucune clé privilégiée n'est
exposée dans le navigateur.

## Vérifications

- services backend : 64/64 ;
- reconstruction PGlite et contrat de migration : 138/138 ;
- modèle collaboration : 15/15 et 24/24 ;
- build Next.js : 60 routes ;
- inventaire Playwright : 48 tests dans 16 fichiers.

La première CI de PR #438 a confirmé backend, build, schéma/replay et intégration
Supabase réelle. Son FULL E2E a échoué parce que l'aide de connexion attendait
encore uniquement `/app/projects` ou `/app/dao`; le nouveau comportement validé
arrive sur `/app`. Le helper accepte désormais ces trois destinations. La fusion
reste conditionnée à une CI verte sur le HEAD exact, puis à l'application unique
de la migration DEV et à la validation du déploiement main.

## Reprise

Lire d'abord la PR #109, l'issue #83 et le main réel. Ne pas recréer le premier
lot de la PR #84. Ne pas intervenir sur #64 ou #58. Si la PR est fusionnée avec
CI main, migration DEV et smoke documentés, ce lot est terminé ; sinon reprendre
uniquement à la première preuve manquante.
