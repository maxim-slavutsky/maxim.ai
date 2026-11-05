#!/usr/bin/env node
/**
 * Generated SDD gate: documentation reachability, doc-of-record ids and evidence, agent parity, configured
 * runtime-config propagation, Helm chart configuration, and per-change impact.
 *
 *   node scripts/check-sdd.mjs
 *   node scripts/check-sdd.mjs --staged --commit-msg <path>
 *   node scripts/check-sdd.mjs --changed [--base <git-ref>]
 *
 * Every reported line says what is wrong and how to fix it. Shapes and rules: docs/doc-of-record.md.
 * Tool parity: docs/agent-parity.md.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cursorRulesProblems } from './gen-cursor-rules.mjs';
import { DOC_ID, FIXTURE_DIR, declaredHomes, docOfRecord, frontmatter, frontmatterList, normalize, ownerDoc, skipRules, walkFiles } from './sdd-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, '.agent-sdd', 'config.json');
const WAIVERS_PATH = join(ROOT, '.agent-sdd', 'waivers.json');
// "spec-impact" is the name of the doc-impact gate before 1.0.0; waivers written under it stay valid.
const WAIVER_GATES = ['doc-impact', 'agent-parity'];
const WAIVER_ALIASES = { 'spec-impact': 'doc-impact' };
const MIN_REASON_WORDS = 8;
const MIN_WAIVER_WORDS = 12;
const HOOK_SCRIPT = '.claude/hooks/post-edit-reminder.mjs';
const LEGACY_HOOK_SCRIPT = 'scripts/hooks/post-edit-reminder.mjs';
const DOC_RULES = 'docs/doc-of-record.md';
const PARITY_DOC = 'docs/agent-parity.md';
const problems = [];
const fail = (message) => problems.push(message);
const rel = (path) => relative(ROOT, path).replaceAll('\\', '/');

function json(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${rel(path)}: ${error.message}. Fix the JSON syntax (a JSON validator in your editor shows the exact spot).`);
    return null;
  }
}

const config = existsSync(CONFIG_PATH) ? json(CONFIG_PATH) : null;
if (!config) {
  fail('missing or invalid .agent-sdd/config.json. This file tells the gate which folders hold application code; re-run the sdd-enforce "apply --write" command to recreate it.');
}

const HOOK_CONFIG_PATHS = {
  claude: '.claude/settings.json',
  codex: '.codex/hooks.json',
  cursor: '.cursor/hooks.json',
};
const enabledAgents = new Set(config?.agents?.length ? config.agents : Object.keys(HOOK_CONFIG_PATHS));

const { isSkipped: isSkippedKey } = skipRules(config);
const allFiles = walkFiles(ROOT, config);
const isSkippedPath = (path) => isSkippedKey(rel(path));

function files(predicate) {
  return allFiles.map((path) => join(ROOT, path)).filter(predicate);
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function refExists(ref) {
  return spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: ROOT, encoding: 'utf8' }).status === 0;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? null : (args[index + 1] ?? null);
}

function markdownLinks(path) {
  const body = normalize(readFileSync(path, 'utf8'));
  const out = [];
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
    out.push({ raw: match[1], absolute: resolve(dirname(path), decoded) });
  }
  return out;
}

function checkDocs() {
  const markdown = files((path) => extname(path).toLowerCase() === '.md');
  const inbound = new Map();
  for (const path of markdown) {
    for (const link of markdownLinks(path)) {
      if (!existsSync(link.absolute)) {
        fail(`${rel(path)} links to "${link.raw}" but that file does not exist. Fix the link target or restore the file.`);
        continue;
      }
      const key = rel(link.absolute);
      if (!inbound.has(key)) inbound.set(key, []);
      inbound.get(key).push(rel(path));
    }
  }

  for (const path of markdown) {
    const key = rel(path);
    if (key === 'AGENTS.md') continue;
    const kind = basename(path) === 'AGENTS.md' ? 'AGENTS.md' : docOfRecord(key, readFileSync(path, 'utf8')) ? 'doc of record' : null;
    if (kind && !inbound.has(key)) {
      fail(`unreachable ${kind}: ${key}. No other Markdown file links to it, so people and agents cannot find it. Link an AGENTS.md from its parent AGENTS.md or README.md, and list a doc of record in the README.md of its docs/ folder.`);
    }
  }
}

function ledgerHeading(body) {
  return body.match(/^##\s+(?:Tasks|Bugs|§T|§B)\b[^\n]*$/m)?.[0] ?? null;
}

const CITATION_EXTENSIONS = ['.cjs', '.go', '.java', '.js', '.jsx', '.kt', '.md', '.mjs', '.py', '.rs', '.ts', '.tsx'];
const isTestFile = (key) => /(?:^|\/)(?:__tests__\/|[^/]+\.(?:spec|test)\.[^/]+$)/.test(key);

function checkDocsOfRecord() {
  // Test fixtures hold old forms on purpose; the docs audit leaves them out, and so do these checks.
  for (const path of files((item) => basename(item) === 'SPEC.md' && !FIXTURE_DIR.test(rel(item)))) {
    fail(
      `${rel(path)}: a module doc is no longer a SPEC.md. Move it to <workspace>/docs/<module>.md, add a "code:" folder for the code it owns, ` +
        `and drop the Tasks, Bugs and Files tables (shape in ${DOC_RULES}).`,
    );
  }
  const docs = new Map();
  const codeFolders = new Map();
  for (const path of files((item) => extname(item) === '.md')) {
    const key = rel(path);
    const body = normalize(readFileSync(path, 'utf8'));
    const doc = docOfRecord(key, body);
    if (!doc) continue;
    if (!doc.id || !DOC_ID.test(doc.id)) {
      fail(`missing or invalid stable id: ${key}. Add "id: <lowercase id, dots or dashes allowed>" to the frontmatter. Tests cite this id, so it never changes once set.`);
    }
    const docsDir = dirname(key);
    const owner = docsDir === 'docs' ? '' : docsDir.slice(0, -'/docs'.length);
    if (!doc.code) {
      fail(`${key} has no "code:" folder. Name the one folder this doc of record owns, relative to the repository root (${DOC_RULES}).`);
    } else if (!allFiles.some((file) => file.startsWith(`${doc.code}/`))) {
      fail(`${key}: the "code:" folder "${doc.code}" does not exist. Fix the path, or move the doc together with its code.`);
    } else if (owner && doc.code !== owner && !doc.code.startsWith(`${owner}/`)) {
      fail(`${key}: the "code:" folder "${doc.code}" is outside ${owner}. A doc in ${docsDir}/ owns a folder of that workspace only; move it to the docs/ folder of the workspace that holds the code.`);
    } else if (codeFolders.has(doc.code)) {
      fail(`${codeFolders.get(doc.code)} and ${key} both claim the "code:" folder "${doc.code}". One folder has one doc of record: merge the two docs, or point one of them at a folder inside it.`);
    } else {
      codeFolders.set(doc.code, key);
    }
    const invariants = new Set();
    for (const match of body.matchAll(/^(?:-\s+)?(?:\*\*)?(V\d+)(?:\*\*)?:/gm)) {
      if (invariants.has(match[1])) {
        fail(`duplicate invariant ${match[1]}: ${key}. Each V<n> id appears once; give the second one a new number and never reuse a retired number.`);
      }
      invariants.add(match[1]);
    }
    for (const invariant of doc.critical) {
      if (!invariants.has(invariant)) {
        fail(`critical invariant does not exist: ${doc.id ?? key}:${invariant}. The frontmatter lists ${invariant} under "critical:" but the body has no line starting with "${invariant}:". Add the invariant or remove it from the list.`);
      }
    }
    const ledger = ledgerHeading(body);
    if (ledger) {
      fail(`${key}: "${ledger}" does not belong in a doc of record. Move open work and bugs to the issue tracker and delete the section; the doc states the current code only.`);
    }
    if (!doc.id || !DOC_ID.test(doc.id)) continue;
    if (docs.has(doc.id)) {
      fail(`duplicate doc of record id ${doc.id}: ${docs.get(doc.id).key} + ${key}. Give each doc of record its own id.`);
    } else {
      docs.set(doc.id, { key, invariants, critical: doc.critical });
    }
  }

  const evidence = new Set();
  for (const path of files((item) => CITATION_EXTENSIONS.includes(extname(item).toLowerCase()) && !FIXTURE_DIR.test(rel(item)))) {
    const key = rel(path);
    const body = normalize(readFileSync(path, 'utf8'));
    for (const match of body.matchAll(/@spec\s+([a-z0-9]+(?:[.-][a-z0-9]+)*):(V\d+)\b/g)) {
      fail(`${key}: "@spec ${match[1]}:${match[2]}" is the citation form before 1.0.0. Write "@invariant ${match[1]}:${match[2]}" instead.`);
    }
    for (const match of body.matchAll(/@invariant\s+([a-z0-9]+(?:[.-][a-z0-9]+)*):(V\d+)\b/g)) {
      const doc = docs.get(match[1]);
      if (!doc) {
        fail(`citation names unknown doc of record ${match[1]}: ${key}. The "@invariant ${match[1]}:${match[2]}" text points at an id that does not exist; fix the id or add the doc.`);
        continue;
      }
      if (!doc.invariants.has(match[2])) {
        fail(`citation names unknown invariant ${match[1]}:${match[2]}: ${key}. ${doc.key} has no "${match[2]}:" line; fix the number in the citation or add the invariant.`);
        continue;
      }
      if (isTestFile(key)) evidence.add(`${match[1]}:${match[2]}`);
    }
  }
  for (const [id, doc] of docs) {
    for (const invariant of doc.critical) {
      if (!evidence.has(`${id}:${invariant}`)) {
        fail(
          `critical invariant lacks executable evidence: ${id}:${invariant} (${doc.key}). ${invariant} is marked critical, so a test must prove it: ` +
            `put "@invariant ${id}:${invariant}" in a test title or a comment inside a *.test.* / *.spec.* / __tests__ file. ` +
            `If ${invariant} cannot be tested as written, ask the owner to split it or remove it from "critical:". Never cite a test that proves only part of it.`,
        );
      }
    }
  }
}

function skillNames(base) {
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((name) => existsSync(join(base, name, 'SKILL.md')) && !isSkippedPath(join(base, name)));
}

// Folders that docs/map.md declares as an added home. A concern doc inside one of them counts as a concern doc.
const MAP_PATH = join(ROOT, 'docs', 'map.md');
const DECLARED_HOMES = existsSync(MAP_PATH) ? declaredHomes(readFileSync(MAP_PATH, 'utf8')) : [];

/**
 * Repo-relative concern docs that `path` links: Markdown directly under a docs/ folder, or directly under a docs/
 * subfolder that docs/map.md declares.
 */
