# Existing-repository migration

Read when audit reports existing instructions, specs, hooks, gates, or conflicting target paths.

## Ownership classes

| Class | Action |
|---|---|
| Absent | Safe to create after plan review |
| Generated + unchanged | Safe to upgrade |
| Generated + locally modified | Conflict; reconcile against recorded base |
| User-owned compatible | Preserve; add link or managed block only after review |
| User-owned conflicting | Stop and choose canonical owner explicitly |

## Migration order

1. Inventory current behavior and which harness actually reads each file.
2. Select canonical policy from existing material; do not assume new template is more correct.
3. Deduplicate policy into `docs/workflows` and root/nested `AGENTS.md`.
4. Replace copies with thin adapters.
5. Establish SPEC ownership for touched/high-risk modules first.
6. Introduce static gates.
7. Introduce per-change gates. Commits already on a shared branch that the new gate rejects go into
   `.agent-sdd/waivers.json` (full SHA, gate, reason of at least 12 words); new commits never get a waiver.
8. Wire Git hooks and CI after local commands pass.
9. Remove superseded files only after every enabled harness resolves replacements.

## Mature repositories

Do not require a complete historical rewrite before new work can proceed. Record legacy gaps, enforce ownership for
new/changed runtime files, and migrate high-risk modules first. A waiver is temporary debt accounting for history already merged, not a gate bypass: `--staged` never reads
it.

## Conflict rules

- Never overwrite an unowned `AGENTS.md`, `CLAUDE.md`, settings file, rule, workflow, or gate.
- `--merge-agents` permits only the marked governance block/import; inspect resulting document immediately.
- JSON hook integration is additive. Preserve unrelated hooks/settings and validate schema in each harness.
- Existing gate failure requires contract/evidence repair or a narrow audited migration decision; never weaken a
  checker solely to produce green output.
- Do not synthesize behavioral invariants from current code without confirming intended behavior.
