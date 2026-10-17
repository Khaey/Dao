# D.A.O — Autonomous execution / FAST EXECUTION MODE

## 0. Regle generale A-Z — decision proprietaire du 16 octobre 2026

**Tous les agents actuels et futurs**, quels que soient le modele, la plateforme et le role (Pilot, CoPilot, DEV, OPT, Chat, COP, DOW, TOW, auditeurs), poursuivent **sans confirmations utilisateur repetitives** chaque mission deja autorisee. Les etapes normales sont preflight minimal, travail sur branche propre, modification, tests, correction, commit/push, PR, revue/CI, rebase/merge et verification de livraison DEV, dans les limites de l'issue, des politiques de release et des protections GitHub.

Par defaut : **DECIDER, EXECUTER, VERIFIER, PUBLIER, POURSUIVRE.** Un checkpoint n'est jamais un nouveau gate de GO. Ne pas interrompre un chantier pour choisir une solution technique reversible, une validation ciblee ou une sequence de tests deja approuvee. L'agent n'a pas a promettre une execution en arriere-plan et ne peut pas se reveiller tout seul apres un quota/Stop.

Si une etape est deja autorisee mais bloquee par un controle obligatoire : ne pas contourner les protections ; preparer tout le reste, documenter le blocage **specifique** une fois et solliciter seulement la personne qui a le droit de le lever. Le pilote arbitre les decisions d'organisation/cross-owner ; le proprietaire garde les decisions nouvelles a impact juridique, financier, securite, prod, secrets, VPS/root/OPS/OCE, schema destructif ou garantie Auth/RLS. Pas de fusion de la PR d'autrui sans mandat, ni fusion en presence d'un gel P0 explicite. Reutiliser les preuves CI du SHA exact, pas de polling ou reruns pour rassurance.

Cette decision renforce le protocole 0A ci-dessous sans supprimer les controles de surete deja documentes. Pour Claude Code, `CLAUDE.md` pointe vers les memes sources ; GitHub est l'etat partage, pas la memoire d'une conversation.


## Scope and ownership

The **latest canonical owner issue** controls scope for every D.A.O agent:
DEV 1, DEV 2, DEV 20, OPT, OPT 20, Back-office, Pilot/coordinators and any
new agents. OPT is distinct from OPT 20. Issue #116 belongs to DEV 2; #115
belongs to OPT. Historical role labels or old snapshots never authorize
changes on another owner's branch, project, VPS task or PR.

This protocol supports A→Z execution within the user's authorized scope.
It is not permission to change product behavior, business rules, RLS, Auth,
SQL/RPC/schema, production, infrastructure unrelated to D.A.O, or another
Work's branch. Explicit current user instructions take precedence over old
checkpoints. Do not ask again for already authorized routine work.

Repository-root `AGENTS.md` is the startup instruction for new Work/Codex
sessions. Read this protocol first, then the index and task-relevant context.
Read full applicable security/business decisions for any domain being changed. The user
has authorized WORK OPT to complete its own normal branch → checks → PR → CI
→ merge workflow without repeated confirmations. WORK DEV remains separate.
Permanent DEV TEST accounts are allowed for targeted validation; they do not
replace isolated CI users. See [../platform-operations.md](../platform-operations.md)
for scripts, DEV operations and the fixture reset boundary.

## 0A. DECISION DAO PILOT 4 — no routine confirmation requests (2026-10-13)

**Default for ALL current and future DAO agents: DECIDE AND CONTINUE within
the authorized canonical owner issue.** Checkpoints are evidence, **never
approval gates**. The owner explicitly wants uninterrupted progress, with
the fewest possible "confirme", "valide", "go", "je continue ?" or repeated
requests to acknowledge a completed GitHub comment. Do not stop to obtain a
second approval for an action already within an existing GO. A ChatGPT session
may still require a new user turn to resume; publishing a GitHub comment
cannot restart or keep a Work/Chat session running.

