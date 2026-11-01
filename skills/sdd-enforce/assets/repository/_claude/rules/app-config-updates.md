---
name: Runtime application config parity
description: Adding, removing, or renaming a runtime config key: update every surface (validator, local and shipped copies, test fixtures, chart config, values placeholders, typed reader, doc of record) in the same change.
type: feedback
paths:
  - "**/config/**"
  - "**/configs/**"
  - "**/chart/**"
  - "**/values*.yaml"
  - "**/values*.yml"
---

# Runtime application config parity

The surfaces and the procedure in full: [application config](../../docs/app-config.md).

- **Change every surface in the same commit when a key is added, removed or renamed**, because a missed copy fails only in one environment.
- **Update the test fixtures with the validator**, because the e2e module fails at load time without them.
- **Keep secrets as placeholders in tracked files**, because a committed secret leaks.
- **Search for an old key name until it is gone everywhere** before you report the rename as done.
