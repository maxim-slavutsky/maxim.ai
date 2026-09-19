# Configuration and profiles

Read when choosing profiles, interpreting CLI output, or configuring generated gates.

## Profiles

| Profile | Installs | Selection rule |
|---|---|---|
| `core` | agent parity, commit workflow, changes log, docs/parity gates, Cursor rule generator, shared edit reminder | Required base |
| `sdd` | SPEC format, spec-first adapters, invariant/evidence + change-impact gate | Required base |
| `config` | runtime-config workflow/adapters + configured surface propagation gate | Runtime config has multiple copies/schemas/readers |
| `helm` | Helm validation workflow + cross-agent validation skill | Repository owns Helm charts |

`core` and `sdd` are always installed together. `full` adds `config` and `helm`. Do not enable either optional
profile only to make the installation look complete.

## Adapter shape per concern

| Concern kind | Claude Code | Codex + Cursor |
|---|---|---|
| Path-scoped (spec-first, agent-parity, app-config-updates) | `.claude/rules/<name>.md` | `.agents/skills/<name>/SKILL.md` + `agents/openai.yaml`; Cursor also auto-attaches generated `.cursor/rules/<name>.mdc` |
| Invocable workflow (commit-changes, validate-helm-charts) | `.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` + `agents/openai.yaml` |

Never create both a rule and a skill for one concern; the gate accepts either as the Claude counterpart.

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

`exclude` entries without a slash are directory names skipped anywhere (`vendor`). Entries with a slash are
repo-relative path prefixes (`apps/samples`, `docs/archive`).

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

### Waivers

`.agent-sdd/waivers.json` is created empty and never rewritten by the installer. It lists commits that
`--changed` mode skips for a named gate:

```json
[
  {
    "commit": "97c0d9febaacc23a2f4629ebade2699c2351a8c0",
    "gates": ["spec-impact"],
    "reason": "Commit tightened the gate and already sits on develop; rewriting shared history was declined on 2026-09-19."
  }
]
```

Rules: full 40-character SHA, `gates` from `spec-impact` and `agent-parity`, reason of at least 12 words a
reviewer can check. `--staged` (local hooks) never reads waivers, so new work still has to pass. A malformed
file fails the gate.

## Commands

```text
node scripts/check-sdd.mjs
node scripts/check-sdd.mjs --staged --commit-msg <path>
node scripts/check-sdd.mjs --changed [--base <git-ref>]
node scripts/gen-cursor-rules.mjs [--check]
```

Wire static command into pre-commit/CI. Wire staged command into commit-msg. Run the generator after editing
`.claude/rules/*.md`; the static gate runs `--check`.

`--changed` base resolution, first match wins:

1. `--base <ref>`;
2. `SDD_BASE_REF`;
3. `origin/<CHANGE_TARGET>`, then `<CHANGE_TARGET>` (Jenkins/GitHub PR target);
4. `GIT_PREVIOUS_COMMIT` (Jenkins previous branch build), then `GIT_PREVIOUS_SUCCESSFUL_COMMIT`;
5. `HEAD^`.

An explicit source (1-3) that does not resolve fails the gate instead of silently auditing one commit. CI branch
builds should audit only commits since the previous build, not since an indefinitely old successful one.