**Execute autonomously when already covered by the assigned GO:**
- create/inspect/update an owned GitHub issue checkpoint, branch, commit, PR,
  tests and CI; fix proven implementation errors; reconcile with main;
- resume immediately after a successful phase from the documented next step;
  complete approved review, deployment or merge when the exact-HEAD CI,
  required checks, repository rules and scope-specific authorization pass;
- choose ordinary, safe, reversible technical implementation details, copy
  text, labels, validation messages and test sequencing without asking Pilot;
- use existing approved synthetic DEV TEST records and distinct test users
  for **already-authorized** E2E/manual acceptance flows, with authentic actor
  permissions and no reset of shared DEV. Do not treat a PASS checkpoint as a
  request to confirm or replay it.

**Classify each contemplated action before asking anyone:**
1. `ROUTINE / ALREADY APPROVED` -> execute, then one concise checkpoint.
2. `CROSS-OWNER` -> notify the affected owner through the canonical GitHub
   issues and hand off the action; work on other independent tasks. No
   duplicated modifications or races on a shared TEST fixture.
3. `NEW OWNER DECISION` -> present a safe, concrete recommendation and the
   smallest necessary question **to Pilot**, not a generic "je peux
   continuer ?" to the user. Continue any independent approved work.
4. `SAFETY / EXTERNAL APPROVAL GATE` -> stop *only the affected action*.
   Existing provider/UI consent, protected GitHub environment approvals,
   approvals for privileged VPS/root, Cloudflare tunnel activation,
   `gateway-host apply`, production/real-client mutations, legal
   signatures, actual financial transfers, secrets, changes to Auth/RLS
   guarantees or business rules, and destructive operations are **not**
   silently approved by this policy. Do not bypass native confirmation
   controls or invent an approval.

**For the concrete #115 / #124 situation:** the OPT #115 checkpoint confirms
the synthetic project's first lot was created; it is *not* a DAO submission.
Issue #124 explicitly grants OPT 20 a full Client -> Admin -> Artisan ->
Client test including DAO submission on authorized synthetic data. OPT #115
should record the existing PASS and let OPT 20 own the subsequent
cross-role/mutating test step, coordinating through issues; neither agent
must ask the owner to "confirm" an already-authorized test submission.
Never submit a real dossier, send a new external message to a real person
or impersonate a separate reviewer.

**Messages to the owner:** report only DONE, BLOCKED, important failures,
true new business/security decisions, and a final concise outcome with
GitHub links. Do not send an extra confirmation request after "checkpoint
published". Routine progress belongs in GitHub/Telegram according to the
existing monitoring policy.

## 1. Resume from remote evidence

1. Identify the official repository `Khaey/Dao`, local path (if any), branch,
   HEAD, worktree status and remote. Never assume a directory named dao is it.
2. Read root `AGENTS.md`, the current owner issue + latest checkpoint,
   this protocol and the README index. From the index, load task-relevant
   context/decisions and files at verified main SHA. Read full cross-domain
   invariants when needed, especially business, Auth/RLS, money or access.
   Do not repeatedly read all historical documents by default.
3. Read the actual `refs/heads/main`, latest main workflow and open PR metadata.
   Record SHA, run ID/attempt, conclusion, and PR ownership without changing
   other PRs. Chat and old documentation are leads, not live state.
4. For **any agent implementing code/docs**, create the task's own branch
   from that exact main SHA (respect established `chore/*` for OPT and
   feature/fix naming for DEV). For recovery of the same assigned task,
   verify ownership and resume its published branch/PR using
   [WORK_CHECKPOINTS.md](WORK_CHECKPOINTS.md). Use an isolated clone/worktree;
   preserve all other local changes. Never reset, clean, stash or switch
   another agent's checkout. A Pilot coordination comment alone needs no
   branch, build or CI run.
5. Verify main at preflight and before publication/merge; also recheck on
   observed concurrent changes. Avoid refetching unchanged refs after every
   small edit. If main advanced, inspect the delta and reconcile only your
   own branch, preserving other Work's changes. Never overwrite concurrent
   context or force-push another Work's history.

