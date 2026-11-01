# Harness matrix

Read before creating or editing agent-specific files.

| Concern | Canonical owner | Claude Code | Codex | Cursor |
|---|---|---|---|---|
| Standing repository policy | root/nested `AGENTS.md` | reads `AGENTS.md`; never ship `CLAUDE.md` (it hides every `AGENTS.md`) | native | native |
| Procedure (skill) | `.claude/skills/<name>/SKILL.md` (holds the steps) | native | `.agents/skills/<name>/SKILL.md` twin that links it + `agents/openai.yaml` | loads `.agents/skills` |
| Path-scoped rule | concern doc `docs/<concern>.md` | `.claude/rules/<name>.md` (tool-neutral body, source of the Cursor copy) | `.agents/skills/<name>` adapter that links the same concern doc | generated `.cursor/rules/<name>.mdc` |
| Rule index | Rules index table in `docs/agent-parity.md` | same file | same file | same file |
| Docs map rows | `sdd-enforce` block in `docs/map.md` | same file | same file | same file |
| Post-edit reminder | `.claude/hooks/post-edit-reminder.mjs` | `.claude/settings.json` | `.codex/hooks.json` | `.cursor/hooks.json` (`--cursor`) |
| Enforcement | `scripts/check-docs.mjs` + `scripts/check-sdd.mjs` (shared `scripts/sdd-lib.mjs`) | Git hooks (`.husky/` or `.pre-commit-config.yaml`) + CI | same | same |

## Partner rules

- `.claude/skills/<name>` holds the steps; the `.agents/skills/<name>` twin links it and copies none. Either side
  may change alone: no partner needed.
- `.claude/rules/<name>.md` and generated `.cursor/rules/<name>.mdc` move together; regenerate with
  `node scripts/gen-cursor-rules.mjs`, never hand-edit `.mdc`.
- The `.agents/skills/<name>` adapter of a rule links the same concern doc as `.claude/rules/<name>.md`.
- Path-scoped concern gets a Claude rule, not a Claude skill; a procedure someone starts gets a skill. The gate
  accepts either `.claude/skills/<name>` or `.claude/rules/<name>.md` as the Claude counterpart of
  `.agents/skills/<name>`.
- Every `.agents/skills/<name>` carries `agents/openai.yaml` (gate checks when Codex is enabled).
- One hook script; all enabled harness configs invoke it. Only the Cursor command passes `--cursor`. The
  three configs move together (a changed config is never its own partner); the script may change alone.
- The gates skip `.claude/skills/sdd-enforce`, `.agents/skills/sdd-enforce`, and `.cursor/skills/sdd-enforce`
  (this skill installed in-repo, also under the former name `cross-agent-sdd`), and `.claude/worktrees` (Claude
  Code worktrees, full repository copies). Other tool skills installed in-repo go into `exclude` in
  `.agent-sdd/config.json`.
- Adding, removing, or renaming a rule updates the Rules index in `docs/agent-parity.md` in the same change. Keep
  `.claude/rules` for rules only: a file there without `paths` loads in every Claude Code session. The gates still
  skip a legacy `.claude/rules/INDEX.md` (no mirror, no partner) until it is deleted.
- Every rule links exactly one concern doc; that concern doc links the rule back (gate checks both directions). A
  back-link to `.claude/rules/<name>.md` also covers its generated `.cursor/rules/<name>.mdc`.
- Every rule `paths:` glob matches a file (`check-docs`). Apply drops dead globs and skips a rule with none.
- Skill `name` = folder name, `description` at most 1,024 characters, `SKILL.md` under 500 lines (`check-docs`).
- `agents/openai.yaml` is Codex/OpenAI display metadata, not canonical policy.
- A one-sided harness change needs `Agent-Parity: none - <reason that names each file>` in the commit message.

Cursor can load `.agents/skills`; do not create `.cursor/skills` duplicates for repository-local skills. A personal
copy under `~/.cursor/skills` is useful only when Cursor Cloud skill sync is explicitly required.

## Adapter boundary

Allowed adapter content:

- trigger/description/frontmatter;
- native path scoping;
- how this harness discovers root/nested instructions;
- one link: the concern doc (rule adapter) or the Claude skill (skill twin);
- native invocation detail that cannot be expressed canonically.

Forbidden adapter content:

- copied skill steps or concern doc text;
- independent policy exceptions;
- repository behavior contracts (those live in docs of record);
- copied gate semantics;
- harness names inside `.claude/rules` bodies (the generator copies them into Cursor verbatim and refuses
  `Skill("`, `Claude-specific`, `# Claude Code adapter`).
