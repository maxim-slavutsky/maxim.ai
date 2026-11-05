---
name: commit-changes
description: Use when the user asks to commit, finish or hand over the current work. Runs the tests, build and lint of the affected workspaces, the owner-doc check and the gate trailers, writes the message from git diff, stages exactly and commits.
disable-model-invocation: true
---

# Commit changes

The steps below are the only commit path of the repository. Do not commit, push or merge unless the user
asked for that action. Commit preparation never allows a push, a pull request, a merge or a branch delete.

## Rules

- **Stage each path by name.** Never `git add -A` or `git add .`.
- **Report a failure, never hide it.** Never edit a file to make a test, lint, gate or chart check pass.
- **Never `--no-verify`, never amend.** Fix a failed commit and commit again as a new commit.
- **Use Conventional Commits**: `<type>(<scope>): <description>`, with the types `feat fix docs style
  refactor perf test build ci chore revert`.
- **Commit to a topic branch.** If HEAD is on a shared branch (`main`, `develop`), create a topic branch
  first, unless the user said otherwise.
- **Use `git -C <path>`** instead of `cd <path> && git ...`. Commands you give the user use the user's shell.
- **Run independent commands in one tool call** where a step says so, because each call costs a full turn.

If lint reports thousands of ``Delete `␍` `` errors on files you never touched, the checkout has CRLF line
ends. `.gitattributes` pins `eol=lf` and `core.autocrlf` must be `false`: fix the checkout, do not reformat.
If a hook fails with `<package manager>: command not found`, put the package manager on the PATH of the
hook (for pnpm: `corepack enable pnpm`).

## Delegation (optional, Claude Code only)

Any agent runs the steps inline. The Claude Code main thread may give them to a cheaper sub-agent to keep
its own context small.

- Sub-agents are not available, or you were told not to spawn one: run the steps inline and say so.
- You are the sub-agent: run the steps yourself. Run a chart validation inline. Never nest sub-agents.
- You are the main thread and sub-agents are available: list the files this session changed, spawn the
  sub-agent with that list, then stop. Relay its summary when it returns:

  ```text
  Agent(
    subagent_type: "general-purpose",
    model: "sonnet",
    description: "commit changes",
    prompt: "You ARE the delegated sub-agent: run every step of .claude/skills/commit-changes/SKILL.md yourself and do NOT spawn another agent. The session changed these files: <paths, one per line>. Intent: <one line per change group, with Doc-Impact changed or none - reason>. Run the affected tests, builds and lint through the cached task runner in ONE call with a concurrency cap and errors-only output (tool timeout 600 s). Validate touched Helm charts INLINE. Do the targeted owner-doc check, run the gates, write the message to a scratch file, stage only the listed and clearly incidental files, pre-validate the message with the commit linter and check-sdd --staged in the same call, then commit with git commit -F (tool timeout 300 s). Other dirty files: EXCLUDE them, list them in the report, never edit them. A failing test, build, gate or chart: STOP and report. Report: commit hash and subject, what ran per workspace (ran / cache hit / stub / skipped), chart result, owner docs edited, excluded paths."
  )
  ```

## Step 1: list the changes and classify `git status`

Run in one call:

```bash
git status --porcelain && git diff --stat HEAD
```

The session's changes are the files that this session edited. Read their diff with `git diff HEAD -- <path>`
when you need the details for the message.

- Nothing changed: tell the user there is nothing to commit and stop.
- Classify each other path in `git status` before staging:

| Class | Example | Action |
|---|---|---|
| Clearly incidental | a linter fix to a file the session changed; a lockfile that a dependency change regenerated | include, and say so in the report |
| Everything else | an unrelated modified file; a new file the session did not create; an untracked folder | exclude, go on with the session's files, and list the excluded paths in the report |

Exclude and go on in every agent, sub-agent or not, because a stopped run wastes the tests already paid for.
Ask the user only when the session changed nothing that can be committed. Never stage an untracked folder on
your own judgment, and never edit a file the session did not change.

Done when every path in `git status` is in the commit set or in the excluded list.

## Step 2: test, build and lint the affected workspaces

Find the workspaces from the paths in the commit set. Record the map from path prefix to workspace filter
here when you know the repository:

| Path prefix | Filter | Notes |
|---|---|---|
| `apps/<name>/` | `<workspace name>` | |
| `packages/<name>/` | the package **and** every workspace that uses it | |
| shared config packages | every workspace | no filter |

Run **one** call of the cached task runner of the repository (turbo, nx or similar), with every task and
filter, `lint` included, and errors-only output. For example:

```bash
pnpm turbo run test build lint --filter=<workspace> --filter=<workspace> --concurrency=2 --output-logs=errors-only 2>&1 | tail -60
```

Set the tool timeout to **600 s**, because a cold run of several apps takes minutes. Four parts of that line
matter:

- **The task runner**, never `pnpm --filter <pkg> test`. The direct form skips the cache and runs the suites
  cold again. A cached task is a pass, because the runner hashes the inputs. Report it as "cache hit", not
  as "tests ran".
- **`lint` in the same call**: the pre-commit hook runs lint anyway. Here it runs in parallel with the tests,
  and the hook then hits the cache.
- **Errors-only output**: a passing task prints nothing, and a failing task prints its full log. Never run
  again to read the output, and never redirect it to a file.
- **A concurrency cap** (`--concurrency=<n>`, sized to the machine; 2 fits a laptop). Task runners start
  high (turbo: 10), so every suite starts at once and the suites hit their timeouts. The worker cap of the
  test runner (`--maxWorkers=50%`) in the package scripts is the second limit. Keep both.

Also:

- **Docs only** (every path ends in `.md`): skip this step and say so. The hook still runs the gates and lint.
- **Any failure**: stop. Report the failing suite or build, and do not stage.
- **A stub `test` script** (exits 0 without tests): report the workspace as "stub". Never report "tests pass"
  when only stubs ran.

Done when every affected workspace ran, hit the cache, is a stub, or is skipped with a reason.

## Step 3: validate the changed Helm charts

If a path in the commit set is under a chart root (`helmCharts` in `.agent-sdd/config.json`), run the steps
of the `validating-helm-charts` skill, which the `helm` profile installs. A sub-agent runs it inline. Any
`FAIL` (lint, template, kubeconform): stop and report, and do not fix the chart. Say so in the report when
you skip the validation.

Done when each changed chart passed, or you stopped on a failure.

## Step 4: check the owner docs

The doc-of-record rules make the owner change with the code. The `Doc-Impact` gate rejects a runtime file
staged without its owner. This step checks that cheaply. It is not a doc audit.

For each change group:

- **No behavior change**: nothing to read. Write the reason for the `Doc-Impact` trailer in step 5 if no
  owner is in the commit set.
- **Behavior changed**: the owner must be in the commit set. The owners are the docs of record whose
  `covers:` matches the runtime file, else the workspace `AGENTS.md`. If no owner is in the set, `grep -n`
  the owner for the changed symbols or behaviors. Read only the matching lines with context. Edit only a
  real gap and add the doc to the commit set. Follow [doc of record](../../../docs/doc-of-record.md) for the
  shape.

Never read a large `AGENTS.md` or doc of record whole for this step. Touch the root docs (`README.md`, the
root `AGENTS.md`) only when the change adds a doc, module, script, command or config key. A new module with
no doc of record: write one and link it from the workspace `AGENTS.md` in this commit, or
`scripts/check-docs.mjs` fails. Doc edits go in the **same** commit as the code, because a second `docs:`
commit runs the whole hook again.

Done when each behavior change has its owner in the commit set, or a `Doc-Impact` reason.

## Step 5: run the gates and write the message

Run the static gates first. They take seconds, and a failure found here costs one turn, not a failed commit:

```bash
node scripts/check-docs.mjs && node scripts/check-sdd.mjs
```

If a gate fails, write the missing doc or fix its shape. Never delete the link or the check.

Write a Conventional Commits message from the session's changes. Keep it short and exact, and say why more
than what.

- **Subject**: `<type>(<scope>): <imperative summary>`, in the imperative (`add`, `fix`, not `added`), at
  most 50 characters (hard cap 72), with no period at the end. The scope is the workspace when every change
  is inside one. The type is `feat` for any new feature, `fix` for bugs only, else the type of most
  changes. A breaking change gets `!` after the scope and a `BREAKING CHANGE:` line in the body.
- **Body**: only when the subject does not explain the change: the reason that is not obvious, migration
  notes, several changes in one commit. Use `-` bullets with lines of at most 100 characters, wrapped by
  hand. Always write a body for breaking changes, security fixes, data migrations and reverts.
- **Words to leave out**: "This commit", "I", "we", "now", "currently", "as requested by", emoji, the file
  name that the scope already says, and any AI attribution except the `Co-Authored-By` trailer.
- **Gate trailers**: the commit-msg hook checks them with `node scripts/check-sdd.mjs --staged`, and CI
  checks them with `--changed`.
  - A runtime file staged without its owner needs
    `Doc-Impact: none - <at least 8 words that name each file and say why behavior cannot change>`. The gate
    rejects generic words (refactor, cleanup, no behavior change). Name **each** such file, by its file name
    or a folder on its path.
  - A harness file changed without its partner needs `Agent-Parity: none - <reason that names each file>`.
    Prefer to change the partner ([agent parity](../../../docs/agent-parity.md)).
  - `.agent-sdd/waivers.json` is for commits already on a shared branch only.
- **Line limits**: the header and every body and footer line, trailers included, are at most 100
  characters. A trailer that names several files does not fit on one line. Fold it: continue on the next
  lines with one leading space, like a Git trailer. `check-sdd` joins the folded lines.

  ```text
  Doc-Impact: none - probe.service.ts and projector.service.ts only capitalise finding text
   through sentenceCase; net-tools.dto.ts wording only; scoring untouched.
  ```

Write the message to a file in your scratch directory. Validate it **before** the commit, in step 6.

Done when both gates are green and the message file exists.

## Step 6: stage and validate the message

Stage every path in the commit set, then validate the message, in **one** call:

```bash
git add <path> <path> ... && <commit linter> --edit <scratch>/commit-msg.txt && node scripts/check-sdd.mjs --staged --commit-msg <scratch>/commit-msg.txt
```

The staged set is exactly what the commit holds. The pre-commit hook stages nothing again, so other dirty
files stay out without a stash. If the trailer or the format fails here, fix the message file and run this
line again. Nothing was committed.

Done when the linter and `check-sdd --staged` pass.

## Step 7: commit

```bash
git commit -F <scratch>/commit-msg.txt
```

The message file ends with the `Co-Authored-By: <model name> <noreply@anthropic.com>` trailer of the model
that runs now. Never copy a name from this file. Set the tool timeout to **300 s**: the hook runs both gates
and then lint (a cache hit after step 2; a cold run takes a minute or more).

If the hook fails, fix the cause, stage again and make a new commit. When a workspace lints without `--fix`,
run its `lint:fix` script, then stage again.

Done when `git log -1` shows the new commit.

## Step 8: report

Report:

- the commit hash and subject;
- what ran in step 2, per workspace: ran, cache hit, stub or skipped;
- the chart result, or "not applicable";
- the owner docs edited in step 4;
- the paths that step 1 excluded.

Done when the report holds each of these items.
