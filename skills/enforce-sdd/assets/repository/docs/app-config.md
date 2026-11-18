# Application config

How a change to the shape of the runtime configuration reaches every copy of that configuration.

The rule [`.claude/rules/app-config-updates.md`](../.claude/rules/app-config-updates.md) loads these rules when an agent reads a config file.

A repository with several config shapes gives each shape its own section below, with its own surfaces
table. Examples are a service settings file, a browser `window.CONFIG` and a registry. Split the rule into
one rule per shape, with narrow path globs, and let each rule link its section.

## Rules

When you add, remove or rename a runtime config key, update every surface that applies, in the same
change:

1. The shape contract or the runtime validator.
2. The local or default developer config.
3. The other shipped configs.
4. The test fixtures, such as the e2e config folder and the unit-test defaults.
5. The application config that Helm renders.
6. The values placeholder for each direct chart input.
7. The typed reader or getter.
8. The doc of record or the `AGENTS.md` that owns the behavior, when behavior changes.

A change to a value only is not a change to the shape. Chart settings for the deployment only, which the
runtime config does not receive, are outside these rules. A local override file that Git ignores holds
the values and real credentials of one machine. The tracked files never hold them.

## Surfaces

Write one table per config shape, with `file | role`. Fill it when you know the repository:

| File | Role |
|---|---|
| `<app>/configs/<config>.json` | local development values |
| `<app>/configs/local.<config>.json` | optional, ignored by Git, merged on top: values of one machine |
| `<app>/test/configs/<config>.json` | e2e fixture, which starts its own module |
| `<app>/src/config/<config>.interface.ts` | the shape the app reads |
| `<app>/src/config/<config>.schema.ts` | runtime validator, which rejects unknown keys |
| `<app>/chart/configs/<config>.json` | Helm template for the ConfigMap |
| `<app>/chart/values.yaml` | placeholder for each field that a Helm value supplies |

## Procedure

1. Read the doc of record that covers the config, the owning `AGENTS.md` and the matching group in
   `.agent-sdd/config.json`.
2. Change the intended shape and its evidence first.
3. Copy the key change to every surface that applies.
4. Keep secrets as placeholders. Never commit live values. Never put a real secret in a config file that
   a browser loads.
5. Render and validate the charts when a chart input changes.
6. Run `node scripts/check-sdd.mjs` and the validation of the affected application.

## How to apply

- **Field added**: change the interface, the validator, every JSON copy with the test fixtures, the chart
  JSON and the chart values.
- **Field renamed**: remove the old name everywhere. Search for it before you report the work as done.
- **Optional block with defaults**: the JSON copies can leave it out. The validator must then set the
  default, or the block is `undefined` at runtime.
- **Value from the chart**: keep it inside a string in the chart JSON template. A bare template
  expression in place of a JSON number breaks parsing and the drift test. The exception is a whole object
  rendered with `{{ ... | toJson }}`, which the drift test replaces with `{}` before parsing.
- **After the change**: run the config tests, which check every tracked JSON against the schema. Run
  `helm template` when the chart changed.

## Browser runtime config

A single-page app can read a global (`window.CONFIG`) from a script that `index.html` loads before the
bundle. No build step checks the shape of that global. A field that the reader expects and the file lacks
is `undefined` in the browser, after the deployment. One shape has five surfaces:

| Surface | Role |
|---|---|
| served config script (`public/config/config.js`) | values for a local run and for the bare image |
| global type declaration (`global.d.ts`) | types for the reader, but nothing about the file |
| config reader module | the only place that reads the global |
| test setup default | the global in every test: a field missing here is `undefined` in every test |
| chart template and values placeholders | the cluster source of the script, with values that arrive at deploy time |

- **Field added**: change every surface in one change. Then render the chart and read the generated script.
- **Field renamed**: search for the global and the field name. The single reader shows a stale name.
- **Value at deploy time**: CI renders placeholders only. Say in the commit body that the external source
  needs the value.
- **Secrets**: the served script reaches the browser, so never put a secret in it.

## What the gate checks

The gate checks the configured JSON paths and that each key name appears in each text surface. Computed
configuration can need a parser or a test of its own. A green gate does not prove that the values are
right. If the chart copy is a template that is not valid JSON, keep the `config` profile off. Then name
here the check that replaces it.

## Why

A strict validator fails in both directions. A JSON key that the schema lacks stops the start-up. A schema
field that no JSON sets fails only in the environment that lacks it. People forget the e2e fixture first.
It starts its own module, so every e2e test fails at load time. People forget the chart copy next. It
fails in the cluster while the local tests stay green.
