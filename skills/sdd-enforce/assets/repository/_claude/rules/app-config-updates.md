---
name: Runtime application config parity
description: Adding, removing, or renaming a runtime config key: update every surface (validator, local and shipped copies, test fixtures, chart config, values placeholders, typed reader, owning SPEC) in the same change.
type: feedback
paths:
  - "**/config/**"
  - "**/configs/**"
  - "**/chart/**"
  - "**/values*.yaml"
  - "**/values*.yml"
---

# Runtime application config parity

Adapter, path matching only (`**/config/**`, `**/configs/**`, `**/chart/**`, `**/values*.yaml`, `**/values*.yml`).
The surfaces, the **why**, and the **how to apply** live in the
[canonical application config workflow](../../docs/workflows/APP-CONFIG-WORKFLOW.md). Read it before editing. Do not
duplicate shared policy here.
