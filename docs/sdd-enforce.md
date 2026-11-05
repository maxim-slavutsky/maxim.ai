---
id: sdd-enforce.gates
code: skills/sdd-enforce
critical:
  - V1
  - V2
  - V3
  - V4
  - V5
  - V6
  - V7
  - V8
  - V9
  - V10
  - V11
  - V12
  - V13
  - V14
  - V15
  - V16
  - V17
  - V18
  - V19
  - V20
  - V21
  - V22
  - V23
---

# sdd-enforce installer and gates

## Goal

The installer writes one SDD policy for Claude Code, Codex and Cursor into a repository. The generated gates keep
the docs, the evidence and the agent files true, and accept each of their valid forms.

## Constraints

- The CLI and the gates run on Node 22 or later, with no dependencies outside the Node standard library.
- The templates hold no organization-specific names, links or secrets. The organization's map line and the
  name of its docs standard come from `docsStandardLine` and `docsStandard` in the target configuration.
- The generated layout follows a docs standard. It ships `AGENTS.md` and never `CLAUDE.md`, and kebab-case docs
  under `docs/`. It uses docs of record instead of module `SPEC.md` files, and keeps plans in the issue tracker.
- The decision to replace module `SPEC.md` files is in
  [ADR 0001](adr/0001-docs-of-record-replace-module-specs.md). The owner model, one `code:` folder per doc, is
  in [ADR 0002](adr/0002-a-code-file-has-one-owner-the-doc-with-the-longest-code-folder.md). The ported
  standard checks and the declared map rows are in
  [ADR 0003](adr/0003-the-gates-port-the-standard-script-checks-and-accept-declared-map-rows.md).

## Interfaces

```text
cmd: node skills/sdd-enforce/scripts/sdd-enforce.mjs audit|plan|apply|verify|uninstall <repo> [flags]
cmd: node scripts/check-docs.mjs
cmd: node scripts/check-sdd.mjs [--staged --commit-msg <path> | --changed [--base <ref>]]
cmd: node scripts/gen-cursor-rules.mjs [--check]
env: SDD_BASE_REF, CHANGE_TARGET, GIT_PREVIOUS_COMMIT, GIT_PREVIOUS_SUCCESSFUL_COMMIT: base for --changed
```

## Invariants

V1: A doc of record is a Markdown file directly under a `docs/` folder whose frontmatter has `id:` or `code:`.
It needs both. `code:` names one folder that holds a file, read with forward slashes and without a trailing
slash. A doc in `<workspace>/docs/` owns a folder of that workspace only. Two docs never name one folder. A
`Tasks`, `Bugs`, `§T` or `§B` heading fails. Any `SPEC.md` and any `@spec <id>:V<n>` fail, and the message names
the new form.

V2: For each `.claude/rules/<n>.md` except `INDEX.md`, `.cursor/rules/<n>.mdc` equals the output of
`scripts/gen-cursor-rules.mjs`. A stale, missing or stray `.mdc` fails the gate. A legacy `INDEX.md` is no rule:
the generator, the link check and the per-commit partner check all skip it.

V3: The `--changed` base is the first of `--base`, `SDD_BASE_REF`, `origin/<CHANGE_TARGET>` or `<CHANGE_TARGET>`,
`GIT_PREVIOUS_COMMIT`, `GIT_PREVIOUS_SUCCESSFUL_COMMIT` and `HEAD^`. An explicit source that does not resolve
fails. The gate never falls back to `HEAD^` silently.

V4: A waiver `{commit: full 40-hex SHA, gates, reason of 12 words or more}` skips the named gates for that commit in
`--changed` only. The gates are `doc-impact` and `agent-parity`, and `spec-impact` is an alias of `doc-impact`.
`--staged` never reads waivers. A malformed file fails the gate.

V5: Each `.claude/rules/<n>.md` links exactly one concern doc directly under a `docs/` folder, or directly under a
`docs/` subfolder that a row of `docs/map.md` names in backticks in its second column, and that doc links the rule
back. The back-link covers the generated `.mdc`. The `.agents/skills/<n>` twin of a Claude skill links its
`SKILL.md`. The adapter of a rule links the rule's concern doc. With Codex enabled, each `.agents/skills/<n>` has
`agents/openai.yaml`.

V6: `uninstall` touches only content that `.agent-toolchain.json` records. It deletes a generated file only when
the hash matches the record, or with `--force`. It removes a tool block, line or hook entry and keeps the rest of
the file. It deletes a file only when install created it and nothing else remains. A `preserved` file stays. A
dry run is the default. `--write` needs a typed `uninstall` on a TTY or `--yes`. Without a TTY and without `--yes`,
it refuses and changes nothing.

V7: The manifest records each file the installer wrote that is still on disk, also after a re-apply with fewer
profiles. A generated file that existed with the same content before the first apply is `preserved`. Plan and
uninstall keep a preserved file, and verify does not hash-check it. A generated file edited after install gets `keep` and an
unchanged record, and apply goes on with the rest. `--replace <path>` writes the tool version with mode `created`.
An unknown path fails. Any `create` action records mode `created`.

V8: A change to one hook config (`.claude/settings.json`, `.codex/hooks.json`, `.cursor/hooks.json`) needs each
other enabled config in the same commit, or an `Agent-Parity` trailer. The changed file is never its own partner.
The hook script under `.claude/hooks/`, a Claude skill and its `.agents` twin each need no partner.

V9: The gates never read `.claude/skills/<n>/`, `.agents/skills/<n>/` or `.cursor/skills/<n>/` for `n` in
`sdd-enforce` and `cross-agent-sdd`. A copy of the skill inside a repository is tooling, not policy.

