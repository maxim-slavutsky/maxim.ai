#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toMdc } from '../assets/repository/scripts/gen-cursor-rules.mjs';

const VERSION = '0.2.0';
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
const AGENTS_START = '<!-- cross-agent-sdd:start -->';
const AGENTS_END = '<!-- cross-agent-sdd:end -->';
const GITIGNORE_START = '# cross-agent-sdd:start';
const GITIGNORE_END = '# cross-agent-sdd:end';
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

Usage:
  audit <repo> [--json]
  plan <repo> [--profiles core,sdd,config,helm|full] [--agents all|claude,codex,cursor] [--json]
  apply <repo> --write [--profiles ...] [--agents ...] [--merge-agents] [--allow-dirty]
  verify <repo> [--json]
  install-skill --scope user|project --agents all|claude,codex,cursor --write
                [--repo <path>] [--cursor-cloud] [--force]

Mutating commands are dry-run unless --write is present.`);
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

function listOption(value, allowed, fallback) {
  if (!value) return [...fallback];
  const values = value === 'all' || value === 'full' ? [...allowed] : String(value).split(',').map((item) => item.trim());
  const invalid = values.filter((item) => !allowed.includes(item));
  if (invalid.length) throw new Error(`unsupported value(s): ${invalid.join(', ')}`);
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
    throw new Error(`not a Git repository: ${candidate}`);
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
    throw new Error(`path escapes expected root: ${absolute}`);
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
    throw new Error(`invalid ${CONFIG}: ${error.message}`);
  }
}

function selected(parsed, root = null) {
  const current = root ? existingConfig(root) : null;
  const profiles = listOption(flag(parsed, 'profiles'), ALL_PROFILES, current?.profiles ?? DEFAULT_PROFILES);
  if (!profiles.includes('core')) profiles.unshift('core');
  if (!profiles.includes('sdd')) profiles.splice(1, 0, 'sdd');
  const agents = listOption(flag(parsed, 'agents'), ALL_AGENTS, current?.agents ?? ALL_AGENTS);
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
    throw new Error(`invalid ${MANIFEST}: ${error.message}`);
  }
}

function mergeHookConfig(agent, current = {}) {
  const data = structuredClone(current);
  if (agent === 'cursor') {
    data.version ??= 1;
    data.hooks ??= {};
    data.hooks.postToolUse ??= [];
    const command = 'node scripts/hooks/post-edit-reminder.mjs --cursor';
    if (!data.hooks.postToolUse.some((item) => item?.command === command)) {
      data.hooks.postToolUse.push({ command, timeout: 5 });
    }
    return data;
  }
  data.hooks ??= {};
  data.hooks.PostToolUse ??= [];
  const script = 'scripts/hooks/post-edit-reminder.mjs';
  const already = data.hooks.PostToolUse.some((entry) =>
    (entry?.hooks ?? []).some((hook) => String(hook?.command ?? '').replaceAll('\\', '/').includes(script)),
  );
  if (already) return data;
  if (agent === 'claude') {
    data.hooks.PostToolUse.push({
      matcher: 'Edit|Write',
      hooks: [{ type: 'command', command: `node ${script}`, timeout: 5 }],
    });
  } else {
    data.description ??= 'Cross-agent counterpart hooks. Canonical policy loads before edits through AGENTS.md and skills.';
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
      throw new Error(`cannot merge invalid ${hookConfigs[agent]}: ${error.message}`);
    }
  }
  return `${JSON.stringify(mergeHookConfig(agent, current), null, 2)}\n`;
}

function agentsContent(root, allowMerge) {
  const fragment = read(join(ASSET_ROOT, 'AGENTS.fragment.md')).trim();
  const path = join(root, 'AGENTS.md');
  if (!existsSync(path)) return { action: 'create', content: `# Repository agent instructions\n\n${fragment}\n` };
  const current = read(path);
  const replaced = replaceBlock(current, fragment, AGENTS_START, AGENTS_END);
  if (replaced !== null) return { action: replaced === current ? 'preserve' : 'update', content: replaced };
  if (!allowMerge) return { action: 'conflict', content: null, reason: 'existing AGENTS.md lacks managed block' };
  return { action: 'merge', content: `${current.trimEnd()}\n\n${fragment}\n` };
}

