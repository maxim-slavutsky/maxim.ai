# Helm validation

How the repository validates its Helm charts, and what counts as a pass. The skill
[`validating-helm-charts`](../.claude/skills/validating-helm-charts/SKILL.md) holds the steps.

## Repository facts

Record here the facts that the validation depends on, when you know the repository:

- The chart roots are `helmCharts` in `.agent-sdd/config.json`. The validation never checks or fixes a
  fixture chart or a sample chart.
- If the charts use custom resources, name the committed folder of CRD schemas for offline `kubeconform`.
- If `helm` or `kubeconform` is not on the inherited `PATH`, name the folder that holds it. Add that folder
  to `PATH` instead of skipping the step.
- Name each application check that must follow rendering. For example, the rendered ConfigMap must pass
  the schema of the application. `kubeconform` checks Kubernetes shapes, not the JSON inside a ConfigMap.

A skipped step blocks the validation. It is not a pass. The validation checks the schema, not that the
routes are correct.

## Report, never fix

The validation reports failures only. Do not edit `values.yaml`, templates, `Chart.yaml` or any other
chart file to make it pass, and do not stage chart files. Fixing a chart is a separate task that the user
must ask for. A fix without a request, mostly inside a commit, ships changes that nobody reviewed. The
validation writes one kind of file only: a missing CRD schema, into the committed schema folder.

## Pass and fail

| Condition | Result |
|---|---|
| `helm` is missing | FAIL |
| `helm lint` exits with an error | FAIL |
| `helm template` exits with an error | FAIL |
| `kubeconform` finds invalid resources | FAIL |
| `kubeconform` is missing | the third step is blocked: say so in the report |
| no chart changed, and the user chooses a full scan | validate every chart in `helmCharts` |
| no chart changed, and the user chooses to stop | PASS |

## Missing CRD schemas

There are two schema sources. The core Kubernetes kinds come from `yannh/kubernetes-json-schema` through
`-schema-location default`, with no download. Custom resources, such as ServiceMonitor or ExternalSecret,
come from the `datreeio/CRDs-catalog` repository. When `kubeconform` fails because a CRD schema is
missing, fetch the schema once into the committed schema folder, as
`<group>/<kind-lowercased>_<version>.json`. Commit it with the chart change:

```bash
f='<group>/<kind-lowercased>_<version>.json'
mkdir -p "<schema folder>/$(dirname "$f")"
curl -fsSL -o "<schema folder>/$f" "https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/$f"
```

Normal validation does not use the network. For one run only, you can extract `openAPIV3Schema` from the
CRD, or pass `-ignore-missing-schemas` and say so in the report.

## Install kubeconform

| Platform | Command |
|---|---|
| Windows (scoop) | `scoop install kubeconform` |
| macOS (brew) | `brew install kubeconform` |
| Linux | download the release binary from the kubeconform GitHub releases page |
