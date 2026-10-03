# maxim.ai

AI skills packaged as one plugin, `maxim-ai`, for Claude Code, Codex, and Cursor. This repository is the
plugin marketplace: add it to your tool and install the plugin from there. There is nothing to clone.

## Install

**Claude Code.** Inside Claude Code:

```text
/plugin marketplace add maxim-slavutsky/maxim.ai
/plugin install maxim-ai@maxim-ai
```

**Codex.**

```bash
codex plugin marketplace add maxim-slavutsky/maxim.ai
```

```bash
codex plugin add maxim-ai@maxim-ai
```

**Cursor.** Customize, then From GitHub Repository, and enter `https://github.com/maxim-slavutsky/maxim.ai`.
Or from the Cursor CLI:

```bash
agent plugin marketplace add https://github.com/maxim-slavutsky/maxim.ai
```

The plugin has no version number: every install and update takes the latest commit on `main`. Each skill's
README has the details.

## Skills

| Skill | Claude Code command | What it does | Docs |
|---|---|---|---|
| `sdd-enforce` | `/maxim-ai:sdd-enforce` | Installs one spec-driven-development policy into a repository for Claude Code, Codex, and Cursor: shared instructions, thin per-tool adapters, a post-edit reminder hook, and a commit-time gate. Formerly `cross-agent-sdd`. | [README](skills/sdd-enforce/README.md) · [SKILL.md](skills/sdd-enforce/SKILL.md) · [contract](skills/sdd-enforce/SPEC.md) |

## Repository layout

| Path | Read by |
|---|---|
| `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json` | Claude Code and Codex |
| `.cursor-plugin/marketplace.json`, `.cursor-plugin/plugin.json` | Cursor |
| `skills/<name>/SKILL.md` | all three tools |

To add a skill, add a `skills/<name>/` folder. Keep the plugin name `maxim-ai` the same in all four manifest
files.

## Development

```bash
npm test
```

Runs every `skills/*/scripts/*.test.mjs` with the Node test runner. Node 22 or newer. It also checks that
the manifests agree with each other.

```bash
claude plugin validate .
```

Checks the Claude Code manifests.