Use a working authenticated GitHub connector when shell Git/network access is
unavailable. Git data API publication must use the verified main tree as its
base, preserving all untouched paths, and the owned branch as its only target.
Confirm remote branch SHA after each publication via API or git ls-remote.
Never describe an API file snapshot as a complete local clone.

## 2. Preflight once, then execute

Record only the capabilities required by the phase:

| Capability | Evidence | If unavailable |
| --- | --- | --- |
| GitHub read/write | Read main; create/update owned branch; verify SHA | Use available authorized connector; report the exact remaining blocker |
| Local runtime | Relevant executable/version only | Use existing CI for checks needing its runtime |
| Disposable E2E stack | Docker and pinned CLI, or existing CI job | Do not substitute shared DEV |
| VPS | Existing authorized SSH identity, bounded read-only connection | Read deployment evidence through GitHub; mark direct access unverified |
| External provider | Required configuration exists, without showing values | Continue independent work; identify only missing prerequisite |

Do not probe unrelated accounts, extract GitHub Actions secrets, disable host
verification, bypass approval controls, or install broad new access to remove a
blocker. One concrete failure plus one supported fallback is normally enough
for access diagnosis; do not spend the task trying equivalent failed paths.

## 3. Plan the smallest complete phase

- State the outcome, allowed files, excluded files and acceptance evidence.
- Separate independent reads and inspections; batch them where practical.
  Keep dependent changes, publication and deployment sequential.
- Prepare a concrete change and verify it before seeking any genuinely missing
  approval. Do not stop at a plan when implementation is already authorized.
- Commit/publish a coherent checkpoint before starting the next phase.
  Avoid a push for every prose correction: finish the small phase first.
- Send concise progress updates about findings, next action or blockers.
  During execution, avoid long silent waits and tight polling.

## 3A. Quota-aware execution — ALL D.A.O agents

**Permanent default for DEV 1/2/20, OPT, OPT 20, Back-office, Pilot and every
future agent.** Save Work quota by reducing repeated reasoning/tool calls,
not by weakening the quality or security gates. This protocol cannot set a
ChatGPT Work credit limit or guarantee quantified savings.

1. **Resume rather than restart.** Read the canonical owner issue, the last
   useful published checkpoint and exact remote HEAD/PR. Check actual main,
   open PR ownership and matching CI **once per coherent phase**, then again
   before publication/merge or after a genuine conflicting change. Don't
   reread entire history or repeat known setup without new evidence.
2. **Smallest useful context.** Start with root AGENTS.md, this protocol,
   the context index and the affected sections/code. Batch independent reads
   and search for a known file/symbol instead of opening entire large trees.
   Expand the review whenever business rules, Auth/RLS, privacy, finance,
   infra/root boundaries, cross-domain changes or uncertain decisions demand
   it. Context economy is **not** a permission to skip security review.
3. **One coherent phase at a time.** Complete a bounded outcome, run focused
   validation, push safe WIP with verified remote HEAD and publish **one short
   checkpoint** describing the delta, proof and next step. Avoid verbose
   repeated reports, frequent polling, duplicate screenshots and parallel
   exploratory tasks with no clear acceptance criterion.
4. **Reuse existing proof, not stale proof.** For unchanged code/inputs,
   reference the already green exact run/SHA. When code or relevant inputs
   change, execute focused tests and the **unchanged mandatory** CI including
   full E2E, fresh schema/integration, negative permissions and DEV deployment
   checks appropriate to the change. Investigate failures rather than using
   skips or rerunning the same failing attempt unchanged.
5. **Stop on a real blocker.** One useful failed capability check plus its
   supported fallback is normally enough. Save a durable checkpoint, do
   independent safe work, then surface only the essential permission/secret/
   product decision. Do not spin on identical Cloudflare/SSH/Auth errors.
   Never ask the owner to relay agent instructions or publish secrets.
6. **Finish rather than extend.** After all authorized acceptance evidence is
   collected, deliver a concise final report with verified links and mark
   gaps honestly. Do not add new features, speculative audits or repeated
   validation without a new mandate. A GitHub comment does not wake a Work
   session and no end-of-quota background-save hook is promised.

