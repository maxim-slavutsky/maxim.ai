# Helm validation workflow

Canonical validation for changed or selected chart roots. Adapters:

- [Claude Code skill](../../.claude/skills/validate-helm-charts/SKILL.md)
- [Codex/Cursor skill](../../.agents/skills/validate-helm-charts/SKILL.md)

## Repository facts

Record here what the scripts below depend on, once the repository is known:

- Chart roots: `helmCharts` in `.agent-sdd/config.json`. Fixture or sample charts are never validated and never
  fixed.
- Committed CRD schemas for offline `kubeconform` (see "Missing CRD schemas"), if the charts use custom resources.
- Where `helm` and `kubeconform` live when they are missing from the inherited PATH: prepend the folder rather than
  skipping.
- Any application-level check that must follow rendering (for example: the rendered ConfigMap must pass the app's own
  config schema). `kubeconform` validates Kubernetes shapes, not the JSON inside a ConfigMap.

A skipped step is a **blocked** validation, not a pass. Chart validation checks schema, **not** route correctness.

## Delegation (optional, Claude Code only)

- You are already a sub-agent: run everything inline; never nest sub-agents.
- Main thread with sub-agents available: resolve the chart list first (a sub-agent cannot ask the user), then spawn
  one sub-agent with the explicit list and the instruction to run steps 2 and 3 inline. Relay its summary table
  verbatim.

## Validation flow

For every chart:

1. `helm lint`
2. `helm template`
3. `kubeconform` if installed

Validation stops for a chart on the first failure.

## Scope: report failures, never fix

This workflow **validates and reports only**. On any `FAIL`, surface the error verbatim (step 3) and stop. Do not
edit `values.yaml`, templates, `Chart.yaml`, or any chart file to make validation pass, and do not stage chart
files. Fixing a broken chart is a separate task the user must request. Auto-fixing unprompted, especially inside a
commit flow, ships unreviewed changes and expands scope. The only write this workflow performs is fetching a
missing CRD schema into the committed schema folder.

## Step 1: detect changed charts

A chart root is any directory containing `Chart.yaml`. Exclude paths containing `/charts/` (subcharts).

Bash:

```bash
charts=$(
git diff --name-only HEAD | while IFS= read -r f; do
  dir=$(dirname "$f")
  while [ "$dir" != "." ] && [ "$dir" != "/" ]; do
    case "$dir" in */charts/*) break ;; esac
    if [ -f "$dir/Chart.yaml" ]; then echo "$dir"; break; fi
    dir=$(dirname "$dir")
  done
done | sort -u
)
```

PowerShell:

```powershell
$charts = git diff --name-only HEAD | ForEach-Object {
  $dir = Split-Path $_ -Parent
  while ($dir -and $dir -ne '.') {
    if ($dir -match '[\\/]charts[\\/]') { break }
    if (Test-Path (Join-Path $dir 'Chart.yaml')) { $dir; break }
    $dir = Split-Path $dir -Parent
  }
} | Sort-Object -Unique
```

No changed charts: ask the user whether to validate every chart in `helmCharts` instead (Claude Code: a question
tool with one option per chart, "All charts" first; other harnesses: a plain question). A single chart: skip the
question.

## Step 2: validate charts

The script prints **per-step status lines only**, no summary table, no colors, no banner. Long tool output is
collapsed in the terminal, so anything printed at the end is routinely hidden. The summary is rendered by you in
step 3.

```bash
if ! command -v helm >/dev/null 2>&1; then echo "helm is not installed: cannot validate charts"; exit 1; fi
FAILED=0
for chart_dir in $charts; do
  release=$(helm show chart "$chart_dir" | awk '/^name:/ {print $2}')
  echo; echo "=== Validating: $chart_dir ($release) ==="
  lint_output=$(helm lint "$chart_dir" 2>&1) || { echo "  [1/3] lint        FAILED"; echo "$lint_output"; FAILED=1; continue; }
  echo "  [1/3] lint        OK"
  template_output=$(helm template "$release" "$chart_dir" 2>&1) || { echo "  [2/3] template    FAILED"; echo "$template_output"; FAILED=1; continue; }
  echo "  [2/3] template    OK"
  if command -v kubeconform >/dev/null 2>&1; then
    kube_output=$(printf '%s\n' "$template_output" | kubeconform -strict -summary -schema-location default \
      -schema-location '<crd-schema-dir>/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json' 2>&1) \
      || { echo "  [3/3] kubeconform FAILED"; echo "$kube_output"; FAILED=1; continue; }
    echo "  [3/3] kubeconform OK"
  else
    echo "  [3/3] kubeconform SKIPPED (not installed)"
  fi
done
exit $FAILED
```

Use representative values (`-f`) when the chart needs them; record which values file was used.

## Step 3: report results in the final message (mandatory)

Render this table in your final message, from the status lines in the tool result:

```markdown
| Chart | Lint | Template | Kubeconform |
|---|---|---|---|
| `apps/api/chart` | OK | OK | OK |
| `apps/web/chart` | OK | **FAIL** | - |
```

Cell values: `OK`, `**FAIL**`, `skipped` (tool not installed), `-` (step not reached). ASCII only, no emoji: emoji are
double-width glyphs and break column alignment in the terminal.

- Any `FAIL`: below the table, quote the failing step's key error lines verbatim, then state **Validation failed.**
- All pass: state **All charts passed.**
- kubeconform skipped: add one line pointing to the install table. Report tool versions and the exact chart and
  values inputs whenever anything failed or was skipped.

Do not skip this step because "the script already printed the result": it printed into collapsed tool output the
user cannot see.

## Pass / fail rules

| Condition | Result |
|---|---|
| `helm` missing | FAIL |
| `helm lint` non-zero exit | FAIL |
| `helm template` non-zero exit | FAIL |
| kubeconform invalid resources | FAIL |
| kubeconform missing | step 3 blocked; say so |
| no changed charts, user chooses full scan | validate every chart in `helmCharts` |
| no changed charts, user chooses exit | PASS |

## Missing CRD schemas

Two schema sources; do not confuse them. Core Kubernetes kinds come from `yannh/kubernetes-json-schema`, already
wired in through `-schema-location default` (no download). Custom resources (ServiceMonitor, ExternalSecret, ...)
come from the `datreeio/CRDs-catalog` repository. When `kubeconform` fails because a CRD schema is absent, fetch it
once into the committed schema folder (`<group>/<kind-lowercased>_<version>.json`) and commit it with the chart
change. Do not rely on the network during normal validation. Fallbacks for one run only: extract `openAPIV3Schema`
from the CRD, or pass `-ignore-missing-schemas` and say so in the report.

## Optional kubeconform install

| Platform | Command |
|---|---|
| Windows (scoop) | `scoop install kubeconform` |
| macOS (brew) | `brew install kubeconform` |
| Linux | download the release binary from the kubeconform GitHub releases page |
