# Configuration and profiles

Read when choosing profiles, interpreting CLI output, or configuring generated gates.

## Profiles

| Profile | Installs | Selection rule |
|---|---|---|
| `core` | agent parity, commit workflow, finishing-branch ordering rule, generated rule index, changes log, docs existence gate (`check-docs`), docs/parity gate (`check-sdd`), Cursor rule generator, shared edit reminder | Required base |
| `sdd` | SPEC format, spec-first adapters, invariant/evidence + change-impact gate, workflow import in `AGENTS.md` | Required base |
| `config` | runtime-config workflow/adapters + configured surface propagation gate | Runtime config has multiple copies/schemas/readers |
| `helm` | Helm validation workflow + cross-agent validation skill | Repository owns Helm charts |

`core` and `sdd` are always installed together. `full` adds `config` and `helm`. Do not enable either optional
profile only to make the installation look complete.

## Adapter shape per concern

| Concern kind | Claude Code | Codex + Cursor |
|---|---|---|
| Path-scoped (spec-first, agent-parity, app-config-updates) | `.claude/rules/<name>.md` | `.agents/skills/<name>/SKILL.md` + `agents/openai.yaml`; Cursor also auto-attaches generated `.cursor/rules/<name>.mdc` |
| Invocable workflow (commit-changes, validate-helm-charts) | `.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` + `agents/openai.yaml` |
| Ordering guard, no path (finishing-branch-commit-order) | `.claude/rules/<name>.md` without `paths`, loads for every task | generated `.cursor/rules/<name>.mdc`; Codex reads the workflow section it links |
| Rule index | `.claude/rules/INDEX.md`, generated at apply from the shipped rules | none: not a rule, no mirror, no partner |

Never create both a rule and a skill for one concern; the gate accepts either as the Claude counterpart. The index is
generated once; after the repository adds its own rules and edits it, upgrades keep the edited version (`keep`).

Adapter body shape: `description` = the one-line trigger; body = "Adapter, path matching only (<scope>). The rules,
the why, and the how to apply live in <workflow>." Every workflow keeps **Why** (citing the real incident) and
**How to apply** sections.

## Repository configuration

`.agent-sdd/config.json` is committed and target-specific:

```json
{
  "schemaVersion": 1,
  "profiles": ["core", "sdd"],
  "agents": ["claude", "codex", "cursor"],
  "runtimeRoots": ["apps", "packages", "src"],
  "moduleRoots": ["apps/*/src/modules"],
  "exclude": ["node_modules", "dist", "build", "coverage", "vendor"],
  "configGroups": [],
  "helmCharts": []
}
```

Remove nonexistent `runtimeRoots`; add repository-specific roots. A runtime path is owned by nearest
`SPEC.md`, falling back to an `AGENTS.md` inside the same runtime root.

`moduleRoots` feeds `scripts/check-docs.mjs`: every direct child folder of a matched root is a module that needs a
`SPEC.md`, linked from the nearest `AGENTS.md` above it. `*` matches one path segment. The installer detects
`<runtimeRoot>/*/src/modules` once; the repository owns the list afterwards. Empty list: no module check.
`check-docs` also demands an `AGENTS.md` in every workspace (a direct child of a runtime root that carries a package
manifest such as `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Chart.yaml`).

`exclude` entries without a slash are directory names skipped anywhere (`vendor`). Entries with a slash are
repo-relative path prefixes (`apps/samples`, `docs/archive`). `.claude/worktrees` is always skipped by both gates:
Claude Code worktrees are full copies of the repository inside the checkout.

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
node scripts/check-docs.mjs
node scripts/check-sdd.mjs
node scripts/check-sdd.mjs --staged --commit-msg <path>
node scripts/check-sdd.mjs --changed [--base <git-ref>]
node scripts/gen-cursor-rules.mjs [--check]
```

Where each command runs:

| Place | Command | Why |
|---|---|---|
| pre-commit hook | `node scripts/check-docs.mjs && node scripts/check-sdd.mjs` | Documents exist and are wired; static shape checks on the whole tree. Call `node` directly: a package-manager wrapper adds seconds of start-up per gate. |
| commit-msg hook | `node scripts/check-sdd.mjs --staged --commit-msg "$1"` | Per-commit checks on what is being committed. |
| CI, every build | both static commands **and** `node scripts/check-sdd.mjs --changed` | The static commands alone let a code-only commit through: they never look at what a commit changed. Only `--changed` checks each commit since the base. |

Run the generator after editing `.claude/rules/*.md`; the static gate runs `--check`.

Trailer reasons (`Spec-Impact: none - ...`, `Agent-Parity: none - ...`) may fold over several lines: each
continuation line starts with one space, like a Git trailer, and the gate joins them. Commit linters cap body lines
at 100 characters, and a reason that names several files does not fit on one line. A CI bot commit (release bump)
needs its own trailer too, for example `Spec-Impact: none - release job writes only the version field in
package.json, no source touched`.

`--changed` base resolution, first match wins:

1. `--base <ref>`;
2. `SDD_BASE_REF`;
3. `origin/<CHANGE_TARGET>`, then `<CHANGE_TARGET>` (Jenkins/GitHub PR target);
4. `GIT_PREVIOUS_COMMIT` (Jenkins previous branch build), then `GIT_PREVIOUS_SUCCESSFUL_COMMIT`;
5. `HEAD^`.

An explicit source (1-3) that does not resolve fails the gate instead of silently auditing one commit. CI branch
builds should audit only commits since the previous build, not since an indefinitely old successful one.
