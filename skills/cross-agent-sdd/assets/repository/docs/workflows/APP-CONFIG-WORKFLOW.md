# Application config update workflow

Canonical policy for maintained runtime configuration shape changes. Adapters:

- [Claude Code rule](../../.claude/rules/app-config-updates.md)
- [Codex/Cursor skill](../../.agents/skills/app-config-updates/SKILL.md)
- [Cursor rule](../../.cursor/rules/app-config-updates.mdc)

## Invariant

Add, remove, or rename a runtime config key: update every applicable surface in the same change:

1. shape contract/runtime validator;
2. local/default developer config;
3. alternate shipped config;
4. Helm-rendered application config;
5. values placeholder for every direct chart input;
6. typed reader/getter;
7. owning SPEC/AGENTS contract when behavior changes.

Value-only edit is not automatically a shape change. Deployment-only chart settings not injected into runtime
config are outside this workflow.

## Procedure

1. Read nearest config SPEC, owning `AGENTS.md`, then `.agent-sdd/config.json` group.
2. Amend intended shape/evidence first.
3. Propagate structural key through every applicable surface.
4. Keep secrets as placeholders; never commit live values.
5. Render/validate charts when chart input changes.
6. Run `node scripts/check-sdd.mjs` and affected application validation.

The generic gate checks configured JSON paths and textual key coverage. Computed configuration may require a
repository-specific parser/test; green generic coverage does not prove value semantics.
