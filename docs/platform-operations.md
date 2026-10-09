# D.A.O platform operations

## Work startup and targeted validation

Repository-root `AGENTS.md` directs Work/Codex agents that load repository
instructions to the execution protocol and AI context. It cannot control a
client that never opens the repository; that client must read AGENTS.md first.

`bash scripts/dao-task-check.sh` is a read-only, bounded preflight. It reports
official repo identity, local branch/head, actual remote main, changed files,
available tools and suggested checks. With authenticated `gh`, it also reads
latest main CI and open PRs. Missing evidence remains explicitly unverified;
exit 3 means remote main could not be verified, not permission to assume it.
`--offline` never contacts GitHub and deliberately returns that same code.
Use the authenticated connector if shell networking or gh credentials fail.

Suggested tests depend on changed paths. They do not remove any mandatory CI
gate. Docs-only changes need no local application build; CI still runs its
existing complete suite. Product changes keep all existing security and E2E
coverage. Reconcile new tests merged by WORK DEV before publishing/merging.

## DEV smoke and deployment reliability

`bash scripts/validate-dev.sh` defaults to https://dao-dev.logiclab.fr.
The only other permitted target is http://127.0.0.1:3000. It checks login,
register and forgot-password HTML and Next.js asset references without
credentials, form submission, email or business mutation. Retries are bounded
readiness polling, not Playwright assertion retries. Response bodies are never
printed. This proves HTTP readiness only, not authenticated user journeys.

Deployment keeps verified CI artifacts and all existing build/environment
checks. It now holds a host flock, refuses activation when remote main has
advanced, and runs local HTTP smoke while automatic rollback is still armed.
Failure after switching restores the previous release; initial deployment
without a previous release retains the existing failure behavior.

PR runs cancel obsolete runs of the same PR. Main runs are not interrupted;
the deploy job and DEV operations share `dao-dev-operations` concurrency with
cancel-in-progress false. GitHub concurrency is not a FIFO queue: a newer
pending job can replace a pending job. The stale-revision check prevents an
older queued revision from deliberately replacing current main. A main update
in the tiny interval after the check is handled by the following serialized
deployment; this is not a claim of an atomic GitHub-to-VPS transaction.

## Stable control through GitHub Actions

The common interface for every DEV/OPT/Pilot is documented in
[OPS control](ops-control.md), including exact owner-comment signals on #91,
the role/operation/precondition/proof matrix and versioned root maintenance.
Existing workflows and qualified backups/restores remain valid. Root OPS
bootstrap from PR #96 is now installed and confirmed by live Actions #16/#17
on 2026-10-09; do not repeat it. Read OPS control for the exact maintenance
proofs of the qualified code rollback. A merge alone is not installation.

The common workflow transports its four fixed non-root scripts from the main
checkout into a run/attempt-scoped directory, independently of
`/opt/dao/current`. Installed helper diagnostics/recovery stay reachable when
that release link is missing or broken; this does not restore application
releases or data. The existing root permissions, secrets and host lock remain
unchanged. See OPS control for transport cleanup and qualification evidence.

### VPS operations policy

For D.A.O, **all routine VPS operations must transit through GitHub Actions**.
Do not ask the operator to copy/paste SSH commands from chat for status,
health, diagnostics, OCE checks, restart or other bounded platform operations.
A direct root shell is reserved only for a genuinely unavoidable **one-time
bootstrap** that installs or refreshes the reviewed root helper/sudoers. After
that bootstrap, repeated execution must return to the protected GitHub Actions
SSH identity and fixed allowlisted operations.

Every successful main deployment performs the normal DEV health/status checks
and, once the bounded root grant is installed, also runs the read-only
`oce-gateway-plan`. If that one-time grant has not yet been installed, the
deployment reports `{"oce_gateway_plan":"bootstrap_required"}` rather than
requesting broader runner privileges.

