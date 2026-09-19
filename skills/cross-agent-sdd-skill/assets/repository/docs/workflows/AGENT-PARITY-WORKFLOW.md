# Agent parity workflow

Claude Code, Codex, and Cursor form one repository toolchain. A change to one enabled harness's rules, skills,
hooks, or docs includes its partners in the same change.

Adapters:

- [Claude Code rule](../../.claude/rules/agent-parity.md)
- [Claude Code skill](../../.claude/skills/agent-parity/SKILL.md)
- [Codex/Cursor skill](../../.agents/skills/agent-parity/SKILL.md)
- [Cursor rule](../../.cursor/rules/agent-parity.mdc)

## Model

| Surface | Source of truth | Harness adapters |
|---|---|---|
| Policy | `docs/workflows/*.md`, root/nested `AGENTS.md` | Link only |
| Skill | Canonical workflow | `.claude/skills`, `.agents/skills` |
| Path rule | Canonical workflow | `.claude/rules`, generated `.cursor/rules` |
| Hook logic | `scripts/hooks/*.mjs` | Three native JSON configs |
| Enforcement | `scripts/check-sdd.mjs` | Git hook + CI invocation |

## Partner rules

1. `.claude/skills/<name>` and `.agents/skills/<name>` move together.
2. `.claude/rules/<name>.md` and `.cursor/rules/<name>.mdc` move together.
3. Hook script change includes every enabled harness config.
4. Adapter links one canonical workflow; workflow links every adapter.
5. Native-only metadata stays native and records a concrete parity exception when changed alone.
6. Post-edit hooks are reminders, not pre-edit policy enforcement.

Run `node scripts/check-sdd.mjs` before handoff. A green shape check cannot prove adapter prose has matching
semantics, so keep adapters thin.