function claudeContent(root, allowMerge, enabled) {
  if (!enabled) return null;
  const path = join(root, 'CLAUDE.md');
  if (!existsSync(path)) return { action: 'create', content: '@AGENTS.md\n' };
  const current = read(path);
  if (/(?:^|\n)@AGENTS\.md(?:\n|$)/.test(current)) return { action: 'preserve', content: current };
  if (!allowMerge) return { action: 'conflict', content: null, reason: 'existing CLAUDE.md does not import @AGENTS.md' };
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

function plan(root, profiles, agents, allowMerge = false) {
  const manifest = readManifest(root);
  const desired = desiredFiles(root, profiles, agents);
  const actions = [];
  for (const [path, content] of desired) {
    const absolute = join(root, path);
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
    if (record?.kind === 'generated' && record.sha256 === sha(current)) {
      actions.push({ path, action: 'update-generated', content });
    } else {
      actions.push({ path, action: 'conflict', content: null, reason: 'existing file is unowned or locally modified' });
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
    actions.push({ path, action: existsSync(join(root, path)) && read(join(root, path)) === content ? 'preserve' : 'merge', content });
  }
  return { root, profiles, agents, actions };
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

function printPlan(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify({ ...value, actions: value.actions.map(({ content: _content, ...action }) => action) }, null, 2));
    return;
  }
  console.log(`Repository: ${value.root}`);
  console.log(`Profiles:   ${value.profiles.join(', ')}`);
  console.log(`Agents:     ${value.agents.join(', ')}`);
  for (const action of value.actions) {
    console.log(`${action.action.padEnd(17)} ${action.path}${action.reason ? ` - ${action.reason}` : ''}`);
  }
  const conflicts = value.actions.filter((action) => action.action === 'conflict').length;
  console.log(`\n${conflicts ? `${conflicts} conflict(s); no apply permitted` : 'No blocking conflicts'}`);
}

function applyPlan(value) {
  const conflicts = value.actions.filter((action) => action.action === 'conflict');
  if (conflicts.length) throw new Error(`cannot apply with conflicts: ${conflicts.map((item) => item.path).join(', ')}`);

  const rollback = [];
  try {
    for (const action of value.actions) {
      if (action.action === 'preserve') continue;
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
      if (action.path === 'AGENTS.md') {
        const block = managedBlock(read(path), AGENTS_START, AGENTS_END);
        managedFiles[action.path] = { kind: 'managed-block', sha256: sha(block ?? '') };
      } else if (action.path === '.gitignore' || action.path === 'CLAUDE.md') {
        managedFiles[action.path] = { kind: 'merged' };
      } else if (Object.values(hookConfigs).includes(action.path)) {
        managedFiles[action.path] = { kind: 'semantic' };
      } else {
        managedFiles[action.path] = { kind: 'generated', sha256: sha(read(path)) };
      }
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

function verify(root) {
  const manifest = readManifest(root);
  const errors = [];
  if (!manifest) return { ok: false, errors: [`missing ${MANIFEST}`] };
  for (const [path, record] of Object.entries(manifest.managedFiles ?? {})) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      errors.push(`missing managed file: ${path}`);
      continue;
    }
    if (record.kind === 'generated' && sha(read(absolute)) !== record.sha256) {
      errors.push(`managed file changed outside installer: ${path}`);
    }
    if (record.kind === 'managed-block') {
      const block = managedBlock(read(absolute), AGENTS_START, AGENTS_END);
      if (!block || sha(block) !== record.sha256) errors.push(`managed AGENTS block changed: ${path}`);
    }
  }
  for (const agent of manifest.agents ?? []) {
    const path = hookConfigs[agent];
    if (!path || !existsSync(join(root, path))) errors.push(`missing ${agent} hook config`);
    else if (!read(join(root, path)).replaceAll('\\', '/').includes('scripts/hooks/post-edit-reminder.mjs')) {
      errors.push(`${agent} hook no longer invokes shared reminder`);
    }
  }

  const gate = join(root, 'scripts', 'check-sdd.mjs');
  let gateResult = null;
  if (existsSync(gate)) {
    const result = spawnSync(process.execPath, [gate], { cwd: root, encoding: 'utf8' });
    gateResult = { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
    if (result.status !== 0) errors.push('generated SDD gate failed');
  } else {
    errors.push('missing scripts/check-sdd.mjs');
  }
  return { ok: errors.length === 0, errors, gate: gateResult };
}

function copySkill(target, force) {
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  safePath(parent, target);
  if (existsSync(target)) {
    const marker = join(target, '.cross-agent-sdd-install.json');
    if (!existsSync(marker)) throw new Error(`refusing to replace unowned skill directory: ${target}`);
    if (!force) throw new Error(`skill already installed at ${target}; use --force for managed upgrade`);
  }

  const temporary = join(parent, `.${SKILL_NAME}-${process.pid}-${randomUUID()}.tmp`);
  const backup = join(parent, `.${SKILL_NAME}-${process.pid}-${randomUUID()}.bak`);
  cpSync(SKILL_ROOT, temporary, { recursive: true, errorOnExist: true, force: false });
  writeFileSync(
    join(temporary, '.cross-agent-sdd-install.json'),
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

function installSkill(parsed) {
  const scope = flag(parsed, 'scope', 'user');
  if (!['user', 'project'].includes(scope)) throw new Error('--scope must be user or project');
  const agents = listOption(flag(parsed, 'agents', 'all'), ALL_AGENTS, ALL_AGENTS);
  const base = scope === 'user' ? homedir() : repoRoot(flag(parsed, 'repo', '.'));
  const targets = new Set();
  if (agents.includes('codex') || agents.includes('cursor')) {
    targets.add(join(base, '.agents', 'skills', SKILL_NAME));
  }
  if (agents.includes('claude')) targets.add(join(base, '.claude', 'skills', SKILL_NAME));
  if (agents.includes('cursor') && flag(parsed, 'cursor-cloud', false)) {
    targets.add(join(base, '.cursor', 'skills', SKILL_NAME));
  }
  const output = { scope, agents, targets: [...targets] };
  if (!flag(parsed, 'write', false)) return { ...output, dryRun: true };
  for (const target of targets) copySkill(target, flag(parsed, 'force', false));
  return { ...output, dryRun: false };
}

function main() {
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
    console.log(JSON.stringify(installSkill(parsed), null, 2));
    return;
  }

  const root = repoRoot(parsed.positional[0] ?? '.');
  if (command === 'audit') {
    const result = audit(root);
    if (flag(parsed, 'json', false)) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Repository: ${result.root}`);
      console.log(`Branch: ${result.branch ?? '<detached>'}; dirty: ${result.dirty}`);
      console.log(`Existing specs: ${result.sdd.specCount}; workflows: ${result.sdd.workflowCount}`);
      console.log(`Config-like files: ${result.configFileCount}; Helm charts: ${result.charts.length}`);
      console.log(`Suggested profiles: ${result.suggestedProfiles.join(', ')}`);
    }
    return;
  }

  const { profiles, agents } = selected(parsed, root);
  const value = plan(root, profiles, agents, flag(parsed, 'merge-agents', false));
  if (command === 'plan') {
    printPlan(value, flag(parsed, 'json', false));
    return;
  }
  if (command === 'apply') {
    if (!flag(parsed, 'allow-dirty', false) && git(root, ['status', '--porcelain'])) {
      throw new Error('repository is dirty; use an isolated worktree or explicitly pass --allow-dirty after review');
    }
    printPlan(value, false);
    if (!flag(parsed, 'write', false)) {
      console.log('\nDry run only; add --write after review.');
      return;
    }
    applyPlan(value);
    console.log(`\nApplied ${SKILL_NAME} ${VERSION}. Configure target-specific ownership, hooks/CI, then run verify.`);
    return;
  }
  if (command === 'verify') {
    const result = verify(root);
    if (flag(parsed, 'json', false)) console.log(JSON.stringify(result, null, 2));
    else {
      if (result.gate?.stdout) console.log(result.gate.stdout);
      if (result.gate?.stderr) console.error(result.gate.stderr);
      for (const error of result.errors) console.error(`x ${error}`);
      console.log(result.ok ? 'cross-agent-sdd verify: ok' : 'cross-agent-sdd verify: failed');
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(`cross-agent-sdd: ${error.message}`);
  process.exit(1);
}
