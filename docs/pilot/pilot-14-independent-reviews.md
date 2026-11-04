# D.A.O. — Deux contre-audits indépendants du Coordinateur (03/11/2026)

> **Archives fidèles** : [premier rapport (151 lignes)](audits/2026-11-03-second-avis-v1.md) et [second rapport enrichi (191 lignes)](audits/2026-11-03-second-avis-v2.md). Ces textes ont été **archivés intégralement, sans modification du corps original**, dans GitHub à la demande du propriétaire.
>
> Contexte : contre-analyse indépendante de PILOT 14 et inspection du code, de GitHub et de Supabase DEV **en lecture seule**, à la date indiquée. Ce fichier constitue l'index des points techniques à transmettre ; pour chaque preuve détaillée, consulter l'archive, puis **revérifier la donnée actuelle** avant décision.

## Audit n°1 — Diagnostic général et contradictions

### Constats rapportés par le Coordinateur
- Socle : **105 migrations Git, 54 écrans, 89 API routes**, trois gates environ 12–17 minutes ; recette multi-rôles **14 étapes PASS** (issue #175, 03/11).
- Moteur de métrés PR #550 : erreur CI initiale (variables `SUPABASE_*` vs `DAO_SUPABASE_*`) **déjà corrigée** sur `e5aed76` ; [run 41716736819](https://github.com/Khaey/Dao/actions/runs/41716736819) à trois gates verts. **Conflit de fusion** avec `main` sur cinq fichiers ; preuve à revalider au moment du merge.
- Schéma DEV : ledger aux conventions hétérogènes, quatre changements Vault/connexions sans migration homonyme dans Git ; application hors CI. **Écart fonctionnel non prouvé**, audit comparatif d'objets requis [#555](https://github.com/Khaey/Dao/issues/555).
- BTP : **pas d'écran de métrés** ; validation par Gestionnaire/relecteur affecté ; sans source tarifaire réelle, aucune estimation de référence chiffrée ; liaison #551 ↔ #550 API/SQL compatible sur le papier, recette DEV restante.
- Sécurité : `dao_reviewer` et certains `dao_admin` bénéficient de lecture transversale via prédicat historique `staff()`; sémantique de `manages_project` conditionnée à `dao.native_tracking_scope`. **Aucune faille démontrée**, besoin d'arbitrage politique.
- Documentation : `docs/agents.md` ancien au 28/10 avec PILOT 13 ; PILOT 14 sans issue avant [#556](https://github.com/Khaey/Dao/issues/556) ; PR historiques déjà fermées mentionnées comme ouvertes.
- Prix : nouvelles tables de #551 sont **source tarifaire du moteur**, mais snapshots/versions exposent encore anciennes tables vides #541 ; nettoyage ciblé, non nouveau projet d'estimation.
- Avis vérifiés : **déjà implémentés**, contrairement à la proposition initiale de PILOT 14 ; reliquat de #213 concerne notamment suppression de compte/RGPD.
- OCE optionnel, mais ne pas le mettre en veille sans prouver l'innocuité.

### Rectifications assumées par PILOT 14
| Formulation initiale PILOT 14 | Correction conservée |
|---|---|
| « Corriger la CI de #550 » | Erreur déjà réparée ; **fusion/rebase, nouveau SHA et recette DEV** sont la priorité |
| « Lancer une recette complète multi-rôles » | Déjà couverte par #175 ; **étendre seulement au maillon BTP** |
| « Créer la fonction d'avis clients » | Déjà développée ; traiter uniquement reliquats du ticket #213 |
| « Auditer tout le modèle de prix » | Décision de source tarifaire déjà prise ; supprimer **les lectures anciennes** identifiées |
| « Vérifier le ledger DEV par numéro de migration » | Comparer **les objets effectifs** et privilèges, pas seulement les IDs de ledger |
| « DEV est livré comme Git » | **Parité non démontrée**, audit #555 requis |

## Audit n°2 — Ajout préparation PROD et calendrier

Le second fichier reprend l'essentiel du premier et ajoute une estimation de maturité **non statistique** :
- **~80 % du fonctionnel MVP** : marketplace et suivi avancés.
- **~50 % de préparation à une PROD** : pas d'environnement Supabase PROD distinct ni pipeline PROD démontrés.
- Le vrai reste à faire : projet PROD isolé, migrations contrôlées, sauvegarde/restauration, supervision, secrets, domaine, e-mail, sécurité, règles de confidentialité/effacement et cadre juridique tunisien.
- **Bêta très limitée sans argent ni signature engageante** : 4–6 semaines proposées comme hypothèse, **non engagement**. PILOT 14 estime l'ouverture publique moins prévisible ; un décalage juridique/tiers peut allonger le calendrier.
- Les fonctionnalités prix réels, signature et escrow dépendent de fournisseurs et ne doivent pas bloquer la V1 limitée dès lors que leur absence est honnêtement affichée.
- La sécurité ne se réduit pas à l'existence de RLS/JWT : revue transversale et restauration testée restent nécessaires.

### Désaccord restant sur les délais
PILOT 14 valide la distinction MVP/PROD, **mais rejette un délai garanti**. La projection de quelques semaines repose sur des conditions non encore prouvées (PROD, juridique, restauration, revue sécurité, vrais utilisateurs). L'objectif doit être une **porte de sortie vérifiable**, pas une date arbitraire.

## Questions non résolues à transmettre

1. Pour les métrés sans Gestionnaire : **qui peut signer la validation technique ?** Le Client peut déclarer une quantité sans l'autovalider professionnellement ; décider si une estimation peut intégrer ce statut.
2. Pour les prix : fournisseur/licence/source locale, date et unité, saisie et vérification par **deux personnes distinctes** ; pas forcément deux `dao_admin`.
3. Pour la consultation staff : accès de `dao_reviewer` global ou borné aux missions et chantiers affectés ?
4. Pour le catalogue : compte des lots publiés divergent (**10 vs 20** dans différentes notes) : requête filtrée à `TN-2026.1` et aux états publiés, distincts du brouillon retiré.
5. Pour le coffre : quatre changements Vault présents dans DEV et absence de fichier homonyme Git : **parité réelle encore à démontrer**.
6. Pour la V1 : définir ce qui est publié **sans** engager fonds et signatures, et comment l'utilisateur perçoit les fonctionnalités indisponibles.

## Méthode de reprise

- Prioriser les **preuves nouvelles** sur les assertions anciennes, y compris si elles viennent de PILOT 14 ou du Coordinateur.
- Qualifier les affirmations : `PROUVÉ` par SHA/SQL/run actuel ; `RAPPORTÉ` par agent/audit ; `HYPOTHÈSE` ; `UNTESTED`.
- Ne jamais effacer un désaccord. Écrire une décision nouvelle datée, liée au résultat qui a changé.
- Lire aussi [passation PILOT 14](pilot-14-handover.md) et [issue #556](https://github.com/Khaey/Dao/issues/556).
