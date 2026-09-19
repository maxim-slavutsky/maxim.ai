# cross-agent-sdd

One spec-driven-development (SDD) policy for a repository, shared by Claude Code, Codex, and Cursor.

**In plain words:** your AI coding tools read instruction files from the repository before they change code.
Each tool wants those files in a different place and format. This skill writes one canonical policy and thin
per-tool adapters that point at it, adds a small hook that reminds the AI to log what it changed, and adds a
script that fails a commit when code changed but the document that describes it did not.

Nothing here is specific to one product or company. The generated files contain no secrets.

## Contents

- [Install the skill](#install-the-skill)
- [Use it in a repository](#use-it-in-a-repository)
- [What gets installed into your repository](#what-gets-installed-into-your-repository)
- [What changes for the team](#what-changes-for-the-team)
- [CLI reference](#cli-reference)
- [Gate reference](#gate-reference)
- [Common gate messages](#common-gate-messages)
- [Uninstall](#uninstall)

## Install the skill

A *skill* is a folder with a `SKILL.md` file that an AI coding tool loads on demand. Claude Code looks in
`~/.claude/skills`, Codex and Cursor look in `~/.agents/skills`. The installer copies this folder there.

```bash
node skills/cross-agent-sdd/scripts/cross-agent-sdd.mjs install-skill --agents all --scope user --write
```

Same command works in PowerShell, Command Prompt, Git Bash, and zsh (Node.js 22 or newer). Without `--write`
it only prints the target folders. Start a new session in your AI tool afterwards so it sees the skill.

Options:

| Option | Meaning | Default |
|---|---|---|
| `--scope user` | Copy into your home folder, available in every repository | yes |
| `--scope project --repo <path>` | Copy into one repository only (`.claude/skills`, `.agents/skills`) | |
| `--agents claude,codex,cursor` | Which tools get a copy; Codex and Cursor share one folder | `all` |
| `--cursor-cloud` | Also copy into `~/.cursor/skills` (only needed for Cursor Cloud sync) | off |
| `--force` | Replace a copy this installer made earlier (upgrade) | off |
| `--json` | Machine-readable output | off |

## Use it in a repository

Two ways.

**Through your AI tool.** Open the repository and ask, for example: "Bootstrap cross-agent SDD in this repo".
The tool loads the skill, runs an audit, shows you a plan, and applies it only after the plan is clean. It
also fills in the parts a script cannot guess: which folders hold application code, which hooks and CI to wire.

**Directly from a terminal.** Same result, you drive it:

```bash
SKILL=~/.claude/skills/cross-agent-sdd/scripts/cross-agent-sdd.mjs
node $SKILL audit  .            # what is already here, changes nothing
node $SKILL plan   .            # what apply would write, changes nothing
node $SKILL apply  . --write    # write the files
node $SKILL verify .            # check the result and run the gate
```

Every writing command is a dry run until you add `--write`. A file that already exists and was not created by
this tool is reported as a conflict and never overwritten.

## What gets installed into your repository

With the default profiles (`core,sdd`) and all three tools:

| Path | What it is | Who reads it |
|---|---|---|
| `AGENTS.md` | Standing repository policy. Created if missing; if it exists, a marked block is appended only when you pass `--merge-agents`. Your own text is never changed. | Codex, Cursor, people |
| `CLAUDE.md` | One line, `@AGENTS.md`, so Claude Code reads the same policy. Existing content is kept. | Claude Code |
| `docs/workflows/*.md` | The actual procedures (SPEC-first, agent parity, commit). One copy, tool-neutral. | every tool, people |
| `docs/agent-sdd/FORMAT.md` | Shapes of `SPEC.md`, `AGENTS.md`, and the session change log. | every tool, people |
| `.claude/rules/*.md` | Claude Code path rules: when a file under `src/`, `apps/`, or `packages/` is edited, Claude reads the matching workflow first. Thin: one link each. | Claude Code |
| `.cursor/rules/*.mdc` | Same rules for Cursor, generated from `.claude/rules` by `scripts/gen-cursor-rules.mjs`. Never edit by hand. | Cursor |
| `.agents/skills/*/` | Codex and Cursor skills: thin adapters plus `agents/openai.yaml` display metadata. | Codex, Cursor |
| `.claude/skills/commit-changes/` | Claude Code skill for the commit workflow. | Claude Code |
| `.claude/settings.json`, `.codex/hooks.json`, `.cursor/hooks.json` | One post-edit hook per tool. Existing settings are kept; only the hook entry is added. | each tool |
| `scripts/hooks/post-edit-reminder.mjs` | The hook script. After the AI edits a file it is reminded to log the change and run the gate. | each tool |
| `scripts/check-sdd.mjs` | The gate. See [Gate reference](#gate-reference). | Git hooks, CI, people |
| `scripts/gen-cursor-rules.mjs` | Generator for `.cursor/rules`. | people, gate |
| `.agent-sdd/config.json` | Gate configuration: which folders hold application code, what to skip, optional config groups and Helm charts. Edit this. | gate |
| `.agent-sdd/waivers.json` | Commits the CI gate may skip, with a reason. Starts empty. | gate |
| `.agent-toolchain.json` | List of files this tool owns, with hashes, so upgrades replace only untouched files. | this tool |
| `.gitignore` | Adds `changes-log.md`. | Git |

Optional profiles add more:

- `config`: a workflow and gate for repositories where the same runtime config keys live in several files
  (local JSON, shipped JSON, schema, reader, Helm values). You describe the files in `.agent-sdd/config.json`.
- `helm`: a Helm chart validation workflow (`helm lint`, `helm template`, `kubeconform`) and a skill for it.

The tool never commits, pushes, or opens pull requests. Review the diff, then commit it yourself.

## What changes for the team

- **Specs live next to code.** A folder with important behavior gets a `SPEC.md` with a stable `id:` and
  numbered invariants (`V1:`, `V2:` ...). Invariants listed under `critical:` must be proven by a test that
  contains `@spec <id>:V<n>` in its title or a comment.
- **Change the code, change the spec.** When a commit touches application code but not the `SPEC.md` or
  `AGENTS.md` that owns it, the gate stops the commit unless the message explains why in one line:
  `Spec-Impact: none - <at least 8 words naming the files and why behavior cannot change>`.
- **Tools move together.** Editing a Claude rule, a Codex skill, or a hook config without its counterparts
  fails the gate unless the message says why: `Agent-Parity: none - <reason naming the files>`.
- **AI sessions leave a trail.** The hook reminds the AI to append what it changed to `changes-log.md`
  (ignored by Git). The commit workflow turns that log into the commit message and deletes it.
- **Old history is not rewritten.** A commit already on a shared branch that a new gate rejects goes into
  `.agent-sdd/waivers.json` with its full SHA and a 12-word reason. Waivers apply to CI range checks only;
  local hooks never read them, so new work always has to pass.

## CLI reference

```text
node <skill>/scripts/cross-agent-sdd.mjs <command> [arguments]
```

| Command | Writes files | Purpose |
|---|---|---|
| `audit <repo> [--json]` | no | Report branch, existing agent files, SPEC count, config-like files, Helm charts, CI type, and suggested profiles. |
| `plan <repo> [options]` | no | List every file `apply` would create, keep, merge, update, or refuse, with a reason for each conflict. |
| `apply <repo> [options]` | only with `--write` | Write the planned files atomically. Refuses when the plan has conflicts or the working tree has uncommitted changes. Prints next steps. |
| `verify <repo> [--json]` | no | Check every tool-owned file against its recorded hash, check hook configs, then run `scripts/check-sdd.mjs`. Exit code 1 on any problem. |
| `install-skill [options]` | only with `--write` | Copy the skill into your home folder or a repository. |
| `version` | no | Print the version. |
| `help` | no | Print usage. |

Options for `plan` and `apply`:

| Option | Meaning |
|---|---|
| `--profiles core,sdd,config,helm` or `full` | File sets to install. `core` and `sdd` are always included. Default: `core,sdd`, or whatever `.agent-sdd/config.json` already says. |
| `--agents all` or `claude,codex,cursor` | Tools to configure. Default: all three. |
| `--merge-agents` | Append the managed block to an existing `AGENTS.md` and the `@AGENTS.md` import to an existing `CLAUDE.md`. Read both files first. |
| `--allow-dirty` | Apply with uncommitted changes present. Not recommended: you lose the clean one-diff review. |
| `--write` | Actually write. Without it, `apply` is a dry run. |
| `--json` | Machine-readable output. |

Plan action words: `create` new file; `preserve` already correct; `update` managed block refreshed;
`update-generated` tool-owned file upgraded (hash matched); `merge` your file kept, tool entries added;
`conflict` file exists and the tool does not own it, nothing is written.

Exit codes: `0` success or clean dry run, `1` any error, conflict, or failed verification.

## Gate reference

Installed at `scripts/check-sdd.mjs`. Three modes:

| Command | When | Checks |
|---|---|---|
| `node scripts/check-sdd.mjs` | pre-commit hook, CI, any time | Markdown links resolve; every `AGENTS.md`/`SPEC.md` is linked from somewhere; SPEC ids unique; critical invariants have `@spec` evidence in a test file; Claude/Codex/Cursor files have their partners; `.cursor/rules` match `.claude/rules`; hook configs call the shared script; config groups and Helm charts (when those profiles are on). |
| `node scripts/check-sdd.mjs --staged --commit-msg <path>` | commit-msg hook (`$1`) | Everything above plus: staged application files changed with their owning `SPEC.md`/`AGENTS.md`, or the message carries an accepted `Spec-Impact: none -` line; harness files changed with partners, or `Agent-Parity: none -`. |
| `node scripts/check-sdd.mjs --changed [--base <ref>]` | CI | Same per-commit checks for every commit since the base, honoring `.agent-sdd/waivers.json`. |

Base for `--changed`, first match wins: `--base`, `SDD_BASE_REF`, `origin/<CHANGE_TARGET>` then
`<CHANGE_TARGET>`, `GIT_PREVIOUS_COMMIT`, `GIT_PREVIOUS_SUCCESSFUL_COMMIT`, `HEAD^`. An explicit value that
Git cannot resolve fails the gate instead of silently checking one commit.

`.agent-sdd/config.json` keys:

| Key | Meaning |
|---|---|
| `runtimeRoots` | Folders that hold application code (`apps`, `packages`, `src` ...). Files here need an owning `SPEC.md` or `AGENTS.md`. |
| `exclude` | Names skipped anywhere (`vendor`) or repo-relative prefixes (`apps/samples`). |
| `configGroups` | For the `config` profile: `{ name, source, surfaces: [{ path, mode: "json" \| "text" }] }`. |
| `helmCharts` | For the `helm` profile: chart folders containing `Chart.yaml`. |
| `agents`, `profiles` | What was installed; the gate uses `agents` to decide which partners to require. |

Generate Cursor rules after editing any `.claude/rules/*.md`:

```bash
node scripts/gen-cursor-rules.mjs
```

## Common gate messages

Every message ends with what to do. The most frequent ones:

| Message starts with | Meaning | Fix |
|---|---|---|
| `runtime paths lack owning contract change` | You changed code but not its `SPEC.md`/`AGENTS.md`. | Update the owner in the same commit, or add `Spec-Impact: none - <8+ words naming the files and why>` to the commit message. |
| `rejected Spec-Impact trailer` | The `none -` reason is too short, generic, or does not name the files. | Rewrite the reason: name each file, say what changed, say why behavior cannot change. |
| `critical invariant lacks executable evidence` | A `V<n>` under `critical:` has no test citing it. | Add `@spec <id>:V<n>` to a real test that proves the whole invariant, or ask the SPEC owner to split it or drop `critical`. Never cite a partial test. |
| `harness paths lack partner change` | A Claude/Codex/Cursor file changed alone. | Change the partner files too, or add `Agent-Parity: none - <reason>`. |
| `.cursor/rules/<name>.mdc stale` | A Claude rule changed, the Cursor mirror did not. | `node scripts/gen-cursor-rules.mjs`, commit both. |
| `unreachable SPEC.md` | Nothing links to that spec. | Link it from the nearest `AGENTS.md` or `README.md`. |
| `managed file changed outside installer` (from `verify`) | A tool-owned file was hand-edited. | Restore it with `git checkout -- <path>` or `apply --write`, or keep the edit and accept that upgrades skip it. |

## Uninstall

From a repository:

```bash
node $SKILL uninstall .            # dry run: lists what would be deleted, edited, kept
node $SKILL uninstall . --write    # asks you to type "uninstall", then removes it
```

What happens:

| Kind of file | What uninstall does |
|---|---|
| Files the tool created (workflows, adapters, gate, hooks script, generated Cursor rules) | Deleted, if unchanged since install. Edited copies are kept and reported; add `--force` to delete them too. |
| `AGENTS.md`, `CLAUDE.md`, `.gitignore` | Only the cross-agent-sdd block or line is removed; your text stays. A file the tool created and that holds nothing else is deleted. |
| `.claude/settings.json`, `.codex/hooks.json`, `.cursor/hooks.json` | Only the reminder hook entry is removed; your other hooks and settings stay. A file the tool created and that holds nothing else is deleted. |
| `.agent-sdd/config.json`, `.agent-sdd/waivers.json`, `.agent-toolchain.json` | Deleted (Git history keeps them). |
| Your `SPEC.md` files, `changes-log.md` | Untouched. |
| Empty folders left behind | Removed. |

Options: `--write` perform; `--yes` skip the typed confirmation (for scripts, only after a person confirmed);
`--force` also delete edited tool files; `--allow-dirty` run with uncommitted changes present.

Not undone automatically: lines you added to Git hooks, CI, or `package.json` that run `scripts/check-sdd.mjs`.
The command reminds you at the end.

To remove the skill copies from your machine:

```bash
node skills/cross-agent-sdd/scripts/cross-agent-sdd.mjs uninstall-skill --scope user --agents all --write
```

Only folders this installer created are removed; anything else under those paths is left alone.
