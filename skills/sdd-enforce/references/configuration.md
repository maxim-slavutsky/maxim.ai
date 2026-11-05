# Configuration and profiles

Read when choosing profiles, interpreting CLI output, or configuring generated gates.

## Profiles

| Profile | Installs | Selection rule |
|---|---|---|
| `core` | `docs/agent-parity.md` (with the rules index), `agent-parity` rule + adapter, `commit-changes` skill + twin, docs gate `scripts/check-docs.mjs`, SDD gate `scripts/check-sdd.mjs`, shared gate lib `scripts/sdd-lib.mjs`, Cursor rule generator, post-edit reminder `.claude/hooks/post-edit-reminder.mjs`, hook configs, `docs/map.md` block | Required base |
| `sdd` | `docs/doc-of-record.md`, `doc-of-record` rule + adapter, doc-of-record + evidence + `Doc-Impact` checks, `AGENTS.md` pointer line | Required base |
| `config` | `docs/app-config.md`, `app-config-updates` rule + adapter, configured surface propagation check | Runtime config has several copies, schemas, or readers |
| `helm` | `docs/helm-validation.md`, `validating-helm-charts` skill + twin | Repository owns Helm charts |

`core` and `sdd` are always installed together. `full` adds `config` and `helm`. Do not enable either optional
profile only to make the installation look complete.

## Adapter shape per concern

| Concern kind | Claude Code | Codex + Cursor |
|---|---|---|
| Path-scoped rule (`doc-of-record`, `agent-parity`, `app-config-updates`) | `.claude/rules/<name>.md`: frontmatter `description` + `paths`; body = heading, one link to the concern doc, 3-6 short imperatives | `.agents/skills/<name>/SKILL.md` that links the same concern doc + `agents/openai.yaml`; Cursor also auto-attaches generated `.cursor/rules/<name>.mdc` |
| Procedure (`commit-changes`, `validating-helm-charts`) | `.claude/skills/<name>/SKILL.md` holds the steps | `.agents/skills/<name>/SKILL.md` links the Claude skill and copies no step + `agents/openai.yaml` |
| Rules index | table in `docs/agent-parity.md` (Rules index), rendered at apply from the shipped rules | same file |

- One concern = a rule or a skill, never both. The gate accepts either as the Claude counterpart of
  `.agents/skills/<name>`.
- The concern doc holds each imperative in full and links the rule back. The gate checks both directions.
- No rule without `paths`: it loads in every Claude Code session. The rules index is therefore a table in
  `docs/agent-parity.md`, not a file in `.claude/rules`. After the repository adds rows, upgrades keep the edited
  doc (`keep`).
- Apply keeps only the `paths:` globs that match a file once apply has run. The `doc-of-record` rule gets
  `<runtimeRoot>/**` for each entry of `runtimeRoots`. A rule with no live glob is not written, nor its adapter,
  nor the concern doc line that links it. `plan` lists it under "Not written". Fix: set `runtimeRoots` or add the
  files, then apply again.
