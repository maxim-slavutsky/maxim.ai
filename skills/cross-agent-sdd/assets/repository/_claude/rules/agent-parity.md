---
name: Agent parity
description: Editing a rule, skill, hook config, or canonical workflow: the partner files of every enabled harness change in the same commit; regenerate the Cursor mirrors after a rule edit.
type: feedback
paths:
  - ".claude/**"
  - ".codex/**"
  - ".cursor/**"
  - ".agents/**"
  - "scripts/hooks/**"
  - "docs/workflows/**"
---

# Agent parity

Adapter, path matching only (`.claude/**`, `.codex/**`, `.cursor/**`, `.agents/**`, `scripts/hooks/**`,
`docs/workflows/**`). The partner rules, the **why**, and the **how to apply** live in the
[canonical agent parity workflow](../../docs/workflows/AGENT-PARITY-WORKFLOW.md). Read it completely before editing.
Do not duplicate or override shared policy here.
