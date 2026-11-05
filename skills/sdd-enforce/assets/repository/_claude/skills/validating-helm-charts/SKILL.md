---
name: validating-helm-charts
description: Use before committing or deploying a change to a Helm chart, or when asked to validate charts. Runs helm lint, helm template and kubeconform on the changed or selected charts, and reports failures without rewriting charts.
---

# Validating Helm charts

Validate each chart, then report a table. The pass rules, the CRD schemas and the "report, never fix" scope
are in [Helm validation](../../../docs/helm-validation.md). Never edit a chart file to make it pass.

## Delegation (optional, Claude Code only)

- You are already a sub-agent, or another skill runs this one inline: run every step inline. Never nest
  sub-agents. A prompt with an explicit chart list replaces step 1.
- You are the main thread and sub-agents are available: find the chart list first, because a sub-agent
  cannot ask the user. Then spawn one sub-agent with the explicit list and stop:

  ```text
  Agent(
    subagent_type: "general-purpose",
    model: "sonnet",
    description: "validate helm charts",
    prompt: "Validate these Helm charts: <chart paths, one per line>. You ARE the sub-agent: use exactly this list, skip step 1, run steps 2 and 3 of .claude/skills/validating-helm-charts/SKILL.md, and return the step 3 summary table as your final message. Do NOT spawn another sub-agent."
  )
  ```

  The user does not see the final message of the sub-agent. Relay its summary table word for word.

## Step 1: find the changed charts

A chart root is a folder that holds `Chart.yaml`. Skip paths that contain `/charts/` (subcharts).

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

If no chart changed, ask the user whether to validate every chart in `helmCharts`. In Claude Code, use a
multi-select question. One question holds at most 4 options, and one call holds at most 4 questions. So
question 1 is "All charts" plus the first 3 charts, then 4 charts per question. List any chart after the
15th in the question text, for the user to type. In other agents, ask a plain question. For a single
chart, skip the question.

Done when you have the list of chart folders to validate.

## Step 2: validate the charts

The script prints one status line per step only: no summary table, no colors, no banner. The terminal
collapses long tool output, so it hides a summary at the end. You write the summary in step 3.

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

The validation of a chart stops at its first failure. If the chart needs values, pass a representative
values file with `-f` and record which file you used.

Done when each chart has a status line for each step it reached.

## Step 3: report the results in the final message

Write this table in your final message, from the status lines in the tool result:

```markdown
| Chart | Lint | Template | Kubeconform |
|---|---|---|---|
| `apps/api/chart` | OK | OK | OK |
| `apps/web/chart` | OK | **FAIL** | - |
```

The cell values are `OK`, `**FAIL**`, `skipped` (tool not installed) and `-` (step not reached). Use ASCII
only and no emoji: an emoji is two columns wide and breaks the alignment in the terminal.

- Any `FAIL`: below the table, quote the key error lines of the failed step word for word. Then write
  **Validation failed.**
- All pass: write **All charts passed.**
- `kubeconform` skipped: add one line that points to the install table in
  [Helm validation](../../../docs/helm-validation.md#install-kubeconform).
- Anything failed or skipped: report the tool versions and the exact chart and values inputs.

Do not skip this step because the script printed the result. It printed into collapsed tool output, which
the user cannot see.

Done when the final message holds the table and the verdict line.
