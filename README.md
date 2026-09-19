# maxim.ai

Private, versioned AI skills and plugins. Each entry has its own README with install steps and usage.

## Skills

| Skill | What it does | Docs |
|---|---|---|
| `cross-agent-sdd` | Installs one spec-driven-development policy into a repository for Claude Code, Codex, and Cursor: shared instructions, thin per-tool adapters, a post-edit reminder hook, and a commit-time gate. | [README](skills/cross-agent-sdd/README.md) · [SKILL.md](skills/cross-agent-sdd/SKILL.md) · [contract](skills/cross-agent-sdd/SPEC.md) |

## Plugins

None yet.

## Development

```bash
npm test
```

Runs every `skills/*/scripts/*.test.mjs` with the Node test runner. Node 22 or newer.
