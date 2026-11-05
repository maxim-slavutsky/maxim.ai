# sdd-enforce

One spec-driven development (SDD) policy for a repository, shared by Claude Code, Codex, and Cursor.

**In plain words:** your AI coding tools read instruction files from the repository before they change code.
Each tool wants those files in a different place and format. This skill writes one policy and thin per-tool
adapters that point at it. It adds a small hook that reminds the AI to update the docs that describe the code.
It also adds two gate scripts. They fail a commit when code changed but the doc that owns that code did not.

The generated layout fits a docs standard. It ships `AGENTS.md` and never `CLAUDE.md`, kebab-case file names
under `docs/` and one docs map. Specs stay in the issue tracker, never in files. Nothing here is specific to one product
or company. The generated files contain no secrets.

## Contents

- [Terms](#terms)
- [Install the skill](#install-the-skill)
- [Use it in a repository](#use-it-in-a-repository)
- [What gets installed into your repository](#what-gets-installed-into-your-repository)
- [What changes for the team](#what-changes-for-the-team)
- [CLI reference](#cli-reference)
- [Gate reference](#gate-reference)
- [Common gate messages](#common-gate-messages)
- [Uninstall](#uninstall)

## Terms

| Term | Meaning |
|---|---|
| doc of record | A Markdown file that states what one module does now: goal, constraints, interfaces, and invariants. Its `code:` line names the one folder it owns. |
| invariant | A numbered condition in a doc of record (`V1:`, `V2:`) that always holds. |
| concern doc | A doc directly under `docs/` that holds the full rules for one concern, for example `docs/agent-parity.md`. |
| rule | A short file in `.claude/rules/` that Claude Code loads when it reads a matching file. It links one concern doc. |
| skill | A procedure that someone starts, for example a commit. Its steps live in `.claude/skills/<name>/SKILL.md`. |
| spec | A plan for work that is not shipped yet. It lives in the issue tracker, never in the repository. |

## Install the skill

The skill ships in the `maxim-ai` plugin. This GitHub repository is the plugin marketplace: add it once,
then install the plugin from it. There is nothing to clone. Start a new session afterwards so the tool sees
the skill.

**Claude Code.** Inside Claude Code:

```text
/plugin marketplace add maxim-slavutsky/maxim.ai
/plugin install maxim-ai@maxim-ai
```

The skill shows as `/maxim-ai:sdd-enforce`. Update with `/plugin marketplace update maxim-ai`, then
`/plugin update maxim-ai@maxim-ai`.

**Codex.** Codex reads the same marketplace file:

```bash
codex plugin marketplace add maxim-slavutsky/maxim.ai
```

```bash
codex plugin add maxim-ai@maxim-ai
```

Or use `/plugins` inside Codex. Update with `codex plugin marketplace upgrade maxim-ai`.

**Cursor.** In the IDE: Customize, then From GitHub Repository, and enter
`https://github.com/maxim-slavutsky/maxim.ai`. Teams can add the same URL as a team marketplace in the Cursor
dashboard. From the Cursor CLI:

```bash
agent plugin marketplace add https://github.com/maxim-slavutsky/maxim.ai
```

Then install the `maxim-ai` plugin from that marketplace.

The plugin has no version number. Every install and update takes the latest commit on `main`. The CLI inside
it has its own version, 1.0.0. The `version` command prints it.

**Upgrading from `cross-agent-sdd`.** The skill was renamed from `cross-agent-sdd` to `sdd-enforce` in 0.6.0,
and the copy-to-home-folder installer was removed. Remove the old copies with the old script, then install the
plugin as above:

```bash
node ~/.claude/skills/cross-agent-sdd/scripts/cross-agent-sdd.mjs uninstall-skill --scope user --agents all --write
```

Repositories set up under the old name keep working. `apply` reads the old `cross-agent-sdd` markers in
`AGENTS.md` and `.gitignore` and replaces them on upgrade. See
[Upgrading a repository set up by an older version](#upgrading-a-repository-set-up-by-an-older-version).

## Use it in a repository

Two ways.

**Through your AI tool.** Open the repository and run the skill with no arguments, for example
`/maxim-ai:sdd-enforce` in Claude Code. The skill shows a menu with four actions:

| Action | What it does |
|---|---|
| Audit | Reports what the repository has and what the gates would fail on. Changes nothing. |
| Apply SDD | Installs or upgrades the policy. It runs an audit and a plan, and writes only after your OK. |
| Verify | Checks that the installed files are intact and that both gates are green. Changes nothing. |
| Remove | Lists what uninstall would delete, and deletes only after your explicit yes. |

To skip the menu, name the action: `/maxim-ai:sdd-enforce audit` or `/maxim-ai:sdd-enforce apply`. You can also
ask in your own words, for example "Set up sdd-enforce in this repo". During Apply the skill also does the parts
that a script cannot guess. It sets the folders that hold application code, moves old-format docs, and tells you
how to wire Git hooks and CI.

**Directly from a terminal.** Same result, you drive it.

Run these commands from the repository root. `<skill>` is the folder that the plugin installed, the one that
holds `SKILL.md`. In Claude Code it is under `~/.claude/plugins/cache/maxim-ai/maxim-ai/`. Any tool can tell
you the exact path. On Windows Command Prompt, replace `~` with `%USERPROFILE%`.

```bash
node <skill>/scripts/sdd-enforce.mjs audit .
```

Reports what is already in the repository and lists the old-format items that you must move by hand. Changes
nothing.

```bash
node <skill>/scripts/sdd-enforce.mjs plan .
```

Lists every file that `apply` would create, update, keep, merge, delete, or refuse. Changes nothing.

```bash
node <skill>/scripts/sdd-enforce.mjs apply . --write
```

Writes the files. Without `--write` it prints the plan and writes nothing. At the end it prints the next steps.

```bash
node <skill>/scripts/sdd-enforce.mjs verify .
```

Checks that every generated file is intact and runs both gates.

Every writing command is a dry run until you add `--write`. A file that already exists and was not created by
this tool is reported as a conflict and never overwritten.

## What gets installed into your repository

With the default profiles (`core,sdd`) and all three tools:

| Path | What it is | Who reads it |
|---|---|---|
| `AGENTS.md` | Standing repository policy. The tool owns one line below the first heading: `Before you edit code, read every doc of record that covers it: [doc of record](docs/doc-of-record.md).` When `docsStandardLine` is set, the tool also owns that line, above the pointer. The tool creates the file if it is missing. An existing file without the lines gets them only when you pass `--merge-agents`. The rest of the file is yours. | every tool, people |
| `docs/doc-of-record.md` | Concern doc: the shape of a doc of record, the evidence rules, and the rules for reading and updating a doc. | every tool, people |
| `docs/agent-parity.md` | Concern doc: the partner rules for Claude Code, Codex, and Cursor files. It also holds the rules index (scope, concern doc, and trigger of each rule), rendered from the shipped rules. Add rows for your own rules. | every tool, people |
| `docs/map.md` | The docs map: which kind of doc goes where. The tool writes its rows between `<!-- sdd-enforce:start -->` and `<!-- sdd-enforce:end -->`. It creates the file, or adds the block to your file. Your rows outside the block stay. | every tool, people |
| `.claude/rules/doc-of-record.md`, `.claude/rules/agent-parity.md` | Claude Code path rules. Each rule holds three to six short imperatives and one link to its concern doc. The `doc-of-record` rule loads for files under your `runtimeRoots`. | Claude Code |
| `.cursor/rules/*.mdc` | The same rules for Cursor, generated from `.claude/rules` by `scripts/gen-cursor-rules.mjs`. Never edit them by hand. | Cursor |
| `.agents/skills/<name>/` | Codex and Cursor adapters, each with `agents/openai.yaml` display metadata. The adapter of a rule links the same concern doc as the rule. The twin of a skill links the Claude skill. | Codex, Cursor |
| `.claude/skills/commit-changes/` | The commit skill: tests, the owner-doc check, the gate trailers, exact staging, and the commit. It works from `git status` and `git diff`. | Claude Code, and Codex and Cursor through its twin |
| `.claude/settings.json`, `.codex/hooks.json`, `.cursor/hooks.json` | One post-edit hook entry per tool. Your other settings stay. | each tool |
| `.claude/hooks/post-edit-reminder.mjs` | The hook script. After the AI edits a file, it reminds the AI to update each doc of record that covers the file and to run the gate. | each tool |
| `scripts/check-docs.mjs` | The docs gate: the docs exist, other docs link them, and they follow the docs standard. See [Gate reference](#gate-reference). | Git hooks, CI, people |
| `scripts/check-sdd.mjs` | The SDD gate: links, docs of record, evidence, agent parity, and each commit. See [Gate reference](#gate-reference). | Git hooks, CI, people |
| `scripts/sdd-lib.mjs` | Code that both gates share: the file walk, glob matching, and frontmatter parsing. | the gates |
| `scripts/gen-cursor-rules.mjs` | The generator for `.cursor/rules`. | people, the gate |
| `.agent-sdd/config.json` | Gate configuration. Edit this file. See [Configuration keys](#configuration-keys). | the gates, this tool |
| `.agent-sdd/waivers.json` | Commits that the CI gate may skip, each with a reason. It starts empty. | the gate |
| `.agent-toolchain.json` | The list of files that this tool owns, with hashes, so upgrades replace only untouched files. | this tool |

The tool never writes a `CLAUDE.md`. A `CLAUDE.md` hides every `AGENTS.md` from Claude Code, so the
repository ships `AGENTS.md` only.

Each rule glob must match a file. Apply drops every `paths:` glob that matches no file after apply. A rule
with no glob left is not written, and neither is its adapter. `plan` lists such a rule under "Not written".
For example, the `agent-parity` rule drops `.codex/**` when Codex is not enabled and the repository has no
`.codex/` files.

Optional profiles add more:

- `config`: the concern doc `docs/app-config.md`, the rule `app-config-updates` with its adapter, and a gate
  check. Use it when the same runtime config keys live in several files (local JSON, shipped JSON, schema,
  reader, Helm values). You describe the files in `configGroups` in `.agent-sdd/config.json`.
- `helm`: the concern doc `docs/helm-validation.md` and the skill `validating-helm-charts` (`helm lint`,
  `helm template`, `kubeconform`). You list the charts in `helmCharts`.

The tool never commits, pushes, or opens pull requests. It does not write Git hooks or CI files either. Review
the diff, wire the gates (see [Gate reference](#gate-reference)), then commit it yourself.

## What changes for the team

- **Each module has a doc of record.** It states what the module does now. It lives in
  `<workspace>/docs/<module>.md`, or in the root `docs/<module>.md` when its code is in no workspace. Its
  frontmatter has a stable `id:` and one `code:` folder that it owns. The headings are Goal,
  Constraints, Interfaces, and Invariants, in plain prose. Only Goal is required. The full shape is in
  `docs/doc-of-record.md`.
- **Open work goes to the issue tracker.** A doc of record has no task, bug, or file tables. A spec lives in
  its ticket. A wire shape that two sides depend on goes in an API contract (`docs/<subject>-contract.md`). A
  decision that is hard to reverse goes in an ADR under `docs/adr/`.
- **Critical invariants have tests.** An invariant listed under `critical:` needs a test file that contains
  `@invariant <id>:V<n>` in a test title or a comment.
- **Docs must exist.** Every app or package folder needs an `AGENTS.md`. Every module folder under
  `moduleRoots` needs a doc of record whose `code:` is that folder or a folder inside it. The `README.md` of
  each `docs/` folder lists its docs of record, and the nearest `AGENTS.md` links that index. The
  `check-docs` gate stops a commit that breaks this.
- **Change the code, change its doc.** The owner of a runtime file is the doc of record with the longest
  `code:` folder that holds it. When no doc holds it, the owner is the workspace `AGENTS.md`. When a commit
  changes a runtime file and not its owner, the gate stops the commit. The message must then explain why:
  `Doc-Impact: none - <at least 8 words naming the files and why behavior cannot change>`. A long reason can
  fold over several lines. Start each continuation line with one space, like a Git trailer.
- **Tools move together.** When a Claude rule or a hook config changes without its partners, the gate fails.
  The message must then say why: `Agent-Parity: none - <reason naming the files>`. A skill and its twin can
  change alone, because the twin only links the skill.
- **Old history is not rewritten.** A commit already on a shared branch that a new gate rejects goes into
  `.agent-sdd/waivers.json`. The entry has the full SHA and a reason of at least 12 words. Only the CI range
  check reads waivers. Local hooks never read them, so new work always has to pass.

## CLI reference

```text
node <skill>/scripts/sdd-enforce.mjs <command> [arguments]
```

`<skill>` is the folder that the plugin installed. See [Use it in a repository](#use-it-in-a-repository).

| Command | Writes files | Purpose |
|---|---|---|
| `audit <repo> [--json]` | no | Report the branch, existing agent files, `docs/map.md`, config-like files, Helm charts, package manager, CI type, and suggested profiles. List each old-format item that you must move by hand. |
| `plan <repo> [options]` | no | List every file that `apply` would create, update, keep, merge, delete, or refuse, with a reason. List the rules that are not written. |
| `apply <repo> [options]` | only with `--write` | Write the planned files atomically. Refuse when the plan has conflicts or the working tree has uncommitted changes. Print the next steps. |
| `verify <repo> [--json]` | no | Check every tool-owned file against its recorded hash and check the hook configs. Then run `scripts/check-docs.mjs` and `scripts/check-sdd.mjs`. Exit code 1 on any problem. |
| `uninstall <repo> [options]` | only with `--write` | Remove everything that `apply` added. See [Uninstall](#uninstall). |
| `version` | no | Print the version. |
| `help` | no | Print usage. |

Options for `plan` and `apply`:

| Option | Meaning |
|---|---|
| `--profiles core,sdd,config,helm` or `full` | File sets to install. `core` and `sdd` are always included. Default: `core,sdd`, or the profiles that `.agent-sdd/config.json` already lists. |
| `--agents all` or `claude,codex,cursor` | Tools to configure. Default: all three. |
| `--merge-agents` | Add the tool lines below the first heading of an existing `AGENTS.md` that lacks them. Read the file first. |
| `--replace <path>[,<path>]` | Write the tool version of these tool-owned files, even if you edited them or they existed before install. They become tool-owned: upgrades update them and `uninstall` deletes them. |
| `--allow-dirty` | Apply with uncommitted changes present. Not recommended, because you lose the clean one-diff review. |
| `--write` | Write the files. Without it, `apply` is a dry run. |
| `--json` | Machine-readable output (`plan`, `audit`, `verify`). |

Plan action words:

| Word | Meaning |
|---|---|
| `create` | New file. |
| `preserve` | Already correct. The tool leaves it alone. |
| `update` | The tool-owned part of your file is refreshed. For example, an old import line in `AGENTS.md` becomes the pointer line. |
| `update-generated` | A tool-owned file is upgraded, because its hash still matches. |
| `keep` | Left alone and skipped by this upgrade. It is a tool-owned file that you edited, or a file that had the tool's content before the first apply. |
| `merge` | Your file stays and the tool adds its entries. |
| `delete` | An unedited file that an older version generated and this version no longer ships. Or an older tool part that is no longer needed, such as the one-line `CLAUDE.md`. |
| `conflict` | The file exists and the tool does not own it. Nothing is written. |

Files from an earlier apply that your current `--profiles` no longer include stay on disk and stay tracked.
The plan lists them. `uninstall` removes them, or you delete them by hand.

Exit codes: `0` success or a clean dry run, `1` any error, conflict, or failed verification.

## Gate reference

Two scripts check the repository. `scripts/check-docs.mjs` checks that the docs exist, that other docs link
them, and that they follow the docs standard. `scripts/check-sdd.mjs` checks links, docs of record, evidence,
agent parity, and each commit. Together, the gates fail on every old-format item. There is no debt list, so
the install change must move every item.

| Command | When | Checks |
|---|---|---|
| `node scripts/check-docs.mjs` | pre-commit hook, CI, any time | Docs exist, are linked, and follow the docs standard. |
| `node scripts/check-sdd.mjs` | pre-commit hook, CI, any time | Links, docs of record, evidence, agent parity, config groups, and Helm charts. |
| `node scripts/check-sdd.mjs --staged --commit-msg <path>` | commit-msg hook (`$1`) | The static checks, plus the staged change: each staged runtime file changed with an owner, or the message has an accepted `Doc-Impact: none -` line. Harness files changed with their partners, or the message has `Agent-Parity: none -`. |
| `node scripts/check-sdd.mjs --changed [--base <ref>]` | CI | The same per-commit checks for every commit since the base. It honors `.agent-sdd/waivers.json`. |

`check-docs` fails on:

- a workspace under `runtimeRoots` (a folder with a package manifest) without an `AGENTS.md`
- a module folder under `moduleRoots` that no doc of record covers
- a doc of record that the `README.md` index of its `docs/` folder does not list, and an index that the
  nearest `AGENTS.md` does not link
- a root `AGENTS.md` that does not link `docs/doc-of-record.md`
- a root `AGENTS.md` without the exact `docsStandardLine`, when the config sets one
- any `CLAUDE.md`
- a doc under `docs/` whose name is not kebab-case (`README.md` and `AGENTS.md` are allowed)
- an `AGENTS.md` of 200 lines or more, or a `SKILL.md` of 500 lines or more
- a skill whose frontmatter `name` differs from its folder name
- a skill `description` of more than 1,024 characters
- a rule `paths:` glob that matches no file
- a missing root `AGENTS.md` or `README.md`, a root `README.md` with only headings, and a `GLOSSARY.md` term
  that is a writing term of the docs standard
- a hit of a migration detect check of the docs standard: a plan file, `CONTEXT.md`, "spec of record", an ADR
  status in the body, research sent to a scratchpad, a `## Writing` section in a glossary
- an ADR status that is not a standard form, a superseding ADR that does not name the old one, a research
  note without its frontmatter and sections, an open check box in a living doc, and an API contract that no
  `AGENTS.md` links

`check-sdd` fails on:

- a Markdown link to a file that does not exist
- an `AGENTS.md` or a doc of record that no other Markdown file links (the root `AGENTS.md` is exempt)
- any `SPEC.md`, and any `@spec <id>:V<n>` citation (the message names the new form)
- a doc of record without a valid `id:` or without a `code:` folder
- a `code:` folder that does not exist, that is outside the workspace of the doc, or that two docs name
- a rule without `paths:`, and a Claude rule without its `.agents` twin
- a duplicate doc id, a duplicate invariant id, or a `critical:` entry that has no invariant
- a `Tasks`, `Bugs`, `§T`, or `§B` heading in a doc of record
- an `@invariant` citation of an unknown doc or invariant
- a critical invariant that no test file cites
- a Claude skill without its `.agents` twin, or an `.agents` folder without a Claude rule or skill of the
  same name
- a missing `agents/openai.yaml` when Codex is enabled
- a rule that does not link exactly one concern doc, or a concern doc that does not link its rule back
- an adapter that does not link the concern doc of its rule, or a twin that does not link its skill
- a stale, missing, or stray `.cursor/rules/*.mdc`
- a hook config that does not run `.claude/hooks/post-edit-reminder.mjs`
- config groups and Helm charts that do not match the files, when those profiles are on

CI must run the static commands and `--changed`. The static commands alone never look at what a commit changed.

Put the hook lines in `.husky/` for a JavaScript repository, or in `.pre-commit-config.yaml` for the
pre-commit framework. The tool does not write these files.

| Place | Command |
|---|---|
| pre-commit hook | `node scripts/check-docs.mjs && node scripts/check-sdd.mjs` |
| commit-msg hook | `node scripts/check-sdd.mjs --staged --commit-msg $1` |
| CI | `node scripts/check-docs.mjs && node scripts/check-sdd.mjs && node scripts/check-sdd.mjs --changed` |

Call `node` directly in hooks. A package-manager wrapper (`pnpm check-sdd`) adds seconds of start-up per gate.

The base for `--changed` is the first value that is set: `--base`, `SDD_BASE_REF`, `origin/<CHANGE_TARGET>`
then `<CHANGE_TARGET>`, `GIT_PREVIOUS_COMMIT`, `GIT_PREVIOUS_SUCCESSFUL_COMMIT`, and `HEAD^`. When Git cannot
resolve an explicit value, the gate fails. It does not silently check one commit.

### Configuration keys

`.agent-sdd/config.json` keys:

| Key | Meaning |
|---|---|
| `runtimeRoots` | Folders that hold application code (`apps`, `packages`, `src`). Each runtime file in them needs an owner. Each workspace inside needs an `AGENTS.md`. The `doc-of-record` rule loads for `<root>/**` of each folder. Detected at install. |
| `moduleRoots` | Folders whose direct children are modules that a doc of record must cover (`apps/*/src/modules`, where `*` is one path segment). Detected once at install, and yours afterwards. An empty list turns the module check off. |
| `exclude` | Names that the gates skip anywhere (`vendor`), or repo-relative prefixes (`apps/samples`). The gates always skip `.claude/worktrees`, because Claude Code worktrees are full repository copies. |
| `configGroups` | For the `config` profile: `{ name, source, surfaces: [{ path, mode: "json" \| "text" }] }`. |
| `helmCharts` | For the `helm` profile: the chart folders that contain `Chart.yaml`. |
| `docsStandardLine` | One line that your docs standard asks every root `AGENTS.md` to carry. Empty by default. When it is set, `apply` adds the line to the root `AGENTS.md`, above the pointer line. `check-docs` then fails when the line is missing. |
| `agents`, `profiles` | What was installed. The gate uses `agents` to decide which partners to require. |

After you change `docsStandardLine` or `runtimeRoots`, commit the config change and run `apply` again.
`apply` needs a clean working tree.

Generate the Cursor rules after you edit any `.claude/rules/*.md`:

```bash
node scripts/gen-cursor-rules.mjs
```

## Common gate messages

Every message ends with what to do. The most frequent ones:

| Message contains | Meaning | Fix |
|---|---|---|
| `runtime paths lack an owner change` | You changed code but none of its owners: no doc of record that covers it and no workspace `AGENTS.md`. | Update an owner in the same commit. Or add `Doc-Impact: none - <8+ words naming the files and why>` to the commit message. |
| `rejected Doc-Impact trailer` | The `none -` reason is too short or too generic, or it does not name the files. | Rewrite the reason. Name each file, say what changed, and say why behavior cannot change. |
| `critical invariant lacks executable evidence` | An invariant under `critical:` has no test that cites it. | Add `@invariant <id>:V<n>` to a real test that proves the whole invariant. Or ask the owner of the doc to split the invariant or drop `critical`. Never cite a partial test. |
| `harness paths lack partner change` | A Claude, Codex, or Cursor file changed alone. | Change the partner files too, or add `Agent-Parity: none - <reason>`. |
| `.cursor/rules/<name>.mdc stale` | A Claude rule changed, but its Cursor copy did not. | Run `node scripts/gen-cursor-rules.mjs` and commit both files. |
| `unreachable doc of record` | No other doc links that doc of record. | Link it from the nearest `AGENTS.md` or `README.md`. |
| `a module doc is no longer a SPEC.md` | A `SPEC.md` from a version before 1.0.0 is still there. | Move it to a doc of record. See [From 0.6.0 to 1.0.0](#from-060-to-100). |
| `is the citation form before 1.0.0` | A test or doc still cites `@spec <id>:V<n>`. | Write `@invariant <id>:V<n>` instead. |
| `does not belong in a doc of record` | A doc of record has a Tasks or Bugs section. | Move open work and bugs to the issue tracker and delete the section. |
| `missing AGENTS.md: <folder>` (`check-docs`) | An app or package folder has no `AGENTS.md`. | Write one with its gotchas and links to its docs of record. |
| `module not covered: <folder>` (`check-docs`) | No doc of record covers a module folder under `moduleRoots`. | Write the doc per `docs/doc-of-record.md` and link it from the workspace `AGENTS.md`, in the same commit. |
| `AGENTS.md does not link docs/doc-of-record.md` (`check-docs`) | The pointer line was removed from the root `AGENTS.md`. | Put the line back. Without it, agents skip the docs of record. |
| `the repository ships AGENTS.md, never CLAUDE.md` (`check-docs`) | A `CLAUDE.md` is in the repository. | Move each line that `AGENTS.md` lacks into the `AGENTS.md` beside it. Then delete the `CLAUDE.md`. |
| `a doc under docs/ needs a kebab-case name` (`check-docs`) | A doc under `docs/` has capital letters or underscores in its name. | Run the `git mv` command that the message shows, then update every link. |
| `matches no file, so the rule never loads` (`check-docs`) | A rule glob matches nothing, so the rule never loads. | Fix the glob or remove it. |
| `still runs scripts/hooks/post-edit-reminder.mjs` | A hook config uses the hook path from before 1.0.0. | Run `apply --write`. It moves the hook to `.claude/hooks/`. |
| `a CLAUDE.md hides every AGENTS.md from Claude Code` (`plan`) | A `CLAUDE.md` that the tool did not create blocks `apply`. | Move its lines into `AGENTS.md`, delete it, then run `apply` again. |
| `this file already exists without the tool lines` (`plan`) | Your `AGENTS.md` lacks the pointer line. | Read the file, then run `apply` with `--merge-agents`. |
| `no file matches its paths` (`plan`, under "Not written") | No file matches any glob of a rule. | Set `runtimeRoots` in `.agent-sdd/config.json`, or add the files. Then run `apply` again. |
| `the old cross-agent-sdd block was edited after install` (`plan`) | You wrote inside the block that version 0.4.0 managed. | Move your text outside the markers. Then run `apply --write --replace AGENTS.md`. |
| `no longer shipped, and it is yours` (`plan`) | You edited a file that an older version generated. | Move your text to the new home that the reason names. Then delete the file. |
| `managed file changed outside installer` (`verify`) | A tool-owned file was edited by hand. | Keep the edit: `apply` then lists the file as `keep` and skips it on every upgrade. Or take the tool version back, see [Taking the tool version back](#taking-the-tool-version-back). Prefer `.agent-sdd/config.json` over edits to a gate script, so upgrades keep working. |

### Upgrading a repository set up by an older version

Run `plan .` first. Files that you never touched show `update-generated` and get the new text. Files that you
edited show `keep` and stay yours. A file that the new version ships and that you already wrote by hand shows
`conflict`. Compare the two files. Then move yours aside, or adopt the tool version with
`apply . --write --replace <path>`. Then run `verify`, which runs both gates.

#### From 0.6.0 to 1.0.0

Version 1.0.0 is a breaking change. Module `SPEC.md` files become docs of record, and the layout follows the
docs standard.

What `apply` does for you:

- It deletes each retired file that the tool generated and you did not edit. These are
  `docs/workflows/*-WORKFLOW.md`, `docs/agent-sdd/FORMAT.md`, `scripts/hooks/post-edit-reminder.mjs`, the
  `spec-first` and `finishing-branch-commit-order` rules with their Cursor copies, and the old `spec-first`,
  `commit-changes`, and `validate-helm-charts` skills and adapters.
- It writes the new files in their place: `docs/doc-of-record.md`, `docs/agent-parity.md`,
  `docs/app-config.md`, `docs/helm-validation.md`, the `doc-of-record` rule and adapter, the
  `commit-changes` and `validating-helm-charts` skills, `.claude/hooks/post-edit-reminder.mjs`, and
  `scripts/sdd-lib.mjs`.
- It replaces the line `@./docs/workflows/SPEC-FIRST-WORKFLOW.md` in `AGENTS.md` with the pointer line. Your
  other text stays.
- It deletes the one-line `@AGENTS.md` `CLAUDE.md` that an older version created. Any other `CLAUDE.md` is a
  conflict. Move its lines into `AGENTS.md` and delete it before you apply.
- It removes the `changes-log.md` block from `.gitignore`. It deletes `.gitignore` when the tool created the
  file and nothing else is left.
- It moves the hook command in `.claude/settings.json`, `.codex/hooks.json`, and `.cursor/hooks.json` to
  `.claude/hooks/post-edit-reminder.mjs`.
- It creates `docs/map.md` with the tool rows, or adds the block to your file.
- It adds `docsStandardLine` (empty) to `.agent-sdd/config.json`.

A retired file that you edited stays (`keep`). The gate then fails on it, for example on its old upper-case
name. Move your text to its new home, then delete the file. Git no longer ignores a local `changes-log.md`, so
delete it too.

What you move by hand: there is no migrate command, because moving prose and tables needs judgment. Run
`audit .`. It lists each old-format item. The gates fail on each one, so the install change must move them all.

| Item | What to do |
|---|---|
| `SPEC.md` | Move it to `<workspace>/docs/<module>.md`. Keep its `id` and its invariant numbers, because tests cite them. Add a `code:` folder and a row in the index of its `docs/` folder. Use the headings Goal, Constraints, Interfaces, and Invariants, in plain prose. Drop the Tasks, Bugs, and Files tables, and move open work and bugs to the issue tracker. Link the new doc from the workspace `AGENTS.md`. |
| `@spec <id>:V<n>` in a test or a doc | Rewrite it as `@invariant <id>:V<n>`. |
| `CLAUDE.md` | Move each line that `AGENTS.md` lacks into the `AGENTS.md` beside it. Then delete the file. An `@AGENTS.md` line moves nowhere. |
| A doc under `docs/` with a name that is not kebab-case | Rename it with `git mv` and update every link. |
| The `.gitignore` block | Nothing. `apply` removes it. |

Old commit messages with `Spec-Impact:` stay valid. Waivers for the gate name `spec-impact` stay valid too.
New commits use `Doc-Impact:`, and new waivers use `doc-impact`.

#### From 0.4.0

The `AGENTS.md` block that 0.4.0 managed becomes the tool lines (`update`). A block that you edited stays
(`keep`) until you run `apply --write --replace AGENTS.md`. An unedited `.claude/rules/INDEX.md` is removed
(`delete`). Its table now lives in the rules index of `docs/agent-parity.md`. Then follow
[From 0.6.0 to 1.0.0](#from-060-to-100).

### Taking the tool version back

One command, the same for an edit that you committed and for a file that existed before install:

```bash
node <skill>/scripts/sdd-enforce.mjs apply . --write --replace scripts/check-sdd.mjs
```

The file gets the tool version and becomes tool-owned. Later upgrades update it and `uninstall` deletes it.
For several files, separate the paths with commas. Commit or discard other changes first, as for any `apply`.
Then commit the result. `verify` is green again.

Do not delete the file and commit the deletion first. The pre-commit hook runs the gate, and that commit fails
while `scripts/check-sdd.mjs` is missing.

## Uninstall

From a repository:

```bash
node <skill>/scripts/sdd-enforce.mjs uninstall .
```

This is a dry run. It lists what would be deleted, edited, or kept, and changes nothing.

```bash
node <skill>/scripts/sdd-enforce.mjs uninstall . --write
```

It asks you to type `uninstall`, then removes the files.

What happens:

| Kind of file | What uninstall does |
|---|---|
| Files that the tool created (concern docs, rules, adapters, skills, gates, the hook script, generated Cursor rules) | Deleted, if unchanged since install. Edited copies are kept and reported. Add `--force` to delete them too. |
| Files that had the same content before install | Kept. The tool did not create them, so it does not delete them. |
| `AGENTS.md` | Only the tool lines are removed: the pointer, the docs standard line, and an old import line. Your text stays. A file that the tool created and that holds nothing else is deleted. |
| `docs/map.md` | Only the `sdd-enforce` block is removed. A file that the tool created and that holds only the block and its heading is deleted. |
| `.claude/settings.json`, `.codex/hooks.json`, `.cursor/hooks.json` | Only the reminder hook entry is removed. Your other hooks and settings stay. A file that the tool created and that holds nothing else is deleted. |
| `CLAUDE.md` and `.gitignore` from an install before 1.0.0 that was never upgraded | Only the old `@AGENTS.md` line or the `changes-log.md` block is removed. Your text stays. |
| `.agent-sdd/config.json`, `.agent-sdd/waivers.json`, `.agent-toolchain.json` | Deleted. Git history keeps them. |
| Your docs of record | Untouched. They stay useful without the gate. |
| Empty folders left behind | Removed. |

Options: `--write` performs the removal. `--yes` skips the typed confirmation, for scripts, and only after a
person has confirmed. `--force` also deletes edited tool files. `--allow-dirty` runs with uncommitted changes
present.

Uninstall does not undo the lines that you added to `.husky/`, `.pre-commit-config.yaml`, CI, or
`package.json` to run `scripts/check-docs.mjs` or `scripts/check-sdd.mjs`. The command reminds you at the end.

To remove the skill from your machine, uninstall the plugin: `/plugin uninstall maxim-ai@maxim-ai` in Claude
Code, `codex plugin remove maxim-ai@maxim-ai` in Codex, or the plugin settings in Cursor. Repositories set up
with the skill keep working without it.
