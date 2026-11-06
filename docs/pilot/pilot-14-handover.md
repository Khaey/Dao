# D.A.O. — Passation officielle PILOT 14 (04/11/2026)

> **Canal officiel : [issue PILOT 14 #556](https://github.com/Khaey/Dao/issues/556).** Snapshot historique du **04/11/2026**, établi à partir de GitHub, des preuves publiées dans les tickets, des deux audits indépendants du Coordinateur et des décisions explicites du propriétaire. **À revérifier lors de chaque reprise.**
>
> **Aucune intervention PROD autorisée dans cette passation.** Un ticket ouvert, un commentaire ou une PR ne déclenchent pas une session d'agent.

## Complément final daté du 06/11/2026

Cette passation du 04/11 est **conservée comme historique**, et ses anciens statuts OPEN/PENDING ne doivent pas être lus comme un état actuel. Pour la clôture de #556, consulter le [checkpoint final du 06/11](pilot-14-final-2026-11-06.md) : #557/#558 fusionnées, #555/#561/#568 clôturées, #577 fusionnée en PR #580 mais restant OPEN avec recettes et corrections métier à finir, #578 encore OPEN en PR #579. Le rôle global de PILOT 14 reste défini par le propriétaire : **clore #556 ne nomme aucun successeur**.

## À lire en premier par PILOT 15 et suivants

1. [Issue pilote #556](https://github.com/Khaey/Dao/issues/556), ce document et [registre d'agents](../agents.md).
2. [Deuxième avis indépendant et corrections](pilot-14-independent-reviews.md), avec **archives fidèles** [v1](audits/2026-11-03-second-avis-v1.md) et [v2](audits/2026-11-03-second-avis-v2.md).
3. [Décisions de produit et d'architecture](../decisions.md), [architecture](../architecture.md), [work checkpoints](../ai-context/WORK_CHECKPOINTS.md).
4. [PILOT 13 #511](https://github.com/Khaey/Dao/issues/511) comme historique — pas comme canal actuel.
5. **Relire les faits actuels** : SHA de `main`, issues/PR ouvertes, trois gates CI sur le HEAD exact, dernier `deploy-dev`, état Supabase DEV/ledger et activité réellement attestée des agents.

## 1. Organisation et règles de gouvernance

**Décision du propriétaire : organisation inchangée.** PILOT 14 reste responsable de la stratégie produit, du cadrage, des arbitrages, de la coordination et des validations. Coordinateur Mission 1 et Mission 2 restent deux agents distincts ; ils ne sont pas promus en PILOT. DEV 4/5 et OPT 4 conservent leurs métiers. L'un des coordinateurs a réalisé des **contre-audits indépendants et critiques** : les pilotes doivent **analyser, contredire si nécessaire et corriger les erreurs**, plutôt qu'acquiescer systématiquement.

**Un chantier = un owner** ; pas de co-édition concurrente, pas de GO répétitifs pour un périmètre déjà délégué. Une livraison comprend : **tests → PR → backend-verify / frontend-build / Fresh schema real Supabase + FULL E2E verts sur le SHA exact → merge → deploy-dev SUCCESS → recette DEV authentifiée → preuves → clôture**. Ne jamais déclarer livré sur seul commit, test local ou rapport d'agent non recoupé.

Toutes les décisions avec effet juridique, financier, fournisseur LIVE, changement destructif ou PROD exigent arbitrage spécifique ; les missions présentes ne l'autorisent pas.

## 2. État des agents (vérification GitHub du 04/11/2026)

| Agent | Mission récente / principale | Statut GitHub | Activité session |
|---|---|---|---|
| **PILOT 14** | Coordination globale, arbitrages, passation [#556](https://github.com/Khaey/Dao/issues/556) | Issue créée | Session conversationnelle de PILOT, pas agent de code |
| **DEV 5** | [#548](https://github.com/Khaey/Dao/issues/548) — métrés / [PR #550](https://github.com/Khaey/Dao/pull/550) | **OPEN** | Reprise P0 demandée ; lancement effectif de la session à confirmer |
| **OPT 4** | [#555](https://github.com/Khaey/Dao/issues/555) — schéma Git↔DEV / Vault | **OPEN** | Affecté P0 ; démarrage de la session à confirmer |
| **Coordinateur Mission 1** | [#543](https://github.com/Khaey/Dao/issues/543) assistant, [#551](https://github.com/Khaey/Dao/issues/551) estimation | **CLOSED** | Disponible à réaffecter explicitement |
| **Coordinateur Mission 2** | [#423](https://github.com/Khaey/Dao/issues/423) Settings, [#547](https://github.com/Khaey/Dao/issues/547) Admin Référentiel | **CLOSED** | Disponible à réaffecter explicitement |
| **DEV 4** | [#515](https://github.com/Khaey/Dao/issues/515) intégrations, [#175](https://github.com/Khaey/Dao/issues/175) recette | **CLOSED** | Pas de session active confirmée |
| **OPT 4 — anciens travaux** | [#449](https://github.com/Khaey/Dao/issues/449) / [#476](https://github.com/Khaey/Dao/issues/476) | **CLOSED** | Ne pas confondre avec nouvelle #555 |

Aucun agent autonome n'est déclenché par la création de #556 ou d'une autre issue.

## 3. Bilan des domaines D.A.O. (vérifications et limites)

| Domaine | Livré / existant | À confirmer ou terminer |
|---|---|---|
| **Marketplace Client/Artisan** | Chantiers, équipes, lots, publication, offres, attribution et dossiers contractuels ; recette **14 étapes PASS** rapportée dans [#175](https://github.com/Khaey/Dao/issues/175) | Réalité de l'annuaire de 20 profils **synthétiques** [#395](https://github.com/Khaey/Dao/issues/395) |
| **Contrats et suivi** | Contrat non engageant, documents, suivi natif/Gantt/dépendances, situations techniques et réception [#408](https://github.com/Khaey/Dao/issues/408), [#440](https://github.com/Khaey/Dao/issues/440), [#425](https://github.com/Khaey/Dao/issues/425) | Ne pas confondre avec signature juridique, paiement et escrow ; annulation [#523](https://github.com/Khaey/Dao/issues/523) reportée |
| **Admin/Settings** | Paramètres #423, intégrations #515, admin référentiel #547 | Audit des migrations/ACL Vault #555 |
| **Référentiel métier** | #541, catalogue `TN-2026.1`, 20 ouvrages, 5 modèles de métrés ; Admin six onglets #547 | Taille réelle du catalogue publié à vérifier ; comptes lots 10/20 contradictoires selon rapports et versions archivées |
| **Assistant BTP** | #543 : description libre → proposition → ajustement → création chantier | **Moteur déterministe par règles**, pas LLM génératif ; ne pas le présenter comme IA générative complète |
| **Métrés BTP** | #548 : moteur et API en PR #550, tests locaux / trois gates sur ancien HEAD documentés | Merge/rebase, migrations DEV, tests intégrés ; **aucun écran métier de métrés** livré par la PR |
| **Prix & estimation** | #551 fusionné et recetté DEV : prix sourcés, versions, estimation non contractuelle | **0 tarif réel vérifié** au snapshot ; seules sources fictives de recette, estimation réelle indisponible sans données |
| **Notation professionnelle** | Avis vérifiés déjà développés selon contre-audit, dont trois avis DEV rapportés | [#213](https://github.com/Khaey/Dao/issues/213) reste ouvert pour reliquat notamment suppression de compte/RGPD |
| **CI/OPS** | Gates CI et deploy-dev, recette #175, infrastructure VPS/OCE mesurée | Docker registry intermittente à surveiller, réconciliation schéma #555, vrai dispositif PROD absent |
| **Externalisations légales** | Architecture multi-fournisseurs, sandbox signature | [#383](https://github.com/Khaey/Dao/issues/383) signature et [#507](https://github.com/Khaey/Dao/issues/507) escrow non activables comme actes réels sans conditions |

## 4. Priorités et dépendances

### P0 A : DEV 5 #548 / PR #550 — livraison du moteur de métrés

Le run [41716736819](https://github.com/Khaey/Dao/actions/runs/41716736819) est rapporté et recoupé **PASS sur les trois gates** pour le commit `e5aed76`. L'ancien FAIL de variables Supabase était déjà corrigé et **ne doit pas être repris**. Second audit : PR #550 bloquée par conflits avec `main` sur cinq fichiers : `.github/dao-monitor-agents.json`, `dao-backend/src/server/runtime.ts`, `dao-backend/tests/local.mjs`, `dao-backend/tests/schema-contract.sql`, `docs/architecture.md`.

**À faire par DEV 5 seul :** vérifier conflits actuels, rebase/synchronisation avec #549 et #552, assurer ordre de la migration métrés, trois gates sur le **nouveau** SHA, fusion, migration DEV contrôlée et recette JWT/RLS, puis prouver que [#551](https://github.com/Khaey/Dao/issues/551) lit une révision de métré validée sans valeur client falsifiable. Ticket de pilotage : [#548](https://github.com/Khaey/Dao/issues/548). Ne pas utiliser un ancien run vert pour qualifier le nouveau HEAD.

### P0 B : OPT 4 #555 — écart entre Git et schéma DEV

Le déploiement DEV des applications n'applique pas automatiquement toutes les migrations SQL : plusieurs conventions de ledger sur DEV et **quatre migrations DEV sans fichier homonyme Git** ont été signalées. Noms :
- `provider_connection_manifest_v2_backfill`
- `provider_secret_vault_permissions_hotfix`
- `provider_secret_put_vault_acl_hotfix`
- `dropbox_sign_real_check_v3`

**Ce n'est pas une faille prouvée.** #555 doit comparer en **lecture seule** les objets effectifs (tables, colonnes, fonctions, RLS, GRANT, triggers, Vault, etc.) d'une pile reconstruite depuis Git à DEV. Vérifier si les quatre effets sont déjà présents dans les migrations fusionnées. Pas de lecture de secrets, pas de réécriture d'historique ni suppression pour corriger des numéros de ledger ; corrections addititives documentées seulement après preuve. OPT 4 **ne touche pas** aux fichiers en conflit détenus par DEV 5.

### P1 : parcours BTP et décisions produit

- Aucun écran natif de saisie/révision/validation des métrés dans #550 (API seule), malgré l'existence du Budget prévisionnel : construire un **parcours utilisateur unifié** chantier, sans nouveau menu dispersé.
- **Qui valide un métré si aucun Gestionnaire n'est affecté ?** PILOT 14 recommande : `brouillon` → `déclaré par Client` → `validé techniquement` uniquement par personne habilitée ; **déclaration du Client ≠ vérification technique**, arbitrage requis sur l'usage du déclaré pour l'estimation.
- **Source de prix tunisiens** : fournisseur/licence/région/date/fréquence à qualifier ; séparation saisie et vérification par deux personnes distinctes, pas nécessairement deux Admin globaux.
- Nettoyage ciblé des anciennes tables de prix vides `btp_price_books` / `btp_work_prices` : le moteur #551 utilise `btp_price_sources` / `btp_price_items`. Vérifier et retirer sans suppression risquée les lectures obsolètes `priceSources` du snapshot et compteur `priceBooks` de l'écran Versions.
- Décider expressément l'accès global `dao_reviewer` et la sémantique effective de `manages_project` selon `dao.native_tracking_scope`.
- Ne pas répéter toute la recette multi-rôles [#175](https://github.com/Khaey/Dao/issues/175) : **compléter exclusivement** assistant → métrés → estimation, et cas staff multi-rôles.

### P2 / différé
- [#395](https://github.com/Khaey/Dao/issues/395) : recette réelle annuaire ; profils synthétiques, pas d'entreprises certifiées.
- [#396](https://github.com/Khaey/Dao/issues/396) : préflight des fixtures, backlog sans owner ; optimisation [#85](https://github.com/Khaey/Dao/issues/85), aucune réduction couverture E2E.
- [#523](https://github.com/Khaey/Dao/issues/523) annulation **REPORTÉE**.
- [#383](https://github.com/Khaey/Dao/issues/383) e-signature, [#507](https://github.com/Khaey/Dao/issues/507) escrow : étude/fournisseurs/habilitations, aucun flux LIVE.
- LLM de l'assistant : évolution future, pas fonctionnalité actuelle.

## 5. Préparation PROD (ne pas confondre avec le MVP)

**Estimations subjectives (non KPI)** : second avis `~80 % MVP fonctionnel`, `~50 % préparation PROD`. Ancienne estimation de PILOT 14 `~65 % V1 commercialisable` regroupait des dimensions différentes et doit être **remplacée** par ces deux axes de pilotage. Aucune durée n'est garantie : hypothèse seconde analyse `4–6 semaines` pour bêta limitée sous conditions ; PILOT 14 estime l'ouverture publique plus risquée du fait du juridique et de l'exploitation.

**V1 recommandée** : publication de chantiers, offres, attribution, contrats **non engageants** et suivi, **sans mouvement d'argent, escrow ni signature engageante**. Estimation BTP chiffrée **facultative** si aucune source réelle vérifiée. Avant toute PROD : projet Supabase PROD séparé, configuration et secrets isolés, migrations/replay fiables, tests restauration sauvegarde, surveillance, domaine, e-mails, revue RLS et sécurité, CGU/confidentialité/effacement et exigences tunisiennes validés. Rien de cela n'est autorisé à l'exécution par ce document.

## 6. Passation obligatoire et critères de preuves

Pour chaque PILOT suivant :
1. Émettre un nouveau snapshot daté, non réécrire l'ancien ; actualiser [#556](https://github.com/Khaey/Dao/issues/556) avec le lien vers le successeur.
2. Contrôler **main**, PR, CI, DEPLOY, Supabase DEV/PROD (si autorisé) et activité des sessions ; qualifier `PROUVÉ`, `RAPPORTÉ`, `HYPOTHÈSE`, `UNTESTED`.
3. Garder les deux contre-audits en archives immuables ; préserver les désaccords, ne pas lisser les erreurs rétrospectivement.
4. Produire une matrice **agent → mission → owner unique → statut → SHA → PR → CI → déploiement → recette → blocage**.
5. Séparer **décision produit**, **architecture**, **sécurité**, **opérations** et **contrats juridiques**. Ne pas ajouter de fonctionnalités si les P0 restent bloquants.
6. En fin de passage, créer/mettre à jour l'issue PILOT, une PR de documentation versionnée et le registre [`docs/agents.md`](../agents.md). Ne pas pousser directement des modifications non vérifiées dans `main`.

## Historique / liens essentiels

- PILOT 13 #511, PILOT 12 #436 (**archive**), PILOT 14 #556.
- Foundation BTP #541, assistant #543, Admin #547, métrés #548 / PR #550, prix #551.
- Audit Git↔DEV #555, parcours multi-rôles #175, CI navigateur #553, offres/devis #314, intégrations #515.
- [Second avis indépendant — synthèse](pilot-14-independent-reviews.md) et [archives originales](audits/2026-11-03-second-avis-v1.md).
