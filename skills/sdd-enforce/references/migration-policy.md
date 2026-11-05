# Existing-repository migration

Read when audit reports existing instructions, `SPEC.md` files, hooks, gates, old-format items, or conflicting
target paths.

## Ownership classes

What `plan`/`apply` do with each file class:

| Class | Action |
|---|---|
| Absent | Safe to create after plan review |
| Generated + unchanged | Safe to upgrade (`update-generated`) |
| Generated + locally modified | Kept as is (`keep`); upgrade skips it. To take the tool version: `apply --write --replace <path>` |
| Pre-existing, identical to template at first apply (`mode: preserved`) | Repository-owned. Never upgraded, never policed by `verify`, never deleted by `uninstall`. Adopt with `apply --write --replace <path>` |
| Gates and adapters from an older install, but no `.agent-toolchain.json` (the record was deleted) | Every tool path is a conflict. Read each one and move what the repository added (a check, a rule line, a filter table) into its own rule, doc or script. Then take the paths over with `apply --write --replace <path>,<path>`. A one-off takeover needs no other command |
| Retired file an older version generated (`docs/workflows/*-WORKFLOW.md`, `docs/agent-sdd/FORMAT.md`, `scripts/hooks/post-edit-reminder.mjs`, `spec-first` and `finishing-branch-commit-order` rules + `.mdc`, `spec-first` / `commit-changes` / `validate-helm-charts` skills and adapters, `.claude/rules/INDEX.md`) | Unedited: deleted (`delete`). Edited or preserved: kept and still tracked (`keep`); the gates then fail on it (old name, old form). Move its content where the plan reason says, then delete it by hand |
| 0.6.0 import line `@./docs/workflows/SPEC-FIRST-WORKFLOW.md` in `AGENTS.md` | Swapped for the tool lines (`update`); other text stays |
| 0.4.0 `AGENTS.md` block, unedited | Swapped for the tool lines (`update`); text outside the markers stays |
| 0.4.0 `AGENTS.md` block edited inside the markers | Kept as is (`keep`); the upgrade never drops text inside the markers. Move repository text outside the markers, then `apply --write --replace AGENTS.md` |
| `CLAUDE.md` = the one-line `@AGENTS.md` an older version created | Deleted (`delete`), record released |
| Any other `CLAUDE.md` | `conflict`. Read it, move each line `AGENTS.md` lacks into the `AGENTS.md` beside it, delete it, re-run |
| `.gitignore` with the `cross-agent-sdd` `changes-log.md` block | Block removed (`update`); file deleted when the tool created it and nothing else remains |
| Hook config that runs `scripts/hooks/post-edit-reminder.mjs` | Command moved to `.claude/hooks/post-edit-reminder.mjs` (`merge`); other hooks stay |
| `docs/map.md` absent / without block / with block | `create` / `merge` (block appended, own rows stay) / `update` or `preserve` |
| User-owned compatible `AGENTS.md` | Preserve; add the tool lines only after review (`--merge-agents`) |
| User-owned conflicting file | Stop and choose canonical owner explicitly |

The tool lines of the root `AGENTS.md`: the `docsStandardLine` (when set), then
`Before you edit code, read every doc of record that covers it: [doc of record](docs/doc-of-record.md).`,
below the first heading.

## Old-format items

`audit` lists them. They are user-owned: the tool never rewrites them and has no migrate command. The gates fail
on each one with no debt list, so the install change moves all of them.

| Item | Move to |
|---|---|
| `**/SPEC.md` | `<workspace>/docs/<module>.md`, or root `docs/<module>.md` when its code is in no workspace. Keep `id` and every `V<n>` number (tests cite them). Add one `code:` folder (repo-relative, the folder the old `SPEC.md` sat in). Headings Goal, Constraints, Interfaces, Invariants, plain prose (no `§` headings, no compressed encoding). Drop Tasks, Bugs, Files tables: open work and bugs to the issue tracker. Wire shapes to an API contract `docs/<subject>-contract.md`; hard-to-reverse decisions to an ADR under `docs/adr/`. List the doc in the `README.md` index of its `docs/` folder, and link the index from the nearest `AGENTS.md` |
| `@spec <id>:V<n>` | `@invariant <id>:V<n>` |
| `CLAUDE.md` | Lines `AGENTS.md` lacks into the `AGENTS.md` beside it; delete the file. An `@AGENTS.md` line moves nowhere |
| Doc under `docs/` with a non-kebab name | `git mv` to kebab-case (the gate message prints the command); update every link |
| `.gitignore` `changes-log.md` block | Nothing; apply removes it. Delete a leftover local `changes-log.md` |
| `Spec-Impact:` in existing commits, `spec-impact` in waivers | Leave; accepted forever. New commits use `Doc-Impact:`, new waivers `doc-impact` |

Shape and rules of a doc of record: `docs/doc-of-record.md` in the target repository.

## Migration order

1. Inventory current behavior and which harness actually reads each file.
2. Select canonical policy from existing material; do not assume the new template is more correct.
3. Deduplicate policy into concern docs under `docs/` and root/nested `AGENTS.md`; procedures into
   `.claude/skills/<name>/SKILL.md`.
4. Replace copies with thin adapters: rule adapter links the concern doc, skill twin links the skill.
5. Move every old-format item `audit` lists (table above), in the install change.
6. Cover every module under `moduleRoots` with a doc of record, high-risk modules first. Take invariants from the
   owner's intent, never from the code alone.
7. Bring the static gates to green.
8. Introduce per-change gates. Commits already on a shared branch that the new gate rejects go into
   `.agent-sdd/waivers.json` (full SHA, gate, reason of at least 12 words); new commits never get a waiver.
9. Wire Git hooks (`.husky/` or `.pre-commit-config.yaml`) and CI after local commands pass.
10. Remove superseded files only after every enabled harness resolves replacements.

## Mature repositories

The gates have no debt list and no partial mode: every old-format hit fails, and the install change fixes all of
them. A module with no invariant (types, presentational components, configuration) needs no doc of record: take
its folder out of `moduleRoots` only for that reason, never to get green. A critical invariant without whole-proof
evidence stays red: report it in the commit body and propose a split to the owner. A repository too large to
migrate in one change: stop and ask the user. A waiver is accounting for history already merged, not a gate
bypass: `--staged` never reads it.

## Conflict rules

- Never overwrite an unowned `AGENTS.md`, `CLAUDE.md`, settings file, rule, concern doc, skill, or gate.
- `--merge-agents` permits only the tool lines below the first heading; inspect the resulting document
  immediately.
- JSON hook integration is additive. Preserve unrelated hooks/settings and validate schema in each harness.
- An existing gate failure requires doc/evidence repair or a narrow audited migration decision; never weaken a
  checker solely to produce green output.
- Do not synthesize behavioral invariants from current code without confirming intended behavior.
