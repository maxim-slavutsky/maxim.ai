# SPEC-first workflow

Canonical, tool-neutral specification-driven development procedure. Agent adapters (thin, link here only):

- [Claude Code rule](../../.claude/rules/spec-first.md), path scope `apps/**`, `packages/**`, `src/**`
- [Codex/Cursor skill](../../.agents/skills/spec-first/SKILL.md)
- [Cursor rule](../../.cursor/rules/spec-first.mdc), generated from the Claude rule, never hand-edited

Format and evidence syntax: [agent documentation format](../agent-sdd/FORMAT.md).

This file is imported from the root `AGENTS.md` (`@./docs/workflows/SPEC-FIRST-WORKFLOW.md`), so it is always in
context for Claude Code; Codex and Cursor reach it through the adapters above. Removing that import line silently
disables every rule below. `scripts/check-docs.mjs` asserts the line is present.

Document layout: every important module has a co-located `SPEC.md`; the repository root has one standing
`AGENTS.md`; `CLAUDE.md` is a one-line `@AGENTS.md` import and is never edited.

## Coverage

List here the documents that exist today, so a reader knows what to expect and where rule 4 fires:

| Scope | Document |
|---|---|
| format convention | [FORMAT.md](../agent-sdd/FORMAT.md) |
| repository root | [AGENTS.md](../../AGENTS.md) |
| project rules | [.claude/rules/INDEX.md](../../.claude/rules/INDEX.md) |
| canonical workflows | this folder |

Add one row per app, package, and shared config folder as their documents are written.

## Rules

1. **Read before edit.** Before touching files in a module, read the nearest `SPEC.md` (search upward from the
   edit target) **and every `SPEC.md` above it up to the module root**: a split module's parent SPEC holds the rules
   that span its folders. Then read the nearest owning app or package `AGENTS.md`, the root `AGENTS.md`, and the
   applicable canonical workflow. No SPEC: start with the nearest owning `AGENTS.md`, then follow the same order.
2. **Minimise raw reads.** When the spec answers the question (contracts, invariants, data flow, pitfalls), do not
   spelunk the implementation unless verifying a specific line. Trust the spec. Spec wrong: fix the spec.
3. **Diverged, update.** A behavior change that contradicts an invariant, an interface line, or a recorded pitfall
   updates the SPEC in the same change set.
4. **Missing, create.** Non-trivial work in a module without a SPEC creates one, shaped per FORMAT.md: goal,
   constraints, interfaces, invariants, tasks, bugs, files. Establish ownership and intended invariants; do not
   reverse-engineer requirements from implementation guesses.
5. **Cross-spec consistency.** A change that touches several modules walks every affected `SPEC.md` and confirms
   cross-references and invariant citations still hold.
6. **The gate is partial.** Two gates run in pre-commit and CI. `scripts/check-docs.mjs` enforces rule 4 (the
   document exists and is linked). `scripts/check-sdd.mjs` enforces SPEC frontmatter ids, unique invariant ids,
   resolving `@spec` citations, evidence for critical invariants, adapter and workflow links, Cursor mirrors, hook
   parity, and chart roots. Neither checks content, so rules 1, 2, 3, and 5 stay on you. A SPEC that lies passes
   green. When a gate fires, write the missing document; never delete the link or the check.
7. **Log as you go.** Every meaningful edit appends one entry to `changes-log.md` at the root (intent, not diff),
   ending with `**Spec impact:** changed | none - <concrete reason>`. Append; never overwrite the file. It is
   ignored by Git and deleted after each commit. It is the sole input to the next commit message: `git diff` is not
   used to rediscover changes. Procedure: [commit workflow](COMMIT-WORKFLOW.md).
8. **The owner moves with the code.** For every runtime file under a runtime root (not tests, not type
   declarations, not `docs/`), the owner is the nearest `SPEC.md` upward, else the workspace `AGENTS.md`. A commit
   that touches the file without its owner needs `Spec-Impact: none - <at least 8 words naming each file and why
   behavior cannot change>`, or the commit-msg hook rejects it (`check-sdd --staged`; CI re-checks every new commit
   with `--changed`). Prefer updating the owner. The same shape applies to a one-sided harness edit:
   `Agent-Parity: none - ...` ([agent parity workflow](AGENT-PARITY-WORKFLOW.md)).
9. **Evidence is `@spec`.** A test proves an invariant only when its title or an adjacent comment carries
   `@spec <spec-id>:V<n>` (`id` from that SPEC's frontmatter). Mark `critical:` only for invariants a test proves
   **whole**. A partial proof is no evidence; ask the owner to split the invariant instead. Never mark an invariant
   critical to look thorough: the gate turns it red.
10. **Commit contract, evidence, implementation, and adapters together.** Remove completed task rows from live
    specs; keep the durable outcome as an invariant or a bug row.

## Workflow shortcut

```text
edit request lands
   |
   v
locate nearest SPEC.md ---- not found ---> read nearest owning AGENTS.md
   |                                             |
   v                                             v
read it and every SPEC.md above it        plan the SPEC.md write as part of the change
(up to the module root)
   |
   v
do the work; behavior diverges -> update the SPEC in the same change
```

Both paths then read the owning app or package `AGENTS.md`, the root `AGENTS.md`, and the applicable canonical
workflow before doing the work.

## High-leverage call-outs

Paths where a wrong assumption costs the most. Work touching any of them re-reads the implementation before editing.
Fill the table as the repository learns:

| Path glob | Why it matters |
|---|---|
| | |

## Enforcement boundary

The generated gates check stable ids, citations, critical evidence, link reachability, document existence,
ownership, and per-change impact. They cannot determine intended behavior or semantic correctness. Fix the
disagreement between contract, evidence, and code; never weaken a gate merely to obtain green output.

## Why

A `SPEC.md` compresses hundreds of lines of code into a few hundred well-shaped lines so that future investigations
stay fast and accurate. Bypassing it reintroduces the original reading cost and risks violating invariants that the
code itself does not visibly assert.
