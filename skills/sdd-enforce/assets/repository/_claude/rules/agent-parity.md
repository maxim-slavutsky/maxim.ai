---
name: Agent parity
description: Editing a rule, skill, hook config, or concern doc of a coding agent: the partner files of every enabled agent change in the same commit; regenerate the Cursor copies after a rule edit.
type: feedback
paths:
  - ".claude/**"
  - ".codex/**"
  - ".cursor/**"
  - ".agents/**"
---

# Agent parity

The partner rules in full: [agent parity](../../docs/agent-parity.md).

- **Run `node scripts/gen-cursor-rules.mjs` after a rule edit and commit both files**, because the gate rejects a stale `.mdc`.
- **Give every new rule or skill its `.agents/skills/<name>/` adapter with `agents/openai.yaml`**, so Codex and Cursor find it.
- **Change all enabled hook configs together**, because each agent must run the same reminder.
- **Add `Agent-Parity: none - <reason>` when one side changes alone**, naming each file.
