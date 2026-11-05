#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseRule, toMdc } from '../assets/repository/scripts/gen-cursor-rules.mjs';
import { matchesGlob, skipRules } from '../assets/repository/scripts/sdd-lib.mjs';

const VERSION = '1.0.0';
// The version of the docs standard whose script checks scripts/docs-standard.mjs ports.
const STANDARD_VERSION = '0.9.0';
const SKILL_NAME = 'sdd-enforce';
const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = join(SKILL_ROOT, 'assets', 'repository');

// Harness directories are stored with a leading underscore so Claude Code, Codex, and Cursor do not load
// the templates as live skills while someone works inside this repository.
function assetSource(targetPath) {
  return join(ASSET_ROOT, targetPath.replace(/^\.(claude|codex|cursor|agents|agent-sdd)\//, '_$1/'));
}
const MANIFEST = '.agent-toolchain.json';
const CONFIG = '.agent-sdd/config.json';
const WAIVERS = '.agent-sdd/waivers.json';
// The tool-owned pointer line of the root AGENTS.md: every agent reads the doc-of-record rules before an edit.
const AGENTS_POINTER = 'Before you edit code, read every doc of record that covers it: [doc of record](docs/doc-of-record.md).';
// Up to 0.6.0 the tool owned an import line that loaded the whole SPEC-first workflow into every session.
const LEGACY_AGENTS_IMPORT = '@./docs/workflows/SPEC-FIRST-WORKFLOW.md';
const LEGACY_AGENTS_IMPORT_LINE = /^@(?:\.\/)?docs\/workflows\/SPEC-FIRST-WORKFLOW\.md[ \t]*$/;
// Up to 0.4.0 the tool owned a block between these markers; upgrades swap an unedited block for the tool lines.
const AGENTS_START = '<!-- cross-agent-sdd:start -->';
const AGENTS_END = '<!-- cross-agent-sdd:end -->';
const AGENTS_DEFAULT_HEADER = '# Repository agent instructions';
// Up to 0.6.0 the tool kept changes-log.md out of Git with this block; upgrades remove it.
const GITIGNORE_START = '# cross-agent-sdd:start';
const GITIGNORE_END = '# cross-agent-sdd:end';
const MAP = 'docs/map.md';
const MAP_START = '<!-- sdd-enforce:start -->';
const MAP_END = '<!-- sdd-enforce:end -->';
const MAP_HEADER = '# Docs map: rows this repository adds\n\nEach row adds a home that the shared docs map has no row for.';
const HOOK_SCRIPT = '.claude/hooks/post-edit-reminder.mjs';
const LEGACY_HOOK_SCRIPT = 'scripts/hooks/post-edit-reminder.mjs';
const CODEX_HOOK_DESCRIPTION = 'Cross-agent counterpart hooks. Canonical policy loads before edits through AGENTS.md and skills.';
const DEFAULT_PROFILES = ['core', 'sdd'];
const ALL_PROFILES = ['core', 'sdd', 'config', 'helm'];
const ALL_AGENTS = ['claude', 'codex', 'cursor'];

// Path-scoped concern: Claude rule + Codex/Cursor adapter. Procedure: Claude skill + Codex/Cursor twin that links it.
// Cursor rule mirrors are generated from Claude rules, never listed here.
const entries = [
  ['core', 'docs/agent-parity.md'],
  ['core', 'scripts/check-sdd.mjs'],
  ['core', 'scripts/check-docs.mjs'],
  ['core', 'scripts/gen-cursor-rules.mjs'],
  ['core', 'scripts/sdd-lib.mjs'],
  ['core', 'scripts/docs-standard.mjs'],
  ['core', '.claude/hooks/post-edit-reminder.mjs'],
  ['core', '.agents/skills/agent-parity/SKILL.md'],
  ['core', '.agents/skills/agent-parity/agents/openai.yaml'],
  ['core', '.agents/skills/committing-changes/SKILL.md'],
  ['core', '.agents/skills/committing-changes/agents/openai.yaml'],
  ['core', '.claude/skills/committing-changes/SKILL.md'],
  ['core', '.claude/rules/agent-parity.md'],
  ['sdd', 'docs/doc-of-record.md'],
  ['sdd', '.agents/skills/doc-of-record/SKILL.md'],
  ['sdd', '.agents/skills/doc-of-record/agents/openai.yaml'],
  ['sdd', '.claude/rules/doc-of-record.md'],
  ['config', 'docs/app-config.md'],
  ['config', '.agents/skills/app-config-updates/SKILL.md'],
  ['config', '.agents/skills/app-config-updates/agents/openai.yaml'],
  ['config', '.claude/rules/app-config-updates.md'],
  ['helm', 'docs/helm-validation.md'],
  ['helm', '.agents/skills/validating-helm-charts/SKILL.md'],
  ['helm', '.agents/skills/validating-helm-charts/agents/openai.yaml'],
  ['helm', '.claude/skills/validating-helm-charts/SKILL.md'],
].map(([profile, path]) => ({ profile, path }));

function help() {
  console.log(`sdd-enforce ${VERSION}
One spec-driven-development policy for Claude Code, Codex, and Cursor, installed into a Git repository.

Usage: node <path-to-skill>/scripts/sdd-enforce.mjs <command> [arguments]

Commands
  audit <repo> [--json]           Look at the repository and report what is already there. Changes nothing.
  plan <repo> [options]           Show every file "apply" would create, update, keep, or refuse. Changes nothing.
  apply <repo> --write [options]  Write the files from the plan. Without --write it is a dry run: it prints
                                  the plan and writes nothing.
  verify <repo> [--json]          Check that every generated file is intact, then run both repository gates
                                  (scripts/check-docs.mjs, scripts/check-sdd.mjs). Changes nothing.
  uninstall <repo> --write        Remove everything "apply" added: delete tool-owned files, take the tool
                                  lines out of AGENTS.md and docs/map.md, the hook entries out of the settings
                                  files. Your own files stay. Asks you to type "uninstall"
                                  before deleting; without --write it only lists what would go.

Options for audit
  --standard <dir>                  The root folder of the installed docs standard plugin. Audit warns when its
                                    version is newer than the one these gates port.

Options for plan, apply, and uninstall
  --profiles core,sdd,config,helm   Which file sets to install. "core,sdd" is the default and always included.
                                    "config" adds a runtime-config propagation gate; "helm" adds Helm chart
                                    validation. "full" means all four. (plan, apply)
  --agents all | claude,codex,cursor   Which AI tools to configure. Default: all three. (plan, apply)
  --merge-agents                    When AGENTS.md already exists without the tool lines, add them below its
                                    first heading instead of stopping. Read the file first. (plan, apply)
  --replace <path>[,<path>]         Write the tool version of these tool-owned files even if you edited them or
                                    they existed before install. They become tool-owned: upgrades update them
                                    and uninstall deletes them. (plan, apply)
  --allow-dirty                     Run even if the repository has uncommitted changes. Not recommended.
  --yes                             Skip the typed confirmation. Only for scripts, and only after a person has
                                    confirmed. (uninstall)
  --force                           uninstall: also delete tool-owned files that were edited after install.
  --json                            Machine-readable output (plan, audit, verify).

Safety
  Every command that writes or deletes files is a dry run until you add --write.
  A file that already exists and was not created by this tool is reported as a conflict and never overwritten.
  Uninstall never deletes a file this tool did not create, and keeps tool files you edited unless --force.`);
}

function parseArgs(argv) {
  const flags = new Map();
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { positional, flags };
}

function flag(parsed, name, fallback = null) {
  return parsed.flags.has(name) ? parsed.flags.get(name) : fallback;
}

function listOption(name, value, allowed, fallback) {
  if (!value) return [...fallback];
  const values = value === 'all' || value === 'full' ? [...allowed] : String(value).split(',').map((item) => item.trim());
  const invalid = values.filter((item) => !allowed.includes(item));
  if (invalid.length) {
    throw new Error(`--${name} does not accept "${invalid.join(', ')}". Allowed values: ${allowed.join(', ')} (comma-separated), or "all".`);
  }
  return [...new Set(values)];
}

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalize(value) {
  return value.replace(/^﻿/, '').replaceAll('\r\n', '\n');
}

function read(path) {
  return normalize(readFileSync(path, 'utf8'));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function repoRoot(input = '.') {
  const candidate = resolve(input);
  try {
    return resolve(git(candidate, ['rev-parse', '--show-toplevel']));
  } catch {
    throw new Error(`not a Git repository: ${candidate}. Pass the path of a folder that is inside a Git checkout.`);
  }
}

function requireCleanTree(root, parsed, verb) {
  if (!flag(parsed, 'allow-dirty', false) && git(root, ['status', '--porcelain'])) {
    throw new Error(
      `the repository has uncommitted changes. Commit or stash them first so you can review what ${verb} does as one clean diff. To continue anyway, add --allow-dirty.`,
    );
  }
}

/** Tracked plus untracked-but-not-ignored files, repo-relative with forward slashes. */
function repositoryFiles(root) {
  return git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => !/(?:^|\/)node_modules\//.test(path));
}

function safePath(root, path) {
  const absoluteRoot = resolve(root);
  const absolute = resolve(path);
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}\\`) && !absolute.startsWith(`${absoluteRoot}/`)) {
    throw new Error(`refusing to touch a path outside the target folder: ${absolute}`);
  }
  return absolute;
}

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.sdd-enforce-${process.pid}-${randomUUID()}.tmp`;
  const backup = `${path}.sdd-enforce-${process.pid}-${randomUUID()}.bak`;
  writeFileSync(temporary, content, 'utf8');
  if (!existsSync(path)) {
    renameSync(temporary, path);
    return;
  }
  renameSync(path, backup);
  try {
    renameSync(temporary, path);
    unlinkSync(backup);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    if (existsSync(path)) unlinkSync(path);
    renameSync(backup, path);
    throw error;
  }
}

/** Remove now-empty parent folders between `path` and `root`. */
function pruneEmptyDirs(root, path) {
  let cursor = dirname(path);
  const stop = resolve(root);
  while (cursor !== stop && cursor.startsWith(stop)) {
    if (!existsSync(cursor) || readdirSync(cursor).length) return;
    rmdirSync(cursor);
    cursor = dirname(cursor);
  }
}

async function confirmOrThrow(parsed, word, what) {
  if (flag(parsed, 'yes', false)) return true;
  if (!process.stdin.isTTY) {
    throw new Error(
      `confirmation required: ${what}. Run this command in an interactive terminal and type "${word}" when asked, or add --yes only when a person has already confirmed the list above.`,
    );
  }
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Type "${word}" to confirm, anything else to cancel: `);
    return answer.trim() === word;
  } finally {
    prompt.close();
  }
}

function managedBlock(body, start, end) {
  const from = body.indexOf(start);
  const to = body.indexOf(end);
  if (from < 0 || to < from) return null;
  return body.slice(from, to + end.length);
}

function replaceBlock(body, block, start, end) {
  const existing = managedBlock(body, start, end);
  if (!existing) return null;
  return `${body.slice(0, body.indexOf(existing))}${block}${body.slice(body.indexOf(existing) + existing.length)}`;
}

function detectRuntimeRoots(root) {
  const candidates = ['apps', 'packages', 'services', 'modules', 'src'];
  const found = candidates.filter((name) => existsSync(join(root, name)));
  return found.length ? found : ['src'];
}

/**
 * Module roots for scripts/check-docs.mjs: folders whose every child is a module that a doc of record covers.
 * Detected once, from the workspace layout "<runtime root>/<workspace>/src/modules"; the repository owns the list
 * afterwards in .agent-sdd/config.json.
 */
function detectModuleRoots(root, runtimeRoots) {
  const out = [];
  for (const runtimeRoot of runtimeRoots) {
    const base = join(root, runtimeRoot);
    if (!existsSync(base) || !statSync(base).isDirectory()) continue;
    const hasModules = readdirSync(base).some((name) => existsSync(join(base, name, 'src', 'modules')));
    if (hasModules) out.push(`${runtimeRoot}/*/src/modules`);
  }
  return out;
}

const PARITY_DOC = 'docs/agent-parity.md';
const RULES_INDEX_SLOT = '<!-- rules-index -->';

/**
 * Rows of the rules index in docs/agent-parity.md: one per shipped Claude rule (name, scope, concern doc, trigger),
 * so the table always matches the selected profiles. It lives in a concern doc, not in .claude/rules: a rule file
 * without "paths" loads in every Claude Code session.
 */
function rulesIndexRows(rules) {
  return rules
    .map(([path, body]) => {
      const name = basename(path, '.md');
      const rule = parseRule(body);
      const doc = body.match(/\]\(\.\.\/\.\.\/docs\/([^)#]+\.md)(#[^)]*)?\)/);
      const docCell = !doc
        ? '-'
        : `docs/${doc[1]}` === PARITY_DOC
          ? 'this file'
          : `[${basename(doc[1], '.md')}](${doc[1]}${doc[2] ?? ''})`;
      const scope = rule?.paths?.length ? rule.paths.map((glob) => `\`${glob}\``).join(', ') : 'no glob: loads every session';
      const trigger = (rule?.description ?? '').replace(/\|/g, '\\|');
      return `| [\`${name}\`](../.claude/rules/${name}.md) | ${scope} | ${docCell} | ${trigger} |`;
    })
    .join('\n');
}

/** A rule body with its "paths:" list replaced. */
function withPaths(body, paths) {
  const list = paths.map((glob) => `  - "${glob}"`).join('\n');
  return body.replace(/^paths:\s*\n(?:\s+-\s+.+\n?)+/m, `paths:\n${list}\n`);
}

// Files an earlier version generated and this one no longer ships. Unedited: deleted on upgrade. Edited: kept.
const RETIRED_WHY = {
  workflow: 'the workflow docs became concern docs with kebab-case names directly under docs/',
  spec: 'module SPEC.md files became docs of record, and docs/agent-sdd/FORMAT.md merged into docs/doc-of-record.md',
  log: 'changes-log.md is gone; the commit skill works from git status and git diff',
  hook: 'the post-edit hook script moved to .claude/hooks/post-edit-reminder.mjs',
  skill: 'the skill has a gerund name now',
};
const RETIRED_FILES = {
  '.claude/rules/INDEX.md':
    'a rule file without "paths" loads in every Claude Code session; the rules table now lives in the Rules index of docs/agent-parity.md',
  'docs/agent-sdd/FORMAT.md': RETIRED_WHY.spec,
  'docs/workflows/AGENT-PARITY-WORKFLOW.md': RETIRED_WHY.workflow,
  'docs/workflows/APP-CONFIG-WORKFLOW.md': RETIRED_WHY.workflow,
  'docs/workflows/COMMIT-WORKFLOW.md': `${RETIRED_WHY.workflow}; the commit steps live in .claude/skills/committing-changes/SKILL.md`,
  'docs/workflows/HELM-VALIDATION-WORKFLOW.md': RETIRED_WHY.workflow,
  'docs/workflows/SPEC-FIRST-WORKFLOW.md': `${RETIRED_WHY.workflow}; its rules live in docs/doc-of-record.md`,
  'scripts/hooks/post-edit-reminder.mjs': RETIRED_WHY.hook,
  '.claude/rules/spec-first.md': `${RETIRED_WHY.spec}; the rule is .claude/rules/doc-of-record.md`,
  '.cursor/rules/spec-first.mdc': `${RETIRED_WHY.spec}; the rule is .claude/rules/doc-of-record.md`,
  '.agents/skills/spec-first/SKILL.md': `${RETIRED_WHY.spec}; the adapter is .agents/skills/doc-of-record`,
  '.agents/skills/spec-first/agents/openai.yaml': `${RETIRED_WHY.spec}; the adapter is .agents/skills/doc-of-record`,
  '.claude/rules/finishing-branch-commit-order.md': RETIRED_WHY.log,
  '.cursor/rules/finishing-branch-commit-order.mdc': RETIRED_WHY.log,
  '.claude/skills/commit-changes/SKILL.md': `${RETIRED_WHY.skill}: .claude/skills/committing-changes`,
  '.agents/skills/commit-changes/SKILL.md': `${RETIRED_WHY.skill}: .agents/skills/committing-changes`,
  '.agents/skills/commit-changes/agents/openai.yaml': `${RETIRED_WHY.skill}: .agents/skills/committing-changes`,
  '.claude/skills/validate-helm-charts/SKILL.md': `${RETIRED_WHY.skill}: .claude/skills/validating-helm-charts`,
  '.agents/skills/validate-helm-charts/SKILL.md': `${RETIRED_WHY.skill}: .agents/skills/validating-helm-charts`,
  '.agents/skills/validate-helm-charts/agents/openai.yaml': `${RETIRED_WHY.skill}: .agents/skills/validating-helm-charts`,
};

function existingConfig(root) {
  const path = join(root, CONFIG);
  if (!existsSync(path)) return null;
  try {
    return readJson(path);
  } catch (error) {
    throw new Error(`${CONFIG} is not valid JSON (${error.message}). Fix the syntax, then run the command again.`);
  }
}

function selected(parsed, root = null) {
  const current = root ? existingConfig(root) : null;
  const profiles = listOption('profiles', flag(parsed, 'profiles'), ALL_PROFILES, current?.profiles ?? DEFAULT_PROFILES);
  if (!profiles.includes('core')) profiles.unshift('core');
  if (!profiles.includes('sdd')) profiles.splice(1, 0, 'sdd');
  const agents = listOption('agents', flag(parsed, 'agents'), ALL_AGENTS, current?.agents ?? ALL_AGENTS);
  return { profiles, agents };
}

/**
 * Every file apply writes for the selected profiles. Each rule keeps only the "paths:" globs that match a file
 * once apply has run, so no rule glob is dead (the docs standard fails a rule glob that matches nothing). A rule
 * left with no glob is not written, nor is its .agents adapter or the concern doc line that links it.
 */
function desiredFiles(root, profiles, agents) {
  const output = new Map();
  for (const entry of entries) {
    if (!profiles.includes(entry.profile)) continue;
    output.set(entry.path, read(assetSource(entry.path)));
  }

  const current = existingConfig(root);
  const runtimeRoots = current?.runtimeRoots ?? detectRuntimeRoots(root);
  const ruleSource = '.claude/rules/doc-of-record.md';
  if (output.has(ruleSource)) output.set(ruleSource, withPaths(output.get(ruleSource), runtimeRoots.map((item) => `${item}/**`)));

  const future = [
    ...repositoryFiles(root),
    ...output.keys(),
    ...agents.map((agent) => hookConfigs[agent]),
    ...[...output.keys()].filter((path) => path.startsWith('.claude/rules/')).map((path) => path.replace(/^\.claude\/rules\/(.+)\.md$/, '.cursor/rules/$1.mdc')),
  ];
  const skipped = [];
  for (const [path, content] of [...output]) {
    const match = path.match(/^\.claude\/rules\/([^/]+)\.md$/);
    if (!match) continue;
    const globs = parseRule(content)?.paths ?? [];
    const live = globs.filter((glob) => future.some((file) => matchesGlob(file, glob)));
    if (live.length === globs.length) continue;
    if (live.length) {
      output.set(path, withPaths(content, live));
      continue;
    }
    output.delete(path);
    for (const other of [...output.keys()]) if (other.startsWith(`.agents/skills/${match[1]}/`)) output.delete(other);
    for (const [other, body] of [...output]) {
      if (other.endsWith('.md') && body.includes(`.claude/rules/${match[1]}.md`)) {
        output.set(other, body.split('\n').filter((line) => !line.includes(`.claude/rules/${match[1]}.md`)).join('\n'));
      }
    }
    skipped.push({ path, reason: `no file matches its paths (${globs.join(', ')}), so the rule would never load. Set the right folders in .agent-sdd/config.json or add the files, then run apply again.` });
  }

  const rules = [];
  for (const [path, content] of [...output]) {
    const match = path.match(/^\.claude\/rules\/([^/]+\.md)$/);
    if (!match) continue;
    rules.push([path, content]);
    const mirror = toMdc(match[1], content);
    output.set(`.cursor/rules/${mirror.file}`, mirror.content);
  }
  if (output.has(PARITY_DOC)) {
    output.set(PARITY_DOC, output.get(PARITY_DOC).replace(RULES_INDEX_SLOT, rulesIndexRows(rules)));
  }

  const nextConfig = {
    schemaVersion: 1,
    profiles,
    agents,
    runtimeRoots,
    moduleRoots: current?.moduleRoots ?? detectModuleRoots(root, runtimeRoots),
    exclude: current?.exclude ?? ['node_modules', 'dist', 'build', 'coverage', 'vendor'],
    configGroups: current?.configGroups ?? [],
    helmCharts: current?.helmCharts ?? [],
    docsStandardLine: current?.docsStandardLine ?? '',
    // The standard the gates port: its name comes from the user, its version is the one these gates implement.
    docsStandard: { name: String(current?.docsStandard?.name ?? ''), version: STANDARD_VERSION },
  };
  output.set(CONFIG, `${JSON.stringify(nextConfig, null, 2)}\n`);
  const needs = [
    ...(String(nextConfig.docsStandardLine).trim() ? [] : ['docsStandardLine']),
    ...(nextConfig.docsStandard.name.trim() ? [] : ['docsStandard.name']),
  ];
  return { files: output, skipped, needs, standardLine: String(nextConfig.docsStandardLine ?? '').trim() };
}

function readManifest(root) {
  const path = join(root, MANIFEST);
  if (!existsSync(path)) return null;
  try {
    return readJson(path);
  } catch (error) {
    throw new Error(`${MANIFEST} is not valid JSON (${error.message}). This file records which files this tool owns; restore it from Git or fix the syntax.`);
  }
}

/** Our reminder command, at its current path or at the path before 1.0.0. */
function hookMatches(command) {
  const value = String(command ?? '').replaceAll('\\', '/');
  return value.includes(HOOK_SCRIPT) || value.includes(LEGACY_HOOK_SCRIPT);
}

function currentHook(command) {
  return String(command ?? '').replaceAll('\\', '/').includes(HOOK_SCRIPT);
}

function mergeHookConfig(agent, current = {}) {
  // An entry that still runs the script at its path before 1.0.0 is dropped first, then the current one is added.
  const data = structuredClone(current);
  if (agent === 'cursor' && Array.isArray(data.hooks?.postToolUse)) {
    data.hooks.postToolUse = data.hooks.postToolUse.filter((item) => !hookMatches(item?.command) || currentHook(item?.command));
  } else if (agent !== 'cursor' && Array.isArray(data.hooks?.PostToolUse)) {
    data.hooks.PostToolUse = data.hooks.PostToolUse.flatMap((entry) => {
      if (!Array.isArray(entry?.hooks)) return [entry];
      const hooks = entry.hooks.filter((hook) => !hookMatches(hook?.command) || currentHook(hook?.command));
      return hooks.length ? [{ ...entry, hooks }] : [];
    });
  }
  if (agent === 'cursor') {
    data.version ??= 1;
    data.hooks ??= {};
    data.hooks.postToolUse ??= [];
    const command = `node ${HOOK_SCRIPT} --cursor`;
    if (!data.hooks.postToolUse.some((item) => item?.command === command)) {
      data.hooks.postToolUse.push({ command, timeout: 5 });
    }
    return data;
  }
  data.hooks ??= {};
  data.hooks.PostToolUse ??= [];
  const already = data.hooks.PostToolUse.some((entry) => (entry?.hooks ?? []).some((hook) => currentHook(hook?.command)));
  if (already) return data;
  if (agent === 'claude') {
    data.hooks.PostToolUse.push({
      matcher: 'Edit|Write',
      hooks: [{ type: 'command', command: `node ${HOOK_SCRIPT}`, timeout: 5 }],
    });
  } else {
    data.description ??= CODEX_HOOK_DESCRIPTION;
    data.hooks.PostToolUse.push({
      matcher: '^apply_patch$',
      hooks: [
        {
          type: 'command',
          command: 'node "$(git rev-parse --show-toplevel)/.claude/hooks/post-edit-reminder.mjs"',
          commandWindows:
            'for /f "delims=" %r in (\'git rev-parse --show-toplevel\') do @node "%r\\.claude\\hooks\\post-edit-reminder.mjs"',
          statusMessage: 'Checking the docs of record',
          timeout: 5,
        },
      ],
    });
  }
  return data;
}

/** Inverse of mergeHookConfig: drop our entry, then any container it left empty. */
function stripHookConfig(agent, current) {
  const data = structuredClone(current ?? {});
  if (agent === 'cursor') {
    if (Array.isArray(data.hooks?.postToolUse)) {
      data.hooks.postToolUse = data.hooks.postToolUse.filter((item) => !hookMatches(item?.command));
      if (!data.hooks.postToolUse.length) delete data.hooks.postToolUse;
    }
  } else {
    if (Array.isArray(data.hooks?.PostToolUse)) {
      // Drop only our command. A user command in the same entry stays, and so does the entry around it.
      data.hooks.PostToolUse = data.hooks.PostToolUse.flatMap((entry) => {
        if (!Array.isArray(entry?.hooks) || !entry.hooks.some((hook) => hookMatches(hook?.command))) return [entry];
        const hooks = entry.hooks.filter((hook) => !hookMatches(hook?.command));
        return hooks.length ? [{ ...entry, hooks }] : [];
      });
      if (!data.hooks.PostToolUse.length) delete data.hooks.PostToolUse;
    }
    if (data.description === CODEX_HOOK_DESCRIPTION) delete data.description;
  }
  if (data.hooks && typeof data.hooks === 'object' && !Object.keys(data.hooks).length) delete data.hooks;
  const meaningful = Object.keys(data).filter((key) => !(agent === 'cursor' && key === 'version'));
  return { data, empty: !meaningful.length };
}

const hookConfigs = {
  claude: '.claude/settings.json',
  codex: '.codex/hooks.json',
  cursor: '.cursor/hooks.json',
};

function hookContent(root, agent) {
  const path = join(root, hookConfigs[agent]);
  let current = {};
  if (existsSync(path)) {
    try {
      current = readJson(path);
    } catch (error) {
      throw new Error(`${hookConfigs[agent]} exists but is not valid JSON (${error.message}). Fix the syntax so the hook entry can be added next to your existing settings.`);
    }
  }
  return `${JSON.stringify(mergeHookConfig(agent, current), null, 2)}\n`;
}

/** The lines the tool owns in the root AGENTS.md: the docs standard line when configured, then the pointer. */
function agentsLines(standardLine) {
  return [...(standardLine ? [standardLine] : []), AGENTS_POINTER];
}

const hasLine = (body, line) => body.split('\n').some((item) => item.trim() === line);

/** `lines` inserted below the first level-one heading, or at the top when the file has none. */
function insertLines(body, lines) {
  const all = body.split('\n');
  const heading = all.findIndex((line) => /^#\s/.test(line));
  const at = heading + 1;
  const before = all.slice(0, at);
  const after = all.slice(at);
  while (after.length && !after[0].trim()) after.shift();
  const middle = lines.flatMap((line) => [line, '']);
  return `${[...before, ...(heading >= 0 ? [''] : []), ...middle, ...after].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/**
 * The root AGENTS.md carries tool-owned lines: the pointer at docs/doc-of-record.md, and the docs standard line when
 * "docsStandardLine" is set. The rest of the file is the repository's. Older installs owned an import line (0.5-0.6)
 * or a marked block (0.4); an upgrade swaps either for the current lines.
 */
function agentsContent(root, allowMerge, record = null, standardLine = '') {
  const path = join(root, 'AGENTS.md');
  const lines = agentsLines(standardLine);
  if (!existsSync(path)) return { action: 'create', content: insertLines(`${AGENTS_DEFAULT_HEADER}\n`, lines), lines };
  const current = read(path);
  const block = managedBlock(current, AGENTS_START, AGENTS_END);
  if (block !== null) {
    // An edited 0.4.0 block holds the team's text: swapping it for the tool lines would silently drop that text.
    if (record?.kind === 'managed-block' && sha(block) !== record.sha256) {
      return {
        action: 'keep',
        content: null,
        reason: `the old cross-agent-sdd block was edited after install, so this upgrade keeps it. This version replaces the block with the line "${AGENTS_POINTER}". Move your text outside the markers, then run "apply <repo> --write --replace AGENTS.md".`,
      };
    }
    const rest = current.replace(block, '');
    return { action: 'update', content: insertLines(rest, lines.filter((line) => !hasLine(rest, line))), lines };
  }
  // A line the tool owned before and no longer writes (the old import, a changed docsStandardLine) goes.
  const stale = (record?.lines ?? []).filter((line) => !lines.includes(line));
  const isStale = (line) => LEGACY_AGENTS_IMPORT_LINE.test(line.trimEnd()) || stale.includes(line.trim());
  const legacy = current.split('\n').some(isStale);
  const withoutLegacy = current.split('\n').filter((line) => !isStale(line)).join('\n');
  const missing = lines.filter((line) => !hasLine(withoutLegacy, line));
  if (!legacy && !missing.length) return { action: 'preserve', content: current, lines };
  if (legacy || record?.kind === 'managed-line' || allowMerge) {
    return { action: allowMerge && !legacy && record?.kind !== 'managed-line' ? 'merge' : 'update', content: insertLines(withoutLegacy, missing), lines };
  }
  return {
    action: 'conflict',
    content: null,
    reason: `this file already exists without the tool lines. Read it, then re-run with --merge-agents to add them below its first heading: ${missing.map((line) => `"${line}"`).join(', ')}. Your text stays as is.`,
  };
}

/**
 * CLAUDE.md hides every AGENTS.md from Claude Code, so the tool never ships one. The one-line import an older
 * version created goes on upgrade; any other CLAUDE.md stops apply until its lines move into AGENTS.md.
 */
function claudeCleanup(root, record) {
  const path = join(root, 'CLAUDE.md');
  if (!existsSync(path)) return null;
  const current = read(path);
  if (record?.kind === 'merged' && record.mode === 'created' && current.trim() === '@AGENTS.md') {
    return { action: 'delete', content: null, release: true, reason: 'an older version created it; a CLAUDE.md hides every AGENTS.md from Claude Code.' };
  }
  return {
    action: 'conflict',
    content: null,
    reason: 'a CLAUDE.md hides every AGENTS.md from Claude Code, so the repository ships AGENTS.md only. Move each line that AGENTS.md lacks into AGENTS.md (an "@AGENTS.md" import line moves nowhere), delete CLAUDE.md, then run apply again.',
  };
}

/** Up to 0.6.0 the tool kept changes-log.md out of Git; the upgrade removes that block and hands the file back. */
function gitignoreCleanup(root, record) {
  const path = join(root, '.gitignore');
  if (!existsSync(path)) return null;
  const current = read(path);
  const block = managedBlock(current, GITIGNORE_START, GITIGNORE_END);
  if (!block) return null;
  const rest = trimmedOrEmpty(current.replace(block, ''));
  if (!rest && record?.mode === 'created') return { action: 'delete', content: null, release: true, reason: 'only the changes-log.md rule was inside, and changes-log.md is gone.' };
  return { action: 'update', content: rest, release: true, reason: 'remove the changes-log.md rule; changes-log.md is gone.' };
}

/** Rows this tool adds to docs/map.md, in the column shape of the shared docs map. */
function mapRows(agents) {
  const rows = [
    '| You have… | It goes in | Living | Loaded |',
    '|---|---|---|---|',
    '| a gate script that a Git hook or CI runs | `scripts/check-docs.mjs` and `scripts/check-sdd.mjs`, with `scripts/sdd-lib.mjs`, configured in `.agent-sdd/config.json` | yes | by git and CI |',
    '| a commit already on a shared branch that fails a per-commit gate | one entry in `.agent-sdd/waivers.json`, with the full SHA and a reason | yes | by `check-sdd --changed` |',
  ];
  if (agents.includes('codex') || agents.includes('cursor')) {
    rows.push('| the Codex and Cursor adapter of a rule or a skill | `.agents/skills/<name>/SKILL.md` and `agents/openai.yaml`, with the name of the rule or skill. It links the concern doc of the rule, or the Claude skill | yes | when its description matches |');
  }
  if (agents.includes('cursor') && agents.includes('claude')) {
    rows.push('| the Cursor copy of a rule | `.cursor/rules/<name>.mdc`, generated from `.claude/rules/<name>.md` by `scripts/gen-cursor-rules.mjs`, never edited by hand | yes | when a matching file is read |');
  }
  const others = ['codex', 'cursor'].filter((agent) => agents.includes(agent)).map((agent) => `\`${hookConfigs[agent]}\``);
  if (others.length) {
    rows.push(`| the Codex or Cursor wiring of the post-edit hook | ${others.join(' and ')}, which run \`${HOOK_SCRIPT}\` like \`.claude/settings.json\` | yes | by the harness, never read |`);
  }
  return `${MAP_START}\n${rows.join('\n')}\n${MAP_END}`;
}

function mapContent(root, agents) {
  const block = mapRows(agents);
  const path = join(root, MAP);
  if (!existsSync(path)) return { action: 'create', content: `${MAP_HEADER}\n\n${block}\n` };
  const current = read(path);
  const replaced = replaceBlock(current, block, MAP_START, MAP_END);
  if (replaced !== null) return { action: replaced === current ? 'preserve' : 'update', content: replaced };
  return { action: 'merge', content: `${current.trimEnd()}\n\n${block}\n` };
}

/** How to get the tool version of an edited generated file back. "git checkout" only helps before a commit. */
function restoreAdvice(path) {
  return `To take the tool version back, run "apply <repo> --write --replace ${path}" (commit or discard other changes first).`;
}

function plan(root, profiles, agents, allowMerge = false, replace = []) {
  const manifest = readManifest(root);
  const { files: desired, skipped, needs, standardLine } = desiredFiles(root, profiles, agents);
  const desiredPaths = new Set([...desired].map(([path]) => path));
  const replaced = new Set(replace);
  for (const path of replaced) {
    if (path === 'AGENTS.md') continue; // swaps an edited 0.4.0 block for the tool lines
    if (!desiredPaths.has(path) || path === CONFIG) {
      throw new Error(`--replace ${path}: not a file this tool generates for the selected profiles. Run "plan <repo>" to see the tool-owned files.`);
    }
  }
  const actions = [];
  for (const [path, content] of desired) {
    const absolute = join(root, path);
    if (replaced.has(path)) {
      actions.push({ path, action: existsSync(absolute) ? 'update-generated' : 'create', content, replaced: true });
      continue;
    }
    if (path === CONFIG && existsSync(absolute)) {
      actions.push({ path, action: read(absolute) === content ? 'preserve' : 'merge', content });
      continue;
    }
    if (!existsSync(absolute)) {
      actions.push({ path, action: 'create', content });
      continue;
    }
    const current = read(absolute);
    if (current === content) {
      actions.push({ path, action: 'preserve', content });
      continue;
    }
    const record = manifest?.managedFiles?.[path];
    if (record?.kind === 'generated' && record.mode === 'preserved') {
      actions.push({
        path,
        action: 'keep',
        content: null,
        reason: `existed with this content before install, so it is yours and upgrades never touch it. To adopt the tool version, run "apply <repo> --write --replace ${path}".`,
      });
    } else if (record?.kind === 'generated' && record.sha256 === sha(current)) {
      actions.push({ path, action: 'update-generated', content });
    } else if (record?.kind === 'generated') {
      actions.push({
        path,
        action: 'keep',
        content: null,
        reason: `edited after install, so this upgrade skips it and your version stays. ${restoreAdvice(path)}`,
      });
    } else {
      actions.push({
        path,
        action: 'conflict',
        content: null,
        reason: `the file already exists and was not created by this tool. Keep your version by moving it aside, drop the profile that ships it (--profiles), or adopt the tool version with "apply <repo> --write --replace ${path}" after comparing the two.`,
      });
    }
  }

  // Waivers are target-owned history accounting: created empty once, never rewritten.
  const waiversPath = join(root, WAIVERS);
  actions.push(
    existsSync(waiversPath)
      ? { path: WAIVERS, action: 'preserve', content: read(waiversPath) }
      : { path: WAIVERS, action: 'create', content: '[]\n' },
  );

  const agentsPlan = agentsContent(root, allowMerge, replaced.has('AGENTS.md') ? null : manifest?.managedFiles?.['AGENTS.md'], standardLine);
  actions.push({ path: 'AGENTS.md', ...agentsPlan });
  const claude = claudeCleanup(root, manifest?.managedFiles?.['CLAUDE.md']);
  if (claude) actions.push({ path: 'CLAUDE.md', ...claude });
  const gitignore = gitignoreCleanup(root, manifest?.managedFiles?.['.gitignore']);
  if (gitignore) actions.push({ path: '.gitignore', ...gitignore });
  actions.push({ path: MAP, ...mapContent(root, agents) });
  for (const agent of agents) {
    const path = hookConfigs[agent];
    const content = hookContent(root, agent);
    const absolute = join(root, path);
    const action = !existsSync(absolute) ? 'create' : read(absolute) === content ? 'preserve' : 'merge';
    actions.push({ path, action, content });
  }
  for (const [path, why] of Object.entries(RETIRED_FILES)) {
    const record = manifest?.managedFiles?.[path];
    const absolute = join(root, path);
    if (record?.kind !== 'generated' || !existsSync(absolute)) continue;
    if (record.mode !== 'preserved' && sha(read(absolute)) === record.sha256) {
      actions.push({ path, action: 'delete', content: null, reason: `no longer shipped: ${why}.` });
    } else {
      actions.push({
        path,
        action: 'keep',
        content: null,
        reason: `no longer shipped, and it is yours (edited after install or present before it), so it stays: ${why}. Move what you added to its new home, then delete this file.`,
      });
    }
  }
  // Files from an earlier apply that the selected profiles no longer ship stay tracked while they exist.
  const planned = new Set(actions.map((action) => action.path));
  const orphans = Object.keys(manifest?.managedFiles ?? {}).filter((path) => !planned.has(path) && existsSync(join(root, path)));
  return { root, profiles, agents, actions, orphans, skipped, needs, previousManifest: manifest };
}

/** Items in the shape before 1.0.0 that an agent moves by hand: the tool never rewrites user-owned docs or tests. */
function legacyItems(root, allFiles, manifest) {
  const out = [];
  const managed = manifest?.managedFiles ?? {};
  // A copy of this skill kept in the repository is tooling: its templates and tests are not the repository's docs.
  // The gates' skip rules apply: "exclude" from the config, worktrees, and a copy of this skill kept as tooling.
  const { isSkipped } = skipRules(existingConfig(root));
  for (const path of allFiles.filter((item) => !isSkipped(item))) {
    const name = basename(path);
    if (name === 'SPEC.md') {
      out.push({ path, action: 'move to <workspace>/docs/<module>.md: add a "code:" folder, drop the Tasks, Bugs and Files tables (open work and bugs go to the issue tracker)' });
    } else if (name === 'CLAUDE.md') {
      out.push({ path, action: 'move each line that AGENTS.md lacks into the AGENTS.md beside it, then delete the file' });
    } else if (/(?:^|\/)docs\/(?:.*\/)?[^/]*[A-Z_][^/]*\.md$/.test(path) && !['README.md', 'AGENTS.md'].includes(name)) {
      out.push({ path, action: managed[path] ? 'apply deletes it when unedited; otherwise move your text to its new home' : 'git mv to a kebab-case name and update every link' });
    }
    if (/\.(?:[cm]?js|jsx|ts|tsx|py|go|java|kt|rs|md)$/.test(path)) {
      const count = (read(join(root, path)).match(/@spec\s+[a-z0-9]+(?:[.-][a-z0-9]+)*:V\d+\b/g) ?? []).length;
      if (count) out.push({ path, action: `rewrite ${count} "@spec <id>:V<n>" citation(s) as "@invariant <id>:V<n>"` });
    }
  }
  if (existsSync(join(root, '.gitignore')) && managedBlock(read(join(root, '.gitignore')), GITIGNORE_START, GITIGNORE_END)) {
    out.push({ path: '.gitignore', action: 'apply removes the changes-log.md block' });
  }
  return out;
}

/** Numeric compare of dotted versions: 0.10.0 is newer than 0.9.0. */
function newerVersion(left, right) {
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

/** The installed standard's version from <dir>/.claude-plugin/plugin.json, against the version the gates port. */
function standardStatus(root, standardDir) {
  const name = String(existingConfig(root)?.docsStandard?.name ?? '');
  let installed = null;
  if (standardDir) {
    const path = join(resolve(String(standardDir)), '.claude-plugin', 'plugin.json');
    if (!existsSync(path)) throw new Error(`--standard ${standardDir}: no .claude-plugin/plugin.json there. Pass the root folder of the installed standard plugin.`);
    installed = String(readJson(path).version ?? '') || null;
  }
  return { name, ported: STANDARD_VERSION, installed, newer: installed ? newerVersion(installed, STANDARD_VERSION) : false };
}

function audit(root, { standard = null } = {}) {
  const allFiles = repositoryFiles(root);
  const has = (path) => existsSync(join(root, path));
  const charts = allFiles.filter((path) => basename(path) === 'Chart.yaml').map((path) => dirname(path).replaceAll('\\', '/'));
  const configFiles = allFiles.filter((path) => /(?:^|\/)(?:config|configs)\//i.test(path));
  return {
    root,
    branch: git(root, ['branch', '--show-current']) || null,
    dirty: Boolean(git(root, ['status', '--porcelain'])),
    manifest: has(MANIFEST),
    packageManager: has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : has('package-lock.json') ? 'npm' : null,
    agents: {
      rootInstructions: has('AGENTS.md'),
      claudeImport: has('CLAUDE.md'),
      claude: has('.claude'),
      codex: has('.codex') || has('.agents'),
      cursor: has('.cursor'),
    },
    sdd: {
      docMap: has(MAP),
      gate: has('scripts/check-sdd.mjs'),
    },
    legacy: legacyItems(root, allFiles, readManifest(root)),
    standard: standardStatus(root, standard),
    charts,
    configFileCount: configFiles.length,
    ci: {
      github: has('.github/workflows'),
      gitlab: has('.gitlab-ci.yml'),
      bitbucket: has('bitbucket-pipelines.yml'),
      jenkins: has('Jenkinsfile'),
    },
    suggestedProfiles: [
      'core',
      'sdd',
      ...(configFiles.length ? ['config'] : []),
      ...(charts.length ? ['helm'] : []),
    ],
  };
}

function printAudit(result) {
  const yesNo = (value) => (value ? 'yes' : 'no');
  const ci = Object.entries(result.ci).filter(([, value]) => value).map(([name]) => name);
  console.log(`Repository: ${result.root}`);
  console.log(`Branch: ${result.branch ?? '<detached HEAD>'}; uncommitted changes: ${yesNo(result.dirty)}`);
  console.log(`Already set up by this tool: ${yesNo(result.manifest)}`);
  console.log(
    `Existing files: AGENTS.md ${yesNo(result.agents.rootInstructions)}, CLAUDE.md ${yesNo(result.agents.claudeImport)}, ` +
      `.claude ${yesNo(result.agents.claude)}, .codex/.agents ${yesNo(result.agents.codex)}, .cursor ${yesNo(result.agents.cursor)}`,
  );
  console.log(`docs/map.md present: ${yesNo(result.sdd.docMap)}; gate script present: ${yesNo(result.sdd.gate)}`);
  console.log(`Config-like files (paths containing config/): ${result.configFileCount}; Helm charts: ${result.charts.length}`);
  console.log(`Package manager: ${result.packageManager ?? 'none detected'}; CI: ${ci.length ? ci.join(', ') : 'none detected'}`);
  console.log(`Suggested profiles: ${result.suggestedProfiles.join(', ')} (core and sdd are always installed; config and helm only when useful)`);
  if (result.standard.newer) {
    console.log(
      `\nWarning: the installed standard ${result.standard.installed} is newer than the ${result.standard.ported} checks these gates port. ` +
        'Its new rules are not gated yet: run the docs audit, and update sdd-enforce when a newer version exists.',
    );
  }
  if (result.legacy.length) {
    console.log(`\nOld-format items (${result.legacy.length}). The gates fail on each one; move them by hand in the install change:`);
    for (const item of result.legacy) console.log(`  - ${item.path}: ${item.action}`);
  }
  console.log('\nAudit wrote nothing. Next: run "plan <repo>" to see what apply would change.');
}

function printPlan(value, asJson) {
  if (asJson) {
    const { previousManifest: _previous, ...rest } = value;
    console.log(JSON.stringify({ ...rest, actions: value.actions.map(({ content: _content, ...action }) => action) }, null, 2));
    return;
  }
  console.log(`Repository: ${value.root}`);
  console.log(`Profiles:   ${value.profiles.join(', ')}`);
  console.log(`Agents:     ${value.agents.join(', ')}`);
  console.log('');
  for (const action of value.actions) {
    console.log(`  ${action.action.padEnd(17)} ${action.path}${action.replaced ? '   (--replace: tool version written, now tool-owned)' : ''}`);
  }
  console.log(
    '\nAction words: create = new file; preserve = already correct, left alone; update = tool-owned part of your ' +
      'file refreshed; update-generated = tool-owned file upgraded; keep = tool-owned file you edited, left alone, ' +
      'upgrade skipped; merge = your file kept, tool entries added; delete = unedited file an older version generated ' +
      'and this one no longer ships, or an older tool part handed back; conflict = file exists and this tool does not ' +
      'own it, so nothing is written.',
  );
  const kept = value.actions.filter((action) => action.action === 'keep');
  if (kept.length) {
    console.log('\nKept as they are (edited by you after install):');
    for (const action of kept) console.log(`  - ${action.path}: ${action.reason}`);
  }
  const deleted = value.actions.filter((action) => action.action === 'delete');
  if (deleted.length) {
    console.log('\nRemoved (unedited, and this version no longer ships them, or no longer needed):');
    for (const action of deleted) console.log(`  - ${action.path}: ${action.reason}`);
  }
  if (value.needs?.length) {
    console.log(`\nNeeds a value: ${value.needs.join(', ')}. Ask the user, set it in .agent-sdd/config.json, then run apply again.`);
  }
  if (value.skipped?.length) {
    console.log('\nNot written:');
    for (const item of value.skipped) console.log(`  - ${item.path}: ${item.reason}`);
  }
  if (value.orphans?.length) {
    console.log(
      `\nStill tracked but no longer in the selected profiles (uninstall removes them; delete by hand if you want them gone now): ${value.orphans.join(', ')}`,
    );
  }
  const conflicts = value.actions.filter((action) => action.action === 'conflict');
  if (!conflicts.length) {
    console.log('\nNo conflicts. Apply can run.');
    return;
  }
  console.log(`\n${conflicts.length} conflict(s). Apply writes nothing until each one is resolved:`);
  for (const action of conflicts) console.log(`  - ${action.path}: ${action.reason}`);
}

/** How a merged/managed file came to carry our content; uninstall uses it to decide edit vs delete. */
function installMode(action, previousRecord) {
  if (previousRecord?.mode) return previousRecord.mode;
  if (action === 'create') return 'created';
  if (action === 'preserve') return 'preserved';
  return 'appended';
}

function applyPlan(value) {
  const conflicts = value.actions.filter((action) => action.action === 'conflict');
  if (conflicts.length) {
    throw new Error(`cannot apply with conflicts: ${conflicts.map((item) => item.path).join(', ')}. The plan above explains how to resolve each one. Nothing was written.`);
  }

  const rollback = [];
  try {
    for (const action of value.actions) {
      if (action.action === 'preserve' || action.action === 'keep') continue;
      const path = safePath(value.root, join(value.root, action.path));
      const before = existsSync(path) ? read(path) : null;
      if (action.action === 'delete') unlinkSync(path);
      else atomicWrite(path, action.content);
      rollback.push({ path, before });
    }

    const managedFiles = {};
    for (const action of value.actions) {
      if (action.path === CONFIG || action.path === WAIVERS || action.release) continue;
      const path = join(value.root, action.path);
      if (!existsSync(path)) continue;
      const previous = value.previousManifest?.managedFiles?.[action.path];
      if (action.action === 'keep' && previous) {
        managedFiles[action.path] = previous; // install-time hash stays, so uninstall still sees the edit
        continue;
      }
      if (action.path === 'AGENTS.md') {
        managedFiles[action.path] = { kind: 'managed-line', mode: installMode(action.action, previous), lines: action.lines ?? previous?.lines ?? [AGENTS_POINTER] };
      } else if (action.path === MAP || action.path === '.gitignore' || action.path === 'CLAUDE.md') {
        managedFiles[action.path] = { kind: 'merged', mode: installMode(action.action, previous) };
      } else if (Object.values(hookConfigs).includes(action.path)) {
        managedFiles[action.path] = { kind: 'semantic', mode: installMode(action.action, previous) };
      } else {
        // 'preserved' = the file already had this exact content before the first apply; uninstall leaves it.
        // Written fresh (create) or on request (--replace): ours from now on, whatever the file was before.
        const mode =
          action.action === 'create' || action.replaced
            ? 'created'
            : previous
              ? previous.mode ?? 'created'
              : action.action === 'preserve'
                ? 'preserved'
                : 'created';
        managedFiles[action.path] = { kind: 'generated', mode, sha256: sha(read(path)) };
      }
    }
    for (const path of value.orphans ?? []) {
      managedFiles[path] = value.previousManifest.managedFiles[path];
    }
    const manifest = {
      schemaVersion: 1,
      generator: { name: SKILL_NAME, version: VERSION },
      profiles: value.profiles,
      agents: value.agents,
      managedFiles,
    };
    const manifestPath = join(value.root, MANIFEST);
    const before = existsSync(manifestPath) ? read(manifestPath) : null;
    atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    rollback.push({ path: manifestPath, before });
  } catch (error) {
    for (const item of rollback.reverse()) {
      try {
        if (item.before === null && existsSync(item.path)) unlinkSync(item.path);
        else if (item.before !== null) atomicWrite(item.path, item.before);
      } catch {
        // Preserve original error; report manual recovery if rollback itself is incomplete.
      }
    }
    throw error;
  }
}

function withoutLine(body, line) {
  return body.split('\n').filter((item) => item.trim() !== line).join('\n');
}

function trimmedOrEmpty(body) {
  const trimmed = body.replace(/\n{3,}/g, '\n\n').trim();
  return trimmed ? `${trimmed}\n` : '';
}

/** What uninstall would do. Actions: delete, edit (content), keep (reason), skip (reason). */
function uninstallPlan(root, force) {
  const manifest = readManifest(root);
  if (!manifest) {
    throw new Error(`${MANIFEST} is missing, so there is nothing to uninstall. This repository was never set up by sdd-enforce, or the file was deleted; if files remain, remove them by hand.`);
  }
  const actions = [];
  const push = (path, action, extra = {}) => actions.push({ path, action, ...extra });

  for (const [path, record] of Object.entries(manifest.managedFiles ?? {})) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      push(path, 'skip', { reason: 'already gone' });
      continue;
    }
    const current = read(absolute);
    const mode = record.mode ?? (record.kind === 'generated' ? 'created' : 'appended');

    if (record.kind === 'generated') {
      if (mode === 'preserved') {
        push(path, 'keep', { reason: 'existed with this content before install; not ours to delete' });
        continue;
      }
      const unchanged = sha(current) === record.sha256;
      if (unchanged) push(path, 'delete');
      else if (force) push(path, 'delete', { reason: 'edited after install; deleted because --force was given' });
      else push(path, 'keep', { reason: 'edited after install; add --force to delete it anyway' });
      continue;
    }
    if (mode === 'preserved') {
      push(path, 'keep', { reason: 'existed with this content before install; not ours to change' });
      continue;
    }
    if (path === 'AGENTS.md') {
      // A 0.4.0 block the upgrade kept (edited) goes whole; otherwise only the tool lines are ours.
      const block = managedBlock(current, AGENTS_START, AGENTS_END);
      const what = block ? 'the cross-agent-sdd block' : 'the tool lines';
      const owned = [...(record.lines ?? [AGENTS_POINTER]), LEGACY_AGENTS_IMPORT];
      const rest = trimmedOrEmpty(block ? current.replace(block, '') : owned.reduce((body, line) => withoutLine(body, line), current));
      if (rest === trimmedOrEmpty(current)) push(path, 'keep', { reason: `${what} is no longer there; nothing to remove` });
      else if (mode === 'created' && (!rest || rest.trim() === AGENTS_DEFAULT_HEADER)) push(path, 'delete', { reason: `created by install, only ${what} inside` });
      else push(path, 'edit', { content: rest, reason: `remove ${what}, keep the rest` });
      continue;
    }
    if (path === 'CLAUDE.md') {
      const rest = trimmedOrEmpty(withoutLine(current, '@AGENTS.md'));
      if (mode === 'created' && !rest) push(path, 'delete', { reason: 'created by install, only the @AGENTS.md import inside' });
      else if (rest === trimmedOrEmpty(current)) push(path, 'keep', { reason: 'the @AGENTS.md line is no longer there; nothing to remove' });
      else push(path, 'edit', { content: rest, reason: 'remove the @AGENTS.md import, keep the rest' });
      continue;
    }
    if (path === MAP) {
      const block = managedBlock(current, MAP_START, MAP_END);
      if (!block) {
        push(path, 'keep', { reason: 'the sdd-enforce rows are no longer there; nothing to remove' });
        continue;
      }
      const rest = trimmedOrEmpty(current.replace(block, ''));
      if (mode === 'created' && (!rest || rest.trim() === MAP_HEADER)) push(path, 'delete', { reason: 'created by install, only the sdd-enforce rows inside' });
      else push(path, 'edit', { content: rest, reason: 'remove the sdd-enforce rows, keep the rest' });
      continue;
    }
    if (path === '.gitignore') {
      const block = managedBlock(current, GITIGNORE_START, GITIGNORE_END);
      if (!block) {
        push(path, 'keep', { reason: 'the cross-agent-sdd block is no longer there; nothing to remove' });
        continue;
      }
      const rest = trimmedOrEmpty(current.replace(block, ''));
      if (mode === 'created' && !rest) push(path, 'delete', { reason: 'created by install, only the changes-log.md rule inside' });
      else push(path, 'edit', { content: rest, reason: 'remove the changes-log.md rule, keep the rest' });
      continue;
    }
    const agent = Object.entries(hookConfigs).find(([, hookPath]) => hookPath === path)?.[0];
    if (agent) {
      let parsedJson;
      try {
        parsedJson = readJson(absolute);
      } catch (error) {
        push(path, 'keep', { reason: `not valid JSON (${error.message}); remove the ${HOOK_SCRIPT} entry by hand` });
        continue;
      }
      const { data, empty } = stripHookConfig(agent, parsedJson);
      const content = `${JSON.stringify(data, null, 2)}\n`;
      if (mode === 'created' && empty) push(path, 'delete', { reason: 'created by install, only the reminder hook inside' });
      else if (content === current) push(path, 'keep', { reason: 'the reminder hook entry is no longer there; nothing to remove' });
      else push(path, 'edit', { content, reason: 'remove the reminder hook entry, keep your other settings' });
      continue;
    }
    push(path, 'keep', { reason: `unknown record kind "${record.kind}"; remove by hand if it is ours` });
  }

  for (const path of [CONFIG, WAIVERS]) {
    if (existsSync(join(root, path))) push(path, 'delete', { reason: 'gate configuration; useless without the gate, Git history keeps it' });
  }
  push(MANIFEST, 'delete', { reason: 'ownership record' });
  return { root, actions, manifest };
}

function printUninstall(value) {
  console.log(`Repository: ${value.root}`);
  console.log(`Installed by: ${value.manifest.generator?.name ?? SKILL_NAME} ${value.manifest.generator?.version ?? '?'}\n`);
  for (const action of value.actions) {
    console.log(`  ${action.action.padEnd(8)} ${action.path}${action.reason ? `   (${action.reason})` : ''}`);
  }
  const counts = {};
  for (const action of value.actions) counts[action.action] = (counts[action.action] ?? 0) + 1;
  console.log(
    `\nAction words: delete = file removed; edit = only the sdd-enforce part removed, your text stays; ` +
      'keep = left untouched for the reason shown; skip = already absent.',
  );
  console.log(`Summary: ${Object.entries(counts).map(([name, count]) => `${count} ${name}`).join(', ')}.`);
}

function applyUninstall(value) {
  const rollback = [];
  try {
    for (const action of value.actions) {
      if (action.action !== 'delete' && action.action !== 'edit') continue;
      const path = safePath(value.root, join(value.root, action.path));
      const before = read(path);
      if (action.action === 'edit') atomicWrite(path, action.content);
      else unlinkSync(path);
      rollback.push({ path, before });
    }
    for (const action of value.actions) {
      if (action.action === 'delete') pruneEmptyDirs(value.root, join(value.root, action.path));
    }
  } catch (error) {
    for (const item of rollback.reverse()) {
      try {
        atomicWrite(item.path, item.before);
      } catch {
        // Preserve original error; report manual recovery if rollback itself is incomplete.
      }
    }
    throw error;
  }
}

function verify(root) {
  const manifest = readManifest(root);
  const errors = [];
  if (!manifest) {
    return { ok: false, errors: [`${MANIFEST} is missing. This repository was never set up by sdd-enforce (or the file was deleted). Run "apply <repo> --write" first.`] };
  }
  for (const [path, record] of Object.entries(manifest.managedFiles ?? {})) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      errors.push(`managed file is missing: ${path}. It was created by sdd-enforce; run "apply <repo> --write" to restore it.`);
      continue;
    }
    // Preserved files existed before install with the tool's content; they are the repository's, not ours.
    if (record.kind === 'generated' && record.mode !== 'preserved' && sha(read(absolute)) !== record.sha256) {
      errors.push(
        `managed file changed outside installer: ${path}. If the edit is intended, keep it: upgrades skip this file (plan shows "keep"). ${restoreAdvice(path)}`,
      );
    }
    // AGENTS.md is the repository's apart from the tool lines, and check-docs below asserts them.
  }
  for (const agent of manifest.agents ?? []) {
    const path = hookConfigs[agent];
    if (!path || !existsSync(join(root, path))) {
      errors.push(`missing ${agent} hook config (${path ?? agent}). Run "apply <repo> --write" to recreate it.`);
    } else if (!read(join(root, path)).replaceAll('\\', '/').includes(HOOK_SCRIPT)) {
      errors.push(`${agent} hook config (${path}) no longer runs ${HOOK_SCRIPT}. Add the hook entry back or run "apply <repo> --write".`);
    }
  }

  // Both generated gates run: check-docs (documents exist and are wired) then check-sdd (shapes, evidence, parity).
  const stdout = [];
  const stderr = [];
  let status = 0;
  for (const name of ['scripts/check-docs.mjs', 'scripts/check-sdd.mjs']) {
    const gate = join(root, name);
    if (!existsSync(gate)) {
      errors.push(`${name} is missing. Run "apply <repo> --write" to recreate the gate.`);
      continue;
    }
    const result = spawnSync(process.execPath, [gate], { cwd: root, encoding: 'utf8' });
    if (result.stdout.trim()) stdout.push(result.stdout.trim());
    if (result.stderr.trim()) stderr.push(result.stderr.trim());
    if (result.status !== 0) {
      status = result.status ?? 1;
      errors.push(`the repository gate (${name}) reported problems; see the lines above for what to fix.`);
    }
  }
  const gateResult = { status, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  return { ok: errors.length === 0, errors, gate: gateResult };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.positional.shift();
  if (!command || ['help', '-h', '--help'].includes(command)) {
    help();
    return;
  }
  if (command === 'version') {
    console.log(VERSION);
    return;
  }

  const root = repoRoot(parsed.positional[0] ?? '.');
  if (command === 'audit') {
    const result = audit(root, { standard: flag(parsed, 'standard', null) });
    if (flag(parsed, 'json', false)) console.log(JSON.stringify(result, null, 2));
    else printAudit(result);
    return;
  }
  if (command === 'uninstall') {
    const value = uninstallPlan(root, flag(parsed, 'force', false));
    printUninstall(value);
    if (!flag(parsed, 'write', false)) {
      console.log('\nThis was a dry run: nothing was changed. Re-run with --write to remove the files marked "delete" and clean the ones marked "edit".');
      return;
    }
    requireCleanTree(root, parsed, 'uninstall');
    const changes = value.actions.filter((action) => action.action === 'delete' || action.action === 'edit').length;
    if (!(await confirmOrThrow(parsed, 'uninstall', `this deletes or edits ${changes} file(s) listed above`))) {
      console.log('Cancelled. Nothing was changed.');
      return;
    }
    applyUninstall(value);
    console.log(`\nUninstalled sdd-enforce from ${root}. Review the diff with "git status" and commit it.
Things this tool cannot undo for you:
  - lines you added to Git hooks (pre-commit, commit-msg) or CI that run scripts/check-docs.mjs or
    scripts/check-sdd.mjs: remove them;
  - package.json script aliases you added for the gate;
  - your docs of record: they stay and remain useful without the gate.`);
    return;
  }

  const { profiles, agents } = selected(parsed, root);
  const replace = String(flag(parsed, 'replace', '') || '')
    .split(',')
    .map((item) => item.trim().replaceAll('\\', '/').replace(/^\.\//, ''))
    .filter(Boolean);
  const value = plan(root, profiles, agents, flag(parsed, 'merge-agents', false), replace);
  if (command === 'plan') {
    printPlan(value, flag(parsed, 'json', false));
    if (!flag(parsed, 'json', false)) console.log('\nPlan wrote nothing. Next: run "apply <repo> --write" to create these files.');
    return;
  }
  if (command === 'apply') {
    requireCleanTree(root, parsed, 'apply');
    printPlan(value, false);
    if (!flag(parsed, 'write', false)) {
      console.log('\nThis was a dry run: nothing was written. Re-run the same command with --write to create the files.');
      return;
    }
    applyPlan(value);
    console.log(`\nApplied sdd-enforce ${VERSION}. Next steps:
  1. Open .agent-sdd/config.json: make sure "runtimeRoots" lists the folders that hold application code,
     "moduleRoots" lists the folders whose children are modules that a doc of record covers (for example
     "apps/*/src/modules"), and archived docs (old plans, samples) are in "exclude". Set "docsStandardLine"
     when your organization has a docs standard line for the root AGENTS.md, commit the config change, and run
     apply again (apply refuses a dirty tree).
  2. Run "audit <repo>" and move every old-format item it lists; the gates fail on each one.
  3. Run "node scripts/check-docs.mjs" and "node scripts/check-sdd.mjs"; fix what they report. Each line says
     what is wrong and how to fix it.
  4. Wire both gates into Git hooks (.husky/ for JS, .pre-commit-config.yaml for pre-commit) and CI:
       pre-commit:  node scripts/check-docs.mjs && node scripts/check-sdd.mjs
       commit-msg:  node scripts/check-sdd.mjs --staged --commit-msg $1
       CI:          node scripts/check-docs.mjs && node scripts/check-sdd.mjs && node scripts/check-sdd.mjs --changed
  5. Run "verify <repo>" to confirm every generated file is intact and both gates are green.
  6. Commit the new files together (this tool never commits for you).
To remove everything later: "uninstall <repo> --write".`);
    return;
  }
  if (command === 'verify') {
    const result = verify(root);
    if (flag(parsed, 'json', false)) console.log(JSON.stringify(result, null, 2));
    else {
      if (result.gate?.stdout) console.log(result.gate.stdout);
      if (result.gate?.stderr) console.error(result.gate.stderr);
      for (const error of result.errors) console.error(`x ${error}`);
      console.log(
        result.ok
          ? 'sdd-enforce verify: ok (generated files intact, gate green)'
          : `sdd-enforce verify: failed (${result.errors.length} problem(s) listed above)`,
      );
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }
  throw new Error(`unknown command "${command}". Run with --help to see the available commands.`);
}

try {
  await main();
} catch (error) {
  console.error(`sdd-enforce: ${error.message}`);
  process.exit(1);
}