**Agent-specific applications:** DEV 2 #116 reuses the messaging schema and
delivers server permissions → Client/Artisan UI → final tests/CI/deploy.
OPT #115 resumes its existing UX checkpoints rather than repeating
authenticated routes. DEV 20 #58 doesn't retry the same rejected Cloudflare
token; OPT 20 #91/#112 doesn't reconstruct delivered OPS/profile work;
DEV 1 #61 awaits actual contract decisions instead of inventing them;
Back-office #64 reviews only new proven gaps; Pilot coordinates through
canonical GitHub checkpoints without unnecessary full builds. New agents
inherit these generic rules automatically, using their own issues and gates.

## 4. Validation proportional to change

| Change | Minimum useful verification |
| --- | --- |
| Documentation only | Review diff and scope; local links/paths; whitespace; consistency of SHA/run evidence |
| Shell/helper script | Syntax and targeted behavior, including failure propagation and cleanup |
| Workflow/cache/fixtures/Playwright | Relevant local checks when available; existing mandatory CI on final head; coverage comparison |
| DEV deployment tooling | Above plus manifest/release/rollback invariants; authorized real DEV deployment evidence after merge |

Do not rerun local build, full E2E or CI for an unchanged validated SHA and
unchanged relevant inputs merely to reassure yourself. Documentation alone
does not need a local app build. The current workflow still runs on PRs,
including documentation PRs: observe its automatic run once; do not manually
rerun it, add skip markers, or weaken required checks.

Proof is scoped to code SHA, tested merge SHA where applicable, workflow,
environment, dependencies, run and attempt. Rebase, relevant configuration
changes or a changed main can invalidate prior evidence. Never label old
green checks as green on a new head. Test discovery is not test execution;
PGlite is not real Auth/JWT/Storage integration.

On failure: read logs/artifacts, classify the cause, make the smallest certain
technical fix, verify and publish it. Preserve the D-023 bound: stop that
correction path if the same cause returns after two different corrections,
three consecutive runs fail in one functional area, or the cause is ambiguous.
A product/Auth/RLS/business fix belongs to WORK DEV; report evidence and
continue independent OPT work without changing their PR.

## 5. Coverage is a gate, not an optimization variable

Preserve all existing scenarios and useful assertions, desktop and mobile,
negative authorization checks, real integration, fresh migration/schema
proof, full reset/replay, target guards and immutable-history behavior.

Determine expected coverage from the current code and CI, not a stale fixed
number in this document. Preserve newly merged DEV tests when rebasing.
Do not remove tests, introduce skips, reduce viewports, add force clicks,
arbitrary sleeps/retries/timeouts, share mutable scenarios, or replace real
user/API behavior with privileged fixture shortcuts to improve timing.

CI TEST users/data remain scoped to run, attempt, viewport and worker, with a
project unique to each scenario. Privileged setup is limited to the existing
disposable test-provisioning boundary. Product commands keep real actor JWTs.
FULL E2E requires the exact local target `http://127.0.0.1:54321`.
Never run it against shared DEV or production; never delete immutable history.

Keep one fresh disposable stack with reset/replay. Keep E2E's local-config
frontend build separate from the DEV-configured artifact. Preserve the
existing measured optimizations and rejected experiments in DECISIONS.md.

## 6. Review, concurrency and merge

Before publishing: re-read main, check that only owned OPT files changed,
review overlaps with open DEV PRs, and confirm the remote checkpoint SHA.

Before any final merge: re-read main and own PR head; if main advanced, rebase
or recreate the owned branch, reconcile overlapping docs and new tests, then
obtain the required green checks on the updated candidate. Recheck freshness
immediately before merge. Use an exact-head precondition where supported;
otherwise stop on any detected race and repeat the verification.

Merge only within existing user authorization and repository protections.
Do not infer authorization to merge/deploy another Work's PR. A request to
prepare/analyze a phase can finish as a reviewable draft PR. Do not request
confirmation for reversible preparation already authorized.

