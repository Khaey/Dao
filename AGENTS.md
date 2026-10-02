# D.A.O — instructions for every Work/Codex session

Before changing this repository, read `docs/ai-context/AUTONOMOUS_EXECUTION.md`
and every file indexed by `docs/ai-context/README.md`. Verify actual GitHub
main, the latest CI and open PR ownership. A historical checkpoint is not a
current instruction. If shell Git is unavailable, use the authorized GitHub
connector; do not work from an unrelated local directory.

Run `bash scripts/dao-task-check.sh` for a bounded, read-only preflight and
impact suggestion when the local checkout is available. Its suggested checks
are a starting point, not a substitute for mandatory CI or full coverage.

WORK DEV owns functional work. WORK OPT owns platform/CI/test infrastructure
on its own `chore/*` branches. Never modify another Work's branch or PR.
Reconcile changes to main before merge; preserve newly merged tests and docs.

Within the assigned task, continue through targeted checks, commit/push, PR,
green CI and authorized merge without asking again for normal technical steps.
Do not rerun a successful check for identical code and relevant inputs.
Report actual evidence and blockers; do not claim a live check from old logs.

Never weaken Auth, RLS, data isolation, secrets, business permissions or
financial integrity. FULL E2E runs only on the disposable local stack. DEV
smoke checks and permanent TEST accounts are a separate controlled scope;
never reset the shared DEV database or delete immutable business history.

For VPS operations, prefer the `DAO DEV operations` workflow on main. Read
`docs/platform-operations.md` before using it. Never put secret values in
workflow inputs, command arguments, commits, PRs or logs.
