# Agent documentation format

Which document goes where, what shape each one has, and what the gates check. `SPEC.md` files use the compressed
"caveman" encoding described below; every other document is plain English.

## Document ownership

| Document | Purpose |
|---|---|
| root `AGENTS.md` | Repository map + standing policy for every agent. Imports the SPEC-first workflow so the working rules are always in context |
| nested `AGENTS.md` | App/package ownership, entry points, commands, environment, pitfalls, module SPEC index |
| module `SPEC.md` | Intended behavior, interfaces, invariants, evidence, active debt. Caveman encoded |
| `README.md` | Human onboarding. Never duplicates `AGENTS.md` or `SPEC.md` content |
| `docs/workflows/*.md` | Tool-neutral procedures (canonical policy); agent adapters link them. Each keeps a **Why** and a **How to apply** section |
| `CLAUDE.md` | Root `@AGENTS.md` import only; never put content here |
| `changes-log.md` | Ignored session intent log used during commit preparation; deleted after each commit |
| `.claude/rules/*.md` | Path-scoped adapter source: frontmatter `paths` + one link to its workflow. Tool-neutral body |
| `.claude/rules/INDEX.md` | Human index of the rules (scope, workflow, trigger). Not a rule: no mirror, no parity partner |
| `.claude/skills/<name>/` | Thin adapter for an invocable workflow, user-invocable as `/<name>` |
| `.cursor/rules/*.mdc` | Generated from `.claude/rules` by `scripts/gen-cursor-rules.mjs`; never hand-edit |
| `.agents/skills/<name>/` | Codex/Cursor adapter + `agents/openai.yaml` display metadata; same `<name>` as the Claude rule or skill |
| `.agent-sdd/config.json` | Gate configuration: profiles, agents, runtime roots, module roots, excludes, config groups, charts |
| `.agent-sdd/waivers.json` | Per-commit gate waivers for `--changed` mode only; never for new work |

Do not duplicate module invariants in `AGENTS.md` or adapter files. `AGENTS.md` is the index; `SPEC.md` is the
source of truth for module internals.

### AGENTS.md or SPEC.md: which does a folder need?

| Case | Write |
|---|---|
| App | `AGENTS.md` always |
| Package with a public runtime contract others depend on | `AGENTS.md` + `src/SPEC.md` |
| Package that is types-only, presentational, or pure config | `AGENTS.md` only; add a SPEC when invariants appear |
| Module inside an app | `SPEC.md`, linked from the app's module SPEC table |

Test: there is an invariant that the code does not visibly assert, and breaking it breaks a consumer. Yes: SPEC.
No: AGENTS only.

### `.claude/`: agent wiring, not human docs

| Path | Role |
|---|---|
| `rules/` | Path-scoped adapters; loaded when a matching path is touched (no `paths`: loaded for every task). A new rule also needs `.agents/skills/<name>`, a regenerated Cursor mirror, and a row in `rules/INDEX.md` |
| `skills/<name>/SKILL.md` | Thin adapter for an invocable workflow; twin in `.agents/skills/<name>` |
| `settings.json` | Hooks and enabled plugins, committed, shared by every contributor. The post-edit hook is `scripts/hooks/post-edit-reminder.mjs`, shared with `.codex/hooks.json` and `.cursor/hooks.json`: the three configs move together |
| `settings.local.json` | Per-machine overrides; never shared |
| `worktrees/` | Claude Code worktrees, full copies of the repository; both gates skip this folder |

A skill copied in from another repository must be retargeted before use: filter names, script names, and paths
drift silently, and the workflow then does nothing while reporting success.

## SPEC shape

Every maintained `SPEC.md` starts with stable metadata:

```yaml
---
id: <app>.<module-path>
critical:
  - V1
---
```

`id` is lowercase, dots or dashes only, globally unique, and **never changes**: tests cite it. `critical:` is optional.
For every listed `V<n>` the gate demands a test that cites `@spec <id>:V<n>` in its title or an adjacent comment. List
only invariants a test proves **whole**; never mark an invariant critical to look thorough.

Sections, in this order, each optional except the goal:

| Section | Heading | Content |
|---|---|---|
| Goal | `## §G` | One line: what the module exists for |
| Constraints | `## §C` | Bullets: stack, deployment, compatibility, hard limits, rejected options with dates |
| Interfaces | `## §I` | Public surfaces in a fenced block, one line each (grammar below) |
| Invariants | `## §V` | Numbered conditions that must always hold |
| Tasks | `## §T` | Active work only, pipe table |
| Bugs | `## §B` | Durable incident / cause / fix record, pipe table |
| Files | `## §F` | `path \| role` table for the important files |

The long headings `## Goal`, `## Constraints`, `## Interfaces`, `## Invariants`, `## Tasks`, `## Bugs`, `## Files`
are accepted too; the gate reads `## Tasks` and `## §T`, `## Bugs` and `## §B` alike.

### §I: interface lines

```text
api: <METHOD> /path → <status> {<shape>}
cmd: <bin> <args> → <stdout>
env: <NAME> ! <constraint>
fn:  <name>(<args>) → <return>
```

