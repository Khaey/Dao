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

Use **DAO DEV operations**, `workflow_dispatch`, **main only**:

| Operation | Behavior | Available prerequisite |
| --- | --- | --- |
| status | Service state, exact release name, helper presence, selected env key presence | Existing Actions SSH secret and deployed scripts |
| health | Read-only local HTTP smoke | Existing Actions SSH secret |
| restart | Restart only dao-dev.service, then smoke/status | Existing dao service sudoers |
| env-sync | Update three email configuration keys from dev environment secrets, restart, smoke; restore previous env on smoke failure after a change | One-time admin helper installation plus Resend secrets |
| log-summary | Last hour priority counts, at most 200 journal entries; no message bodies | One-time admin helper installation |

Example with a credential authorized for Actions dispatch:

```bash
gh workflow run dev-operations.yml --repo Khaey/Dao --ref main -f operation=status
```

The GitHub connector used by Work can inspect runs/logs but may not expose
dispatch. Use an authorized Actions-capable CLI/API or GitHub Actions UI in
that case. Do not claim dispatch occurred when only the workflow was committed.
No shell Work SSH key is required. SSH remains between GitHub's runner and VPS;
this removes dependence on the Work shell network, not on SSH altogether.

`DEV_SSH_KEY` remains in GitHub's protected dev environment, never downloaded
into Work. The workflow uses the existing dao account/SSH mechanism. It does
not run untrusted PR code or take arbitrary commands/paths. Secrets are never
workflow inputs. Env sync uses a mode-0600 JSON transfer, never an artifact;
normal execution deletes both copies. A network failure after transfer can
leave the private payload under `/opt/dao/ops-incoming/<run>-<attempt>`; remove
that exact private file during recovery before repeating a sync.

### One-time environment administration setup

Existing sudoers only allow service operations, so GitHub's deployment key
cannot install a new privileged helper or edit root-owned env by itself.
From a reviewed main release, a root-capable operator runs once:

```bash
bash /opt/dao/current/ops/install-dev-admin.sh
```

The installer keeps existing sudoers, installs a root-owned isolated Python
helper, and adds only its fixed environment/diagnostic commands. No generic
sudo shell, arbitrary root file write, Auth setting or RLS change is exposed.
The environment and backup stay root:dao / 0640; the directory is root-owned.
The helper uses a file lock, validates allowed keys, refuses duplicates and
multiline assignments for updated keys, and atomically replaces the file.

For email configuration sync, define `RESEND_API_KEY` and `DAO_EMAIL_FROM` as
dev environment secrets. The workflow fixes DAO_PUBLIC_URL to the DEV URL.
It preserves existing database/Auth keys and does not send a test email.
The protected backup supports rollback. A reverted invalid secret also needs
correction in GitHub before retry; env sync does not rotate provider secrets.

Raw application logs may contain tokens/user data, so they are not copied to
public Actions logs. The workflow exposes counts only. Detailed log review
remains a private operator session or a future private, redacted log channel.
This helper installation and new secrets cannot be inferred from successful
deployment; verify their presence explicitly with the status operation.

## Permanent TEST accounts and fixture reset — studied, not provisioned

Permanent DEV TEST accounts are permitted for repeated targeted validation,
separate from worker-scoped disposable CI users. Use dedicated client A/B,
contractor A/B and reviewer accounts through standard Auth administration;
store credentials in the protected dev environment and exact user IDs in a
private manifest. Never expose internal roles in public signup or change RLS.

No exact permanent account IDs/credentials were available in this phase.
No accounts have been created and no existing users relabeled. Default reset
should rotate a scenario namespace and create fresh fixtures via normal APIs;
retain permanent accounts and immutable submitted histories. A later cleanup
must use explicit owned-resource IDs and existing allowed lifecycle actions.

`bash scripts/reset-dev-fixtures.sh --plan` prints that contract only; any
other mode fails without data access. It is deliberately not a working DB
reset. FULL E2E still uses the disposable stack, never shared DEV.

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
