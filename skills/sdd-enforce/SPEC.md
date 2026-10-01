---
id: sdd-enforce.gates
critical:
  - V1
  - V2
  - V3
  - V4
  - V5
  - V6
  - V7
  - V8
  - V9
  - V10
  - V11
  - V12
  - V13
  - V14
  - V15
---

# sdd-enforce generated gates

## Goal

Generated repository gates preserve documentation, SPEC, evidence, agent-parity & configured runtime-config
contracts w/o rejecting their documented valid formats.

## Invariants

V1: Tasks & Bugs ledgers read from heading → next level-two heading | absolute EOF; blank lines & table
header/separator rows before `T<n>|...` | `B<n>|...` data valid.
V2: ∀ `.claude/rules/<n>.md` (≠ `INDEX.md`) → `.cursor/rules/<n>.mdc` = `scripts/gen-cursor-rules.mjs` output.
Stale | missing | stray `.mdc` → gate fail. ⊥ hand-edit `.mdc`. Legacy `INDEX.md` (≤ 0.4.0 rules index) excluded
everywhere: generator, adapter link check **& the per-commit partner check**; ⊥ a rule ∴ ⊥ mirror, ⊥ `Agent-Parity`.
V3: `--changed` base = first of `--base`, `SDD_BASE_REF`, `origin/<CHANGE_TARGET>` | `<CHANGE_TARGET>`,
`GIT_PREVIOUS_COMMIT`, `GIT_PREVIOUS_SUCCESSFUL_COMMIT`, `HEAD^`. Explicit source (`--base`, `SDD_BASE_REF`,
`CHANGE_TARGET`) unresolvable → fail; ⊥ silent fallback to `HEAD^`.
V4: `.agent-sdd/waivers.json` entry `{commit: full 40-hex sha, gates ⊆ {spec-impact, agent-parity}, reason ≥ 12
words}` skips named gates for that commit in `--changed` only. `--staged` ⊥ reads waivers. Malformed file →
gate fail.
V5: codex enabled → ∀ `.agents/skills/<n>` ! `agents/openai.yaml`. ∀ adapter (`.claude/skills`, `.agents/skills`,
`.claude/rules`, `.cursor/rules`) links exactly 1 `docs/workflows/*.md`; that workflow links adapter back.
Back-link to `.claude/rules/<n>.md` covers generated `.cursor/rules/<n>.mdc`; failure names the source rule.
V6: `uninstall` touches only `.agent-toolchain.json`-owned content. Generated file deleted only when hash
matches record (| `--force`). Appended block | line | hook entry removed, rest of file kept; file deleted only
when install created it & nothing else remains. Mode `preserved` → untouched. Dry run default; `--write` needs
typed `uninstall` on TTY | `--yes`; non-TTY w/o `--yes` → refuse, nothing changed.
V7: manifest = ∀ file installer wrote & still on disk, incl. after re-apply w/ fewer profiles. Generated file
found identical before first apply → `mode: preserved` = repository-owned: plan `keep` ∀ later template, verify
⊥ hash-checks it, uninstall keeps it. Generated file edited after install (hash ≠ record) → plan `keep`, record
unchanged, apply proceeds for rest; ⊥ conflict, ⊥ overwrite. `apply --write --replace <path>` → tool version
written, mode `created`; unknown path → fail. Any `create` action → mode `created` (delete + re-apply adopts
too). ⊥ procedure w/ intermediate commit lacking the gate file (pre-commit gate fails).
V8: hook config (`.claude/settings.json` | `.codex/hooks.json` | `.cursor/hooks.json`) changed → ∀ other enabled
hook config changed in same commit | `Agent-Parity` trailer. Changed file ⊥ own partner. `scripts/hooks/*`
needs no partner.
V9: gate ⊥ reads `.claude/skills/<n>/`, `.agents/skills/<n>/`, `.cursor/skills/<n>/`, n ∈ {`sdd-enforce`,
`cross-agent-sdd` (former name)} (skill installed in-repo = tooling, ≠ policy): no doc links, SPEC ids,
adapter shape, parity, or change-impact from those paths.
V10: `Spec-Impact: none - <reason>` | `Agent-Parity: none - <reason>` reason folds git-trailer style: ∀ following
line starting w/ whitespace = continuation, joined w/ space; line w/o leading whitespace ends reason. Commit linters
cap body lines @ 100 chars ∴ reason naming ≥5 files ⊥ fits 1 line.
V11: `scripts/check-docs.mjs` (core) fails on: workspace (dir w/ package manifest) under `runtimeRoots` w/o
`AGENTS.md`; module dir under `moduleRoots` glob (`*` = 1 segment) w/o `SPEC.md`; module `SPEC.md` ⊥ linked
(`<module>/SPEC.md` substring) from nearest `AGENTS.md` above; `sdd` profile & root `AGENTS.md` w/o line
`@./docs/workflows/SPEC-FIRST-WORKFLOW.md`. Existence only, ⊥ content. `verify` runs check-docs then check-sdd;
either red → verify red. `moduleRoots` detected once (`<runtimeRoot>/*/src/modules` when ∃), then config-owned.
V12: both gates skip `.claude/worktrees/` prefix always (⊥ via config): Claude Code worktree = full repo copy
inside checkout ∴ duplicate SPEC ids & dangling links from another branch.
V13: root `AGENTS.md`: tool owns 1 line `@./docs/workflows/SPEC-FIRST-WORKFLOW.md` (record `managed-line`); rest =
repository's; ⊥ restated rules. Missing file → create header + line. File w/ line anywhere → `preserve`. File w/o line
→ conflict unless `--merge-agents` (append). Legacy 0.4.0 block (markers): hash = record → `update` to line; hash ≠
record → `keep` w/ reason; `--replace AGENTS.md` → line. `verify` ⊥ checks AGENTS.md beyond check-docs import line.
Uninstall removes line | legacy block, keeps rest.
V14: rules index = table (rule | scope globs | workflow | description) in `docs/workflows/AGENT-PARITY-WORKFLOW.md`,
rendered @ apply from shipped `.claude/rules/*.md` of selected profiles. ⊥ `.claude/rules/INDEX.md` generated: rule
file w/o `paths` loads ∀ Claude Code session. Legacy `INDEX.md` recorded `generated`: hash = record → plan `delete`;
edited → `keep` w/ reason, record kept. Gates still skip legacy `INDEX.md` (V2).
V15: markers keep former skill name: `.gitignore` block `# cross-agent-sdd:start|end` (∀ installs) & legacy
`AGENTS.md` block `<!-- cross-agent-sdd:start|end -->` (V13) ∴ repos set up before rename upgrade, verify, uninstall.
