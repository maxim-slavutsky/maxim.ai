---
status: 'superseded in part by ADR-0002 (code: replaces covers:, 2026-11-05)'
---

# Docs of record replace module SPEC.md files

Decided 2026-11-01 (sdd-enforce 1.0.0). A docs standard puts a spec, a plan for work not yet shipped, in its
issue tracker ticket. Its audit flags every `**/SPEC.md` as a plan committed to the repository. The
sdd-enforce `SPEC.md` files held current behavior, so they were living docs under a spec's name. Version 1.0.0
moves each one to a concern doc, the doc of record: `<workspace>/docs/<module>.md` with `covers:` globs, plain
prose and no task or bug tables. Tests cite `@invariant <id>:V<n>`, and commits carry `Doc-Impact:`. The gates
fail on any `SPEC.md`, any `@spec` citation and any `CLAUDE.md`. The gates also drop `changes-log.md`, because
the commit skill reads `git status` and `git diff`.

Declined:

- Keep `SPEC.md` and ask the standard for an exception: the standard lets a repository add map rows, never
  override them. It would be right if the standard itself named a module spec file.
- Put the invariants in a module `AGENTS.md` or `README.md`: an `AGENTS.md` holds gotchas and pointers, and a
  README is for people. Neither doc type takes a contract with ids that tests cite.
- Report old hits without failing (a debt list or a check of changed files only): it lets old drift stay. It
  would be right for a repository too large to migrate in one change.
- Ship a `migrate` command for user-owned files: moving prose and tables needs judgment, so `audit` lists the
  items and an agent moves them by hand.
