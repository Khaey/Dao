# Autonomie DEV V3

## Status

Prepared from main `1af71770eb660825e42fa1a2e9925276bb396a06` on
2026-10-03. Documentation/planning only; not merged while PR #10 DEV is open.

Verified prerequisite: DAO DEV operations #2 passed; **ENV-SYNC DEV = PASS**.

## Goal

Normal Work DEV operations should complete from the repository/CI control path
without Ahmed manually dispatching routine operations or handling secrets.

## V3-A — automatic normal-operation availability

- Keep operations fixed and main-only.
- Make normal deployment prerequisites callable from the deployment pipeline or
  a reviewed reusable workflow/composite action.
- Preserve DEV concurrency, host deployment lock, stale-main checks, readiness
  and rollback.
- Never accept arbitrary shell, path, secret or environment values as inputs.

## V3-B — automatic env-sync during DEV deployment

- Reuse protected GitHub `dev` environment secrets; never write secrets to
  artifacts or logs.
- Run env-sync only in the serialized DEV deployment path, before restart and
  readiness validation.
- Keep payload private/ephemeral; preserve remote `0600` and root:dao
  `0640` for `/etc/dao/dao-dev.env`.
- On readiness failure, restore the previous environment and release.
- Prove idempotence and verify only non-secret effective configuration.

## V3-C — permanent TEST DEV accounts

- Provision one TEST client and one TEST contractor through standard Auth
  administration once the protected credential channel exists.
- Keep contractor verification `pending`; store credentials only in protected
  secrets and only IDs/labels in an access-controlled manifest.
- Extend `reset-dev-fixtures.sh` only for explicitly owned scenario data.
- FULL E2E remains disposable and isolated from shared DEV.

## V3-D — no routine human intervention

- Provide automatic status/health checks and bounded recovery.
- Keep manual dispatch only as emergency/operator override.
- Emit redacted summaries and actionable failures, never credentials.
- Stop for product decisions, structural security changes, data-loss risk,
  external secret access or missing authorization.

## Merge gate

After PR #10 merges and DEV is validated, recover the new main, reconcile this
branch with all DEV changes, run targeted validation and CI, then merge one V3
phase at a time.
