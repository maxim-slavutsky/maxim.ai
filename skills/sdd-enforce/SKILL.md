---
name: sdd-enforce
description: Use when a repository needs one shared spec-driven development policy for Claude Code, Codex, and Cursor at once - missing or drifted agent instructions, rules/skills/hooks that no longer match across harnesses, absent docs-of-record or config gates, or an older sdd-enforce install to upgrade. Not for ordinary feature work inside an already governed repository.
argument-hint: "[audit | apply | verify | remove] [repo path]"
---

# SDD enforce: cross-agent SDD bootstrap

Create one tool-neutral SDD policy with thin Claude Code, Codex, and Cursor adapters, in a layout that matches a
docs standard: `AGENTS.md` and never `CLAUDE.md`, kebab-case concern docs under `docs/`, docs of record instead of
module `SPEC.md` files, and plans in the issue tracker. Use the bundled Node CLI for repeatable discovery and file
generation; use agent judgment for target-specific ownership, hook, and CI integration.

## Start

Arguments: `$ARGUMENTS`

1. **Pick the action.** Read the first word of the arguments line above.
   - `audit`, `apply`, `verify`, or `remove` (also `uninstall`): take that action. A second word is the target
     repository path. Without it, the target is the Git root of the current folder.
   - Nothing (the line is empty or still shows the literal placeholder), or any other word: show the menu and
     wait for the answer. In Claude Code, ask one single-select question with the question tool, "What should
     sdd-enforce do in this repository?", with these options in this order:

     | Option | Description |
     |---|---|
     | Audit (Recommended) | Report what the repository has, the suggested profiles, and what the gates would fail on. Changes nothing. |
     | Apply SDD | Install or upgrade the policy: audit, plan, and write only after your OK. |
     | Verify | Check that the installed files are intact and that both gates are green. Changes nothing. |
     | Remove | Uninstall: list what goes, and delete only after your explicit yes. |

     In other agents, ask the same question as a numbered list.

   Done when you know the action and the target repository.
