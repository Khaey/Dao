# D.A.O — Command Center (GitHub Project #3)

Tableau : https://github.com/users/Khaey/projects/3/views/1

Source officielle : les issues et PR de Khaey/Dao, et les agents déclarés
dans .github/dao-monitor-agents.json. Ne pas maintenir un second Kanban.

## Une configuration nécessaire côté propriétaire

Le connecteur ChatGPT GitHub gère les issues et PR mais ne propose pas
d'action d'écriture des champs GitHub Projects. Le jeton GITHUB_TOKEN standard
d'Actions ne peut pas accéder aux Projects.

Créer un **personal access token (classic)** dédié avec les autorisations
**project et repo** pour le Project personnel et dépôt privé. Le déposer
directement dans GitHub, JAMAIS dans ChatGPT ou une PR :

Khaey/Dao → Settings → Secrets and variables → Actions → New repository secret

Nom exact : **DAO_PROJECTS_TOKEN**. Utiliser une expiration et renouveler
si nécessaire. Ne communiquer ni le token ni sa valeur à aucun agent.

Après intégration de la PR, ouvrir :
Actions → DAO Projects Sync → Run workflow, dry_run = false.

Le workflow s'exécute ensuite à chaque changement d'issues ou de PR
et toutes les trois heures ; dry_run = true simule les modifications.

## Fonctionnement

- Import idempotent de toutes les anciennes et nouvelles issues/PR, sans doublons.
- Crée les champs Agent, Priorité, Domaine et État GitHub, s'ils manquent.
- Agent : attribution uniquement depuis le registre officiel. Les PR
  doivent déclarer explicitement une ligne Owner issue: #N.
  L'auteur GitHub partagé Khaey ne permet pas d'identifier l'agent.
- Issue close et PR fusionnée → Done (état du dépôt uniquement).
  PR ouverte et issue reliée à une PR ouverte → In Progress.
  PR close sans fusion n'est pas assimilée à une livraison.
- Le champ État GitHub distingue les PR fusionnées, fermées sans fusion
  et les issues fermées ; **la livraison DEV exige toujours CI/deploy
  et checkpoint**, jamais seulement un merge.
- Aucun changement dans RLS, Auth, DB, données DEV, contrats, finances,
  VPS ou secrets.

## Vues du tableau

Après exécution, tu peux créer des vues GitHub Projects groupées par Agent,
Priorité et Domaine à partir de leurs champs sélectionnables. Le workflow
ne supprime pas de cartes ni ne réorganise les vues manuellement
définies par l'utilisateur.

Les tickets anciens sans owner dans le registre officiel ne reçoivent
pas d'agent inventé ; l'attribution historique se valide par checkpoint.

Références : GitHub Docs — Automating Projects using Actions / Projects GraphQL.

## Afficher et attribuer la priorité dans la vue

Le champ synchronisé s'appelle **`Priorité`** (avec accent), pas **`Priority`**.
Dans Project #3 → vue Git View/Table → options de la vue → **Fields / Champs**,
afficher **Priorité** et non un éventuel champ anglais distinct `Priority`.
Vérifier aussi les filtres de la vue et l'option `Non définie`.

L'automatisation classe `P0` à `P3` seulement à partir d'une déclaration explicite :
le titre, une étiquette `P1`, ou une ligne de description telle que
`Priorité : P1` / `## Priorité : P2` dans les 50 premières lignes.
Sans priorité explicite, elle **conserve une priorité P0–P3 choisie
manuellement dans le Project**, au lieu de la remplacer par `Non définie`.
Les tickets qui n'ont jamais reçu de priorité restent `Non définie` :
ce n'est ni un bug d'import ni une déduction automatique d'urgence.
Pour les classer, le responsable produit attribue une priorité réelle via
le tableau ou ajoute la ligne explicite dans l'issue.

Ce choix évite de transformer arbitrairement 200+ tickets historiques en P1
ou P2, et préserve les choix faits manuellement entre deux synchronisations.
