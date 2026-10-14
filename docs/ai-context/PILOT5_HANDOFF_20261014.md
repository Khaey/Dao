# D.A.O. — Passation intégrale DAO Pilot 5
<!-- Owner issue: #154 -->

> **Snapshot GitHub : 14 octobre 2026, fin d’après-midi (Europe/Paris).** Point d’entrée canonique : [issue #154](https://github.com/Khaey/Dao/issues/154). Ce document est une **photographie datée**, non une source temps réel. Recontrôler `main`, CI, PR et derniers commentaires propriétaires avant toute écriture, merge, exécution ou décision.
>
> **Règle absolue :** ne pas refaire un travail déjà validé ; ne pas inventer des PASS, secrets, utilisateurs réels, ventes ou états juridiques. Une issue/PR/commentaire GitHub n’active **pas** une session Work/Claude inactive.

## 1. Démarrage immédiat de Pilot 5 — ordre obligatoire

1. Lire l’[issue de passation #154](https://github.com/Khaey/Dao/issues/154) et son dernier checkpoint, `AGENTS.md`, `docs/ai-context/README.md`, `docs/ai-context/AUTONOMOUS_EXECUTION.md`, puis ce document.
2. Vérifier via **GitHub live** : `refs/heads/main`, les PR ouvertes, CI de ce SHA, statut deploy-dev, derniers commentaires utiles #93, #146, #115, #137, #58, #91, #64 et #126. Ne pas se fier au titre ou au numéro d’une ancienne CI.
3. Pour une modification métier, lire les contraintes applicables `BUSINESS_RULES.md`, `DECISIONS.md`, `ARCHITECTURE.md` et les issues propriétaires. En cas de doute : préserver Auth/RLS/permissions, données privées et histoire financière/contractuelle.
4. Utiliser **une branche isolée par owner** ; pas de modification sur `main` directement. PR avec ligne autonome `Owner issue: #N`, CI exacte complète verte avant fusion, déploiement DEV vérifié ensuite. Pas de « confirme/go » répété pour les étapes techniques déjà autorisées.
5. Respecter les limites : pas de réinitialisation DB DEV partagée, aucun test E2E sur DEV/production (Supabase locale jetable uniquement), aucune mutation de clients réels, paiement/contrat exécutoire/VPS root sans le mandat et les garde-fous nécessaires.
6. Économiser le quota : prendre le dernier HEAD/checkpoint, comparer uniquement le delta utile, ne pas relancer builds/recettes déjà PASS pour le même SHA et les mêmes entrées.

## 2. État technique vérifié à la passation

| Élément | Preuve GitHub / statut |
| --- | --- |
| Dépôt | [Khaey/Dao](https://github.com/Khaey/Dao), **privé**, branche de référence `main`. |
| `main` observé | `d433cf800aaadbd67c7c2a746695d95fd11c3711` (14/10/2026). Vérifier de nouveau à la reprise. |
| CI/main #549 | [run 38593168816](https://github.com/Khaey/Dao/actions/runs/38593168816) **SUCCESS** : backend, frontend, schéma/migrations, intégration Supabase réelle, **58/58 E2E desktop/mobile**, déploiement DEV. |
| CI/main #550 | [run 38593180907](https://github.com/Khaey/Dao/actions/runs/38593180907) **SUCCESS** sur le même SHA. |
| SSH/deploy DEV | **RÉPARÉ** via [PR #153](https://github.com/Khaey/Dao/pull/153), [issue #152 CLOSED](https://github.com/Khaey/Dao/issues/152). Log [deploy-dev #549](https://github.com/Khaey/Dao/actions/runs/38593168816/job/115958730160) : `git_fetch status=0`, checkout SHA=OK, manifeste/artifact vérifiés, restart/health/http_smoke=0, login/register/forgot-password HTTP 200 ; `DEPLOY_RELEASE sha=d433cf8...`. Jeton `github.token` temporaire en lecture, GIT_ASKPASS non persistant, nettoyage confirmé. |
| Application DEV | `https://dao-dev.logiclab.fr`. Succès de smoke ne prouve pas une recette complète avec comptes réels, ni publication commerciale/production. |
| Stack | Next.js/React frontend, services TS, Supabase PostgreSQL + RLS/JWT/RPC, GitHub Actions, VPS OVH, Resend ; OCE est un service technique distinct, pas source de vérité de D.A.O. |

**Incident passé à ne pas rouvrir :** la CI #542 a échoué au déploiement parce que le VPS tentait `git fetch` anonyme depuis le GitHub privé. La correction #153 est **fusionnée ET validée en DEV**. **Autre incident distinct, toujours actif :** le contrôleur root OPS utilisé pour OCE ne dispose pas encore de lecture authentifiée sur le dépôt privé (#91/#58/#150). La réparation du deploy-dev ne règle pas ce second sujet.

## 3. PR et tâches ouvertes vérifiées

| PR | Owner / état au snapshot | Prochaine action exacte |
| --- | --- | --- |
| [#145](https://github.com/Khaey/Dao/pull/145) | Pilot, #93 : registre `#137 → DAO Chat 20` ; ouverte, ancienne CI **rouge**, HEAD `7cb5b994`. | **P0 coordination** : réconcilier sur `main` actuel en préservant ses deux fichiers, exécuter CI + Monitor sur nouveau HEAD, fusion seulement si verts ; confirmer notification. L’ancien échec Back-office `2 !== 1` provient d’une fixture corrigée sur le `main` récent ; ne pas réexécuter ancien HEAD inchangé. |
| [#147](https://github.com/Khaey/Dao/pull/147) | **AUD 1** (ancien DAO CLAUDE 1), #146 : accueil public Client/Artisan ; **DRAFT**, HEAD `5548c0f15f5f9e09f64ce761513cca84c45dc8b7`, non déployée. | [CI #551](https://github.com/Khaey/Dao/actions/runs/38597045598) **FAILURE** sur **découverte E2E**, pas sur bug Back-office : **`Total: 68 tests in 20 files`** alors que `ci.yml` attend **58 tests**. Backend/build/intégration réelle PASS, Playwright **non exécuté**. Corriger en vérifiant que les 10 nouveaux cas proviennent des 5 scénarios `public-homepage.spec.ts` × desktop/mobile, sans retirer ni sauter de tests. Coordonner le registre #145 et l’assertion `#146 → AUD 1` avant livraison, puis CI complète + revue visuelle. |
| [#144](https://github.com/Khaey/Dao/pull/144) | **DAO OPT 2**, #115 : navigation mobile Gestionnaire, **DRAFT**, HEAD `29b78a5910cfe9e554b8b935b93d78b63166237a`. | Ancien contrôle mobile [38568752815](https://github.com/Khaey/Dao/actions/runs/38568752815) **2/2 PASS** sur HEAD précédent ; le HEAD courant ajoute correctif `useLayoutEffect` pour restaurer défilement/focus après changement de viewport. Vérifier les **dernières** CI mobile et complète au HEAD courant, traiter les échecs réels puis fusionner seulement après gates verts. |
| [#150](https://github.com/Khaey/Dao/pull/150) | **DAO DEV 20**, #91/#58 : accès authentifié du **contrôleur OPS root** au dépôt privé, HEAD `b6e255dd718008e052613ba7af6ea86b531591b6` ; CI PR [38590656099](https://github.com/Khaey/Dao/actions/runs/38590656099) **SUCCESS**, **non fusionnée/non installée**. | Revue sécurité, réconciliation main, CI finale et procédure **bootstrap root séparée**. Credential de lecture à permissions contrôlées, installation root, admission SHA et OPS status soumis aux protocoles #91. Aucune commande `gateway apply` ou grant silencieux. |
| [#151](https://github.com/Khaey/Dao/pull/151) | Alternative **obsolète** de correction du déploiement (Deploy Key permanente), owner mentionné #142, HEAD `ac364a40`, PR ouverte avec conflit et ancienne CI rouge. | **Ne pas fusionner** : #153 a résolu et validé le problème autrement. Demander à l’owner de fermer comme `superseded`, sans écraser sa branche. |
| [#34](https://github.com/Khaey/Dao/pull/34) / [#46](https://github.com/Khaey/Dao/pull/46) | Vieilles PR documentaires toujours ouvertes. | Réexaminer diff/fraîcheur/ownership ; pas de merge « nettoyage » automatique. |

**Ne pas confondre** : la PR #143 (Contrat P2.2-B) est **fusionnée** sur main ; #142 reste une issue ouverte administrative. La correction de contamination des fixtures Back-office dernier Admin est sur le main récent, comme le prouvent CI #549/#550. #64 reste ouvert pour d’autres corrections et supervision métier, mais **ne plus la présenter comme blocage universel de toute CI**.

## 4. Matrice agents, responsabilités et premiers gestes

| Agent actuel | Mission canonique / résultat | Priorité/reprise |
| --- | --- | --- |
| **DAO Pilot 5** | **#154** passation/coordination ; #93 Monitor ; revue de #145, arbitrages et séquencement PR ; rôle PILOT | Débloquer **#145**, contrôler dépendances des autres agents, ne pas coder simultanément leurs branches. Mettre à jour la matrice d’owners sans inventer un agent en session active. |
| **AUD 1** (ancien **DAO CLAUDE 1**) | [#146](https://github.com/Khaey/Dao/issues/146) / PR #147 homepage ; ensuite [#148](https://github.com/Khaey/Dao/issues/148) commercial. Toujours rôle **DEV**, même session/owner renommé. | Corriger la découverte 58→68 après analyse des scénarios, obtenir vraie CI E2E, aligner registre avec #145. Peut **préparer sans attendre** moodboards, trois couvertures et mini-charte du kit #148, mais documents finals après identité homepage stabilisée. Pas de « go » répété. |
| **DAO Chat 20** | [#64](https://github.com/Khaey/Dao/issues/64) Back-office ; [#137](https://github.com/Khaey/Dao/issues/137) bug DAO disponibles (owner transféré, DEV 2 ne code plus ce lot). | Correction UX-115-06 déjà reprise de #141 **sans nouvelle PR**, branche `fix/chat20-137-artisan-availability`, dernier HEAD rapporté `08dec6b5`. **Attendre #145 fusionnée** pour sa PR métier et sa CI exacte ; ne pas repartir à zéro. Écart publication `publiée` ≠ lots ouverts/répondables ; RPC authoritative ; aucune nouvelle règle métier. |
| **DAO DEV 20** | [#58](https://github.com/Khaey/Dao/issues/58) OCE, [#91](https://github.com/Khaey/Dao/issues/91) root OPS, PR #150. | Corriger le contrôleur privé, puis rétablir préflight/upgrade OCE selon autorisation et protections existantes. Ce n’est **pas** le deploy-dev (déjà DONE). |
| **DAO DEV 2** | [#142](https://github.com/Khaey/Dao/issues/142) Contrat P2.2-B non-engageant, PR #143 **MERGED** ; ancienne attribution #137 transférée à Chat 20. | Clôturer/commenter l’acquis de #142 après contrôle ; ne pas ressusciter PR #151 concurrente. Ne pas démarrer signatures juridiques, paiements ni P2.2-C par défaut. |
| **DAO OPT 2** | [#115](https://github.com/Khaey/Dao/issues/115) audit UX et correctif navigation mobile, PR #144. | Qualifier CI exacte HEAD courant ; valider mobile Gestionnaire réel selon droits et livrer. Ne pas recommencer les scénarios déjà PASS, ni éditer #64. |
| **DAO OPT 20** | [#126](https://github.com/Khaey/Dao/issues/126) **étude** Paramètres Admin/pays (Tunisie → Côte d’Ivoire/Burkina Faso). #124 recette tri-rôle **déjà terminée**. | Une note technique **lecture seule** dans #126 ; aucune migration/UI/devise/GO d’implémentation tant que Pilot n’a pas arbitré. |
| **OPT** | [#85](https://github.com/Khaey/Dao/issues/85) anciennes optimisations E2E/SCP. | En pause, pas de reprise implicite ; n’est pas OPT 20. |
| **DEV 1** | Ancien agent sans session active confirmée ; travaux #125 déjà repris/livrés par DEV 2. | Ne pas récréer un agent/branch pour un lot déjà mergé. |

**Surveillance Telegram :** issue [#93](https://github.com/Khaey/Dao/issues/93), workflow DAO Monitor déjà fonctionnel (des runs Monitor sont verts). Le registre `main` **ne contient pas encore** les missions #137 et #146. Ordre : PR #145 ajoute `#137 → DAO Chat 20`, puis PR #147 ajoute `#146 → AUD 1` et modifie le test de mapping dans `tests/test_dao_monitor.py` ; vérifier l’alerte/nom après merge. Le bot GitHub ne peut pas identifier automatiquement une session ou son quota ; le compte GitHub partagé `Khaey` n’identifie pas l’agent. Cron n’est pas une garantie de notification à l’heure exacte.

## 5. Produit livré vs non livré — garanties métier

### Opérationnel / fondamentaux validés
- **Deux parcours : Client / Artisan-Entreprise**, avec comptes cumulables (dernier espace explicitement utilisé), Artisan `pending` jusqu’à vérification ; seuls changements identité, activité ou métiers relancent vérification.
- Un chantier est un projet contenant **1 ou plusieurs vrais lots** ; **zéro lot uniquement au stade brouillon**, lot principal créé sur clic explicite, choix de métier obligatoire. **Aucun lot virtuel**.
- Lots/unité attribuable `project_request`, offres versionnées pouvant couvrir plusieurs lots, comparaison par lot, offres soumises/retrait contrôlé, attribution/annulation/réattribution non destructives, package atomique ; une attribution active par lot.
- Workflows de revue/publication D.A.O et profil professionnel avec distinctions vérification du professionnel, identité publique, fiche, visibilité. Dossiers ciblés/invite-only et privés protégés par JWT/RLS ; aucune auto-promotion admin et protection du dernier admin.
- Chantiers ajoutés par Artisan, invitation et confirmation du Client, collaboration projet/lots/équipe/documents/historique, invitations mail Resend, messagerie Client-Artisan V1 livrée (#116), tests synthétiques.
- Back-office Gestionnaire/Admin opérationnel sur fonctions livrées ; **navigation mobile** PR #144 reste **candidate**, non livrée.
- **Contrat tripartite** : socle P2.2-A livré (#125/PR #134), **P2.2-B neutre et non engageant** livré (#142/PR #143). Acceptations liées à la version immuable, contrôle admin, annulation motivée, état `ready`; cela **n’est PAS** une signature électronique opposable ni l’état `signed`.

### Non acquis / interdits sans validation
- **Pas de signature juridiquement engageante activée, pas d’état `signed` accessible, pas de PDF opposable ni fournisseur NGSign/DigiGO choisi**.
- Pas de paiement réel, escrow, garantie/assurance automatique, encaissement ou ledger financier en exploitation. `project_stage` et `payment_status` sont déclaratifs.
- Entité juridique D.A.O. et mandat du signataire tripartite **à formaliser** avant contrats opposables ; des notes suggèrent LogicLab Tunisie, **ne pas traiter comme preuve d’un choix juridique définitif**. Taxe/frais, délais contractuels, conditions de retrait, preuve d’identité et consentement, mandat, archivage légal restent sujets à valider.
- Sommes actuelles des dossiers tunisiens en **TND stockés en millimes** ; ne jamais activer XOF/multidevise par option avant architecture, fiscalité, conformité et décisions. Futur ledger double entrée non destructif.
- OCE : adapter/gateway en **préparation** ; ne pas déduire d’un plan Cloudflare PASS qu’un tunnel privé est opérationnel, que :8080 est fermé ou qu’un gateway apply a réussi. OCE ne modifie jamais directement attribution/contrat/paiement.
- **Aucune affirmation de clients réels payants, CA, partenaires signés, conformité juridique exhaustive ou production publique commercialisée** sans preuve.

## 6. Priorités commerciales/fondateurs — nouveau contexte utilisateur

**D.A.O. est cofondé par deux associés :**
- Un **architecte de métier** à l’origine de l’idée initiale et du **premier cahier des charges** ; apport et responsabilité métier BTP.
- Le fondateur qui pilote la direction technique, architecture et développement de la plateforme.

**Pour les clients, ne pas vendre “nous sommes seulement deux”** ni afficher la taille de l’équipe ; valoriser la solution, la connaissance du BTP, la transparence, la comparaison des offres, la traçabilité, les processus. Ne pas inventer une équipe nombreuse, une assurance, une certification ou une référence client. Répartition du capital, apports/IP code/cahier des charges, rémunérations et porteur juridique doivent encore être formalisés.

**Kit commercial #148 :** les premières brochures PDF et le deck ont été jugés **trop semblables, génériques et sans originalité**. Refonte voulue :
1. Plaquette institutionnelle **architecture premium** ;
2. Brochure particuliers **projet de vie, confiance, humanité** ;
3. Brochure artisans/entreprises **B2B dynamique, opportunités** ;
4. Deck commercial moderne 8–12 diapositives avec rythme, non duplicata des brochures ;
5. Mini-charte, PDF professionnels, sources PowerPoint modifiables. Trois identités de composition différentes mais marque cohérente. Phase conception autorisée en parallèle de #146 ; finaliser après stabilisation homepage. Lancer en **Tunisie** ; Côte d’Ivoire/Burkina Faso restent **extensions conditionnelles**.

**Investissement :** souhait d’une équipe D.A.O. dédiée au lancement, toi à la direction technique, commercial/support/tech/BTP/marketing selon décisions de recrutement. Un ancien scénario de budget sur 12 mois d’environ **420 173 TND était une estimation de travail et NON un besoin d’investissement validé**. Salaires, cotisations, devis marketing/juridique, rémunération des deux associés, apport des fondateurs, modèle revenus et fonds à lever doivent être prouvés avant investisseurs ; ne pas recopier comme un devis.

## 7. Sécurité / OPS / accès — points à respecter

- Dossier GitHub **privé**. Secrets GitHub, Resend, Supabase, OTP, clés OCE/root : ne jamais demander/coller en commentaires/issues, ni imprimer dans logs, PR ou artefacts. Ne pas passer le dépôt en public pour contourner le root OPS.
- Séparation : **deploy-dev applicatif** (réparé #152/#153) et **contrôleur root OPS** (bloqué #91/#150) ne partagent ni mandat, ni correctif, ni permissions.
- Les opérations root font l’objet du protocole `docs/ops-control.md` : admission d’un SHA main CI verte, scope sudo strict, revue du bootstrap, validation serveur, hash de release. Aucune auto-installation root depuis un PR vert. Pas de `gateway-host apply` spéculatif.
- Comptes TEST Client, Artisan et Admin existants ; ne jamais publier mots de passe, e-mails personnels, tokens ou cookies dans le handoff. **Issue #63** demeure OPEN pour l’accès `dao_reviewer` séparé ; Admin ≠ preuve du parcours reviewer-only. Ne pas créer un faux compte avec des permissions indûment élargies.
- Avant toute recette, vérifier les états et autorisations réels des fixtures ; utiliser les comptes TEST déjà présents, pas d’effacement de données DEV ni duplication de parcours acquis.
- Automation agents : work sessions ne se relancent pas par magie ; un commentaire GitHub et les alertes Telegram ne garantissent ni wake-up ni autonomie permanente.

## 8. Feuille de route d’entrée pour Pilot 5

**P0, immédiatement :**
1. Publier un checkpoint « Pilot 5 ACTIVE » sur #154 après contrôle du main/CI/PR **actualisés** ; confirmer un seul owner par mission.
2. Coordonner **#145** (mapping Chat 20) : rebase/merge propre, CI + monitor sur HEAD exact, ensuite débloquer PR métier #137. Ne pas écraser les changements d’AUD 1 sur son autre branche.
3. Informer **AUD 1** de l’échec exact [#551](https://github.com/Khaey/Dao/actions/runs/38597045598) : 68 découverts/58 attendus, aucun Playwright exécuté. Donner le contrôle complet sans baisse de couverture, puis registre #146 et CI complète ; dossier commercial #148 en parallèle sur design statique.
4. Qualifier **#144** (navigation Gestionnaire) au HEAD actuel et coordonner sa livraison sans conflit.
5. Faire signaler à l’owner de **#151** la clôture de l’alternative au deploy-dev maintenant réglé ; **ne pas fusionner**.

**P1, ensuite :**
6. Revoir **#150**, distinct de #153 ; demander seulement les autorisations externes réellement nécessaires au bootstrap root, conserver protections. Reprendre #58 uniquement après preuves d’accès OPS.
7. Recueillir la **note S0 #126** Paramètres sans coder le P3, puis décider entre configuration Tunisie et extension pays.
8. Assurer les critères de commercialisation pilote et refonte kit #148 ; privilégier démonstration vérifiable plutôt que promesses.

**P2 / administratif :**
9. Clore administrativement les issues réellement DONE (#142 si son owner confirme) et ne pas ranimer #85/anciens docs ; vérifier #63 reviewer seul seulement lors d’une recette nécessitant ces droits.
10. Revoir la décision juridique et le modèle économique avec les **deux associés** avant tout contrat opposable, tarif, paiement réel ou levée de fonds.

## 9. Dernières preuves et pièges

- [CI main #549](https://github.com/Khaey/Dao/actions/runs/38593168816) et [#550](https://github.com/Khaey/Dao/actions/runs/38593180907) sont bien **vertes** sur `d433cf8...` ; cela ne qualifie **aucune PR ouverte**.
- [CI #551 PR #147](https://github.com/Khaey/Dao/actions/runs/38597045598) : la **cause exacte est le compteur de tests** ; `Total: 68 tests in 20 files`, gate toujours 58 ; les tests E2E **n’ont pas été exécutés**. Ne pas attribuer à tort cet échec au Back-office ni au SSH déjà réparé.
- [CI #150](https://github.com/Khaey/Dao/actions/runs/38590656099) : SUCCESS **sur la PR**, pas un droit root ni une installation.
- [PR #145](https://github.com/Khaey/Dao/pull/145) : ancienne base avec fixture admin obsolète, malgré une nouvelle CI main verte ; revalider **nouvelle branche**.
- [PR #144](https://github.com/Khaey/Dao/pull/144) : dernier HEAD a changé depuis le PASS isolé antérieur ; pas de déploiement certifié.
- L’ancien contexte [Pilot 4 13/10](PILOT4_HANDOFF_20261013.md), `CURRENT_STATE.md` et `NEXT_STEPS.md` contiennent de vieux statuts ; les utiliser comme **historique**, jamais comme déclencheurs automatiques.
- Les noms **AUD 1** et l’alias historique **DAO CLAUDE 1** désignent le **même agent**. L’issue, la branche historique `feat/claude1-146-public-homepage` et la PR n’ont pas été recréées. Enregistrer **AUD 1** dans le monitoring seulement après coordination.

---

**Auteur : DAO Pilot 4 — pour reprise par DAO Pilot 5.** Rien dans ce document ne donne de nouvelles permissions root, de modification produit sensible ou de signature juridiquement engageante. Les états exacts doivent être revérifiés à la reprise.
