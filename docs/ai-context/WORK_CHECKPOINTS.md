# D.A.O — Work checkpoints and recovery

Common DEV/OPT procedure, introduced by [issue #87](https://github.com/Khaey/Dao/issues/87).
It supplements [AUTONOMOUS_EXECUTION.md](AUTONOMOUS_EXECUTION.md), especially
sections 1, 4, 6 and 8; it grants no additional product or operational authority.

**Recovery is guaranteed only from the last commit actually published on
GitHub.** Work has no reliable crash, Stop-button or quota-exhaustion hook.
Local edits, local commits, chat messages and a prepared-but-unpublished API
commit are not a remote backup. A checkpoint comment describes a backup; it
does not save the code itself.

## 1. Find the owner before starting

Read the current assignment, the entire owner issue and its comments, actual
remote `main`, root `AGENTS.md`, the complete AI-context index and open PRs.
Record exact main SHA and the matching CI run/attempt; do not confuse a newer
unrelated operational workflow with the application's main CI.

Use one owner issue and one dedicated branch per bounded task. A replacement
session may resume its own previously published branch only after verifying
the issue/PR ownership and that no other active Work owns that branch. An
ambiguous handoff requires coordination; do not take over another Work.
For a new task, create the owned branch remotely from verified main before
implementation, using an isolated checkout. Preserve other Work checkouts.

Ownership at introduction (2026-10-09; verify live assignments on each restart):

| Work | Owner issue | Scope |
| --- | --- | --- |
| DAO OPT 20 | [#87](https://github.com/Khaey/Dao/issues/87) | Work continuity only |
| OPT | [#85](https://github.com/Khaey/Dao/issues/85) | CI/E2E/deployment optimization |
| DEV 20 (formerly DEV 3) | [#58](https://github.com/Khaey/Dao/issues/58) | OCE/Cloudflare work |
| DEV 2 | [#83](https://github.com/Khaey/Dao/issues/83) | Artisan/Entreprise |

Back-office [#64](https://github.com/Khaey/Dao/issues/64) remains a separate
owner's scope. This table neither transfers ownership nor authorizes work.

## 2. Publish during the work, including incomplete work

Keep at most one small, meaningful phase between publications. Checkpoint
after an audit that changes the next action, an implementation slice, a
targeted correction, a useful validation result or a newly understood blocker.
Also checkpoint before a long-running check or a planned pause/handoff. Do
not wait until the whole task is complete or until the session warns of quota.
This is a discipline followed during an active session, not a background timer.

1. Review the diff and stage only the task's explicit files. Exclude secrets,
   personal/client data, environment dumps, credentials, generated build/state
   files and token-bearing logs. WIP is allowed; sensitive content is not.
2. Run the small checks appropriate to the phase. If the work is unfinished
   or a check fails/is unavailable, preserve safe WIP on the owned branch and
   state the failure or missing proof. Do not call it validated or merge it.
3. Commit with a descriptive message (`wip: ...` when useful), then push to
   the owned branch. Open a **draft PR** once there is a reviewable diff; keep
   or return it to draft while incomplete. Never publish WIP on `main`.
4. Independently read the remote branch HEAD and confirm it equals the intended
   commit. With shell Git, use `git rev-parse HEAD` then
   `git ls-remote origin refs/heads/<owned-branch>`; otherwise use the GitHub
   connector's ref read. Commit/tree creation alone is insufficient: the owned
   remote ref must point to it. Never force another Work's branch.
5. Append the small checkpoint below to the owner issue when issue publication
   is authorized. #87 explicitly authorizes its non-sensitive checkpoints;
   another task uses its existing authorization. Otherwise put the same safe
   status in the owned draft PR and report the issue-publication limitation.

No changed files means no empty commit: record read-only findings, newly
available CI evidence or a blocker against the existing published HEAD.
Keep `CURRENT_STATE.md` / `NEXT_STEPS.md` updated at meaningful milestones
with a short owned section and a link to the canonical owner issue. Reuse
`DECISIONS.md` for durable decisions, preserving others' sections. A CI-result
comment needs no new documentation commit merely to repeat an exact SHA.

If push fails, say **local only / not backed up**, try the authorized connector
as the supported fallback, and confirm the ref. If comment publication fails
after a successful push, code is saved but the narrative is missing: record
that limitation and append the comment when possible. Never erase an older
checkpoint to hide a failed check; append a correction referencing it.

## 3. Small owner-issue checkpoint template

Use the stable heading `DAO <Work> — checkpoint` so issue comments are easy
to find. Replace placeholders with verified facts; keep the comment concise.
Full SHAs and links avoid ambiguity. Never copy raw logs or environment values.

```markdown
## DAO <Work> — checkpoint <sequence> — <timestamp + timezone>
- Owner: #<issue>; scope: <bounded task>; state: <WIP / blocked / ready / merged>.
- Main observed: <full SHA>; owned branch: <name>; PR: <link, draft/ready or none>.
- Published HEAD: <full SHA + commit link>; remote ref verified: <timestamp>.
- Done: <concrete changes/findings>; incomplete: <remaining work>.
- Proof: <check, tested code/head or merge SHA, relevant inputs/environment,
  result, run URL + attempt when CI>; pending/failed: <exact missing evidence>.
- Limits/blocker: <safe description or none>; local-only work: <none or scope
  explicitly NOT backed up>; operational action: <not performed / actual proof>.
- Next action: <one concrete command or task, with its prerequisite>.
```

Distinguish a PR run from a main run and an automatic deployment job from an
actual inspected service/HTTP response. An earlier successful check remains
evidence for its tested inputs; it does not become green proof for a new HEAD.
Link the successful result instead of re-running it without an invalidation.

## 4. Resume after crash or quota

1. Start from GitHub, without requiring a copy of the chat. Read current main,
   AGENTS/context and owner issue including all comments. Find the latest
   applicable checkpoint for that owner, its PR and branch. If the PR is
   merged/issue complete, read the final result and continue only the remaining
   assigned scope; do not resurrect its completed branch.
2. Read the actual branch ref, PR head/state/base and matching CI evidence.
   The branch may be **ahead of the comment** if the session stopped after
   push. Inspect those extra commits and the PR diff; recover their published
   contents, marking undocumented tests/intent unverified. If no comment
   exists, use the issue, owned branch and PR metadata/diff to reconstruct a
   checkpoint before continuing.
3. If the comment names a commit no longer at the branch head, inspect ancestry
   and PR history. Do not reset the branch to an old comment or silently accept
   an unexplained rewrite/ownership change. If the branch was deleted, inspect
   the PR head or linked commit and verify it is still retrievable; recover it
   on a new owned branch only within the assigned scope. An unavailable commit
   is a real blocker, not a claim that local work can be recovered.
4. Inspect any surviving local checkout without discarding changes. Prefer a
   fresh isolated clone of the verified owned remote branch; verify its HEAD
   equals the observed remote SHA. If local edits survive, review them as
   **unpublished and unvalidated**, separately from the recovered checkpoint.
   Never reset/clean/stash/switch another Work's checkout. Local changes absent
   from GitHub cannot be recovered from GitHub.
5. Compare current main with the checkpoint base and inspect concurrent PRs.
   If main advanced, reconcile only the owned branch, preserving newly merged
   docs/tests. Before coding and again before merge, recheck main and ownership.
   Preserve remote checkpoints; avoid destructive rewrites. Any necessary
   authorized rewrite of the owned branch uses an exact expected-head lease.
6. Reuse successful checks for unchanged HEAD/code and relevant inputs, with
   their run/attempt and environment. Pending CI: observe that existing run.
   Failed CI: inspect its logs and follow the bounded correction protocol.
   Changed main/tested merge, code, workflow, dependencies or environment:
   explicitly identify invalidated evidence and obtain the required checks
   for the updated candidate. No manual rerun or local build for reassurance.
7. Append a resumed checkpoint stating the actual recovered HEAD, missing
   narrative/proof and next action. Finish that action within the task scope.
   Make the PR ready only when complete; merge only with authorization,
   relevant green checks and the concurrency review required by the protocol.

For a fresh recovery clone, substitute the verified owned branch name:

```bash
git ls-remote https://github.com/Khaey/Dao.git refs/heads/main refs/heads/<owned-branch>
git clone --single-branch --branch <owned-branch> https://github.com/Khaey/Dao.git <new-isolated-directory>
cd <new-isolated-directory>
git rev-parse HEAD
git status --short
bash scripts/dao-task-check.sh
```

Angle-bracket values are placeholders, not literal shell syntax. If shell
access fails, read main/branch refs, issue comments, PR diff and runs through
the authorized connector. Publish reviewed text files using the last verified
owned tree, preserve all untouched paths, update only the owned ref with an
expected-HEAD check, then independently re-read it. Do not call API snapshots
a full clone. The existing preflight suggests checks; it does not publish a
checkpoint or guarantee CI/PR metadata when `gh` is unavailable.

## 5. Short startup message for a new Work

Replace the owner and issue; this message does not launch a Work by itself.

```text
Tu es DAO <Work>, propriétaire exclusif de l'issue #<issue> sur Khaey/Dao.
Lis le vrai main, AGENTS.md, docs/ai-context/ et toute l'issue avec ses commentaires.
Applique docs/ai-context/WORK_CHECKPOINTS.md (politique issue #87).
Vérifie branche/PR/HEAD/checkpoints et les preuves CI avant de reprendre.
Reprends uniquement le dernier état publié de ton chantier, sans refaire les acquis
ni toucher aux branches des autres Work. Sauvegarde même le WIP par petites étapes
sur ta branche ; PR draft si incomplet, checkpoint non sensible selon autorisation.
La reprise garantit le dernier commit publié, jamais les changements locaux perdus.
Continue jusqu'aux contrôles et à la livraison autorisée dans ton périmètre.
```

## 6. Recovery rehearsal (safe, fictitious)

Use a disposable local bare Git repository, synthetic text and fresh clones,
not another Work's branch or a shared database. Verify these cases:

| Interruption point | Expected recovery/action |
| --- | --- |
| After WIP commit + push + comment, then extra local edits | Fresh clone contains published WIP only; lost local edits are not claimed recoverable |
| After a later push, before its comment | Remote HEAD is newer; inspect extra commit and append missing checkpoint; tests remain unverified |
| Push fails or only a local commit exists | Fresh clone stays at last published HEAD; explicitly report local-only work |
| CI already green, HEAD and relevant inputs unchanged | Read/link existing proof; do not rerun |
| Main advanced or tested merge/input changed | Inspect delta, reconcile owned candidate and obtain invalidated required checks |

Record the actual rehearsal outcome in #87 with the published implementation
HEAD. This exercises recovery decisions, not a real Work crash hook. No new
CI job, scheduled automation, always-running process or access grant is needed.
