---
name: Runtime application config parity
description: Propagate runtime config shape changes through every maintained surface.
type: feedback
paths:
  - "**/config/**"
  - "**/configs/**"
  - "**/chart/**"
  - "**/values*.yaml"
  - "**/values*.yml"
---

Read [canonical application config workflow](../../docs/workflows/APP-CONFIG-WORKFLOW.md) before editing. This file
owns Claude path matching only; do not duplicate shared policy here.