### §V: invariants

Stable identifiers `V1`, `V2`, ... at the start of the line, with the colon **right after the id**. A date or note
goes after the colon, otherwise the gate does not see the line and no test can cite it. Never renumber or reuse a
retired id. Ids are unique per file and per split module (a module with one parent SPEC and one SPEC per folder).

```text
V1: ∀ accepted request → response carries correlation id
V2: (amended 2026-09-17) token expiry ≤ now → reject
```

Both forms are read: `V1: ...` and `- **V1**: ...`.

### §T and §B: pipe tables

```text
id|status|task|cites
T1|x|wire swagger at /docs|I.api
T2|.|add pod logs route|V3,I.api
```

Status: `x` done, `~` in progress, `.` todo. Remove completed rows from a live spec once the outcome is recorded as an
invariant or a bug row.

```text
id|date|cause|fix
B1|2026-08-04|chart probe path ≠ real route|V1
```

Escape a literal `|` as `\|`. A `## §T` or `## §B` heading with no row fails the gate: omit the heading until the
first row exists.

### Evidence

A test proves an invariant only when its title or an adjacent comment carries the citation:

```text
@spec <spec-id>:V1
```

Green evidence proves implementation behavior, not that the prose captures intended behavior. Reconcile all three:
contract, evidence, code.

## Caveman encoding (SPEC.md only)

Drop articles, filler, and auxiliary verbs; fragments are fine; prefer tables and bullets over prose. Code,
identifiers, URLs, numbers, JSON, YAML, and error strings stay verbatim. If cutting a word loses a fact, keep the word.

| Symbol | Meaning |
|---|---|
| `→` | leads to / becomes |
| `∴` | therefore / fix |
| `∀` | for all |
| `∃` | exists |
| `!` | required |
| `?` | optional / unknown |
| `⊥` | never / forbidden |
| `≠` | not equal |
| `∈` / `∉` | in / not in |
| `≤` / `≥` | at most / at least |
| `&` / `\|` | and / or |
| `§` | section reference |

## Changes log

Append one entry per logical change group to `changes-log.md` at the repository root. Use an edit that appends;
a whole-file write clobbers earlier entries. Intent, not diff.

```markdown
## <change group>

**Files changed:**

- `path`

**What changed:**

- <intent, not diff narration; name the symbols>

**Spec impact:** changed | none - <concrete reason>
```

For `changed`, name the owning contract, invariant ids, and evidence. For `none`, state why behavior and public
contracts cannot change; generic claims such as "docs only" or "refactor" are insufficient. The line is the draft of
the `Spec-Impact:` commit trailer.

## Enforcement

`scripts/check-docs.mjs` (pre-commit and CI) fails on:

- a workspace under a runtime root without `AGENTS.md`;
- a module under a configured module root without `SPEC.md`;
- a module `SPEC.md` not linked from its owning `AGENTS.md`;
- the root `AGENTS.md` missing the `@./docs/workflows/SPEC-FIRST-WORKFLOW.md` import.

`scripts/check-sdd.mjs` (pre-commit, `--staged` in commit-msg, `--changed` in CI) fails on:

- a dangling relative Markdown link; an `AGENTS.md` or `SPEC.md` nothing links to;
- `SPEC.md` without frontmatter `id:`; duplicate id; duplicate `V<n>` in one file;
- `@spec <id>:V<n>` naming an unknown id or invariant; a `critical:` invariant without a citing test;
- a `## §T` or `## §B` heading without a row;
- an adapter not linking exactly one `docs/workflows/*.md`, or the workflow not linking back;
- a Claude skill without its `.agents/skills` twin (and the reverse); an `.agents/skills` folder without
  `agents/openai.yaml`; `.cursor/rules` out of sync with `.claude/rules`;
- a hook config missing or not calling `scripts/hooks/post-edit-reminder.mjs`; a `helmCharts` entry without `Chart.yaml`;
- per commit: a runtime file changed without its owner (nearest `SPEC.md`, else the workspace `AGENTS.md`) and without
  a `Spec-Impact: none - <at least 8 concrete words>` trailer; a harness file without its partner and without an
  `Agent-Parity: none - ...` trailer.

Both are shape checks. A green run does not prove that a SPEC describes intended behavior.

## Cross-references

Use relative paths in Markdown links. Every module `SPEC.md` is linked from its parent `AGENTS.md`. The root
`AGENTS.md` links every app and package `AGENTS.md`.

## When to write what

- New module or subsystem: `SPEC.md` next to the code.
- New app or package: `AGENTS.md` at its root.
- New cross-cutting invariant or pitfall for the whole repository: root `AGENTS.md`.
- Bug that breaks an invariant: a `§B` row plus the `§V` update, in the same change as the fix.

## Anti-patterns

- Marketing prose ("powerful", "robust", "seamless").
- Restating what the code already says. Capture intent, contracts, and gotchas, not syntax.
- Long narrative paragraphs where a table or bullet list would do.
- Duplicating information between `AGENTS.md` and `SPEC.md`.
- Leaving a SPEC stale after the code diverged. The rule is: diverged, update the spec in the same change.