V10: The reason of `Doc-Impact: none - <reason>`, `Spec-Impact: none - <reason>` or `Agent-Parity: none - <reason>`
folds like a Git trailer. Each following line that starts with whitespace continues it and joins with a space. A
line without leading whitespace ends it.

V11: `scripts/check-docs.mjs` fails on a workspace under `runtimeRoots` without `AGENTS.md`, and on a module folder
under `moduleRoots` that no doc of record covers: a doc covers a module when its `code:` is the module folder or a
folder inside it. It fails on a doc of record that the `README.md` of its `docs/` folder does not link, and on
that index when the nearest `AGENTS.md` above the `docs/` folder does not link it. A link with an anchor or an
encoded character counts. With the `sdd` profile, it fails on a root `AGENTS.md` that does not link
`docs/doc-of-record.md`. A non-empty `docsStandardLine` must be a line of the root `AGENTS.md`. `verify` runs
check-docs, then check-sdd, and fails when either fails.

V12: Both gates always skip the `.claude/worktrees/` prefix, with no configuration. A Claude Code worktree is a
full copy of the repository, so reading it reports duplicate ids and dead links.

V13: The tool owns lines of the root `AGENTS.md`: the docs standard line when configured, then the pointer at
`docs/doc-of-record.md`, below the first heading. A missing file is created with a heading and these lines. A file
with all lines is preserved. A file without them is a conflict unless `--merge-agents`. The 0.6.0 import line and an
unedited 0.4.0 block become these lines. An edited 0.4.0 block is kept until `--replace AGENTS.md`. Uninstall
removes the lines and keeps the rest.

V14: The rules index is a table in `docs/agent-parity.md`, rendered at apply from the shipped rules of the selected
profiles. Apply never generates `.claude/rules/INDEX.md`. A legacy `INDEX.md` whose hash matches its record is
deleted. An edited one is kept with a reason, and its record stays.

V15: An upgrade deletes each retired managed file whose hash matches its record, and keeps an edited one with a
reason. It deletes the one-line `@AGENTS.md` `CLAUDE.md` that an older version created. Any other `CLAUDE.md` is a
conflict. It removes the `.gitignore` block for `changes-log.md` and moves hook commands to
`.claude/hooks/post-edit-reminder.mjs`. `audit` lists each old-format item for a person or agent to move by hand.

V16: `scripts/check-docs.mjs` fails on any `CLAUDE.md` and on a doc under `docs/` with a name that is not
kebab-case. It fails on an `AGENTS.md` of 200 lines or more and on a `SKILL.md` of 500 lines or more. It fails on
a skill whose `name` differs from its folder, a `description` over 1,024 characters, and a rule `paths:` glob that
matches no file. It fails on a missing root `AGENTS.md`, a missing root `README.md` or one that holds only
headings, and a `GLOSSARY.md` term that is a writing term of the standard. Paths under `evals/`, `fixture/`,
`fixtures/`, `__fixtures__/` and `testdata/` are outside these checks, as in the audit.

V17: Apply sets the `paths:` of the doc-of-record rule to `<runtimeRoot>/**` for each runtime root. It keeps only
the rule globs that match a file once apply has run. A rule with no such glob is not written, nor is its `.agents`
adapter or the concern doc line that links it. Plan lists the rule under "Not written".

V18: The owner of a runtime file is the doc of record with the longest `code:` folder that holds the file, else
the workspace `AGENTS.md`. A parent doc does not own a file that a doc of a folder inside it holds. A commit that
changes the file and not its owner needs a `Doc-Impact: none -` reason of 8 words or more.
The reason names each such file and is not generic. `Spec-Impact:` is accepted as the same trailer.

V19: Apply writes the tool's map rows between `<!-- sdd-enforce:start -->` and `<!-- sdd-enforce:end -->` in
`docs/map.md`. The rows follow the enabled agents. It creates the file, or merges the block into an existing file
and keeps the rows outside it. Uninstall removes the block, and deletes the file only when install created it and
only the block and the heading remain.

V20: `scripts/check-docs.mjs` fails on each hit of a migration detect check of the docs standard that a script can
decide: `context-md-to-glossary-md`, `plans-in-jira-not-files`, `spec-of-record-to-doc-of-record`,
`adr-status-in-frontmatter`, `research-notes-in-docs-research` and `writing-terms-out-of-glossary`. The message
names the path, the migration and its step. `docs/map.md`, the migration's own exempt globs, test fixtures and
files Git ignores never hit.

V21: `scripts/check-docs.mjs` fails on an ADR under `docs/adr/` without a `status:` in one of the standard's forms
(`accepted`, `superseded by …` or `superseded in part by …`, several ADRs joined with " and "), on a status that
names an ADR that does not exist, and on a superseding ADR that does not name the old one. It fails on a research
note without `date:`, `question:`, `## Findings` or `## Not covered`, on an open check box outside a fenced block
in a living doc (ADRs and research notes are not living), and on an API contract that no `AGENTS.md` links: the
workspace's own `AGENTS.md` for a contract in `<workspace>/docs/`, any `AGENTS.md` for one in the root `docs/`.

V22: `scripts/check-sdd.mjs` fails on a `.claude/rules/<n>.md` without `paths:`, and, with Claude Code and Codex or
Cursor enabled, on a rule without its `.agents/skills/<n>` twin. `--changed` lists a moved file under its new path
only, as `--staged` does, so a commit that moves a folder together with its doc passes in both modes.

V23: Apply writes `docsStandard` to `.agent-sdd/config.json`: the user's `name`, kept across applies, and the
standard version the gates port. `plan` names each empty value the user must give: `docsStandardLine` and
`docsStandard.name`. `audit --standard <dir>` reads the version in `<dir>/.claude-plugin/plugin.json` and warns
when it is newer than the ported version, comparing the numbers of each part.
