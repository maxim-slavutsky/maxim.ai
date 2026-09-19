# Harness matrix

Read before creating or editing agent-specific files.

| Concern | Canonical owner | Claude Code | Codex | Cursor |
|---|---|---|---|---|
| Standing repository policy | root/nested `AGENTS.md` | `CLAUDE.md` imports root policy | native | native |
| Reusable workflow | `docs/workflows/*.md` | thin `.claude/skills` adapter | thin `.agents/skills` adapter | loads `.agents/skills` |
| Path-scoped rule | canonical workflow | `.claude/rules/*.md` | `AGENTS.md` + skill description | generated `.cursor/rules/*.mdc` |
| Post-edit reminder | `scripts/hooks/post-edit-reminder.mjs` | `.claude/settings.json` | `.codex/hooks.json` | `.cursor/hooks.json` |
| Enforcement | `scripts/check-sdd.mjs` | Git hooks + CI | Git hooks + CI | Git hooks + CI |

## Partner rules

- `.claude/skills/<name>` and `.agents/skills/<name>` move together.
- `.claude/rules/<name>.md` and `.cursor/rules/<name>.mdc` move together.
- One hook script; all enabled harness configs invoke it.
- Every adapter links exactly one canonical workflow; canonical workflow lists its adapters.
- `agents/openai.yaml` is optional Codex/OpenAI metadata, not canonical policy.
- One-sided native metadata needs an explicit, concrete parity exception in change log/commit message.

Cursor can load `.agents/skills`; do not create `.cursor/skills` duplicates for repository-local skills. A personal
copy under `~/.cursor/skills` is useful only when Cursor Cloud skill sync is explicitly required.

## Adapter boundary

Allowed adapter content:

- trigger/description/frontmatter;
- native path scoping;
- how this harness discovers root/nested instructions;
- link to canonical workflow;
- native invocation detail that cannot be expressed canonically.

Forbidden adapter content:

- repeated workflow steps;
- independent policy exceptions;
- repository behavior contracts;
- copied gate semantics.
