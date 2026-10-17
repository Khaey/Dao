---
name: dao-performance
description: Improve D.A.O. frontend performance by measuring a reproducible baseline and validating a scoped optimization.
---

1. Choose an unowned frontend path or coordinate with its canonical owner first.
2. Capture the original main SHA, timings/build-size or reliable metric under specified environment and cache conditions.
3. Apply the smallest measurable optimization without altering product behaviour, permissions or accessibility.
4. Run focused tests and required CI; compare same metric and state limits due to runner/environment variation.
5. Keep only demonstrated changes, publish before/after numbers and a concise PR checkpoint; no repeated runs of identical inputs.
