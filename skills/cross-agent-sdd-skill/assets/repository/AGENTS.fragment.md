<!-- cross-agent-sdd:start -->
## Specification-driven development

Canonical agent policy applies to Claude Code, Codex, and Cursor.

Reading order before maintained-code edits:

1. nearest module `SPEC.md` and cited evidence;
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

Validation:

```text
node scripts/check-sdd.mjs
node scripts/check-sdd.mjs --staged --commit-msg <path>
node scripts/check-sdd.mjs --changed --base <git-ref>
```
<!-- cross-agent-sdd:end -->
