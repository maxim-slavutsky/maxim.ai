---
id: cross-agent-sdd.gates
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
---

# Cross-agent SDD generated gates

## Goal

Generated repository gates preserve documentation, SPEC, evidence, agent-parity & configured runtime-config
contracts w/o rejecting their documented valid formats.

## Invariants

V1: Tasks & Bugs ledgers read from heading → next level-two heading | absolute EOF; blank lines & table
header/separator rows before `T<n>|...` | `B<n>|...` data valid.
V2: ∀ `.claude/rules/<n>.md` (≠ `INDEX.md`) → `.cursor/rules/<n>.mdc` = `scripts/gen-cursor-rules.mjs` output.
Stale | missing | stray `.mdc` → gate fail. ⊥ hand-edit `.mdc`. `INDEX.md` excluded everywhere: generator, adapter
link check **& the per-commit partner check** — it is the human index, ⊥ a rule ∴ ⊥ mirror, ⊥ `Agent-Parity` trailer.
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
V9: gate ⊥ reads `.claude/skills/cross-agent-sdd/`, `.agents/skills/cross-agent-sdd/`,
`.cursor/skills/cross-agent-sdd/` (skill installed in-repo = tooling, ≠ policy): no doc links, SPEC ids,
adapter shape, parity, or change-impact from those paths.

## Bugs

id|date|cause|fix
---|---|---|---
B1|2026-09-19|ledger capture used `$` w/ multiline mode ∴ end-of-line after heading = end-of-section ∴ valid tables read empty|V1 parser slices to next heading | EOF; test covers named & §-prefixed headings
B2|2026-09-19|static `.cursor/rules/*.mdc` assets; gate checked mirror existence only ∴ one-sided Claude rule edit passed green|V2 generator + `--check` in gate
B3|2026-09-19|`--changed` used bare `CHANGE_TARGET`; Jenkins PR checkout has only `origin/<target>` ∴ "cannot inspect commits"|V3 resolution order
B4|2026-09-19|no waiver path ∴ first gate-tightening commit already on shared branch keeps every later `--changed` run red|V4
B5|2026-09-19|uninstall filtered whole PostToolUse entry ∴ user command beside reminder deleted, file too when `created`|V6 strip inner hooks only
B6|2026-09-19|pre-existing file identical to template recorded `generated` w/o mode ∴ uninstall deleted user file|V7 `preserved`
B7|2026-09-19|project-scope skill install: bundled `assets/` docs, own SPEC, own SKILL.md scanned as policy ∴ 33 gate errors|V9
B8|2026-09-19|hook config partner group included changed file ∴ matcher-only change passed staged gate|V8
B9|2026-09-19|re-apply w/ fewer profiles rebuilt manifest from plan only ∴ optional-profile files lost ownership, uninstall missed them|V7
B10|2026-09-19|edited generated file = `conflict` ∴ whole apply blocked; message & README promised skip|V7 `keep`
B11|2026-09-20|`partnerGroups` paired `.claude/rules/INDEX.md` w/ `.cursor/rules/INDEX.mdc` ∴ every commit touching the index needed an `Agent-Parity` trailer (generator + adapter check already skipped it)|V2 partner check skips `INDEX`
