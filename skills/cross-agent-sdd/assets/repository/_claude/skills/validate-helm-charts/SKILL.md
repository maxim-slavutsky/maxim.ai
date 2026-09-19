---
name: validate-helm-charts
description: Validate changed or selected Helm charts with lint, template rendering, and kubeconform before committing or deploying chart changes; report failures without rewriting charts.
---

# Claude Code adapter

Read [canonical Helm validation workflow](../../../docs/workflows/HELM-VALIDATION-WORKFLOW.md), then validate the
selected chart roots from `.agent-sdd/config.json`. Missing tools or schemas block validation; they are not a pass.
