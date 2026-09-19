#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, '.agent-sdd', 'config.json');
const problems = [];
const fail = (message) => problems.push(message);
const normalize = (value) => value.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
const rel = (path) => relative(ROOT, path).replaceAll('\\', '/');

function json(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${rel(path)}: ${error.message}`);
    return null;
  }
}

const config = existsSync(CONFIG_PATH) ? json(CONFIG_PATH) : null;
if (!config) fail('missing or invalid .agent-sdd/config.json');

const skippedNames = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.turbo']);
for (const name of config?.exclude ?? []) skippedNames.add(name);

function walk(path, predicate, out = []) {
  if (!existsSync(path)) return out;
  const pathRel = rel(path);
  if (pathRel.includes('/skills/') && pathRel.includes('/assets/repository/')) return out;
  const info = statSync(path);
  if (info.isFile()) {
    if (predicate(path)) out.push(path);
    return out;
  }
  for (const name of readdirSync(path)) {
    if (skippedNames.has(name)) continue;
    walk(join(path, name), predicate, out);
  }
  return out;
}

function files(predicate) {
  return walk(ROOT, predicate);
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? null : (args[index + 1] ?? null);
}

function checkDocs() {
  const markdown = files((path) => extname(path).toLowerCase() === '.md');
  const inbound = new Map();
  for (const path of markdown) {
    const body = normalize(readFileSync(path, 'utf8'));
    for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].trim();
      if (!target || /^(?:[a-z]+:|#)/i.test(target)) continue;
      target = target.replace(/^<|>$/g, '').split('#')[0].split('?')[0];
      if (!target) continue;
      let decoded = target;
      try {
        decoded = decodeURIComponent(target);
      } catch {
        // Keep literal target; invalid URI escape will fail as a missing path below.
      }
      const absolute = resolve(dirname(path), decoded);
      if (!existsSync(absolute)) {
        fail(`dangling markdown link in ${rel(path)}: ${match[1]}`);
        continue;
      }
      const key = rel(absolute);
      if (!inbound.has(key)) inbound.set(key, []);
      inbound.get(key).push(rel(path));
    }
  }

  for (const path of markdown) {
    const name = basename(path);
    if (!['AGENTS.md', 'SPEC.md'].includes(name)) continue;
    if (rel(path) === 'AGENTS.md') continue;
    if (!inbound.has(rel(path))) fail(`unreachable ${name}: ${rel(path)}`);
  }
}

function specMetadata(path, body) {
  if (!body.startsWith('---\n')) {
    fail(`missing SPEC frontmatter: ${rel(path)}`);
    return { id: null, critical: [] };
  }
  const end = body.indexOf('\n---\n', 4);
  if (end < 0) {
    fail(`unterminated SPEC frontmatter: ${rel(path)}`);
    return { id: null, critical: [] };
  }
  const frontmatter = body.slice(4, end);
  const id = frontmatter.match(/^id:\s*([a-z0-9]+(?:[.-][a-z0-9]+)*)\s*$/m)?.[1] ?? null;
  if (!id) fail(`missing or invalid stable id: ${rel(path)}`);
  const critical = [];
  let active = false;
  for (const line of frontmatter.split('\n')) {
    if (/^critical:\s*$/.test(line)) {
      active = true;
      continue;
    }
    if (!active) continue;
    const item = line.match(/^\s+-\s+(V\d+)\s*$/)?.[1];
    if (item) critical.push(item);
    else if (line.trim() && !/^\s/.test(line)) active = false;
  }
  return { id, critical };
}

function ledgerSection(body, heading, prefix) {
  const match = new RegExp(`^##\\s+(?:${heading}|§${prefix})\\b[^\\n]*\\n`, 'mi').exec(body);
  if (!match) return null;
  const start = match.index + match[0].length;
  const tail = body.slice(start);
  const nextHeading = /^##\s+/m.exec(tail);
  return nextHeading ? tail.slice(0, nextHeading.index) : tail;
}

