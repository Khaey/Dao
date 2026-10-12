# D.A.O — AI context entry point

Start with the owner issue's latest meaningful checkpoint, root `AGENTS.md`,
`AUTONOMOUS_EXECUTION.md` and this index. Read **task-relevant** documents
and code sections at verified remote main, not every long historical file by
default. Read all applicable invariants and decisions before product business
rules, Auth/RLS, collaboration, finance or infrastructure permissions change.
Re-read relevant context if main changes; do not bypass security using a
narrow scope. Current user scope and live GitHub/CI evidence supersede
historical checkpoints.

| File | Purpose |
| --- | --- |
| [AUTONOMOUS_EXECUTION.md](AUTONOMOUS_EXECUTION.md) | WORK OPT / WORK DEV ownership, FAST execution, validation, concurrency and VPS rules |
| [WORK_CHECKPOINTS.md](WORK_CHECKPOINTS.md) | Common DEV/OPT WIP publication, owner-issue template, crash/quota recovery and short Work startup message (#87) |
| [CURRENT_STATE.md](CURRENT_STATE.md) | Latest dated verified snapshot followed by historical evidence |
| [NEXT_STEPS.md](NEXT_STEPS.md) | Current OPT next actions and clearly marked historical DEV checkpoint |
| [OPTIMIZATION_BACKLOG.md](OPTIMIZATION_BACKLOG.md) | Measured baseline and ranked technical experiments; no implementation claim |
| [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) | Product overview, repository and source-of-truth order |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Architecture and technical invariants; older counts must be checked against CI |
| [BUSINESS_RULES.md](BUSINESS_RULES.md) | Protected product/business constraints |
| [COLLABORATION_DESIGN.md](COLLABORATION_DESIGN.md) | Collaborative chantier decisions and authorization model |
| [DECISIONS.md](DECISIONS.md) | Durable decisions, including completed and rejected optimizations |
| [../architecture/README.md](../architecture/README.md) | Living C4/Structurizr visual architecture and maintenance workflow |

For a new task, WORK OPT starts from main on its own `chore/...` branch; for
same-task recovery, verify and resume the owned published branch as described
in WORK_CHECKPOINTS.md. It never resumes
a functional branch named in an old checkpoint and never changes WORK DEV PRs.
Do not treat historical headings such as “remaining” as current instructions
without checking their dated status and the actual remote repository.

Operational entry points: root [AGENTS.md](../../AGENTS.md),
[platform operations](../platform-operations.md), and
`bash scripts/dao-task-check.sh` from a verified checkout.
For the common fixed operations, agent matrix, root release admission and
bootstrap limits, read [OPS control](../ops-control.md). The live #91 checkpoint
distinguishes prepared code from installed permissions.
