---
id: cross-agent-sdd.gates
critical:
  - V1
  - V2
  - V3
  - V4
  - V5
  - V6
---

# Cross-agent SDD generated gates

## Goal

Generated repository gates preserve documentation, SPEC, evidence, agent-parity & configured runtime-config
contracts w/o rejecting their documented valid formats.

## Invariants

V1: Tasks & Bugs ledgers read from heading → next level-two heading | absolute EOF; blank lines & table
header/separator rows before `T<n>|...` | `B<n>|...` data valid.
V2: ∀ `.claude/rules/<n>.md` (≠ `INDEX.md`) → `.cursor/rules/<n>.mdc` = `scripts/gen-cursor-rules.mjs` output.
Stale | missing | stray `.mdc` → gate fail. ⊥ hand-edit `.mdc`.
V3: `--changed` base = first of `--base`, `SDD_BASE_REF`, `origin/<CHANGE_TARGET>` | `<CHANGE_TARGET>`,
`GIT_PREVIOUS_COMMIT`, `GIT_PREVIOUS_SUCCESSFUL_COMMIT`, `HEAD^`. Explicit source (`--base`, `SDD_BASE_REF`,
`CHANGE_TARGET`) unresolvable → fail; ⊥ silent fallback to `HEAD^`.
V4: `.agent-sdd/waivers.json` entry `{commit: full 40-hex sha, gates ⊆ {spec-impact, agent-parity}, reason ≥ 12
words}` skips named gates for that commit in `--changed` only. `--staged` ⊥ reads waivers. Malformed file →
gate fail.
V5: codex enabled → ∀ `.agents/skills/<n>` ! `agents/openai.yaml`. ∀ adapter (`.claude/skills`, `.agents/skills`,
`.claude/rules`, `.cursor/rules`) links exactly 1 `docs/workflows/*.md`; that workflow links adapter back.
V6: `uninstall` touches only `.agent-toolchain.json`-owned content. Generated file deleted only when hash
matches record (| `--force`). Appended block | line | hook entry removed, rest of file kept; file deleted only
when install created it & nothing else remains. Mode `preserved` → untouched. Dry run default; `--write` needs
typed `uninstall` on TTY | `--yes`; non-TTY w/o `--yes` → refuse, nothing changed.

## Bugs

id|date|cause|fix
---|---|---|---
B1|2026-09-19|ledger capture used `$` w/ multiline mode ∴ end-of-line after heading = end-of-section ∴ valid tables read empty|V1 parser slices to next heading | EOF; test covers named & §-prefixed headings
B2|2026-09-19|static `.cursor/rules/*.mdc` assets; gate checked mirror existence only ∴ one-sided Claude rule edit passed green|V2 generator + `--check` in gate
B3|2026-09-19|`--changed` used bare `CHANGE_TARGET`; Jenkins PR checkout has only `origin/<target>` ∴ "cannot inspect commits"|V3 resolution order
B4|2026-09-19|no waiver path ∴ first gate-tightening commit already on shared branch keeps every later `--changed` run red|V4
