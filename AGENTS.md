# D.A.O — instructions for every Work/Codex session

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
