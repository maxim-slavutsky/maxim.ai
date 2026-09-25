---
name: commit-changes
description: Validate and commit repository changes from the session changes log when the user explicitly asks to commit or finalize current work.
---

# Claude Code adapter

Read [canonical commit workflow](../../../docs/workflows/COMMIT-WORKFLOW.md) completely. It owns scope,
spec/parity impact, validation, exact staging, commit, and log cleanup. Do not commit, push, or merge unless the user
authorized that action.

## Delegation (optional, Claude Code only)

The workflow steps are the procedure; any harness runs them inline. The Claude Code main thread **may** hand them to a
cheaper sub-agent to keep its own context small. This is an option, not a requirement.

- Sub-agents unavailable or disallowed, or you were told not to spawn one: run the steps inline and say so.
- You **are** the sub-agent: run the steps directly; a chart validation inside the workflow runs inline in you; never
  nest sub-agents.
- You are the main thread and sub-agents are available: spawn, then stop; relay the summary when it returns:

  ```text
  Agent(
    subagent_type: "general-purpose",
    model: "sonnet",
    description: "commit changes",
    prompt: "You ARE the delegated sub-agent: run the commit workflow yourself (docs/workflows/COMMIT-WORKFLOW.md, every step) and do NOT spawn another agent for any step. Read changes-log.md and classify git status; run the affected tests, builds, and lint through the repository's cached task runner in ONE call; validate touched Helm charts INLINE; do the targeted owner-doc check; run the gates; write the message to a scratch file, stage only logged and clearly incidental files, and pre-validate the message with the commit linter and `check-sdd --staged` in the same call; commit with `git commit -F`; delete the log. Unlisted or untracked files: EXCLUDE them and continue, list them in the report; do not stop, do not stage them, never edit a file to make a check pass. A failing test, build, gate, or chart: STOP and report. Report back: commit hash and subject, what executed per workspace (ran / cache hit / stub / skipped), chart result, owner docs edited, excluded paths."
  )
  ```
