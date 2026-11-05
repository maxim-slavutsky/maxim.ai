---
status: 'accepted'
---

# A code file has one owner: the doc with the longest code: folder

Decided 2026-11-05 (sdd-enforce 1.0.0). It supersedes part of ADR-0001, which gave a doc of record `covers:` globs. With
globs, every doc whose glob matches a file owns that file, and a change to any one of them passes the gate. A
parent doc such as one for `apps/api/src` then owns every file of every module below it, so the gate stops
nothing. One repository brought its docs to the top level of the docs standard with 52 module docs that each
name one folder. Its gate gives a file to the doc with the longest folder, else to the workspace `AGENTS.md`.
sdd-enforce 1.0.0 uses that model: frontmatter `code: <folder>`, one doc per folder, and the longest folder
wins.

Declined:

- `covers:` globs: every match owns the file, so a parent doc weakens the gate. It would be right for a module
  whose files sit in several folders that no single folder holds.
- Both keys, `code:` and `covers:`: the gates would carry two owner models and two sets of messages. It would
  be right if a repository needed globs for a large share of its modules.
