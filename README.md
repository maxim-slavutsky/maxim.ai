# maxim.ai

Private, versioned AI skills.

## Skills

| Skill | Purpose |
|---|---|
| [`cross-agent-sdd-skill`](skills/cross-agent-sdd-skill/SKILL.md) | Audit and bootstrap one SDD policy across Claude Code, Codex, and Cursor |

Install for local Claude Code, Codex, and Cursor sessions:

```powershell
node skills/cross-agent-sdd-skill/scripts/cross-agent-sdd.mjs install-skill --agents all --scope user --write
```

The installer uses Node.js filesystem APIs and the same command works in PowerShell, Command Prompt,
Bash, and zsh.
