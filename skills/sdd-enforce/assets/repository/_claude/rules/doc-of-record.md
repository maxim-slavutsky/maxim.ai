---
name: Doc of record
description: Editing code that a doc of record owns: read the doc whose code: folder holds the file first; a change to behavior, an interface or an invariant updates that doc in the same commit.
paths:
  - "src/**"
---

# Doc of record

The mechanism and each rule in full: [doc of record](../../docs/doc-of-record.md).

- **Read the doc of record whose `code:` folder holds the file before you edit it**, and the docs of the folders above it, because they hold invariants the code does not show.
- **Update that doc in the same commit when behavior, an interface or an invariant changes**, or add `Doc-Impact: none - <reason>`.
- **Cite an invariant only from a test that proves all of it**, with `@invariant <id>:V<n>`.
- **Write the doc of record and its index row before non-trivial work in a module no doc holds**, from the owner's intent, not from the code.
- **Put open work and bugs in the issue tracker**, because the doc states the current code only.