2. **Run the action.**
   - **Audit**: run steps 1 and 2 of the required flow, then run `plan` (read-only). Report what exists, whether
     an older sdd-enforce version is installed, the suggested profiles, each old-format item with its action, and
     each `plan` conflict. End by offering Apply. Done when the report is in the reply and nothing was written.
   - **Apply SDD**: run the required flow below. On a repository with an older install, apply is the upgrade.
   - **Verify**: run `verify <repo>`. Report each failing line with its fix. Done when the report is in the reply.
   - **Remove**: follow [Removal](#removal).

## Required flow

1. Identify target Git root. Read existing `AGENTS.md`, `CLAUDE.md`, agent rules/skills/hooks, docs,
   package scripts, Git hooks, and CI configuration before proposing changes.
2. Run `audit`; treat its output as evidence, not permission to mutate. Its old-format list (`SPEC.md`,
   `CLAUDE.md`, non-kebab docs, `@spec` citations) is work for step 6: the gates fail on every item.
3. Select only applicable profiles and agents. Read:
   - [configuration](references/configuration.md) for profiles, commands, waivers, and config-gate mapping;
   - [harness matrix](references/harness-matrix.md) before changing agent-specific files;
   - [migration policy](references/migration-policy.md) when target already has instructions, gates, or an older install.
4. Run `plan`. Present conflicts, rules listed under "Not written", and material choices before applying when
   they change repository policy.
5. Prefer a separate Git worktree for application. Run `apply --write` only after scope is established.
   Existing unowned files are conflicts; never add `--merge-agents`, replace hooks, or weaken a gate merely
   to make application succeed without inspecting the target.
6. Complete target-specific work the generator cannot infer safely:
   - add the `AGENTS.md` tool lines with `--merge-agents` when required; set `docsStandardLine` in
     `.agent-sdd/config.json` when the organization has a docs standard line, then apply again;
   - map actual runtime/config ownership in `.agent-sdd/config.json`: `runtimeRoots`, `moduleRoots` (folders whose
     children are modules that a doc of record covers), `exclude`;
   - move every old-format item `audit` lists, in the same change: a module `SPEC.md` becomes
     `<workspace>/docs/<module>.md` with `covers:` globs and plain prose, without Tasks, Bugs, or Files tables
     (open work and bugs go to the issue tracker); `@spec` becomes `@invariant`; `CLAUDE.md` lines move into
     `AGENTS.md`; docs under `docs/` get kebab-case names. Never invent behavior;
   - wire both gates in the Git hook home (`.husky/` for JS, `.pre-commit-config.yaml` for pre-commit):
     `node scripts/check-docs.mjs && node scripts/check-sdd.mjs` in pre-commit, `--staged --commit-msg` in
     commit-msg, and in CI both static commands and `--changed` (static alone never inspects a commit). Call `node`
     directly, not through a package-manager wrapper;
   - regenerate `.cursor/rules/*.mdc` with `node scripts/gen-cursor-rules.mjs` after any `.claude/rules` edit;
   - fill the workspace filter table in `.claude/skills/committing-changes/SKILL.md`, the surfaces table in
     `docs/app-config.md`, and the rules index rows for repository-specific rules in `docs/agent-parity.md`;
   - update package-manager aliases only when useful.
7. Run `verify` (runs both gates), and repository-native tests. Report remaining manual migration debt.
   Commits already on a shared branch that fail a per-change gate go into `.agent-sdd/waivers.json` with a
   full SHA and a concrete reason; new work never gets a waiver.
8. Do not commit, push, open a PR, merge, or delete a worktree unless the user requested that action.

## CLI

Resolve `scripts/sdd-enforce.mjs` relative to this `SKILL.md`; quote its absolute path when the skill
path contains spaces.

```text
node <skill>/scripts/sdd-enforce.mjs audit <repo> [--json]
node <skill>/scripts/sdd-enforce.mjs plan <repo> [--profiles core,sdd,config,helm] [--agents all]
node <skill>/scripts/sdd-enforce.mjs apply <repo> --write [--merge-agents] [--replace <path,...>] [--allow-dirty]
node <skill>/scripts/sdd-enforce.mjs verify <repo>
node <skill>/scripts/sdd-enforce.mjs uninstall <repo> [--write] [--force] [--yes]
```

Defaults: profiles `core,sdd`; agents `claude,codex,cursor`; dry-run for every mutating command.

## Removal

When the user asks to remove the governance: run `uninstall <repo>` (dry run), show the user the list of
files marked delete and edit, and ask for an explicit yes in the conversation. Only after that yes run
`uninstall <repo> --write --yes`. Then tell the user what the tool
cannot undo: Git hook lines, CI steps, and package-manager aliases they added for `scripts/check-sdd.mjs`.

## Red flags under pressure

| Thought | Reality |
|---|---|
| "Just make the gate pass, we clean up later" | Red gate on legacy debt is the honest deliverable. Record it in the commit body. Never weaken, exclude, waive, or demote `critical` to get green. |
| "My test proves part of V<n>; I note the gap in a comment" | An `@invariant` citation claims the test proves the whole invariant. Partial proof is no evidence. Leave it red and propose an invariant split to the owner. |
| "User wants a commit, so a red gate blocks nothing" | Commit when asked, but subject and body must say the gate is red and why. Never report green. |
| "No time to inspect before `--merge-agents`" | Inspection is one file read. Merge without reading the target is a conflict, not a fix. |
| "I keep the SPEC.md and add a covers line" | A `SPEC.md` fails the gate whatever it holds. Move it to `<workspace>/docs/<module>.md`. |

## Safety invariants

- Canonical policy lives in concern docs under `docs/` (`doc-of-record.md`, `agent-parity.md`, `app-config.md`,
  `helm-validation.md`). A rule holds short imperatives and one link to its concern doc; the doc links the rule back.
- Path-scoped concern = Claude rule + `.agents/skills` adapter that links the same concern doc. Procedure = steps in
  `.claude/skills/<name>/SKILL.md`; the `.agents/skills/<name>` twin links it and copies none of it.
- `.cursor/rules/*.mdc` are generated from `.claude/rules/*.md`; edit the source and regenerate.
- Every rule `paths:` glob matches a file: apply keeps only live globs and skips a rule with none.
- Agent hooks remind after edits (`.claude/hooks/post-edit-reminder.mjs`); Git hooks and CI enforce before
  integration.
- Generated files carry ownership metadata in `.agent-toolchain.json`.
- Upgrade or re-apply replaces or deletes a managed file only when its recorded hash still matches.
- The tool owns lines of the root `AGENTS.md`: the pointer at `docs/doc-of-record.md` and, when configured,
  `docsStandardLine`. The rest of the file is the repository's. Older import lines and 0.4.0 blocks become these
  lines on upgrade; an edited 0.4.0 block is kept until `--replace AGENTS.md`.
- The tool never writes `CLAUDE.md`: a `CLAUDE.md` hides every `AGENTS.md` from Claude Code. Upgrade deletes the
  one-line import an older version created; any other `CLAUDE.md` is a conflict.
- The tool's map rows live in a marked block of `docs/map.md`; the repository's own rows stay outside it.
- The rules index is a table in `docs/agent-parity.md`, not a file in `.claude/rules`: a rule file without `paths`
  loads in every Claude Code session.
- Both gates skip `.claude/worktrees` (Claude Code worktrees are full repository copies inside the checkout).
- Trailer reasons may fold over continuation lines that start with a space; the gate joins them. The gate accepts
  `Spec-Impact:` as the old name of `Doc-Impact:`, because commits already on shared branches carry it.
- User-owned conflicts stop application. `--force` never authorizes replacement of an unowned directory.
- Waivers cover only commits already on a shared branch; `--staged` never reads them.
- `--yes` on `uninstall` stands for a confirmation the user gave in this conversation after
  seeing the dry-run list. Never pass it on your own initiative.
- Green structural gates do not prove intended behavior. Reconcile doc of record, evidence, and code manually.
- Never fabricate invariants or evidence citations from filenames or static guesses.
- Keep secrets, live configuration values, credentials, and organization-specific identifiers out of templates.
