# D.A.O — instructions for every Work/Codex session

## Current coordinator — DAO PILOT 7 (17 October 2026)

Owner decision: PILOT 6 has ended coordination due to conversation limits;
**DAO PILOT 7** owns [issue #204](https://github.com/Khaey/Dao/issues/204)
and the versioned [handoff](docs/ai-context/PILOT7_HANDOFF_20261017.md).
The owner wants autonomous end-to-end deliveries, not serial approvals.
All agents' existing owners and scopes are preserved; team DEV20/OPT20/Chat20/Chat21
is suspended and their open scopes transferred per #204.
UX S1 #198 / PR #202 and SSH deployment remediation #188/#200/#201 are **delivered**;
UX S2 #203 is DAO DOW's priority. Do not reblock main over resolved #188.
Historical PILOT 6 notes remain valid only to the extent they agree with #204
and live exact-SHA GitHub evidence.


## DECISION OWNER / PILOT 6 — AUTONOMIE PAR DEFAUT POUR TOUS (16 octobre 2026)

**Applicable a TOUS les agents actuels et futurs, ChatGPT, Claude/COP/DOW/TOW, DEV, OPT, Pilot et auditeurs.** La mission proprietaire attribuee vaut autorisation continue d'executer les etapes ordinaires de A a Z : preflight utile, branche isolee, implementation, tests cibles, corrections, commits, push, PR, resolution des retours de revue, CI, reconciliation avec main, merge de sa propre PR et verification post-merge/deploiement DEV *si deja autorises par le perimetre, les gates et la politique de release*. **Ne pas redemander « go », « confirme » ni une validation de confort.** Un checkpoint GitHub informe, il ne bloque pas.

**Arret limite a l'action concernee** lorsqu'un gate reste reellement manquant : droits/permission du fournisseur, revue ou check obligatoire, P0 de securite non resolu, mutation production/VPS/root/OPS/OCE non preautorisee, secret ou acces, cout, suppression destructrice, changement de garanties Auth/RLS, changement de regles metier engageant ou de visibilite du depot. Ne jamais contourner ces controles ; poursuivre les travaux independants et presenter une seule question ciblee au responsable de decision. Le Pilot tranche d'abord les decisions techniques ou entre owners, le proprietaire tranche les nouveaux risques/engagements.

**Autonomie ne signifie pas concurrence** : un agent n'edite ni branche ni PR d'un autre owner et ne reprend pas une mission sans transfert. Eviter les tests/CI identiques et les longues demandes d'approbation. Publier un seul checkpoint utile par jalon avec SHA, resultats, blocage reel ou livraison.

**Les instructions ci-dessous et `docs/ai-context/AUTONOMOUS_EXECUTION.md` precisent les invariants.** Une restriction de securite explicite et actuelle garde priorite sur l'autonomie ordinaire. Aucune instruction ni commentaire ne demarre automatiquement une session interrompue.


**Pilot transition / coordination:** on taking over as **DAO Pilot 5 or later**,
start with [issue #154](https://github.com/Khaey/Dao/issues/154) and
[the 2026-10-14 Pilot 5 handoff](docs/ai-context/PILOT5_HANDOFF_20261014.md),
then verify live main, PRs, CI, and latest canonical owner checkpoints.
The older [Pilot 4 handoff](docs/ai-context/PILOT4_HANDOFF_20261013.md)
is historical; dated snapshots never supersede live evidence. Do not infer that a
GitHub comment launches a ChatGPT Work session.

Before changing this repository, read the **current owner issue and last
meaningful checkpoint**, `docs/ai-context/AUTONOMOUS_EXECUTION.md` and the
`docs/ai-context/README.md` index. Verify actual GitHub main, the relevant
latest CI and open PR ownership. Read task-relevant context and source only;
review complete applicable business/Auth/RLS/financial/OPS invariants before
changing those domains. A historical checkpoint is not a
current instruction. If shell Git is unavailable, use the authorized GitHub
connector; do not work from an unrelated local directory.

Run `bash scripts/dao-task-check.sh` for a bounded, read-only preflight and
impact suggestion when the local checkout is available. Its suggested checks
are a starting point, not a substitute for mandatory CI or full coverage.

The latest owner issue determines scope for **every** D.A.O agent: DEV 1,
DEV 2, DEV 20, OPT, OPT 20, Back-office, Pilot/coordinators and all future
agents. OPT and OPT 20 are distinct; issue-specific assignments (#115,
#116, #58, #61, #64, #91, etc.) override older role labels. No agent may
modify another owner's branch or PR without explicit coordination.
Reconcile changes to main before merge; preserve newly merged tests and docs.

Within the assigned task, continue through targeted checks, commit/push, PR,
green CI and authorized merge without asking again for normal technical steps.
Do not rerun a successful check for identical code and relevant inputs.
**For every current and future agent**, use quota-aware execution: resume
from the last published checkpoint, inspect only affected areas, batch
independent reads, reuse exact-SHA proofs, avoid repeating already validated
UI paths, builds and long checkpoint prose. Publish concise meaningful
milestones; stop when the bounded mission is complete or blocked by a proved
dependency. This applies to feature agents, auditors, infra/OPS agents
and Pilot coordination alike. Full Auth/RLS, required CI/E2E, migrations,
release and infrastructure authorization gates remain intact.
Report actual evidence and blockers; do not claim a live check from old logs.

**New-agent registration is mandatory before the agent's first owned feature PR:**
confirm its official name, canonical issue and coordinator; publish a reviewed
update to `.github/dao-monitor-agents.json` and verify the automatic DAO Monitor
Telegram onboarding event after the registry PR reaches `main`. Do not confuse
a GitHub mission enrollment with creating/starting a ChatGPT Chat/Work session,
nor with adding a human Telegram group member. See `docs/dao-monitor.md`.

In each owned PR body, declare `Owner issue: #N` on its own normal-text line,
using the canonical registered owner issue. Other issue links are context;
conflicting Refs/Fixes/Closes remain ambiguous. See `docs/dao-monitor.md`.

Use `docs/ai-context/WORK_CHECKPOINTS.md` for every agent's code/ops task:
publish each
small meaningful phase, including safe WIP, on the owned branch; keep incomplete
PRs in draft and record an authorized owner-issue checkpoint with verified HEAD,
proof, limits and next action. Recovery starts at the last GitHub-published
commit; no automatic Work crash/Stop/quota hook or local-only recovery is promised.

Never weaken Auth, RLS, data isolation, secrets, business permissions or
financial integrity. FULL E2E runs only on the disposable local stack. DEV
smoke checks and permanent TEST accounts are a separate controlled scope;
never reset the shared DEV database or delete immutable business history.

For VPS operations, prefer the `DAO DEV operations` workflow on main. Read
`docs/platform-operations.md` before using it. Never put secret values in
workflow inputs, command arguments, commits, PRs or logs.

For the common DEV/OPT/Pilot interface, read `docs/ops-control.md`: exact owner
comments on #91 invoke fixed main-only operations. Root maintenance requires
its one-time reviewed bootstrap and explicit SHA admission after green main CI.
When changing a catalogued root helper, regenerate `ops/ops-release.json` using
`python3 scripts/build-ops-release.py` in the same PR. Do not overwrite installed
drift or treat a merged helper source as already updated on the VPS.
