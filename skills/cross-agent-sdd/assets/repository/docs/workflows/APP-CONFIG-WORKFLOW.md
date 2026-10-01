# Application config workflow

Canonical policy for maintained runtime configuration shape changes. Adapters (thin, link here only):

- [Claude Code rule](../../.claude/rules/app-config-updates.md)
- [Codex/Cursor skill](../../.agents/skills/app-config-updates/SKILL.md)
- [Cursor rule](../../.cursor/rules/app-config-updates.mdc), generated, never hand-edited

When a repository has several runtime config shapes (a service settings file, a browser `window.CONFIG`, a
registry), give each one its own section below with its own surfaces table, and split the adapter into one rule
per shape with narrow path globs. Each adapter then links its section of this file.

## Invariant

Add, remove, or rename a runtime config key: update every applicable surface in the same change:

1. shape contract / runtime validator;
2. local or default developer config;
3. alternate shipped config;
4. test fixtures (e2e config folder, unit-test defaults): the surface everyone forgets;
5. Helm-rendered application config;
6. values placeholder for every direct chart input;
7. typed reader / getter;
8. owning SPEC or AGENTS contract when behavior changes.

A value-only edit is not automatically a shape change. Deployment-only chart settings not injected into runtime
config are outside this workflow. A gitignored local override file (deep-merged over the tracked config) holds
machine-specific values and real credentials; the tracked files never do.

## Surfaces

One table per config shape, `file | role`. Fill it once the repository is known:

| File | Role |
|---|---|
| `<app>/configs/<config>.json` | local development values |
| `<app>/configs/local.<config>.json` | optional, gitignored, deep-merged: machine-specific values |
| `<app>/test/configs/<config>.json` | e2e fixture; boots its own module |
| `<app>/src/config/<config>.interface.ts` | the shape the app reads |
| `<app>/src/config/<config>.schema.ts` | runtime validator; unknown keys rejected |
| `<app>/chart/configs/<config>.json` | Helm template for the ConfigMap |
| `<app>/chart/values.yaml` | placeholder for every field a Helm value supplies |

## Procedure

1. Read the nearest config SPEC, the owning `AGENTS.md`, then the `.agent-sdd/config.json` group.
2. Amend the intended shape and evidence first.
3. Propagate the structural key through every applicable surface.
4. Keep secrets as placeholders; never commit live values. A browser-served config file is not the place for a
   real secret.
5. Render and validate charts when a chart input changes.
6. Run `node scripts/check-sdd.mjs` and the affected application validation.

## Why

A strict validator cuts both ways: a JSON key the schema lacks fails the boot, and a schema field no JSON sets
fails only for the environment that missed it. The e2e fixture is forgotten first: it boots its own module, so a
schema change without it fails every e2e spec at load, not at assertion. The chart copy is forgotten next, and that
one fails in the cluster while local tests stay green.

## How to apply

- Field added: interface, validator, every JSON copy including test fixtures, chart JSON, chart values.
- Field renamed: the old name must vanish everywhere; grep it before reporting done.
- Optional block with defaults: the JSON copies may omit it, but the validator default must exist or the block reads
  `undefined` at runtime.
- A value the chart supplies stays inside a string in the chart JSON template: a bare template expression as a JSON
  number breaks parsing and the drift test. One exception: a whole object rendered with `{{ ... | toJson }}`, which
  the drift test stubs as `{}` before parsing.
- After: run the config tests (the shipped-config spec validates every tracked JSON against the schema) and
  `helm template` when the chart moved.

## Browser runtime config

A single-page app that reads a global (`window.CONFIG`) from a script that `index.html` loads before the bundle has
no build-time check of that shape: a field the reader expects and the file lacks is `undefined` in the browser,
after deploy. One shape, five surfaces:

| Surface | Role |
|---|---|
| served config script (`public/config/config.js`) | values for a local run and for the bare image |
| global type declaration (`global.d.ts`) | types the reader; says nothing about the file |
| config reader module | the only place that reads the global |
| test setup default | the global in every test; a field missing here is `undefined` in every spec |
| chart template and values placeholders | cluster source of the script; the values arrive at deploy time |

- Field added: every surface in one change; then render the chart and read the generated script.
- Field renamed: grep the global and the field name; the single reader shows a stale name.
- Deploy-time value: CI renders placeholders only. Note in the change log that the external source needs the value.
- The served script reaches the browser: never put a secret in it.

## What the gate checks

The generic gate checks configured JSON paths and textual key coverage. Computed configuration may require a
repository-specific parser or test; green generic coverage does not prove value semantics. When the chart copy is a
template that is not parseable JSON, leave the `config` profile off and state here which executable check replaces
it.
