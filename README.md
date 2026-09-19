# maxim.ai

Private, versioned AI skills.

## Skills

| Skill | Purpose |
|---|---|
| [`cross-agent-sdd`](skills/cross-agent-sdd/SKILL.md) ([contract](skills/cross-agent-sdd/SPEC.md)) | One shared SDD policy across Claude Code, Codex, and Cursor |

Install for local Claude Code, Codex, and Cursor sessions:

```powershell
node skills/cross-agent-sdd/scripts/cross-agent-sdd.mjs install-skill --agents all --scope user --write
```

The installer uses Node.js filesystem APIs and the same command works in PowerShell, Command Prompt,
Bash, and zsh.

Run the skill test suite:

```powershell
npm test
```
