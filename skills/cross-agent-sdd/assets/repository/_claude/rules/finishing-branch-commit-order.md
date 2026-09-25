---
name: Flush the change log before finishing a branch
description: A non-empty changes-log.md means uncommitted session work; run the commit workflow before any finish-branch, pull-request, or handoff step.
type: feedback
---

# Commit before finishing a development branch

Before any step that finishes a branch (a finish-branch skill, opening a pull request, merging, handing the work
over), read `changes-log.md`:

- non-empty: run the commit workflow first, wait until the log is cleared, then proceed;
- empty or missing: proceed directly.

Adapter, ordering only. The **why** and the full procedure live in
[Commit workflow, "Before finishing a development branch"](../../docs/workflows/COMMIT-WORKFLOW.md#before-finishing-a-development-branch).
