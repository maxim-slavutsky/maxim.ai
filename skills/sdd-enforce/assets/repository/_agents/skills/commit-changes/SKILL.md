---
name: commit-changes
description: Validate and commit repository changes from the session changes log when the user explicitly asks to commit or finalize current work.
---

# Codex and Cursor adapter

Read [canonical commit workflow](../../../docs/workflows/COMMIT-WORKFLOW.md) completely. It owns scope,
spec/parity impact, validation, exact staging, commit, and log cleanup. Do not commit, push, or merge unless the user
authorized that action. Run every step inline: sub-agent delegation is a Claude Code-only option and lives in
`.claude/skills/commit-changes/SKILL.md`.
