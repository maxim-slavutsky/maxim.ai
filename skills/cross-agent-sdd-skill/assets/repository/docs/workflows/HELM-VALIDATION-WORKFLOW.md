# Helm validation workflow

Canonical validation for changed/selected chart roots. Adapters:

- [Claude Code skill](../../.claude/skills/validate-helm-charts/SKILL.md)
- [Codex/Cursor skill](../../.agents/skills/validate-helm-charts/SKILL.md)

## Procedure

For each chart listed in `.agent-sdd/config.json` or selected explicitly:

1. Run `helm dependency build` only when dependencies require it and generated dependency artifacts are intended.
2. Run `helm lint <chart>` with representative values.
3. Run `helm template <release> <chart>` with same values; preserve render output only in temporary storage.
4. Run `kubeconform -strict -summary`, supplying required external CRD schemas.
5. Report tool versions, exact chart/value inputs, warnings, and failures. Validation reports; it does not silently
   modify chart logic.

Missing `helm`, `kubeconform`, values, or CRD schemas is a blocked validation, not a pass.
