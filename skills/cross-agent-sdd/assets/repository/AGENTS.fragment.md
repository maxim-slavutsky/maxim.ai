<!-- cross-agent-sdd:start -->
## Specification-driven development

Canonical agent policy applies to Claude Code, Codex, and Cursor.

Reading order before maintained-code edits:

1. nearest module `SPEC.md`, every `SPEC.md` above it up to the module root, and cited evidence;
2. nearest owning `AGENTS.md`;
3. root `AGENTS.md`;
4. applicable canonical workflow under `docs/workflows/`.

Rules:

- Intended behavior change: update contract, executable evidence, and implementation in one change.
- Bug against existing invariant: add regression evidence and bug ledger entry before/with fix.
- Meaningful edit: append intent to `changes-log.md`; declare `Spec impact: changed | none`.
- Agent rule/skill/hook edit: apply `docs/workflows/AGENT-PARITY-WORKFLOW.md` in same change.
- Runtime configuration shape edit: apply `docs/workflows/APP-CONFIG-WORKFLOW.md` when installed.
- Never bypass repository hooks or weaken a gate solely to make a change pass.

Canonical references:

- [Documentation format](docs/agent-sdd/FORMAT.md)
- [SPEC-first workflow](docs/workflows/SPEC-FIRST-WORKFLOW.md)
- [Agent parity workflow](docs/workflows/AGENT-PARITY-WORKFLOW.md)
- [Commit workflow](docs/workflows/COMMIT-WORKFLOW.md)
- [Rule index](.claude/rules/INDEX.md)

The working rules stay in context for Claude Code through this import; `scripts/check-docs.mjs` fails when the line
is removed:

@./docs/workflows/SPEC-FIRST-WORKFLOW.md

### Session change log

Work in progress accumulates in `changes-log.md` at the repository root: ignored by Git, never committed, deleted
after each commit. Every meaningful edit appends one entry (intent, not diff); a post-edit hook in each harness
config reminds after every edit. The log is the source of truth for the next commit message, so `git diff` is not
re-read to rediscover what changed. Append, never overwrite. Every entry ends with
`**Spec impact:** changed | none - <reason>`, the draft of the `Spec-Impact:` commit trailer. Format and workflow:
[commit workflow](docs/workflows/COMMIT-WORKFLOW.md).

### Gates and hooks

| Where | Command | Checks |
|---|---|---|
| pre-commit | `node scripts/check-docs.mjs` | every workspace has `AGENTS.md`, every module has a linked `SPEC.md`, the workflow import above is present |
| pre-commit | `node scripts/check-sdd.mjs` | links resolve, SPEC ids and evidence, adapters and workflows link both ways, Cursor mirrors in sync, hook parity |
| commit-msg | `node scripts/check-sdd.mjs --staged --commit-msg "$1"` | a runtime file staged without its owner needs `Spec-Impact: none - ...`; a one-sided harness edit needs `Agent-Parity: none - ...` |
| CI | both static commands and `node scripts/check-sdd.mjs --changed` | the same per-commit checks for every commit since the base |

Regenerate `.cursor/rules/*.mdc` after any `.claude/rules` edit: `node scripts/gen-cursor-rules.mjs`.
<!-- cross-agent-sdd:end -->
