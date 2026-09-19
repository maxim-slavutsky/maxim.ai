# Harness matrix

Read before creating or editing agent-specific files.

| Concern | Canonical owner | Claude Code | Codex | Cursor |
|---|---|---|---|---|
| Standing repository policy | root/nested `AGENTS.md` | `CLAUDE.md` imports root policy | native | native |
| Invocable workflow | `docs/workflows/*.md` | thin `.claude/skills` adapter | thin `.agents/skills` adapter + `agents/openai.yaml` | loads `.agents/skills` |
| Path-scoped rule | `docs/workflows/*.md` | `.claude/rules/*.md` (tool-neutral body, source) | `AGENTS.md` + `.agents/skills` adapter description | generated `.cursor/rules/*.mdc` |
| Post-edit reminder | `scripts/hooks/post-edit-reminder.mjs` | `.claude/settings.json` | `.codex/hooks.json` | `.cursor/hooks.json` (`--cursor`) |
| Enforcement | `scripts/check-sdd.mjs` | Git hooks + CI | Git hooks + CI | Git hooks + CI |

## Partner rules

- `.claude/skills/<name>` and `.agents/skills/<name>` move together.
- `.claude/rules/<name>.md` and generated `.cursor/rules/<name>.mdc` move together; regenerate with
  `node scripts/gen-cursor-rules.mjs`, never hand-edit `.mdc`.
- Path-scoped concern gets a Claude rule, not a Claude skill; invocable workflow gets a skill on both sides.
  The gate accepts either `.claude/skills/<name>` or `.claude/rules/<name>.md` as the Claude counterpart of
  `.agents/skills/<name>`.
- Every `.agents/skills/<name>` carries `agents/openai.yaml`.
- One hook script; all enabled harness configs invoke it. Only the Cursor command passes `--cursor`.
- Every adapter links exactly one canonical workflow; canonical workflow lists its adapters (gate checks both
  directions).
- `agents/openai.yaml` is Codex/OpenAI display metadata, not canonical policy.
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
- copied gate semantics;
- harness names inside `.claude/rules` bodies (the generator copies them into Cursor verbatim).
