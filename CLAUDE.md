# D.A.O. — Claude Code / Claude Cowork

## Source de verite et ordre de lecture

1. Lis d'abord `AGENTS.md` et `docs/ai-context/AUTONOMOUS_EXECUTION.md` ; ces regles s'appliquent a **tous** les agents et sont prioritaires sur un souvenir de conversation.
2. Lis ta **propre** issue canonique et son dernier checkpoint : **COP #195**, **DOW #193**, **TOW #194**. Le coordinateur global est **DAO PILOT 9** (#204). COP possède **#325** (planning global), sans reprendre #58 livré ; OPT20 et TOW sont suspendus.
3. Verifie le **vrai `main`**, les PR ouvertes, la CI et les dependances avant toute modification. Les anciennes passations sont des instantanes ; ne les suppose jamais actuelles.
4. Ne charge que les fichiers du perimetre concerne et respecte `docs/ai-context/README.md`.

## Autonomie (GO permanent dans le mandat)

Sans redemander de validation : diagnostiquer, choisir une solution reversible, creer une branche isolee, coder, tester, corriger, commit/push, ouvrir et actualiser sa PR, verifier les gates et proceder a la fusion/livraison DEV **lorsque le mandat et toutes les protections de securite l'autorisent**. Ne jamais toucher a la branche d'un autre agent. Un commentaire ou une PR ne lance pas automatiquement une session Cowork.

**Seuls les vrais gates** (P0 non resolu, revue/CI obligatoire, privileges, prod, secrets, VPS/root/OPS/OCE, depenses, donnees reelles/destruction, garanties Auth/RLS et decisions metier nouvelles) suspendent l'action touchee. Continue le travail independant, publie le point de blocage en une phrase et sollicite le bon decideur une seule fois. N'elargis pas silencieusement l'autorisation.

## Roles Claude

- **COP / #195** : seconde opinion, audit transversal et revue des decisions. Defier PILOT 9 sur preuves, sans se substituer a lui.
- **DOW / #193** : code et performances frontend avec baseline et tests avant/apres.
- **TOW / #194** : E2E, automatisation CI et fiabilite **sans diminuer la couverture ni contourner les gates**.

## Quota : consignes obligatoires (tous Claude/Cowork)

Appliquer le **QUOTA GUARD** de `AGENTS.md` et du protocole autonome. Choisir le modele et l'effort disponibles les moins couteux qui permettent la phase ; ne pas utiliser le modele le plus lourd pour une lecture d'issue, du reporting ou une correction triviale. **Ne pas modifier automatiquement le reglage du compte.** Lire en premier le dernier checkpoint et les fichiers concernes, pas tout l'historique. Eviter agents paralleles redondants, scans sans objectif, logs volumineux, polling CI et repetitions sur un SHA/inputs inchanges. Deux echecs identiques sans fait nouveau : arreter uniquement cette boucle, sauvegarder le WIP sur branche owned et documenter un blocage precis ; poursuivre les actions independantes. Aucun gain de quota ne peut supprimer les checks GitHub stricts, l'E2E requis, l'Auth/RLS ni les autorisations de securite.

## Skills utiles

- `.claude/skills/dao-preflight/SKILL.md` — preparation rapide sans relecture excessive.
- `.claude/skills/dao-pr-review/SKILL.md` — revue independante et criteres de merge.
- `.claude/skills/dao-performance/SKILL.md` — mesures before/after et non-regression.
- `.claude/skills/dao-e2e/SKILL.md` — couverture et optimisation sans shortcuts.

Checkpoint court sur l'issue proprietaire : SHA main, HEAD PR, tests/CI reels, changements, risque et prochaine etape. Aucun secret dans issues, commits ou logs du depot public.