## 7. DEV and VPS boundaries

A GitHub merge, successful deploy job, active service and successful HTTP
response are distinct observations; report only those actually verified.

**VPS execution rule:** routine D.A.O VPS work must run through the protected
GitHub Actions SSH path and fixed allowlisted operations. Do not ask the user
for repetitive terminal/SSH copy-paste commands. A direct root command is only
acceptable for an unavoidable one-time bootstrap/refresh of a reviewed
root-owned helper or sudoers entry when the existing GitHub identity cannot
perform that installation. Once bootstrapped, status, health, diagnostics,
OCE gateway plan and similar repeated operations return to GitHub Actions.
Never use this rule to widen sudo into an arbitrary shell or caller-controlled
command/path.

Preserve main-only deployment after all required validation succeeds, exact
revision and artifact-manifest checks, separate environment configuration,
versioned releases, atomic current-link switch and rollback. Never redeploy an
older revision over a newer active release. Coordinate any shared DEV restart
or deployment with current main/run state; do not interrupt WORK DEV validation.

Secrets stay outside Git and logs. Report only variable presence/absence and
safe metadata, never values or full env files. Preserve
`/etc/dao/dao-dev.env` ownership/mode `root:dao / 0640` when an authorized
configuration task requires editing it. Do not change Auth, migrations or RLS
as part of OPT work. Do not touch WireGuard or expose port 3000 publicly.

When direct SSH is unavailable but CI deployment works, report both facts.
Do not claim live VPS inspection from an old CI log. Do not rerun deployment
solely to test whether credentials exist.

## 8. Durable checkpoint and stop condition

All DEV/OPT sessions follow [WORK_CHECKPOINTS.md](WORK_CHECKPOINTS.md): publish
after each small meaningful phase and before a long check or planned pause,
including safe incomplete work on the owned branch with a draft PR. Record
the verified published HEAD and next action on the authorized owner issue.
There is no reliable Work crash/Stop/quota hook; only the last actually
published commit is recoverable from GitHub. Publication failure stays explicit.

Update only context documents **materially changed** by the work and link
the issue/branch/PR. Avoid duplicating long issue checkpoints in historical
CURRENT_STATE/NEXT_STEPS. Add genuine durable decisions to DECISIONS and
preserve every other owner's history.
Every checkpoint should record:

- verification timestamp/timezone; base main and owned head SHA;
- changed scope; completed work versus proposed experiments;
- checks actually run, exact run/attempt and outcome;
- coverage and measured timing, distinguishing PR from main and warm from cold;
- access limitations, remaining blockers and the exact next action.

The remote commit/PR is the durable checkpoint; local scratch is not enough.
On session recovery, read remote state and resume after the last verified
checkpoint. Do not repeat completed setup or tests without a specific reason.
The assigned OPT role does not imply a background scheduler: only claim work
actually executed in an active session or separately configured automation.


## 9. Keep the visual architecture model current

The living C4/Structurizr model is stored in:

```text
docs/architecture/workspace.dsl
```

Read [../architecture/README.md](../architecture/README.md) before changing it.

Update the model in the same PR whenever a change materially affects an actor,
major functional domain, external system/provider, runtime container,
structuring business flow, deployment topology, or authorization boundary.

Do not churn the model for local UI polish or implementation details that do
not alter architecture. Do not show planned capabilities as operational ones.
When a future capability becomes real, update the relevant current-state view
at the same checkpoint that makes the capability effective.

This is a mandatory maintenance rule for WORK DEV and WORK OPT: if their PR
changes architecture in one of the categories above, the same PR must update
`docs/architecture/workspace.dsl`. Do not defer that update to a later PR
unless the user explicitly separates the work.

After such a PR is merged to `main`, the `D.A.O Architecture Pages` workflow
must validate the Structurizr model, regenerate the static interactive site and
publish it automatically to GitHub Pages. A green Pages workflow is the expected
publication evidence for architecture changes.
