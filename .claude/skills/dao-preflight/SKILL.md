---
name: dao-preflight
description: Prepare a D.A.O. coding task by checking exact main, owner issue, CI and concurrent PRs with minimal quota.
---

1. Read `AGENTS.md`, `CLAUDE.md`, your assigned issue and latest meaningful checkpoint.
2. Get remote `main` SHA, main CI/deploy status and open PRs touching the target files; do not assume an old SHA is current.
3. If local checkout exists, run `bash scripts/dao-task-check.sh` for bounded non-mutating preflight.
4. Identify allowed files, forbidden owner boundaries, expected tests, safety gates and the smallest complete change.
5. Continue implementation immediately when already authorized; ask only for a genuinely missing sensitive decision. Do not rerun an unchanged green check.
