---
name: Agent parity
description: Use when editing a rule, skill, hook config or concern doc of a coding agent. The partner files of every enabled agent change in the same commit. Regenerate the Cursor copies after a rule edit.
paths:
  - ".claude/**"
  - ".codex/**"
  - ".cursor/**"
  - ".agents/**"
---

# Agent parity

The partner rules in full: [agent parity](../../docs/agent-parity.md).

- **Keep an adapter a pointer to its source**, because no gate can tell that two texts mean the same.
- **Name a rule or skill by its scope, not by an incident**, so the next reader finds it by guessing.
- **Make a path-scoped constraint a rule and a procedure someone starts a skill**, and let the skill link the rules it applies.
- **Change the partner files in the same commit before you reach for a trailer**: the partner table is in the concern doc.
