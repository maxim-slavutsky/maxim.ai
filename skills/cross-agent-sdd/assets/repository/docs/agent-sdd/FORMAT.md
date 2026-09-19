# Agent documentation format

## Document ownership

| Document | Purpose |
|---|---|
| root `AGENTS.md` | Repository map + standing policy for every agent |
| nested `AGENTS.md` | App/package ownership, commands, module SPEC index |
| module `SPEC.md` | Intended behavior, interfaces, invariants, evidence, active debt |
| `docs/workflows/*.md` | Tool-neutral procedures; agent adapters link them |
| `CLAUDE.md` | Root `@AGENTS.md` import only when possible |
| `changes-log.md` | Ignored session intent log used during commit preparation |
| `.claude/rules/*.md` | Path-scoped adapter source; tool-neutral body, links one canonical workflow |
| `.cursor/rules/*.mdc` | Generated from `.claude/rules` by `scripts/gen-cursor-rules.mjs`; never hand-edit |
| `.agents/skills/<name>/` | Codex/Cursor adapter + `agents/openai.yaml` display metadata |
| `.agent-sdd/config.json` | Gate configuration: profiles, agents, runtime roots, excludes, config groups, charts |
| `.agent-sdd/waivers.json` | Per-commit gate waivers for `--changed` mode only; never for new work |

Do not duplicate module invariants in `AGENTS.md` or adapter files.

## SPEC shape

Every maintained `SPEC.md` starts with stable metadata:

```yaml
---
id: <globally-unique-lowercase-id>
critical:
  - V1
---
```

Use applicable sections:

- `## Goal`: module responsibility.
- `## Constraints`: compatibility, security, operational limits.
- `## Interfaces`: public routes/functions/events/config shapes.
- `## Invariants`: stable `V1`, `V2`, ... identifiers. Never renumber or reuse retired ids.
- `## Tasks`: active work only; remove completed rows.
- `## Bugs`: durable incident/cause/fix record.
- `## Files`: important path ownership when useful.

Invariant syntax must expose id at line start:

```text
V1: Every accepted request returns the correlation id.
```

Critical invariant executable evidence cites it in a test title or adjacent comment:

```text
@spec <spec-id>:V1
```

Green evidence proves implementation behavior, not that prose captures intended behavior. Reconcile all three.

## Changes log

```markdown
## <change group>

**Files changed:**

- `path`

**What changed:**

- <intent, not diff narration>

**Spec impact:** changed | none - <concrete reason>
```

For `changed`, name owning contract, invariant ids, and evidence. For `none`, state why behavior/public contracts
cannot change; generic claims such as "docs only" or "refactor" are insufficient.