For an immediate on-demand gateway plan without a VPS terminal or an external
workflow-dispatch tool, the repo owner can post the **entire exact comment**
`/dao-ops oce-gateway-plan` on **issue #58**. The dedicated
`DAO VPS OCE read-only plan` workflow accepts only newly created comments
from GitHub actor `Khaey` on that numbered issue; it uses the existing
protected `dev` SSH identity and fixed root allowlist to run only
`dao-dev-admin oce-gateway-plan`. Comment content is a strict signal and
is never passed as a shell argument. All other actors, issue numbers,
pull requests and comment texts are skipped. The resulting sanitized plan
is visible in GitHub Actions; it never starts a service or closes the OCE
public demo URL. This trigger is **not** an approval to execute
`dao-oce-gateway-host apply`.

Use **DAO DEV operations**, `workflow_dispatch`, **main only**:

| Operation | Behavior | Available prerequisite |
| --- | --- | --- |
| status | Service state, exact release name, helper presence, selected env key presence | Existing Actions SSH secret and fixed main scripts |
| health | Read-only local HTTP smoke | Existing Actions SSH secret |
| restart | Restart only dao-dev.service, then smoke/status | Existing dao service sudoers |
| env-sync | Manual recovery operation; normal main deploys now run the same three-key sync automatically before release activation | One-time admin helper installation plus Resend secrets |
| log-summary | Last hour priority counts, at most 200 journal entries; no message bodies | One-time admin helper installation |
| oce-audit | Private Access/Tunnel audit through dao-oce-private-admin; the existing runtime audit remains in its specialized workflow | Installed private helper and provisioning #58 |
| oce-integration-inventory | Fixed OCE DB/Compose/storage/network metadata for #58; anonymous peers and no credential/path values | Reinstall reviewed admin helper once as root; available in DAO DEV operations on main |
| oce-gateway-plan | Fixed read-only gateway host plan; no service start, bind change or demo-access change | One-time reviewed admin-helper refresh grants this exact operation; then GitHub Actions only |

Example with a credential authorized for Actions dispatch:

```bash
gh workflow run dev-operations.yml --repo Khaey/Dao --ref main -f operation=status
```

The GitHub connector used by Work can inspect runs/logs but may not expose
dispatch. Use the exact owner comment `/dao-ops <operation>` on #91 for the
common workflow, or an authorized Actions-capable CLI/API or Actions UI.
Do not claim execution occurred when only the workflow/comment was published.
No shell Work SSH key is required. SSH remains between GitHub's runner and VPS;
this removes dependence on the Work shell network, not on SSH altogether.

`DEV_SSH_KEY` remains in GitHub's protected dev environment, never downloaded
into Work. The workflow uses the existing dao account/SSH mechanism. It does
not run untrusted PR code or take arbitrary commands/paths. Secrets are never
workflow inputs. Env sync uses a mode-0600 JSON transfer, never an artifact;
normal execution deletes both copies. A network failure after transfer can
leave the private payload under `/opt/dao/ops-incoming/<run>-<attempt>`; remove
that exact private file during recovery before repeating a sync.

### Environment administration setup

The OCE V1 inventory and the approved gateway qualification gates are documented
in [OCE integration operations](oce-integration-operations.md). The inventory
does not provision the gateway or perform a backup/pin/restore. The older
`oce-audit` operation is invoked by the separate OCE audit workflow, not the
DEV operations dropdown; completed audit #45 must not be repeated.

The initial DEV admin bootstrap is complete. Its original installation path
was `ops/install-dev-admin.sh`. For future code updates, use the admitted root
maintenance interface after its one-time OPS bootstrap rather than repeated
installer commands. A new sudoers grant remains an explicit trust change and
is not installed by a code upgrade. The operator originally confirmed:
`D.A.O admin helper installed; environment values and service unchanged.`
Therefore `/usr/local/sbin/dao-dev-admin` is installed, root-owned and
available to the main-only DAO DEV operations workflow. `env-sync` remains
limited to the fixed allowed keys, atomic root:dao / 0640 replacement and
protected rollback. No generic root shell, arbitrary path write, Auth setting
or RLS change is exposed.

