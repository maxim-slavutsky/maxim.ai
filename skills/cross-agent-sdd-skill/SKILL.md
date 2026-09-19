---
name: cross-agent-sdd-skill
description: Audit, bootstrap, repair, or upgrade shared specification-driven development governance for Claude Code, Codex, and Cursor. Use when a repository needs canonical agent instructions, spec-first workflows, parity adapters, documentation/spec/config gates, or cross-operating-system skill installation; do not use for ordinary feature work inside an already-governed repository.
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
   - [configuration](references/configuration.md) for profiles, commands, and config-gate mapping;
   - [harness matrix](references/harness-matrix.md) before changing agent-specific files;
   - [migration policy](references/migration-policy.md) when target already has instructions or gates.
4. Run `plan`. Present conflicts and material choices before applying when they change repository policy.
5. Prefer a separate Git worktree for application. Run `apply --write` only after scope is established.
   Existing unowned files are conflicts; never add `--merge-agents`, replace hooks, or weaken a gate merely
   to make application succeed without inspecting the target.
6. Complete target-specific work the generator cannot infer safely:
   - merge the managed `AGENTS.md` block when required;
   - map actual runtime/config ownership in `.agent-sdd/config.json`;
   - wire `node scripts/check-sdd.mjs` into existing Git hooks and CI;
   - add or reconcile real module `SPEC.md` files without inventing behavior;
   - update package-manager aliases only when useful.
7. Run `verify`, the generated gate, and repository-native tests. Report remaining manual migration debt.
8. Do not commit, push, open a PR, merge, or delete a worktree unless the user requested that action.

## CLI

Resolve `scripts/cross-agent-sdd.mjs` relative to this `SKILL.md`; quote its absolute path when the skill
path contains spaces.

```text
node <skill>/scripts/cross-agent-sdd.mjs audit <repo> [--json]
node <skill>/scripts/cross-agent-sdd.mjs plan <repo> [--profiles core,sdd,config,helm] [--agents all]
node <skill>/scripts/cross-agent-sdd.mjs apply <repo> --write [--merge-agents] [--allow-dirty]
node <skill>/scripts/cross-agent-sdd.mjs verify <repo>
node <skill>/scripts/cross-agent-sdd.mjs install-skill --scope user|project --agents all --write
```

Defaults: profiles `core,sdd`; agents `claude,codex,cursor`; dry-run for every mutating command.

## Safety invariants

- Canonical policy lives under `docs/workflows`; adapters link it and contain native discovery only.
- Agent hooks remind after edits; Git hooks and CI enforce before integration.
- Generated files carry ownership metadata in `.agent-toolchain.json`.
- Upgrade or re-apply replaces a managed file only when its recorded hash still matches.
- User-owned conflicts stop application. `--force` never authorizes replacement of an unowned directory.
- Green structural gates do not prove intended behavior. Reconcile contract, evidence, and code manually.
- Never fabricate SPEC invariants or evidence citations from filenames or static guesses.
- Keep secrets, live configuration values, credentials, and organization-specific identifiers out of templates.