function checkSpecs() {
  const specFiles = files((path) => basename(path) === 'SPEC.md');
  const specs = new Map();
  for (const path of specFiles) {
    const body = normalize(readFileSync(path, 'utf8'));
    const { id, critical } = specMetadata(path, body);
    const invariants = new Set();
    for (const match of body.matchAll(/^(?:-\s+)?(?:\*\*)?(V\d+)(?:\*\*)?:/gm)) {
      if (invariants.has(match[1])) fail(`duplicate invariant ${match[1]}: ${rel(path)}`);
      invariants.add(match[1]);
    }
    for (const invariant of critical) {
      if (!invariants.has(invariant)) fail(`critical invariant does not exist: ${id ?? rel(path)}:${invariant}`);
    }
    for (const [heading, prefix] of [
      ['Tasks', 'T'],
      ['Bugs', 'B'],
    ]) {
      const section = ledgerSection(body, heading, prefix);
      if (section !== null && !new RegExp(`^${prefix}\\d+\\s*\\|`, 'm').test(section)) {
        fail(`empty ${heading} ledger (remove heading until first row): ${rel(path)}`);
      }
    }
    if (!id) continue;
    if (specs.has(id)) fail(`duplicate SPEC id ${id}: ${rel(specs.get(id).path)} + ${rel(path)}`);
    else specs.set(id, { path, invariants, critical });
  }

  const citationFiles = files((path) =>
    ['.cjs', '.go', '.java', '.js', '.jsx', '.kt', '.md', '.mjs', '.py', '.rs', '.ts', '.tsx'].includes(
      extname(path).toLowerCase(),
    ),
  );
  const evidence = new Set();
  for (const path of citationFiles) {
    const body = normalize(readFileSync(path, 'utf8'));
    for (const match of body.matchAll(/@spec\s+([a-z0-9]+(?:[.-][a-z0-9]+)*):(V\d+)\b/g)) {
      const spec = specs.get(match[1]);
      if (!spec) {
        fail(`citation names unknown SPEC ${match[1]}: ${rel(path)}`);
        continue;
      }
      if (!spec.invariants.has(match[2])) {
        fail(`citation names unknown invariant ${match[1]}:${match[2]}: ${rel(path)}`);
        continue;
      }
      if (/(?:^|\/)(?:__tests__\/|[^/]+\.(?:spec|test)\.[^/]+$)/.test(rel(path))) {
        evidence.add(`${match[1]}:${match[2]}`);
      }
    }
  }
  for (const [id, spec] of specs) {
    for (const invariant of spec.critical) {
      if (!evidence.has(`${id}:${invariant}`)) fail(`critical invariant lacks executable evidence: ${id}:${invariant}`);
    }
  }
}

function skillNames(base) {
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((name) => existsSync(join(base, name, 'SKILL.md')));
}

function checkAgents() {
  const agents = new Set(config?.agents ?? []);
  const claudeSkills = new Set(skillNames(join(ROOT, '.claude', 'skills')));
  const sharedSkills = new Set(skillNames(join(ROOT, '.agents', 'skills')));
  if (agents.has('claude') && (agents.has('codex') || agents.has('cursor'))) {
    for (const name of claudeSkills) {
      if (!sharedSkills.has(name)) fail(`Claude skill lacks .agents counterpart: ${name}`);
    }
    for (const name of sharedSkills) {
      if (!claudeSkills.has(name) && !existsSync(join(ROOT, '.claude', 'rules', `${name}.md`))) {
        fail(`.agents skill lacks Claude counterpart: ${name}`);
      }
    }
  }

  if (agents.has('claude') && agents.has('cursor')) {
    const rules = join(ROOT, '.claude', 'rules');
    if (existsSync(rules)) {
      for (const name of readdirSync(rules).filter((name) => name.endsWith('.md'))) {
        const mirror = join(ROOT, '.cursor', 'rules', `${name.slice(0, -3)}.mdc`);
        if (!existsSync(mirror)) fail(`Claude rule lacks Cursor mirror: .claude/rules/${name}`);
      }
    }
  }

  for (const root of [join(ROOT, '.claude', 'skills'), join(ROOT, '.agents', 'skills')]) {
    for (const name of skillNames(root)) {
      const path = join(root, name, 'SKILL.md');
      if (!readFileSync(path, 'utf8').includes('docs/workflows/')) {
        fail(`adapter does not link canonical workflow: ${rel(path)}`);
      }
    }
  }

  const hookPath = 'scripts/hooks/post-edit-reminder.mjs';
  const hookConfigs = {
    claude: '.claude/settings.json',
    codex: '.codex/hooks.json',
    cursor: '.cursor/hooks.json',
  };
  for (const agent of agents) {
    const path = hookConfigs[agent];
    if (!path || !existsSync(join(ROOT, path))) {
      fail(`missing ${agent} hook config: ${path ?? agent}`);
      continue;
    }
    if (!readFileSync(join(ROOT, path), 'utf8').replaceAll('\\', '/').includes(hookPath)) {
      fail(`${agent} hook config does not invoke shared reminder: ${path}`);
    }
  }
}

function flatten(value, prefix = '', out = new Set()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) out.add(prefix);
    return out;
  }
  const entries = Object.entries(value);
  if (!entries.length && prefix) out.add(prefix);
  for (const [key, child] of entries) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  return out;
}

