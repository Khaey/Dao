# D.A.O. — Instructions communes pour Claude Code

D.A.O. est une plateforme tunisienne de chantiers : un Client publie un besoin découpé en
**lots**, des Artisans/entreprises répondent par des **offres**, le Client **attribue lot par lot**,
puis les parties conviennent de conditions facultatives et **suivent les travaux** dans D.A.O.
Dépôt source de vérité : <https://github.com/Khaey/Dao>. DEV : <https://dao-dev.logiclab.fr>.
**Répondre en français.**

## 1. Lire avant tout travail (dans cet ordre, sans tout relire)

1. Ce fichier, puis [`docs/agents.md`](docs/agents.md) : qui possède quoi aujourd'hui.
2. Ton **issue propriétaire** et son dernier checkpoint utile ; la coordination générale est
   l'issue de **PILOT 13** [#511](https://github.com/Khaey/Dao/issues/511) (historique : PILOT 12 #436).
3. [`docs/decisions.md`](docs/decisions.md) pour le domaine touché (décisions métier et techniques validées).
4. [`docs/architecture.md`](docs/architecture.md) pour la structure, les conventions et la CI.
5. [`docs/product/`](docs/product/README.md) : spécifications fonctionnelles existantes.
6. Seulement si nécessaire : `AGENTS.md` (règles historiques détaillées, quota, OPS) et
   `docs/ai-context/` (historique long : DECISIONS, BUSINESS_RULES, ARCHITECTURE, CURRENT_STATE).

Les passations datées et les anciens checkpoints sont des **instantanés**. Le vrai `main`,
les PR ouvertes, la CI au SHA exact et le dernier commentaire du propriétaire priment toujours.

## 2. Avant de développer

- Vérifier `main`, les PR ouvertes et leur owner (`git log`, liste des PR, issue propriétaire).
- **Ne pas recommencer une fonctionnalité déjà livrée** : chercher l'issue, la PR fusionnée,
  la migration et le code existants (`docs/decisions.md` liste les livraisons par domaine).
- **Vérifier les migrations** : `dao-backend/supabase/migrations/` sur `main` et, si le travail en
  dépend, leur présence réelle sur Supabase DEV. Une migration mergée n'est pas une migration appliquée.
- Ne pas modifier le périmètre, la branche ou la PR d'un autre agent sans coordination via #511.

## 3. Règles permanentes du propriétaire

- **Autonomie maximale** : diagnostiquer, coder, tester, commit/push, ouvrir la PR, corriger la CI,
  fusionner et vérifier le déploiement DEV **sans redemander GO** à chaque étape.
- **Cycle de livraison** : branche isolée → PR (`Owner issue: #N` sur sa propre ligne) →
  3 contrôles CI obligatoires verts sur le HEAD exact → fusion → `deploy-dev` SUCCESS sur le push
  `main` → vérification DEV (migrations, RPC, écran) → checkpoint court sur l'issue propriétaire.
- **Tests ciblés, quota raisonnable** : lectures groupées, pas de relance d'un check déjà vert sur
  le même SHA, pas de polling CI, pas d'agents parallèles redondants. Deux échecs identiques sans
  fait nouveau : arrêter cette boucle, publier le WIP et le blocage précis.
- **OCE est facultatif** : le suivi natif D.A.O. doit fonctionner sans OpenConstructionERP.
- **Aucune fonctionnalité juridique ou financière automatique sans décision explicite** du
  propriétaire : pas de signature, réception juridique, paiement, dette, facture ou garantie déclenchés
  par le système.
- **Pas de mode Simple/Avancé** : un seul parcours ; sous-lots, dates, dépendances, jalons, métrés,
  échéancier sont des options **facultatives et indépendantes**, révélées quand on les ajoute.
- Rapporter les résultats en `PASS / FAIL / UNTESTED` ; jamais de faux PASS, jamais revendiquer
  une recette navigateur ou un déploiement non constatés.

## 4. Vrais gates (arrêtent seulement l'action concernée)

P0 de sécurité non résolu ; check CI ou revue obligatoire manquant ; changement des garanties
Auth/JWT/RLS ; secrets ; production, VPS/root/OPS/OCE non préautorisés ; dépenses ; données réelles
ou suppression destructrice ; nouvelle règle métier engageante (juridique, financière). Continuer le
travail indépendant, poser **une** question ciblée au bon décideur (PILOT 13 pour le technique et
l'arbitrage entre owners, le propriétaire pour un nouvel engagement).

## 5. Invariants techniques non négociables

- Montants en **TND millimes entiers** (`175000 TND → 175000000`).
- Attribution **atomique par lot**, un seul titulaire actif par lot, package indivisible respecté.
- Versions soumises/acceptées **immuables** ; historique **append-only** ; pas d'effacement d'archives.
- JWT/RLS revérifiés côté base ; un rôle global ne remplace jamais une participation au chantier ;
  un concurrent ne voit jamais les offres, prix ou documents d'un autre.
- Pas de secret dans le dépôt, les issues, les commits ou les logs (dépôt public).
- FULL E2E uniquement sur la pile Supabase jetable ; ne jamais réinitialiser la base DEV partagée.

## 6. Commandes utiles

```bash
bash scripts/dao-task-check.sh                     # préflight borné, lecture seule
cd dao-backend && npm test                          # tests backend (tsc + node --test)
cd dao-backend && npm run settings:sync -- <migr>   # après modification du catalogue Settings
cd dao-frontend && npm run build                    # build Next.js
```

Skills du dépôt : `.claude/skills/dao-preflight`, `dao-pr-review`, `dao-performance`, `dao-e2e`.

## 7. Tenir cette documentation à jour

Une PR qui livre une décision ou un changement d'organisation met à jour, dans la même PR,
`docs/decisions.md`, `docs/agents.md` ou `docs/architecture.md`. Pas de nouveau document
redondant : compléter le fichier existant du domaine.
