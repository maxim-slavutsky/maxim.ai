#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { toMdc } from '../assets/repository/scripts/gen-cursor-rules.mjs';

const VERSION = '0.3.0';
const SKILL_NAME = 'cross-agent-sdd';
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
const INSTALL_MARKER = '.cross-agent-sdd-install.json';
const AGENTS_START = '<!-- cross-agent-sdd:start -->';
const AGENTS_END = '<!-- cross-agent-sdd:end -->';
const AGENTS_DEFAULT_HEADER = '# Repository agent instructions';
const GITIGNORE_START = '# cross-agent-sdd:start';
const GITIGNORE_END = '# cross-agent-sdd:end';
const HOOK_SCRIPT = 'scripts/hooks/post-edit-reminder.mjs';
const CODEX_HOOK_DESCRIPTION = 'Cross-agent counterpart hooks. Canonical policy loads before edits through AGENTS.md and skills.';
const DEFAULT_PROFILES = ['core', 'sdd'];
const ALL_PROFILES = ['core', 'sdd', 'config', 'helm'];
const ALL_AGENTS = ['claude', 'codex', 'cursor'];

// Path-scoped concern: Claude rule + Codex/Cursor skill. Invocable workflow: skill on both sides.
// Cursor rule mirrors are generated from Claude rules, never listed here.
const entries = [
  ['core', 'docs/agent-sdd/FORMAT.md'],
  ['core', 'docs/workflows/AGENT-PARITY-WORKFLOW.md'],
  ['core', 'docs/workflows/COMMIT-WORKFLOW.md'],
  ['core', 'scripts/check-sdd.mjs'],
  ['core', 'scripts/gen-cursor-rules.mjs'],
  ['core', 'scripts/hooks/post-edit-reminder.mjs'],
  ['core', '.agents/skills/agent-parity/SKILL.md'],
  ['core', '.agents/skills/agent-parity/agents/openai.yaml'],
  ['core', '.agents/skills/commit-changes/SKILL.md'],
  ['core', '.agents/skills/commit-changes/agents/openai.yaml'],
  ['core', '.claude/skills/commit-changes/SKILL.md'],
  ['core', '.claude/rules/agent-parity.md'],
  ['sdd', 'docs/workflows/SPEC-FIRST-WORKFLOW.md'],
  ['sdd', '.agents/skills/spec-first/SKILL.md'],
  ['sdd', '.agents/skills/spec-first/agents/openai.yaml'],
  ['sdd', '.claude/rules/spec-first.md'],
  ['config', 'docs/workflows/APP-CONFIG-WORKFLOW.md'],
  ['config', '.agents/skills/app-config-updates/SKILL.md'],
  ['config', '.agents/skills/app-config-updates/agents/openai.yaml'],
  ['config', '.claude/rules/app-config-updates.md'],
  ['helm', 'docs/workflows/HELM-VALIDATION-WORKFLOW.md'],
  ['helm', '.agents/skills/validate-helm-charts/SKILL.md'],
  ['helm', '.agents/skills/validate-helm-charts/agents/openai.yaml'],
  ['helm', '.claude/skills/validate-helm-charts/SKILL.md'],
].map(([profile, path]) => ({ profile, path }));