function concernDocLinks(path) {
  const isConcernDoc = (target) =>
    /(?:^|\/)docs\/[^/]+\.md$/.test(target) || DECLARED_HOMES.some((home) => /^docs\//.test(home) && dirname(target) === home);
  return [...new Set(markdownLinks(path).map((link) => rel(link.absolute)).filter(isConcernDoc))];
}

/**
 * A rule links exactly one concern doc, and that doc links the rule back. A Codex/Cursor adapter of a rule links
 * the rule's concern doc; the adapter of a Claude skill links that SKILL.md.
 */
function checkAdapterLinks() {
  const rulesDir = join(ROOT, '.claude', 'rules');
  const ruleDocs = new Map();
  if (existsSync(rulesDir)) {
    for (const name of readdirSync(rulesDir)) {
      if (!name.endsWith('.md') || name === 'INDEX.md') continue;
      const rulePath = join(rulesDir, name);
      const rule = rel(rulePath);
      const docs = concernDocLinks(rulePath);
      if (docs.length !== 1) {
        fail(`rule must link exactly one concern doc (found ${docs.length}): ${rule}. A rule holds short imperatives and one link to the doc that holds them in full.`);
        continue;
      }
      ruleDocs.set(name.replace(/\.md$/, ''), docs[0]);
      const docPath = join(ROOT, docs[0]);
      if (!existsSync(docPath)) continue; // checkDocs reports the dangling link.
      if (!markdownLinks(docPath).some((link) => rel(link.absolute) === rule)) {
        fail(`${docs[0]} does not link back to ${rule}. Add a line that links the rule, so readers find both directions.`);
      }
    }
  }
  for (const name of skillNames(join(ROOT, '.agents', 'skills'))) {
    const adapterPath = join(ROOT, '.agents', 'skills', name, 'SKILL.md');
    const adapter = rel(adapterPath);
    const targets = new Set(markdownLinks(adapterPath).map((link) => rel(link.absolute)));
    const claudeSkill = `.claude/skills/${name}/SKILL.md`;
    if (existsSync(join(ROOT, claudeSkill))) {
      if (!targets.has(claudeSkill)) {
        fail(`${adapter} does not link ${claudeSkill}. The Codex/Cursor twin of a skill links the Claude skill, which holds the steps.`);
      }
    } else if (ruleDocs.has(name) && !targets.has(ruleDocs.get(name))) {
      fail(`${adapter} does not link ${ruleDocs.get(name)}. The Codex/Cursor adapter of a rule links the same concern doc as .claude/rules/${name}.md.`);
    }
  }
}

function hookCommands(value, out = [], script = HOOK_SCRIPT) {
  if (typeof value === 'string') {
    if (value.replaceAll('\\', '/').includes(script)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) hookCommands(item, out, script);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) hookCommands(item, out, script);
  }
  return out;
}

