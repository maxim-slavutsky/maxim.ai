# Configuration and profiles

Read when choosing profiles, interpreting CLI output, or configuring generated gates.

## Profiles

| Profile | Installs | Selection rule |
|---|---|---|
| `core` | agent parity, commit workflow, changes log, docs/parity gates, shared edit reminder | Required base |
| `sdd` | SPEC format, spec-first adapters, invariant/evidence + change-impact gate | Required base |
| `config` | runtime-config workflow/adapters + configured surface propagation gate | Runtime config has multiple copies/schemas/readers |
| `helm` | Helm validation workflow + cross-agent validation skill | Repository owns Helm charts |

`core` and `sdd` are always installed together. `full` adds `config` and `helm`. Do not enable either optional
profile only to make the installation look complete.

## Repository configuration

`.agent-sdd/config.json` is committed and target-specific:

```json
{
  "schemaVersion": 1,
  "profiles": ["core", "sdd"],
  "agents": ["claude", "codex", "cursor"],
  "runtimeRoots": ["apps", "packages", "src"],
  "exclude": ["node_modules", "dist", "build", "coverage", "vendor"],
  "configGroups": [],
  "helmCharts": []
}
```

Remove nonexistent `runtimeRoots`; add repository-specific roots. A runtime path is owned by nearest
`SPEC.md`, falling back to an `AGENTS.md` inside the same runtime root.

### Config groups

The `config` profile intentionally fails verification while `configGroups` is empty. Describe each maintained
application after inspecting its actual config flow:

```json
{
  "name": "web-api",
  "source": "apps/web-api/config/local.json",
  "surfaces": [
    { "path": "apps/web-api/config/default.json", "mode": "json" },
    { "path": "apps/web-api/chart/config/app.json", "mode": "json" },
    { "path": "apps/web-api/chart/values.yaml", "mode": "text" },
    { "path": "apps/web-api/src/config/schema.ts", "mode": "text" },
    { "path": "apps/web-api/src/config/reader.ts", "mode": "text" }
  ]
}
```

`source` must be JSON. Gate extracts leaf key names. `json` surfaces must contain matching paths; `text`
surfaces must mention every leaf key. This conservative generic check can produce false positives/negatives for
computed configuration. Replace or extend generated gate with repository-specific parsing and tests when needed.

### Helm charts

List chart roots relative to repository root:

```json
"helmCharts": ["apps/web-api/chart"]
```

Generated Helm workflow expects `helm lint`, `helm template`, and `kubeconform` when available. Never treat a
missing validator as a passing validation.

## Commands

```text
node scripts/check-sdd.mjs
node scripts/check-sdd.mjs --staged --commit-msg <path>
node scripts/check-sdd.mjs --changed --base <git-ref>
```

Wire static command into pre-commit/CI. Wire staged command into commit-msg. CI range checks must use PR target or
previous built commit, not an indefinitely old last-successful commit.
