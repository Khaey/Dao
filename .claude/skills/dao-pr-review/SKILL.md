---
name: dao-pr-review
description: Review an assigned D.A.O. PR independently for security, tests, ownership and safe merging.
---

1. Verify live main, exact PR HEAD and diff; inspect overlap with other agent branches.
2. Evaluate Auth/RLS, private data, release secrets, migrations, permissions and OPS impacts proportional to change.
3. Check all required status checks on the **exact** candidate SHA and whether a review is mandatory; do not confuse draft with ready.
4. If safety and scope gates allow a routine own-PR merge, execute and verify post-merge CI; otherwise name the exact blocking condition and review owner.
5. Report APPROVE/BLOCK with proof, without reproducing secrets or repeating CI for an unchanged SHA.