For email configuration sync, define `RESEND_API_KEY` and `DAO_EMAIL_FROM`
as dev environment secrets. The workflow fixes `DAO_PUBLIC_URL` to the DEV
URL. The normal main-only `deploy-dev` job creates a private, run-scoped JSON
payload from those protected secrets, transfers it outside the build artifact,
and deletes it from the runner and VPS in `always()` cleanup paths. The runner
stages it at `ops-incoming/<run>-<attempt>/dao-env.json`. One pinned SCP action
uploads this file together with the unchanged package to `/opt/dao`, retaining
both relative paths; the JSON is never an uploaded GitHub build artifact.
This is one SCP action/upload, not a guarantee of one TCP/SSH session inside
the third-party action. See [issue #85](https://github.com/Khaey/Dao/issues/85)
for before/after timing and deployment evidence. The runner
temporarily changes only the payload's mode to `0644` for the pinned SCP
container, with traversable staging directories; the VPS payload is changed
to `0600` before root-helper consumption.
The deploy script invokes the installed helper under the existing host lock,
after stale-main validation and before release activation. The helper preserves
all non-managed keys and atomically keeps `/etc/dao/dao-dev.env` at `root:dao /
0640`. If service readiness fails after a changed sync, the deploy rollback
restores both the previous release and the previous environment, then restarts
the service with the restored values. Manual `DAO DEV operations` `env-sync`
remains available as a recovery path and does not send a test email.

Raw application logs may contain tokens/user data, so they are not copied to public Actions logs. Detailed log review
remains a private operator session or a future private, redacted log channel.
The helper installation is verified by the operator; use the status operation
to confirm it on a future VPS change.

## Permanent TEST accounts and fixture reset

Permanent DEV TEST accounts remain separate from worker-scoped disposable CI
users. The protected `dev` Environment supplies the two credential pairs to
the dedicated `DAO DEV TEST fixtures` workflow; values never enter Git,
documentation, workflow inputs, logs or artifacts.

Approved identities:

- client: `ahmedhattab.pro+dao-client@gmail.com`;
- contractor: `ahmedhattab.pro+dao-contractor@gmail.com`;
- controlled mailbox: `ahmedhattab.pro@gmail.com` (Gmail plus aliases).

The workflow operations are:

```text
provision      reconcile Auth users, roles and profiles
verify         real password login for both users + contractor pending/draft
reset          archive TEST-owned projects + revoke TEST-owned pending invites
mailbox-smoke  send a real Resend marker to the contractor alias
```

The fixture script refuses every target except the protected DEV Supabase URL.
The reset path resolves the two users by the protected aliases, selects only
projects where either `client_id` or `initiator_id` matches them, and never
deletes accounts, memberships, documents, Storage objects, submitted offers or
immutable audit history. The contractor remains
`verification_status=pending` / `public_identity_status=draft`.

Run `bash scripts/reset-dev-fixtures.sh --plan` for a no-op description. The
mutating `--apply` path is intended for the protected workflow or an equally
authorized DEV environment only. FULL E2E continues to use the disposable
local stack and never shared DEV.

## Next performance experiments — studied, not enabled

- Four workers before sharding: main's measured browser segment is ~101 s.
  Audit shared state and run comparable coverage before retaining a change.
- Sharding duplicates stack setup (~70 s plus reset ~29 s) per runner; evaluate
  elapsed time and total runner cost. Preserve fresh/reset proof and both
  viewports. Do not shard onto a shared DEV database.
- Chromium cache: prior measured gain was only ~3 s; D-028 remains in effect.
  Supabase image caching needs cold/warm pull/restore measurements; never
  cache a prepopulated database in place of migration/reset coverage.
- Keep the existing single DEV artifact; E2E's differently configured build
  cannot replace it. General Next.js fallback key correction remains separate
  because it is off the present critical path.

References: [GitHub concurrency](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency),
[manual workflow dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[Playwright sharding](https://playwright.dev/docs/test-sharding).

## Préparation démo privée Cloudflare — DEV 3, #58

Voir [le runbook dédié](oce-cloudflare-private-demo.md) : Access OTP sur
`oce-demo.logiclab.fr`, liste exacte d'e-mails, Tunnel avec validation JWT,
helper root borné et workflow protégé. Préparation seulement ; aucune
activation constatée, aucun changement de `:8080` ni `gateway-host apply`.
La configuration Cloudflare, le bootstrap root et la recette authentifiée
restent les prochains prérequis ; ils ne sont pas réputés exécutés.