function checkAgents() {
  const agents = new Set(config?.agents ?? []);
  const claudeSkills = new Set(skillNames(join(ROOT, '.claude', 'skills')));
  const sharedSkills = new Set(skillNames(join(ROOT, '.agents', 'skills')));
  const rulesDir = join(ROOT, '.claude', 'rules');
  // A legacy INDEX.md (rules index up to 0.4.0) is not a rule.
  const claudeRules = existsSync(rulesDir) ? readdirSync(rulesDir).filter((name) => name.endsWith('.md') && name !== 'INDEX.md').map((name) => name.slice(0, -3)) : [];
  if (agents.has('claude') && (agents.has('codex') || agents.has('cursor'))) {
    for (const name of claudeSkills) {
      if (!sharedSkills.has(name)) {
        fail(`Claude skill lacks .agents counterpart: ${name}. Create .agents/skills/${name}/SKILL.md that links the Claude skill, plus agents/openai.yaml, so Codex and Cursor find it (${PARITY_DOC}).`);
      }
    }
    for (const name of sharedSkills) {
      if (!claudeSkills.has(name) && !existsSync(join(ROOT, '.claude', 'rules', `${name}.md`))) {
        fail(`.agents skill lacks Claude counterpart: ${name}. Create .claude/rules/${name}.md (for a path-scoped rule) or .claude/skills/${name}/SKILL.md (for a procedure someone starts).`);
      }
    }
    for (const name of claudeRules) {
      if (!sharedSkills.has(name)) {
        fail(`Claude rule lacks .agents counterpart: ${name}. Create .agents/skills/${name}/SKILL.md that links the rule's concern doc, plus agents/openai.yaml, so Codex and Cursor load the same rules (${PARITY_DOC}).`);
      }
    }
  }
  // A rule without "paths:" loads in every Claude Code session; a line every session needs belongs in AGENTS.md.
  for (const name of claudeRules) {
    const rule = `.claude/rules/${name}.md`;
    const block = frontmatter(normalize(readFileSync(join(ROOT, rule), 'utf8')));
    if (!(block && frontmatterList(block, 'paths')?.length)) {
      fail(`${rule} has no "paths:", so it loads in every session. Add "paths:" globs for the files it governs, or move its lines into AGENTS.md and delete the rule.`);
    }
  }
  if (agents.has('codex')) {
    for (const name of sharedSkills) {
      if (!existsSync(join(ROOT, '.agents', 'skills', name, 'agents', 'openai.yaml'))) {
        fail(`.agents/skills/${name} lacks agents/openai.yaml (Codex skill metadata). Copy the file shape from another skill folder and adjust the display name and prompt.`);
      }
    }
  }

  if (agents.has('claude') && agents.has('cursor') && existsSync(join(ROOT, '.claude', 'rules'))) {
    for (const problem of cursorRulesProblems(ROOT)) {
      fail(`${problem}. Cursor rule files are generated from .claude/rules: run "node scripts/gen-cursor-rules.mjs" and commit the result; never edit .mdc files by hand.`);
    }
  }

  checkAdapterLinks();

  const hookConfigs = HOOK_CONFIG_PATHS;
  for (const agent of agents) {
    const path = hookConfigs[agent];
    if (!path || !existsSync(join(ROOT, path))) {
      fail(`missing ${agent} hook config: ${path ?? agent}. Re-run the sdd-enforce "apply --write" command, or remove "${agent}" from "agents" in .agent-sdd/config.json if that tool is not used here.`);
      continue;
    }
    const data = json(join(ROOT, path));
    if (!data) continue;
    const commands = hookCommands(data);
    if (!commands.length && hookCommands(data, [], LEGACY_HOOK_SCRIPT).length) {
      fail(`${path} still runs ${LEGACY_HOOK_SCRIPT}, the path before 1.0.0. Re-run the sdd-enforce "apply --write" command; it moves the hook to ${HOOK_SCRIPT}.`);
      continue;
    }
    if (!commands.length) {
      fail(`${path} does not run ${HOOK_SCRIPT}. Every enabled AI tool must call the same reminder script after it edits a file; re-run "apply --write" or add the hook back.`);
      continue;
    }
    if (agent === 'cursor' && !commands.every((command) => /\s--cursor\b/.test(command))) {
      fail(`${path}: the Cursor command must end with "--cursor" so the reminder script uses Cursor's output format.`);
    }
    if (agent !== 'cursor' && commands.some((command) => /--cursor\b/.test(command))) {
      fail(`${path}: only the Cursor command may pass "--cursor"; remove it from the ${agent} hook command.`);
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
    fail('config profile enabled but .agent-sdd/config.json has no configGroups. Describe each application\'s config files there (name, source JSON, and the surfaces that must carry the same keys), or remove "config" from "profiles".');
    return;
  }
  for (const group of groups) {
    if (!group?.name || !group?.source || !Array.isArray(group.surfaces)) {
      fail('invalid config group in .agent-sdd/config.json: each group needs "name", "source" (a JSON file path), and "surfaces" (an array of {path, mode}).');
      continue;
    }
    const sourcePath = resolve(ROOT, group.source);
    if (!existsSync(sourcePath)) {
      fail(`config group ${group.name}: source file ${group.source} does not exist. Point "source" at the JSON config file that defines the keys.`);
      continue;
    }
    const source = json(sourcePath);
    if (!source) continue;
    const keys = [...flatten(source)];
    for (const surface of group.surfaces) {
      const surfacePath = resolve(ROOT, surface.path ?? '');
      if (!surface.path || !existsSync(surfacePath)) {
        fail(`config group ${group.name}: surface ${surface.path ?? '<path>'} does not exist. Fix the path or remove the surface.`);
        continue;
      }
      if (surface.mode === 'json') {
        const target = json(surfacePath);
        if (!target) continue;
        const targetKeys = flatten(target);
        for (const key of keys) {
          if (!targetKeys.has(key)) {
            fail(`config group ${group.name}: ${surface.path} lacks key "${key}" that ${group.source} defines. Add the key (with the right value for that environment) so every copy of the config has the same shape.`);
          }
        }
      } else if (surface.mode === 'text') {
        const text = readFileSync(surfacePath, 'utf8');
        for (const key of keys) {
          const leaf = key.split('.').at(-1);
          if (!new RegExp(`\\b${regexEscape(leaf)}\\b`).test(text)) {
            fail(`config group ${group.name}: ${surface.path} never mentions "${leaf}" (from key ${key} in ${group.source}). Add the key to that schema, reader, or template, or drop it from the source.`);
          }
        }
      } else {
        fail(`config group ${group.name}: unsupported surface mode "${surface.mode}" for ${surface.path}. Use "json" for JSON files or "text" for any other file.`);
      }
    }
  }
}

function checkHelmConfig() {
  if (!(config?.profiles ?? []).includes('helm')) return;
  const charts = config.helmCharts ?? [];
  if (!charts.length) {
    fail('helm profile enabled but .agent-sdd/config.json has no helmCharts. List each chart folder (the one containing Chart.yaml) under "helmCharts", or remove "helm" from "profiles".');
  }
  for (const chart of charts) {
    if (!existsSync(join(ROOT, chart, 'Chart.yaml'))) fail(`Helm chart ${chart} has no Chart.yaml. Point "helmCharts" at the folder that contains Chart.yaml.`);
    if (!existsSync(join(ROOT, chart, 'values.yaml'))) fail(`Helm chart ${chart} has no values.yaml. Every listed chart needs a values.yaml next to Chart.yaml.`);
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

/** The owner of a runtime file: the doc of record with the longest "code:" folder that holds it, else the workspace AGENTS.md. */
let docsCache = null;
function ownersFor(path) {
  const runtimeRoot = runtimeRootFor(path);
  if (!runtimeRoot) return [];
  docsCache ??= allFiles
    .filter((key) => key.endsWith('.md'))
    .map((key) => docOfRecord(key, readFileSync(join(ROOT, key), 'utf8')))
    .filter(Boolean);
  const doc = ownerDoc(path, docsCache);
  if (doc) return [doc.path];
  // The nearest AGENTS.md above the file, ending at the root: in a repo with no workspace the root is the one.
  let folder = dirname(path);
  while (true) {
    const agents = folder === '.' ? 'AGENTS.md' : `${folder}/AGENTS.md`;
    if (existsSync(join(ROOT, agents))) return [agents];
    if (folder === '.') return [];
    folder = dirname(folder);
  }
}

/**
 * Reads `<name>: none - <reason>` from a commit message. The reason may fold over several lines the way Git
 * trailers fold: every following line that starts with whitespace continues it. Commit linters cap a body line
 * (commitlint: 100 characters) and a reason that names several files does not fit on one line.
 */
function trailer(message, ...names) {
  const match = message.match(new RegExp(`^(?:${names.join('|')}):\\s*none\\s*(?:--|—|–|-)\\s*(.*)$`, 'im'));
  if (!match) return null;
  const following = message.slice(match.index + match[0].length).split(/\r?\n/).slice(1);
  const folded = [match[1]];
  for (const line of following) {
    if (!/^[ \t]+\S/.test(line)) break;
    folded.push(line.trim());
  }
  return folded.join(' ').trim();
}

/** Words that carry no auditable information about why behavior cannot change. */
const GENERIC_WORDS = new Set(
  (
    'a an the and or of in on at to for with without all any this that these those it its is are was were be been ' +
    'no not none only just pure purely simple simply minor trivial safe small tiny same still unchanged nothing ' +
    'change changes changed behavior behaviour behavioral behavioural functional runtime public contract logic api ' +
    'refactor refactoring refactored cleanup clean up cosmetic formatting format formatted prettier lint linting ' +
    'linted typo typos comment comments doc docs documentation test tests internal housekeeping whitespace style ' +
    'chore impact affect affects affected code file files path paths edit edits edited update updated updates ' +
    'touch touched touches modify modified modifies fix fixes fixed bump bumped version dependency dependencies deps ' +
    'see pr description above below title body n a'
  ).split(' '),
);

function mentionsFor(path) {
  const parts = path.split('/');
  const mentions = [path, basename(path)];
  for (let size = 2; size < parts.length; size += 1) mentions.push(parts.slice(0, size).join('/'));
  return mentions;
}

function reasonProblems(reason, paths) {
  const out = [];
  if (!reason) return ['the reason after "none -" is blank'];
  if (/<[^>]*>/.test(reason)) out.push('the reason still contains a <placeholder> from the template; replace it with real words');
  if (reason.split(/\s+/).filter(Boolean).length < MIN_REASON_WORDS) {
    out.push(`the reason needs at least ${MIN_REASON_WORDS} words`);
  }
  const mentions = new Set();
  for (const path of paths) {
    const own = mentionsFor(path);
    if (!own.some((value) => reason.includes(value))) {
      out.push(`the reason does not name ${path} (use its file name or a folder on its path)`);
    }
    for (const value of own) mentions.add(value);
  }
  let stripped = reason;
  for (const token of [...mentions].sort((left, right) => right.length - left.length)) {
    stripped = stripped.replaceAll(token, ' ');
  }
  const substantive = stripped
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !GENERIC_WORDS.has(word));
  if (substantive.length < 2) {
    out.push('the reason is generic ("refactor only", "no behavior change"): say what changed and why that cannot alter behavior');
  }
  return out;
}

function impactProblems(changedFiles, message, label, waived = new Set()) {
  const changed = new Set(
    changedFiles.map((path) => path.replaceAll('\\', '/')).filter((path) => !isSkippedPath(join(ROOT, path))),
  );
  if (!waived.has('doc-impact')) {
    const missing = [];
    for (const path of changed) {
      if (!isRuntimeFile(path)) continue;
      const owners = ownersFor(path);
      if (!owners.some((owner) => changed.has(owner))) missing.push({ path, owners });
    }
    if (missing.length) {
      const listing = missing
        .map((item) => `${item.path} (owner: ${item.owners.join(' or ') || 'none found - add a doc of record that covers it, or an AGENTS.md'})`)
        .join(', ');
      // Spec-Impact is the trailer name before 1.0.0; commits already written with it stay valid.
      const reason = trailer(message, 'Doc-Impact', 'Spec-Impact');
      if (reason === null) {
        fail(
          `${label}: runtime paths lack an owner change: ${listing}. These files changed but no doc of record or AGENTS.md that owns them did. ` +
            'Either update an owner in the same commit, or add this line to the commit message: ' +
            '"Doc-Impact: none - <at least 8 words naming each file and why behavior cannot change>". ' +
            `Rules: ${DOC_RULES}.`,
        );
      } else {
        for (const problem of reasonProblems(reason, missing.map((item) => item.path))) {
          fail(`${label}: rejected Doc-Impact trailer: ${problem}. Files without an owner change: ${missing.map((item) => item.path).join(', ')}.`);
        }
      }
    }
  }

  if (waived.has('agent-parity')) return;
  const partnerMissing = [];
  const present = (path) => path.endsWith('/') ? [...changed].some((item) => item.startsWith(path)) : changed.has(path);
  const partnerGroups = (path) => {
    let match;
    // A skill's twin links it and holds no steps, so an edit to either side alone needs no partner.
    // A legacy INDEX.md (rules index up to 0.4.0) is not a rule: gen-cursor-rules skips it, so it has no mirror.
    if ((match = path.match(/^\.claude\/rules\/([^/]+)\.md$/))) return match[1] === 'INDEX' ? [] : [[`.cursor/rules/${match[1]}.mdc`]];
    if ((match = path.match(/^\.cursor\/rules\/([^/]+)\.mdc$/))) return [[`.claude/rules/${match[1]}.md`]];
    // Hook configs move together: each other enabled tool's config must change in the same commit. The
    // changed file is never its own partner. The shared hook script under .claude/hooks needs no config change.
    if (Object.values(HOOK_CONFIG_PATHS).includes(path)) {
      return Object.entries(HOOK_CONFIG_PATHS)
        .filter(([agent, other]) => other !== path && enabledAgents.has(agent))
        .map(([, other]) => [other]);
    }
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
      fail(
        `${label}: harness paths lack partner change: ${partnerMissing.join(', ')}. Claude Code, Codex, and Cursor files move together ` +
          `(partner table in ${PARITY_DOC}). Update the partner files in the same commit, or add this line to the commit message: ` +
          '"Agent-Parity: none - <reason naming each file and why the other tools need no change>".',
      );
    } else {
      for (const problem of reasonProblems(reason, partnerMissing)) {
        fail(`${label}: rejected Agent-Parity trailer: ${problem}. Files without a partner change: ${partnerMissing.join(', ')}.`);
      }
    }
  }
}

/** Waived commits for `--changed` mode. `null` when the waiver file is malformed (already reported). */
function loadWaivers() {
  if (!existsSync(WAIVERS_PATH)) return new Map();
  const entries = json(WAIVERS_PATH);
  if (entries === null) return null;
  const errors = [];
  if (!Array.isArray(entries)) errors.push('the file must contain a JSON array of waiver objects');
  const seen = new Set();
  for (const [index, entry] of Array.isArray(entries) ? entries.entries() : []) {
    const at = `waiver #${index + 1}`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${at}: must be an object with "commit", "gates", and "reason"`);
      continue;
    }
    if (typeof entry.commit !== 'string' || !/^[0-9a-f]{40}$/.test(entry.commit)) {
      errors.push(`${at}: "commit" must be the full 40-character lowercase SHA (run "git rev-parse <ref>")`);
    } else if (seen.has(entry.commit)) {
      errors.push(`${at}: commit ${entry.commit.slice(0, 12)} is listed twice`);
    } else {
      seen.add(entry.commit);
    }
    if (!Array.isArray(entry.gates) || !entry.gates.length) {
      errors.push(`${at}: "gates" must be a non-empty array (allowed: ${WAIVER_GATES.join(', ')})`);
    } else {
      for (const gate of entry.gates) {
        if (!WAIVER_GATES.includes(WAIVER_ALIASES[gate] ?? gate)) errors.push(`${at}: unknown gate "${gate}" (allowed: ${WAIVER_GATES.join(', ')})`);
      }
    }
    const words = typeof entry.reason === 'string' ? entry.reason.trim().split(/\s+/).filter(Boolean) : [];
    if (words.length < MIN_WAIVER_WORDS) {
      errors.push(`${at}: "reason" has ${words.length} words; write at least ${MIN_WAIVER_WORDS} so a reviewer can check it`);
    }
  }
  if (errors.length) {
    for (const error of errors) fail(`.agent-sdd/waivers.json: ${error}.`);
    return null;
  }
  return new Map(entries.map((entry) => [entry.commit, new Set(entry.gates.map((gate) => WAIVER_ALIASES[gate] ?? gate))]));
}

/**
 * Base commit for `--changed`. Explicit sources (`--base`, SDD_BASE_REF, CHANGE_TARGET) must resolve;
 * Jenkins previous-build variables are skipped when their commit no longer exists.
 */
function resolveBase(args) {
  const env = (name) => (process.env[name] ?? '').trim() || null;
  const explicit = option(args, '--base') ?? env('SDD_BASE_REF');
  if (explicit) {
    return refExists(explicit)
      ? { base: explicit }
      : { error: `no resolvable base: ${explicit}. Git cannot find that commit or branch; check the value passed with --base or in SDD_BASE_REF.` };
  }
  const target = env('CHANGE_TARGET');
  if (target) {
    const candidates = [`origin/${target}`, target];
    const found = candidates.find(refExists);
    return found
      ? { base: found }
      : { error: `no resolvable base for CHANGE_TARGET=${target} (tried ${candidates.join(', ')}). Fetch the target branch in CI before running the gate, or pass --base explicitly.` };
  }
  const fallbacks = [env('GIT_PREVIOUS_COMMIT'), env('GIT_PREVIOUS_SUCCESSFUL_COMMIT'), 'HEAD^'].filter(Boolean);
  const found = fallbacks.find(refExists);
  return found
    ? { base: found }
    : { error: `no resolvable base (tried ${fallbacks.join(', ')}). Pass --base <commit-or-branch> to say which commits to audit.` };
}

function checkChangeImpact(args) {
  const staged = args.includes('--staged');
  const changed = args.includes('--changed');
  if (staged && changed) {
    fail('choose only one mode: --staged (files staged for the next commit) or --changed (commits since a base).');
    return;
  }
  if (staged) {
    const messagePath = option(args, '--commit-msg');
    if (!messagePath) {
      fail('--staged requires --commit-msg <path>: the gate reads the commit message to accept "Doc-Impact: none" and "Agent-Parity: none" explanations. In a commit-msg hook pass "$1".');
      return;
    }
    const changedFiles = git(['diff', '--cached', '--name-only', '--diff-filter=ACMRD']).split('\n').filter(Boolean);
    impactProblems(changedFiles, readFileSync(resolve(ROOT, messagePath), 'utf8'), 'staged commit');
  }
  if (changed) {
    const waivers = loadWaivers();
    if (waivers === null) return;
    const resolved = resolveBase(args);
    if (resolved.error) {
      fail(resolved.error);
      return;
    }
    try {
      for (const commit of git(['rev-list', '--reverse', `${resolved.base}..HEAD`]).split('\n').filter(Boolean)) {
        const waived = waivers.get(commit) ?? new Set();
        if (waived.size) console.log(`check-sdd: waived ${commit.slice(0, 12)} for ${[...waived].join(', ')} (listed in .agent-sdd/waivers.json)`);
        if (waived.size === WAIVER_GATES.length) continue;
        const changedFiles = git([
          // -M: a moved file is one path, its new one, as --staged sees it. Without it the old path reads as a change.
          'diff-tree', '--root', '-M', '--no-commit-id', '--name-only', '-r', '--diff-filter=ACMRD', commit,
        ]).split('\n').filter(Boolean);
        impactProblems(changedFiles, git(['show', '-s', '--format=%B', commit]), `commit ${commit.slice(0, 12)}`, waived);
      }
    } catch (error) {
      fail(`cannot inspect commits from ${resolved.base}: ${error.message}`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  checkDocs();
  checkDocsOfRecord();
  checkAgents();
  checkConfigGroups();
  checkHelmConfig();
  checkChangeImpact(args);

  if (problems.length) {
    console.error(`check-sdd found ${problems.length} problem(s). Each line says what is wrong and how to fix it:`);
    for (const problem of problems) console.error(`  x ${problem}`);
    console.error(`Shapes and rules: ${DOC_RULES}. Tool parity: ${PARITY_DOC}.`);
    process.exit(1);
  }
  console.log('check-sdd: ok');
}

main();
