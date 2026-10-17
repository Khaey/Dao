---
name: dao-e2e
description: Diagnose and optimize D.A.O. E2E tests and CI without weakening checks, isolation or coverage.
---

1. Read existing E2E history #85 and current exact main workflow before experiments.
2. Measure a real bottleneck and preserve every existing scenario, desktop/mobile viewport, negative permission check, schema/replay and Supabase integration.
3. Use only a disposable local E2E stack, **never** shared DEV or production; isolate tests per run/worker.
4. No skips, force-clicks, artificial waits, reduced coverage, privileged fixture shortcuts or disabling CI gates for speed.
5. Make one bounded experiment, validate against exact SHA and publish measurable improvement or revert with reason.
