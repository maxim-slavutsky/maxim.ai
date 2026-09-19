---
id: cross-agent-sdd-skill.gates
critical:
  - V1
---

# Cross-agent SDD generated gates

## Goal

Generated repository gates preserve documentation, SPEC, evidence, agent-parity, and configured runtime-config
contracts without rejecting their documented valid formats.

## Invariants

V1: Tasks and Bugs ledgers are read from their heading through the next level-two heading or absolute EOF; blank
lines and table header/separator rows before `T<n>|...` or `B<n>|...` data are valid.

## Bugs

id|date|cause|fix
---|---|---|---
B1|2026-09-19|ledger capture used `$` with multiline mode, so end-of-line after heading content acted as end-of-section and valid tables appeared empty|V1 parser now slices to next heading or absolute EOF; integration test covers named and §-prefixed headings