function help() {
  console.log(`cross-agent-sdd ${VERSION}
One spec-driven-development policy for Claude Code, Codex, and Cursor, installed into a Git repository.

Usage: node <path-to-skill>/scripts/cross-agent-sdd.mjs <command> [arguments]

Commands
  audit <repo> [--json]           Look at the repository and report what is already there. Changes nothing.
  plan <repo> [options]           Show every file "apply" would create, update, keep, or refuse. Changes nothing.
  apply <repo> --write [options]  Write the files from the plan. Without --write it is a dry run: it prints
                                  the plan and writes nothing.
  verify <repo> [--json]          Check that every generated file is intact, then run the repository gate
                                  (scripts/check-sdd.mjs). Changes nothing.
  uninstall <repo> --write        Remove everything "apply" added: delete tool-owned files, take the managed
                                  block out of AGENTS.md, the import out of CLAUDE.md, the hook entries out
                                  of the settings files. Your own files stay. Asks you to type "uninstall"
                                  before deleting; without --write it only lists what would go.
  install-skill [options] --write Copy this skill into your home folder (or one repository) so your AI tools
                                  can find it. Without --write it only shows the target folders.
  uninstall-skill [options] --write   Remove those copies again (only folders this installer created).

Options for plan, apply, and uninstall
  --profiles core,sdd,config,helm   Which file sets to install. "core,sdd" is the default and always included.
                                    "config" adds a runtime-config propagation gate; "helm" adds Helm chart
                                    validation. "full" means all four. (plan, apply)
  --agents all | claude,codex,cursor   Which AI tools to configure. Default: all three. (plan, apply)
  --merge-agents                    When AGENTS.md or CLAUDE.md already exists, append the managed block or the
                                    @AGENTS.md import instead of stopping. Read those files first. (plan, apply)
  --replace <path>[,<path>]         Write the tool version of these tool-owned files even if you edited them or
                                    they existed before install. They become tool-owned: upgrades update them
                                    and uninstall deletes them. (plan, apply)
  --allow-dirty                     Run even if the repository has uncommitted changes. Not recommended.
  --yes                             Skip the typed confirmation. Only for scripts, and only after a person has
                                    confirmed. (uninstall, uninstall-skill)
  --force                           uninstall: also delete tool-owned files that were edited after install.
  --json                            Machine-readable output (plan, audit, verify, install-skill).

Options for install-skill and uninstall-skill
  --scope user | project            "user" = your home folder (default), "project" = one repository (--repo).
  --repo <path>                     Repository for --scope project. Default: current folder.
  --agents all | claude,codex,cursor   Which tools get a copy. Codex and Cursor share ~/.agents/skills.
  --cursor-cloud                    Also use ~/.cursor/skills (only for Cursor Cloud sync).
  --force                           install-skill: replace a copy this tool installed earlier (upgrade).

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
  const temporary = `${path}.cross-agent-sdd-${process.pid}-${randomUUID()}.tmp`;
  const backup = `${path}.cross-agent-sdd-${process.pid}-${randomUUID()}.bak`;
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

function desiredFiles(root, profiles, agents) {
  const output = new Map();
  for (const entry of entries) {
    if (!profiles.includes(entry.profile)) continue;
    output.set(entry.path, read(assetSource(entry.path)));
  }
  for (const [path, content] of [...output]) {
    const match = path.match(/^\.claude\/rules\/([^/]+\.md)$/);
    if (!match || match[1] === 'INDEX.md') continue;
    const mirror = toMdc(match[1], content);
    output.set(`.cursor/rules/${mirror.file}`, mirror.content);
  }

  const current = existingConfig(root);
  const nextConfig = {
    schemaVersion: 1,
    profiles,
    agents,
    runtimeRoots: current?.runtimeRoots ?? detectRuntimeRoots(root),
    exclude: current?.exclude ?? ['node_modules', 'dist', 'build', 'coverage', 'vendor'],
    configGroups: current?.configGroups ?? [],
    helmCharts: current?.helmCharts ?? [],
  };
  output.set(CONFIG, `${JSON.stringify(nextConfig, null, 2)}\n`);
  return output;
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

function hookMatches(command) {
  return String(command ?? '').replaceAll('\\', '/').includes(HOOK_SCRIPT);
}

function mergeHookConfig(agent, current = {}) {
  const data = structuredClone(current);
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
  const already = data.hooks.PostToolUse.some((entry) => (entry?.hooks ?? []).some((hook) => hookMatches(hook?.command)));
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
          command: 'node "$(git rev-parse --show-toplevel)/scripts/hooks/post-edit-reminder.mjs"',
          commandWindows:
            'for /f "delims=" %r in (\'git rev-parse --show-toplevel\') do @node "%r\\scripts\\hooks\\post-edit-reminder.mjs"',
          statusMessage: 'Checking repository change log',
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

function agentsContent(root, allowMerge) {
  const fragment = read(join(ASSET_ROOT, 'AGENTS.fragment.md')).trim();
  const path = join(root, 'AGENTS.md');
  if (!existsSync(path)) return { action: 'create', content: `${AGENTS_DEFAULT_HEADER}\n\n${fragment}\n` };
  const current = read(path);
  const replaced = replaceBlock(current, fragment, AGENTS_START, AGENTS_END);
  if (replaced !== null) return { action: replaced === current ? 'preserve' : 'update', content: replaced };
  if (!allowMerge) {
    return {
      action: 'conflict',
      content: null,
      reason: 'this file already exists and has no cross-agent-sdd block. Read it, then re-run with --merge-agents to append the block at the end; your text stays as is.',
    };
  }
  return { action: 'merge', content: `${current.trimEnd()}\n\n${fragment}\n` };
}

function claudeContent(root, allowMerge, enabled) {
  if (!enabled) return null;
  const path = join(root, 'CLAUDE.md');
  if (!existsSync(path)) return { action: 'create', content: '@AGENTS.md\n' };
  const current = read(path);
  if (/(?:^|\n)@AGENTS\.md(?:\n|$)/.test(current)) return { action: 'preserve', content: current };
  if (!allowMerge) {
    return {
      action: 'conflict',
      content: null,
      reason: 'this file already exists and does not import @AGENTS.md. Read it, then re-run with --merge-agents to append the import line; your text stays as is.',
    };
  }
  return { action: 'merge', content: `${current.trimEnd()}\n\n@AGENTS.md\n` };
}

function gitignoreContent(root) {
  const block = `${GITIGNORE_START}\nchanges-log.md\n${GITIGNORE_END}`;
  const path = join(root, '.gitignore');
  if (!existsSync(path)) return { action: 'create', content: `${block}\n` };
  const current = read(path);
  if (current.split('\n').some((line) => line.trim() === 'changes-log.md')) {
    return { action: 'preserve', content: current };
  }
  const replaced = replaceBlock(current, block, GITIGNORE_START, GITIGNORE_END);
  if (replaced !== null) return { action: replaced === current ? 'preserve' : 'update', content: replaced };
  return { action: 'merge', content: `${current.trimEnd()}\n\n${block}\n` };
}

/** How to get the tool version of an edited generated file back. "git checkout" only helps before a commit. */
function restoreAdvice(path) {
  return `To take the tool version back, run "apply <repo> --write --replace ${path}" (commit or discard other changes first).`;
}

function plan(root, profiles, agents, allowMerge = false, replace = []) {
  const manifest = readManifest(root);
  const desired = desiredFiles(root, profiles, agents);
  const desiredPaths = new Set([...desired].map(([path]) => path));
  const replaced = new Set(replace);
  for (const path of replaced) {
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
        reason: 'the file already exists and was not created by this tool. Keep your version by moving it aside, or drop the profile that ships it (--profiles).',
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

  const agentsPlan = agentsContent(root, allowMerge);
  actions.push({ path: 'AGENTS.md', ...agentsPlan });
  const claude = claudeContent(root, allowMerge, agents.includes('claude'));
  if (claude) actions.push({ path: 'CLAUDE.md', ...claude });
  actions.push({ path: '.gitignore', ...gitignoreContent(root) });
  for (const agent of agents) {
    const path = hookConfigs[agent];
    const content = hookContent(root, agent);
    const absolute = join(root, path);
    const action = !existsSync(absolute) ? 'create' : read(absolute) === content ? 'preserve' : 'merge';
    actions.push({ path, action, content });
  }
  // Files from an earlier apply that the selected profiles no longer ship stay tracked while they exist.
  const planned = new Set(actions.map((action) => action.path));
  const orphans = Object.keys(manifest?.managedFiles ?? {}).filter((path) => !planned.has(path) && existsSync(join(root, path)));
  return { root, profiles, agents, actions, orphans, previousManifest: manifest };
}

function audit(root) {
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
      specCount: allFiles.filter((path) => basename(path) === 'SPEC.md').length,
      workflowCount: allFiles.filter((path) => path.startsWith('docs/workflows/') && path.endsWith('.md')).length,
      gate: has('scripts/check-sdd.mjs'),
    },
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
  console.log(`SPEC.md files: ${result.sdd.specCount}; workflow docs under docs/workflows: ${result.sdd.workflowCount}; gate script present: ${yesNo(result.sdd.gate)}`);
  console.log(`Config-like files (paths containing config/): ${result.configFileCount}; Helm charts: ${result.charts.length}`);
  console.log(`Package manager: ${result.packageManager ?? 'none detected'}; CI: ${ci.length ? ci.join(', ') : 'none detected'}`);
  console.log(`Suggested profiles: ${result.suggestedProfiles.join(', ')} (core and sdd are always installed; config and helm only when useful)`);
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
    '\nAction words: create = new file; preserve = already correct, left alone; update = managed block refreshed; ' +
      'update-generated = tool-owned file upgraded; keep = tool-owned file you edited, left alone, upgrade skipped; ' +
      'merge = your file kept, tool entries added; conflict = file exists and this tool does not own it, so nothing is written.',
  );
  const kept = value.actions.filter((action) => action.action === 'keep');
  if (kept.length) {
    console.log('\nKept as they are (edited by you after install):');
    for (const action of kept) console.log(`  - ${action.path}: ${action.reason}`);
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
      atomicWrite(path, action.content);
      rollback.push({ path, before });
    }

    const managedFiles = {};
    for (const action of value.actions) {
      if (action.path === CONFIG || action.path === WAIVERS) continue;
      const path = join(value.root, action.path);
      if (!existsSync(path)) continue;
      const previous = value.previousManifest?.managedFiles?.[action.path];
      if (action.action === 'keep' && previous) {
        managedFiles[action.path] = previous; // install-time hash stays, so uninstall still sees the edit
        continue;
      }
      if (action.path === 'AGENTS.md') {
        const block = managedBlock(read(path), AGENTS_START, AGENTS_END);
        managedFiles[action.path] = { kind: 'managed-block', mode: installMode(action.action, previous), sha256: sha(block ?? '') };
      } else if (action.path === '.gitignore' || action.path === 'CLAUDE.md') {
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
    throw new Error(`${MANIFEST} is missing, so there is nothing to uninstall. This repository was never set up by cross-agent-sdd, or the file was deleted; if files remain, remove them by hand.`);
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
    if (record.kind === 'managed-block') {
      const block = managedBlock(current, AGENTS_START, AGENTS_END);
      if (!block) {
        push(path, 'keep', { reason: 'the cross-agent-sdd block is no longer there; nothing to remove' });
        continue;
      }
      const rest = trimmedOrEmpty(current.replace(block, ''));
      if (mode === 'created' && (!rest || rest.trim() === AGENTS_DEFAULT_HEADER)) push(path, 'delete', { reason: 'created by install, only the managed block inside' });
      else push(path, 'edit', { content: rest, reason: 'remove the cross-agent-sdd block, keep the rest' });
      continue;
    }
    if (path === 'CLAUDE.md') {
      const rest = trimmedOrEmpty(withoutLine(current, '@AGENTS.md'));
      if (mode === 'created' && !rest) push(path, 'delete', { reason: 'created by install, only the @AGENTS.md import inside' });
      else if (rest === trimmedOrEmpty(current)) push(path, 'keep', { reason: 'the @AGENTS.md line is no longer there; nothing to remove' });
      else push(path, 'edit', { content: rest, reason: 'remove the @AGENTS.md import, keep the rest' });
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
    `\nAction words: delete = file removed; edit = only the cross-agent-sdd part removed, your text stays; ` +
      'keep = left untouched for the reason shown; skip = already absent.',
  );
  console.log(`Summary: ${Object.entries(counts).map(([name, count]) => `${count} ${name}`).join(', ')}.`);
  if (existsSync(join(value.root, 'changes-log.md'))) {
    console.log('Note: changes-log.md stays; it is your session log, delete it yourself when done.');
  }
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
    return { ok: false, errors: [`${MANIFEST} is missing. This repository was never set up by cross-agent-sdd (or the file was deleted). Run "apply <repo> --write" first.`] };
  }
  for (const [path, record] of Object.entries(manifest.managedFiles ?? {})) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      errors.push(`managed file is missing: ${path}. It was created by cross-agent-sdd; run "apply <repo> --write" to restore it.`);
      continue;
    }
    // Preserved files existed before install with the tool's content; they are the repository's, not ours.
    if (record.kind === 'generated' && record.mode !== 'preserved' && sha(read(absolute)) !== record.sha256) {
      errors.push(
        `managed file changed outside installer: ${path}. If the edit is intended, keep it: upgrades skip this file (plan shows "keep"). ${restoreAdvice(path)}`,
      );
    }
    if (record.kind === 'managed-block') {
      const block = managedBlock(read(absolute), AGENTS_START, AGENTS_END);
      if (!block || sha(block) !== record.sha256) {
        errors.push(`managed AGENTS block changed: ${path}. The text between the cross-agent-sdd markers was edited or removed. Put repository-specific policy outside the markers and run "apply --write" to restore the block.`);
      }
    }
  }
  for (const agent of manifest.agents ?? []) {
    const path = hookConfigs[agent];
    if (!path || !existsSync(join(root, path))) {
      errors.push(`missing ${agent} hook config (${path ?? agent}). Run "apply <repo> --write" to recreate it.`);
    } else if (!read(join(root, path)).replaceAll('\\', '/').includes(HOOK_SCRIPT)) {
      errors.push(`${agent} hook config (${path}) no longer runs ${HOOK_SCRIPT}. Add the hook entry back or run "apply <repo> --write".`);
    }
  }

  const gate = join(root, 'scripts', 'check-sdd.mjs');
  let gateResult = null;
  if (existsSync(gate)) {
    const result = spawnSync(process.execPath, [gate], { cwd: root, encoding: 'utf8' });
    gateResult = { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
    if (result.status !== 0) errors.push('the repository gate (scripts/check-sdd.mjs) reported problems; see the lines above for what to fix.');
  } else {
    errors.push('scripts/check-sdd.mjs is missing. Run "apply <repo> --write" to recreate the gate.');
  }
  return { ok: errors.length === 0, errors, gate: gateResult };
}

function copySkill(target, force) {
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  safePath(parent, target);
  if (existsSync(target)) {
    const marker = join(target, INSTALL_MARKER);
    if (!existsSync(marker)) {
      throw new Error(`refusing to replace ${target}: that folder was not created by this installer. Move it aside first if you want this skill there.`);
    }
    if (!force) throw new Error(`the skill is already installed at ${target}. Add --force to replace it with this version.`);
  }

  const temporary = join(parent, `.${SKILL_NAME}-${process.pid}-${randomUUID()}.tmp`);
  const backup = join(parent, `.${SKILL_NAME}-${process.pid}-${randomUUID()}.bak`);
  cpSync(SKILL_ROOT, temporary, { recursive: true, errorOnExist: true, force: false });
  writeFileSync(
    join(temporary, INSTALL_MARKER),
    `${JSON.stringify({ name: SKILL_NAME, version: VERSION }, null, 2)}\n`,
    'utf8',
  );
  if (!existsSync(target)) {
    renameSync(temporary, target);
    return;
  }
  renameSync(target, backup);
  try {
    renameSync(temporary, target);
    rmSync(backup, { recursive: true });
  } catch (error) {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true });
    if (existsSync(target)) rmSync(target, { recursive: true });
    renameSync(backup, target);
    throw error;
  }
}

function skillTargets(parsed) {
  const scope = flag(parsed, 'scope', 'user');
  if (!['user', 'project'].includes(scope)) {
    throw new Error('--scope must be "user" (your home folder, available in every repository) or "project" (one repository, use --repo <path>).');
  }
  const agents = listOption('agents', flag(parsed, 'agents', 'all'), ALL_AGENTS, ALL_AGENTS);
  const base = scope === 'user' ? homedir() : repoRoot(flag(parsed, 'repo', '.'));
  const targets = [];
  if (agents.includes('codex') || agents.includes('cursor')) {
    targets.push({ path: join(base, '.agents', 'skills', SKILL_NAME), tools: 'Codex and Cursor' });
  }
  if (agents.includes('claude')) targets.push({ path: join(base, '.claude', 'skills', SKILL_NAME), tools: 'Claude Code' });
  if (agents.includes('cursor') && flag(parsed, 'cursor-cloud', false)) {
    targets.push({ path: join(base, '.cursor', 'skills', SKILL_NAME), tools: 'Cursor Cloud sync' });
  }
  return { scope, agents, targets };
}

function installSkill(parsed) {
  const { scope, agents, targets } = skillTargets(parsed);
  const output = { scope, agents, targets: targets.map((target) => target.path) };
  if (!flag(parsed, 'write', false)) return { ...output, dryRun: true, details: targets };
  for (const target of targets) copySkill(target.path, flag(parsed, 'force', false));
  return { ...output, dryRun: false, details: targets };
}

function printInstall(result) {
  if (result.dryRun) {
    console.log('install-skill dry run: nothing was copied. It would copy this skill to:');
  } else {
    console.log(`Installed cross-agent-sdd ${VERSION} (scope: ${result.scope}) to:`);
  }
  for (const target of result.details) console.log(`  ${target.path}   (${target.tools})`);
  if (result.dryRun) {
    console.log('Add --write to copy the files.');
  } else {
    console.log('Start a new session in your AI tool so it picks up the skill. Then, inside a repository, ask it to bootstrap cross-agent SDD.');
  }
}

function uninstallSkillPlan(parsed) {
  const { scope, targets } = skillTargets(parsed);
  const actions = targets.map((target) => {
    if (!existsSync(target.path)) return { ...target, action: 'skip', reason: 'not installed there' };
    if (!existsSync(join(target.path, INSTALL_MARKER))) return { ...target, action: 'keep', reason: 'folder was not created by this installer; remove it by hand if it is yours' };
    return { ...target, action: 'delete' };
  });
  return { scope, actions };
}

function printUninstallSkill(value) {
  console.log(`uninstall-skill (scope: ${value.scope}):`);
  for (const action of value.actions) {
    console.log(`  ${action.action.padEnd(8)} ${action.path}   (${action.tools}${action.reason ? `; ${action.reason}` : ''})`);
  }
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
  if (command === 'install-skill') {
    const result = installSkill(parsed);
    if (flag(parsed, 'json', false)) {
      const { details: _details, ...json } = result;
      console.log(JSON.stringify(json, null, 2));
    } else {
      printInstall(result);
    }
    return;
  }
  if (command === 'uninstall-skill') {
    const value = uninstallSkillPlan(parsed);
    printUninstallSkill(value);
    const deletions = value.actions.filter((action) => action.action === 'delete');
    if (!flag(parsed, 'write', false)) {
      console.log('\nThis was a dry run: nothing was changed. Add --write to remove the folders marked "delete".');
      return;
    }
    if (!deletions.length) {
      console.log('\nNothing to remove.');
      return;
    }
    if (!(await confirmOrThrow(parsed, 'uninstall', `this deletes ${deletions.length} skill folder(s) listed above`))) {
      console.log('Cancelled. Nothing was changed.');
      return;
    }
    for (const action of deletions) rmSync(action.path, { recursive: true });
    console.log(`\nRemoved ${deletions.length} skill folder(s). Repositories set up with the skill keep working; use "uninstall <repo>" to undo those.`);
    return;
  }

  const root = repoRoot(parsed.positional[0] ?? '.');
  if (command === 'audit') {
    const result = audit(root);
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
    console.log(`\nUninstalled cross-agent-sdd from ${root}. Review the diff with "git status" and commit it.
Things this tool cannot undo for you:
  - lines you added to Git hooks (pre-commit, commit-msg) or CI that run scripts/check-sdd.mjs: remove them;
  - package.json script aliases you added for the gate;
  - your own SPEC.md files: they stay and remain useful without the gate.`);
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
    console.log(`\nApplied cross-agent-sdd ${VERSION}. Next steps:
  1. Open .agent-sdd/config.json: make sure "runtimeRoots" lists the folders that hold application code, and
     add archived docs (old plans, samples) to "exclude" so their stale links do not fail the gate.
  2. Run "node scripts/check-sdd.mjs" and fix what it reports. Each line says what is wrong and how to fix it.
  3. Wire the gate into Git hooks and CI:
       pre-commit:  node scripts/check-sdd.mjs
       commit-msg:  node scripts/check-sdd.mjs --staged --commit-msg $1
       CI:          node scripts/check-sdd.mjs --changed
  4. Run "verify <repo>" to confirm every generated file is intact and the gate is green.
  5. Commit the new files together (this tool never commits for you).
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
          ? 'cross-agent-sdd verify: ok (generated files intact, gate green)'
          : `cross-agent-sdd verify: failed (${result.errors.length} problem(s) listed above)`,
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
  console.error(`cross-agent-sdd: ${error.message}`);
  process.exit(1);
}