- Skill: frontmatter `name` = folder name (kebab-case, gerund for a procedure), `description` at most 1,024
  characters, `SKILL.md` under 500 lines. `check-docs` fails otherwise.

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
  "helmCharts": [],
  "docsStandardLine": "",
  "docsStandard": { "name": "", "version": "0.9.0" }
}
```

| Key | Use |
|---|---|
| `runtimeRoots` | Folders with application code. Remove nonexistent roots; add repository-specific ones. Detected at install from `apps`, `packages`, `services`, `modules`, `src` (fallback `src`). |
| `moduleRoots` | Folders whose direct children are modules that a doc of record must cover. `*` = one path segment. Detected once as `<runtimeRoot>/*/src/modules`; the repository owns the list afterwards. Empty list = no module check. |
| `exclude` | No slash = directory name skipped anywhere (`vendor`). With a slash = repo-relative prefix (`apps/samples`, `docs/archive`). `.claude/worktrees` is always skipped. |
| `configGroups` | `config` profile only. See below. |
| `helmCharts` | `helm` profile only. See below. |
| `docsStandardLine` | Empty by default. Non-empty: apply inserts it into the root `AGENTS.md` above the pointer line; `check-docs` requires that exact (trimmed) line. |
| `docsStandard` | `name`: the plugin that holds the organization's docs standard, from the user. `version`: the standard version whose script checks the gates port; apply writes it. `audit --standard <plugin root>` warns when the installed standard is newer. |

`plan` prints `Needs a value:` for an empty `docsStandardLine` or `docsStandard.name`. Ask the user for each one.

Changed `docsStandardLine` or `runtimeRoots`: commit the config, then run `apply --write` again (apply needs a
clean tree).

Ownership of a runtime file (`Doc-Impact` gate):

| Case | Owner |
|---|---|
| One or more docs of record have a `covers:` glob that matches the file | every such doc |
| No doc matches, root is `apps`, `packages`, `services`, or `modules` | `<root>/<workspace>/AGENTS.md` |
| No doc matches, other root (`src`) | `<root>/AGENTS.md` |

Runtime file = under a runtime root, runtime extension, not a test (`*.test.*`, `*.spec.*`, `__tests__/`,
`test/`, `tests/`), not `*.d.ts`, not under `docs/`.

Doc of record placement:

| `covers:` globs | Path | Linked from |
|---|---|---|
| all inside one workspace | `<workspace>/docs/<module>.md` | nearest `AGENTS.md` above that `docs/` folder |
| span workspaces | `docs/<module>.md` | root `AGENTS.md` |

A doc in `<workspace>/docs/` with a glob outside that workspace fails. Full shape: `docs/doc-of-record.md` in the
target repository.

`check-docs` also demands an `AGENTS.md` in every workspace: a direct child of a runtime root that carries a
package manifest (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`,
`Chart.yaml`).

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

`source` must be JSON. The gate extracts leaf key names. `json` surfaces must contain matching paths; `text`
surfaces must mention every leaf key. This conservative generic check can produce false positives and negatives
for computed configuration. Replace or extend the generated gate with repository-specific parsing and tests when
needed. Record the surfaces table in `docs/app-config.md`.

### Helm charts

List chart roots relative to the repository root:

```json
"helmCharts": ["apps/web-api/chart"]
```

The `validating-helm-charts` skill runs `helm lint`, `helm template`, and `kubeconform` when available. Never
treat a missing validator as a passing validation. Pass rules and CRD schemas: `docs/helm-validation.md`.

### Waivers

`.agent-sdd/waivers.json` is created empty and never rewritten by the installer. It lists commits that
`--changed` mode skips for a named gate:

```json
[
  {
    "commit": "97c0d9febaacc23a2f4629ebade2699c2351a8c0",
    "gates": ["doc-impact"],
    "reason": "Commit tightened the gate and already sits on develop; rewriting shared history was declined on 2026-09-19."
  }
]
```

Rules: full 40-character lowercase SHA, `gates` from `doc-impact` and `agent-parity` (`spec-impact` is accepted
as the old name of `doc-impact`), reason of at least 12 words a reviewer can check. `--staged` (local hooks)
never reads waivers, so new work still has to pass. A malformed file fails the gate.

## Commands

```text
node scripts/check-docs.mjs
node scripts/check-sdd.mjs
node scripts/check-sdd.mjs --staged --commit-msg <path>
node scripts/check-sdd.mjs --changed [--base <git-ref>]
node scripts/gen-cursor-rules.mjs [--check]
```

Where each command runs. Hook home: `.husky/` (JS) or `.pre-commit-config.yaml` (pre-commit framework). The
tool writes neither.

| Place | Command | Why |
|---|---|---|
| pre-commit hook | `node scripts/check-docs.mjs && node scripts/check-sdd.mjs` | Docs exist, are linked, follow the docs standard; static shape checks on the whole tree. Call `node` directly: a package-manager wrapper adds seconds of start-up per gate. |
| commit-msg hook | `node scripts/check-sdd.mjs --staged --commit-msg "$1"` | Per-commit checks on what is being committed. |
| CI, every build | both static commands **and** `node scripts/check-sdd.mjs --changed` | The static commands alone let a code-only commit through: they never look at what a commit changed. Only `--changed` checks each commit since the base. |

Run the generator after editing `.claude/rules/*.md`; the static gate runs the same comparison.

Trailer reasons (`Doc-Impact: none - ...`, `Agent-Parity: none - ...`) may fold over several lines: each
continuation line starts with whitespace, like a Git trailer, and the gate joins them. Commit linters cap body
lines at 100 characters, and a reason that names several files does not fit on one line. The gate accepts
`Spec-Impact:` as the old name of `Doc-Impact:`; write `Doc-Impact:` in new commits. A CI bot commit (release
bump) needs its own trailer too, for example `Doc-Impact: none - release job writes only the version field in
package.json, no source touched`.

`--changed` base resolution, first match wins:

1. `--base <ref>`;
2. `SDD_BASE_REF`;
3. `origin/<CHANGE_TARGET>`, then `<CHANGE_TARGET>` (Jenkins PR target; map other CI variables to it or to
   `SDD_BASE_REF`);
4. `GIT_PREVIOUS_COMMIT` (Jenkins previous branch build), then `GIT_PREVIOUS_SUCCESSFUL_COMMIT`;
5. `HEAD^`.

An explicit source (1-3) that does not resolve fails the gate instead of silently auditing one commit. CI branch
builds should audit only commits since the previous build, not since an indefinitely old successful one.