function regexEscape(value) {
  const special = new Set(['\\', '^', '$', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|']);
  return [...value].map((character) => (special.has(character) ? `\\${character}` : character)).join('');
}

function checkConfigGroups() {
  if (!(config?.profiles ?? []).includes('config')) return;
  const groups = config.configGroups ?? [];
  if (!groups.length) {
    fail('config profile enabled but .agent-sdd/config.json has no configGroups');
    return;
  }
  for (const group of groups) {
    if (!group?.name || !group?.source || !Array.isArray(group.surfaces)) {
      fail('invalid config group: require name, source, surfaces[]');
      continue;
    }
    const sourcePath = resolve(ROOT, group.source);
    if (!existsSync(sourcePath)) {
      fail(`config group ${group.name} missing source: ${group.source}`);
      continue;
    }
    const source = json(sourcePath);
    if (!source) continue;
    const keys = [...flatten(source)];
    for (const surface of group.surfaces) {
      const surfacePath = resolve(ROOT, surface.path ?? '');
      if (!surface.path || !existsSync(surfacePath)) {
        fail(`config group ${group.name} missing surface: ${surface.path ?? '<path>'}`);
        continue;
      }
      if (surface.mode === 'json') {
        const target = json(surfacePath);
        if (!target) continue;
        const targetKeys = flatten(target);
        for (const key of keys) {
          if (!targetKeys.has(key)) fail(`config group ${group.name}: ${surface.path} lacks ${key}`);
        }
      } else if (surface.mode === 'text') {
        const text = readFileSync(surfacePath, 'utf8');
        for (const key of keys) {
          const leaf = key.split('.').at(-1);
          if (!new RegExp(`\\b${regexEscape(leaf)}\\b`).test(text)) {
            fail(`config group ${group.name}: ${surface.path} does not mention ${key}`);
          }
        }
      } else {
        fail(`config group ${group.name}: unsupported surface mode ${surface.mode}`);
      }
    }
  }
}

function checkHelmConfig() {
  if (!(config?.profiles ?? []).includes('helm')) return;
  const charts = config.helmCharts ?? [];
  if (!charts.length) fail('helm profile enabled but .agent-sdd/config.json has no helmCharts');
  for (const chart of charts) {
    if (!existsSync(join(ROOT, chart, 'Chart.yaml'))) fail(`Helm chart lacks Chart.yaml: ${chart}`);
    if (!existsSync(join(ROOT, chart, 'values.yaml'))) fail(`Helm chart lacks values.yaml: ${chart}`);
  }
}

const runtimeExtensions = new Set([
  '.c', '.cc', '.cjs', '.cpp', '.cs', '.go', '.h', '.hbs', '.java', '.js', '.json', '.json5', '.jsx', '.kt',
  '.mjs', '.php', '.proto', '.py', '.rb', '.rs', '.sql', '.tpl', '.ts', '.tsx', '.yaml', '.yml',
]);

function runtimeRootFor(path) {
  const normalized = path.replaceAll('\\', '/');
  return (config?.runtimeRoots ?? []).find((root) => normalized === root || normalized.startsWith(`${root}/`)) ?? null;
}

function isRuntimeFile(path) {
  if (!runtimeRootFor(path)) return false;
  if (/(?:^|\/)(?:__tests__|test|tests|docs)\//.test(path)) return false;
  if (/\.(?:spec|test)\.[^/]+$/.test(path) || path.endsWith('.d.ts')) return false;
  return runtimeExtensions.has(extname(path).toLowerCase());
}

function workspaceRoot(path, runtimeRoot) {
  const rootParts = runtimeRoot.split('/');
  const parts = path.split('/');
  if (['apps', 'packages', 'services', 'modules'].includes(rootParts.at(-1)) && parts.length > rootParts.length) {
    return parts.slice(0, rootParts.length + 1).join('/');
  }
  return runtimeRoot;
}

function ownerFor(path) {
  const runtimeRoot = runtimeRootFor(path);
  if (!runtimeRoot) return null;
  const workspace = workspaceRoot(path, runtimeRoot);
  const boundary = resolve(ROOT, workspace);
  let cursor = resolve(ROOT, dirname(path));
  while (cursor === boundary || cursor.startsWith(`${boundary}\\`) || cursor.startsWith(`${boundary}/`)) {
    const spec = join(cursor, 'SPEC.md');
    if (existsSync(spec)) return rel(spec);
    if (cursor === boundary) break;
    cursor = dirname(cursor);
  }
  const agents = join(boundary, 'AGENTS.md');
  return existsSync(agents) ? rel(agents) : null;
}

function trailer(message, name) {
  return message.match(new RegExp(`^${name}:\\s*none\\s*(?:--|—|–|-)\\s*(.*)$`, 'im'))?.[1]?.trim() ?? null;
}

function reasonProblems(reason, paths) {
  const out = [];
  if (!reason) return ['reason is blank'];
  if (/<[^>]*>/.test(reason)) out.push('reason contains a placeholder');
  if (reason.split(/\s+/).filter(Boolean).length < 8) out.push('reason needs at least 8 words');
  for (const path of paths) {
    const parts = path.split('/');
    const mentions = [path, basename(path)];
    for (let size = 2; size < parts.length; size += 1) mentions.push(parts.slice(0, size).join('/'));
    if (!mentions.some((value) => reason.includes(value))) out.push(`reason does not name ${path}`);
  }
  return out;
}

function impactProblems(changedFiles, message, label) {
  const changed = new Set(changedFiles.map((path) => path.replaceAll('\\', '/')));
  const missing = [];
  for (const path of changed) {
    if (!isRuntimeFile(path)) continue;
    const owner = ownerFor(path);
    if (!owner || !changed.has(owner)) missing.push({ path, owner });
  }
  if (missing.length) {
    const reason = trailer(message, 'Spec-Impact');
    if (reason === null) {
      fail(`${label}: runtime paths lack owning contract change: ${missing.map((item) => item.path).join(', ')}`);
    } else {
      for (const problem of reasonProblems(reason, missing.map((item) => item.path))) {
        fail(`${label}: rejected Spec-Impact trailer: ${problem}`);
      }
    }
  }

  const partnerMissing = [];
  const present = (path) => path.endsWith('/') ? [...changed].some((item) => item.startsWith(path)) : changed.has(path);
  const partnerGroups = (path) => {
    let match;
    if ((match = path.match(/^\.claude\/skills\/([^/]+)\//))) return [[`.agents/skills/${match[1]}/`]];
    if ((match = path.match(/^\.agents\/skills\/([^/]+)\/SKILL\.md$/))) {
      return [[`.claude/skills/${match[1]}/`, `.claude/rules/${match[1]}.md`]];
    }
    if ((match = path.match(/^\.claude\/rules\/([^/]+)\.md$/))) return [[`.cursor/rules/${match[1]}.mdc`]];
    if ((match = path.match(/^\.cursor\/rules\/([^/]+)\.mdc$/))) return [[`.claude/rules/${match[1]}.md`]];
    if (/^\.(?:claude\/settings|codex\/hooks|cursor\/hooks)\.json$/.test(path)) {
      return [['.claude/settings.json', '.codex/hooks.json', '.cursor/hooks.json']];
    }
    if (path.startsWith('scripts/hooks/')) return [['.claude/settings.json', '.codex/hooks.json', '.cursor/hooks.json']];
    return [];
  };
  for (const path of changed) {
    for (const group of partnerGroups(path)) {
      if (!group.some((partner) => present(partner))) partnerMissing.push(path);
    }
  }
  if (partnerMissing.length) {
    const reason = trailer(message, 'Agent-Parity');
    if (reason === null) {
      fail(`${label}: harness paths lack partner change: ${partnerMissing.join(', ')}`);
    } else {
      for (const problem of reasonProblems(reason, partnerMissing)) {
        fail(`${label}: rejected Agent-Parity trailer: ${problem}`);
      }
    }
  }
}

function checkChangeImpact(args) {
  const staged = args.includes('--staged');
  const changed = args.includes('--changed');
  if (staged && changed) {
    fail('choose only one mode: --staged or --changed');
    return;
  }
  if (staged) {
    const messagePath = option(args, '--commit-msg');
    if (!messagePath) {
      fail('--staged requires --commit-msg <path>');
      return;
    }
    const changedFiles = git(['diff', '--cached', '--name-only', '--diff-filter=ACMRD']).split('\n').filter(Boolean);
    impactProblems(changedFiles, readFileSync(resolve(ROOT, messagePath), 'utf8'), 'staged commit');
  }
  if (changed) {
    const base = option(args, '--base') ?? process.env.CHANGE_TARGET ?? 'HEAD^';
    try {
      for (const commit of git(['rev-list', '--reverse', `${base}..HEAD`]).split('\n').filter(Boolean)) {
        const changedFiles = git([
          'diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '--diff-filter=ACMRD', commit,
        ]).split('\n').filter(Boolean);
        impactProblems(changedFiles, git(['show', '-s', '--format=%B', commit]), `commit ${commit.slice(0, 12)}`);
      }
    } catch (error) {
      fail(`cannot inspect commits from ${base}: ${error.message}`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  checkDocs();
  checkSpecs();
  checkAgents();
  checkConfigGroups();
  checkHelmConfig();
  checkChangeImpact(args);

  if (problems.length) {
    console.error(`check-sdd: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  x ${problem}`);
    process.exit(1);
  }
  console.log('check-sdd: ok');
}

main();
