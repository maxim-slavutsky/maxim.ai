---
name: cross-agent-sdd
description: Use when a repository needs one shared spec-driven development policy for Claude Code, Codex, and Cursor at once - missing or drifted agent instructions, rules/skills/hooks that no longer match across harnesses, absent SPEC, docs, or config gates, or installing this skill for every harness on Windows, macOS, or Linux. Not for ordinary feature work inside an already governed repository.
---

# Cross-agent SDD bootstrap

Create one tool-neutral SDD policy with thin Claude Code, Codex, and Cursor adapters. Use the bundled
Node CLI for repeatable discovery and file generation; use agent judgment for target-specific ownership,
hook, and CI integration.

## Required flow

1. Identify target Git root. Read existing `AGENTS.md`, `CLAUDE.md`, agent rules/skills/hooks, docs,
   package scripts, Git hooks, and CI configuration before proposing changes.
2. Run `audit`; treat its output as evidence, not permission to mutate.
3. Select only applicable profiles and agents. Read:
   - [configuration](references/configuration.md) for profiles, commands, waivers, and config-gate mapping;
   - [harness matrix](references/harness-matrix.md) before changing agent-specific files;
   - [migration policy](references/migration-policy.md) when target already has instructions or gates.
4. Run `plan`. Present conflicts and material choices before applying when they change repository policy.
5. Prefer a separate Git worktree for application. Run `apply --write` only after scope is established.
   Existing unowned files are conflicts; never add `--merge-agents`, replace hooks, or weaken a gate merely
   to make application succeed without inspecting the target.
6. Complete target-specific work the generator cannot infer safely:
   - merge the managed `AGENTS.md` block when required;
   - map actual runtime/config ownership in `.agent-sdd/config.json`: `runtimeRoots`, `moduleRoots` (folders whose
     children are modules that need a `SPEC.md`), `exclude`;
   - wire both gates: `node scripts/check-docs.mjs && node scripts/check-sdd.mjs` in pre-commit,
     `--staged --commit-msg` in commit-msg, and in CI both static commands and `--changed` (static alone never
     inspects a commit). Call `node` directly, not through a package-manager wrapper;
   - regenerate `.cursor/rules/*.mdc` with `node scripts/gen-cursor-rules.mjs` after any `.claude/rules` edit;
   - add or reconcile real module `SPEC.md` files without inventing behavior; fill the coverage and call-out
     tables in `docs/workflows/SPEC-FIRST-WORKFLOW.md`, the workspace filter table in
     `docs/workflows/COMMIT-WORKFLOW.md`, and the rule index rows for repository-specific rules;
   - update package-manager aliases only when useful.
7. Run `verify` (runs both gates), and repository-native tests. Report remaining manual migration debt.
   Commits already on a shared branch that fail a per-change gate go into `.agent-sdd/waivers.json` with a
   full SHA and a concrete reason; new work never gets a waiver.
8. Do not commit, push, open a PR, merge, or delete a worktree unless the user requested that action.

## CLI

Resolve `scripts/cross-agent-sdd.mjs` relative to this `SKILL.md`; quote its absolute path when the skill
path contains spaces.

```text
node <skill>/scripts/cross-agent-sdd.mjs audit <repo> [--json]
node <skill>/scripts/cross-agent-sdd.mjs plan <repo> [--profiles core,sdd,config,helm] [--agents all]
node <skill>/scripts/cross-agent-sdd.mjs apply <repo> --write [--merge-agents] [--replace <path,...>] [--allow-dirty]
node <skill>/scripts/cross-agent-sdd.mjs verify <repo>
node <skill>/scripts/cross-agent-sdd.mjs uninstall <repo> [--write] [--force] [--yes]
node <skill>/scripts/cross-agent-sdd.mjs install-skill --scope user|project --agents all --write
node <skill>/scripts/cross-agent-sdd.mjs uninstall-skill --scope user|project --agents all [--write] [--yes]
```

Defaults: profiles `core,sdd`; agents `claude,codex,cursor`; dry-run for every mutating command.

## Removal

When the user asks to remove the governance: run `uninstall <repo>` (dry run), show the user the list of
files marked delete and edit, and ask for an explicit yes in the conversation. Only after that yes run
`uninstall <repo> --write --yes`. The same rule applies to `uninstall-skill`. Then tell the user what the tool
cannot undo: Git hook lines, CI steps, and package-manager aliases they added for `scripts/check-sdd.mjs`.

## Red flags under pressure

| Thought | Reality |
|---|---|
| "Just make the gate pass, we clean up later" | Red gate on legacy debt is the honest deliverable. Record it in commit body and `changes-log.md`. Never weaken, exclude, waive, or demote `critical` to get green. |
| "My test proves part of V<n>; I note the gap in a comment" | A `@spec` citation claims the test proves the whole invariant. Partial proof is no evidence. Leave it red and propose an invariant split to the owner. |
| "User wants a commit, so a red gate blocks nothing" | Commit when asked, but subject and body must say the gate is red and why. Never report green. |
| "No time to inspect before `--merge-agents`" | Inspection is one file read. Merge without reading the target is a conflict, not a fix. |

## Safety invariants

- Canonical policy lives under `docs/workflows`; adapters link it and contain native discovery only.
- Path-scoped concern = Claude rule + `.agents/skills` adapter. Invocable workflow = skill in both
  `.claude/skills` and `.agents/skills`. Never both a rule and a skill for the same concern.
- `.cursor/rules/*.mdc` are generated from `.claude/rules/*.md`; edit the source and regenerate.
- Agent hooks remind after edits; Git hooks and CI enforce before integration.
- Generated files carry ownership metadata in `.agent-toolchain.json`.
- Upgrade or re-apply replaces a managed file only when its recorded hash still matches. Text edited inside the
  `AGENTS.md` markers is kept, never overwritten; `--replace AGENTS.md` takes the new block on request.
- `.claude/rules/INDEX.md` is generated from the shipped rules at apply and then belongs to the repository. It is
  not a rule: no mirror, no `.agents` twin, no parity partner.
- Both gates skip `.claude/worktrees` (Claude Code worktrees are full repository copies inside the checkout).
- Trailer reasons may fold over continuation lines that start with a space; the gate joins them.
- User-owned conflicts stop application. `--force` never authorizes replacement of an unowned directory.
- Waivers cover only commits already on a shared branch; `--staged` never reads them.
- `--yes` on `uninstall` or `uninstall-skill` stands for a confirmation the user gave in this conversation after
  seeing the dry-run list. Never pass it on your own initiative.
- Green structural gates do not prove intended behavior. Reconcile contract, evidence, and code manually.
- Never fabricate SPEC invariants or evidence citations from filenames or static guesses.
- Keep secrets, live configuration values, credentials, and organization-specific identifiers out of templates.
