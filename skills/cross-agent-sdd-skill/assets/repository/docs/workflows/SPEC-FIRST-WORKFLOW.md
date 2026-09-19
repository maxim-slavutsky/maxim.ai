# SPEC-first workflow

Canonical, tool-neutral specification-driven development procedure. Agent adapters:

- [Claude Code rule](../../.claude/rules/spec-first.md)
- [Claude Code skill](../../.claude/skills/spec-first/SKILL.md)
- [Codex/Cursor skill](../../.agents/skills/spec-first/SKILL.md)
- [Cursor rule](../../.cursor/rules/spec-first.mdc)

Format and evidence syntax: [agent documentation format](../agent-sdd/FORMAT.md).

## Procedure

1. Locate nearest `SPEC.md` by searching upward from every target file. Read relevant invariant, cited evidence,
   and owning `AGENTS.md` before implementation.
2. Reconcile contract, executable evidence, and code. Disagreement is a decision point; neither prose nor current
   code is automatically authoritative.
3. Classify work:
   - intended behavior change: amend interface/invariant first, then evidence, then implementation;
   - bug against invariant: record cause/fix and regression evidence, then implementation;
   - no contract impact: record concrete reason in `changes-log.md` and commit message when gate requires it.
4. Non-trivial maintained module without a SPEC: establish ownership and intended invariants; do not reverse-engineer
   requirements from implementation guesses.
5. Multi-module change: update every affected owner and keep cross-references consistent.
6. Remove completed task rows from live specs. Keep durable outcome as invariant or bug record.
7. Run `node scripts/check-sdd.mjs`, affected tests, types, lint, and build checks.
8. Commit contract, evidence, implementation, and adapters together.

## Enforcement boundary

Generated gate checks stable ids, citations, critical evidence, link reachability, ownership, and per-change impact.
It cannot determine intended behavior or semantic correctness. Fix the contract/evidence/code disagreement; never
weaken the gate merely to obtain green output.
