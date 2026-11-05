# Agent parity

Claude Code, Codex and Cursor work from one set of repository instructions. A change to the rules, skills
or hooks of one coding agent includes its partner files in the same commit.

The rule [`.claude/rules/agent-parity.md`](../.claude/rules/agent-parity.md) loads these rules when an agent reads a harness file.

## Partner rules

1. **A rule has a generated Cursor copy.** `scripts/gen-cursor-rules.mjs` writes `.cursor/rules/<name>.mdc`
   from `.claude/rules/<name>.md`. Edit the source, run `node scripts/gen-cursor-rules.mjs` and commit both
   files. Never edit an `.mdc` file by hand, because the gate compares it with the generator output.
2. **A rule has a Codex and Cursor adapter.** `.agents/skills/<name>/SKILL.md` links the same concern doc
   as the rule `.claude/rules/<name>.md`. A rule without its adapter leaves Codex and Cursor without its
   imperatives.
3. **A skill has a twin that links it.** `.agents/skills/<name>/SKILL.md` links
   `.claude/skills/<name>/SKILL.md`. The steps live in the Claude Code skill only, so a change to the steps
   needs no change to the twin.
4. **Every adapter folder has Codex metadata.** Each `.agents/skills/<name>/` folder holds
   `agents/openai.yaml` with the display name and the default prompt.
5. **The hook configs move together.** A change to `.claude/settings.json`, `.codex/hooks.json` or
   `.cursor/hooks.json` changes every other enabled config in the same commit. The hook script under
   `.claude/hooks/` can change alone.
6. **A rule links one concern doc, and the doc links the rule back.** The concern doc sits directly under
   `docs/`, or in a `docs/` subfolder that a row of `docs/map.md` declares. A link to
   `.claude/rules/<name>.md` also covers its generated `.cursor/rules/<name>.mdc`.
7. **A one-sided change names its reason.** If a commit changes a harness file without its partner, add
   this trailer to the commit message: `Agent-Parity: none - <reason that names each file>`.

The same kebab-case `<name>` names the rule, its adapter folder and its Cursor copy. The name states the
scope, not an incident. A path-scoped constraint is a rule. A procedure that someone starts is a skill,
and the skill links the rules it applies.

## Rule shape

- **Frontmatter**: `description` is the one-line trigger. `paths` lists the globs of exactly the files the
  rule governs, and each glob must match at least one tracked file. A rule without `paths` loads in every
  Claude Code session: a line every session needs belongs in `AGENTS.md`.
- **Body**: a heading, one line that links the concern doc, then three to six imperatives. Each imperative
  is short and gives its reason in one clause. The concern doc holds each imperative in full.
- **No tool-specific words**: the generator copies the body into the Cursor rule. It refuses `Skill("`,
  `Claude-specific` and `# Claude Code adapter`.

## Gotchas

- `.claude/settings.json` holds the hooks and the enabled plugins. It is committed and every contributor
  shares it. `.claude/settings.local.json` holds the settings of one machine and is never committed.
- `.claude/worktrees/` holds Claude Code worktrees, which are full copies of the repository. Both gates
  skip this folder.
- A skill copied from another repository needs new filter names, script names and paths before you use it.
  Otherwise the skill does nothing and still reports success.
- Post-edit hooks remind the agent after an edit. Git hooks and CI enforce the rules before integration.

## Rules index

| Rule | Scope | Concern doc | Trigger |
|---|---|---|---|
<!-- rules-index -->

When you add, remove or rename a rule, update this table and the rule's adapter folder in the same
commit. Then run `node scripts/gen-cursor-rules.mjs`. Run `node scripts/check-sdd.mjs` before handoff. The
gate checks the links in both directions. It cannot check that an adapter means the same as its source, so
keep adapters short.
