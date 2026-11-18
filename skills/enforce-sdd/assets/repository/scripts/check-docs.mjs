#!/usr/bin/env node
/**
 * Generated documentation gate: the docs a reader expects exist, are linked, and sit where the docs standard
 * puts them.
 *
 *   - every module folder under a configured module root is covered by a doc of record;
 *   - the README.md of each docs/ folder lists its docs of record, and the nearest AGENTS.md links that index;
 *   - the root AGENTS.md links docs/doc-of-record.md, and carries "docsStandardLine" when the config sets one;
 *   - the checks of the docs standard that a script can decide, in scripts/docs-standard.mjs.
 *
 * A workspace needs no AGENTS.md of its own: one with no gotcha and no pointer to hold has none.
 *
 * Warnings are advice and never fail the gate: a history word or a date in a doc of record, and a doc whose name
 * reads as a dated copy. A script can suspect these, and only a reader can decide them.
 *
 * Nothing here inspects meaning. scripts/check-sdd.mjs owns link resolution, doc-of-record frontmatter, evidence,
 * and agent parity. Both run in pre-commit and CI.
 *
 *   node scripts/check-docs.mjs
 *
 * Configuration: .agent-sdd/config.json ("runtimeRoots", "moduleRoots", "exclude", "docsStandardLine").
 * Shapes: docs/doc-of-record.md.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { standardProblems, standardWarnings } from './docs-standard.mjs';
import { docsOfRecord, normalize, skipRules, walkFiles } from './sdd-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, '.agent-sdd', 'config.json');
const DOC_RULES = 'docs/doc-of-record.md';
const MAX_WARNINGS = 20;
const problems = [];
const fail = (message) => problems.push(message);
const rel = (path) => relative(ROOT, path).replaceAll('\\', '/');

let config = null;
try {
  config = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) : null;
} catch (error) {
  fail(`cannot parse .agent-sdd/config.json: ${error.message}. Fix the JSON syntax.`);
}
if (!config) {
  fail('missing or invalid .agent-sdd/config.json. This file tells the gate where workspaces and modules live; re-run the enforce-sdd "apply --write" command to recreate it.');
}

const { isSkipped } = skipRules(config);
const allFiles = walkFiles(ROOT, config);
const read = (path) => normalize(readFileSync(join(ROOT, path), 'utf8'));

function directories(path) {
  if (!existsSync(path) || !statSync(path).isDirectory()) return [];
  return readdirSync(path)
    .sort()
    .map((name) => join(path, name))
    .filter((child) => statSync(child).isDirectory() && !isSkipped(rel(child)));
}

/** Expands a pattern such as "apps/<star>/src/modules" (<star> = one path segment) into existing directories. */
function expand(pattern) {
  const segments = String(pattern).replaceAll('\\', '/').replace(/^\.?\//, '').split('/').filter(Boolean);
  let current = [ROOT];
  for (const segment of segments) {
    const next = [];
    for (const base of current) {
      if (segment === '*') next.push(...directories(base));
      else {
        const candidate = join(base, segment);
        if (existsSync(candidate) && statSync(candidate).isDirectory() && !isSkipped(rel(candidate))) next.push(candidate);
      }
    }
    current = next;
  }
  return current;
}

/** Nearest AGENTS.md at or above `dir` (repo-relative), the root one included. */
function nearestAgents(dir) {
  let cursor = dir;
  while (true) {
    const candidate = cursor ? `${cursor}/AGENTS.md` : 'AGENTS.md';
    if (existsSync(join(ROOT, candidate))) return candidate;
    if (!cursor) return null;
    cursor = cursor.includes('/') ? cursor.slice(0, cursor.lastIndexOf('/')) : '';
  }
}

/** Repo-relative targets of the relative Markdown links in `path`. */
function linkTargets(path) {
  const out = new Set();
  for (const match of read(path).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '').split('#')[0].split('?')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    try {
      target = decodeURIComponent(target);
    } catch {
      // A bad escape stays literal; the link then names no file.
    }
    out.add(rel(resolve(ROOT, dirname(path), target)));
  }
  return out;
}

/** The index that lists a doc of record: the README.md of its docs/ folder. */
function indexPath(doc) {
  return `${dirname(doc.path)}/README.md`;
}

// 1 + 2. Every module folder is covered by a doc of record, its docs/README.md lists it, and the nearest AGENTS.md links that index.
function checkModules(docs) {
  for (const pattern of config?.moduleRoots ?? []) {
    for (const moduleRoot of expand(pattern)) {
      for (const module of directories(moduleRoot)) {
        // A parent doc does not cover a module: with it, one doc for "src" would cover every module.
        const folder = rel(module);
        const covered = docs.some((doc) => doc.code && (doc.code === folder || doc.code.startsWith(`${folder}/`)));
        if (!covered) {
          fail(
            `module not covered: ${folder}. Every module under "${pattern}" needs a doc of record whose "code:" is that folder or a folder inside it ` +
              `(shape in ${DOC_RULES}); write it, or remove the folder from "moduleRoots" in .agent-sdd/config.json.`,
          );
        }
      }
    }
  }
  const indexes = new Set();
  for (const doc of docs) {
    const index = indexPath(doc);
    if (!existsSync(join(ROOT, index)) || !linkTargets(index).has(doc.path)) {
      fail(`${index} does not list ${doc.path}. Each docs/ folder indexes its docs of record in its README.md: add a link row for it.`);
    }
    indexes.add(index);
  }
  // The AGENTS.md links the index, not each doc, so it stays short however many modules the workspace has.
  for (const index of indexes) {
    const docsDir = dirname(index);
    const agents = nearestAgents(docsDir === 'docs' ? '' : docsDir.slice(0, -'/docs'.length));
    if (!agents) {
      fail(`${index} has no AGENTS.md above it. Add an AGENTS.md to the workspace and link the index from it.`);
    } else if (!linkTargets(agents).has(index)) {
      fail(`${agents} does not link ${index}. Add one Markdown link to the index so readers find every doc of record.`);
    }
  }
}

// 3. The root AGENTS.md points at the doc-of-record rules, and carries the docs standard line when configured.
function checkRootAgents() {
  const sdd = (config?.profiles ?? []).includes('sdd');
  const standard = String(config?.docsStandardLine ?? '').trim();
  if (!sdd && !standard) return;
  if (!existsSync(join(ROOT, 'AGENTS.md'))) return; // checkStandard reports the missing file.
  if (sdd && !linkTargets('AGENTS.md').has(DOC_RULES)) {
    fail(`AGENTS.md does not link ${DOC_RULES}. Restore the line that points at it, so every agent reads the doc of record before an edit.`);
  }
  if (standard && !read('AGENTS.md').split('\n').some((line) => line.trim() === standard)) {
    fail(`AGENTS.md lacks the docs standard line that "docsStandardLine" in .agent-sdd/config.json sets. Add this line near the top: ${standard}`);
  }
}

// 4. The checks of the docs standard that a script can decide (scripts/docs-standard.mjs).
function checkStandard() {
  // Git decides what is ignored; outside a Git checkout nothing is.
  const isIgnored = (path) => spawnSync('git', ['check-ignore', '-q', path], { cwd: ROOT }).status === 0;
  for (const problem of standardProblems({ files: allFiles, read, isIgnored })) fail(problem);
}

// Advice: what a script can suspect and only a reader can decide. It never changes the exit code.
// The commit-changes skill reads the map from path prefix to task-runner filter in "workspaces". An empty map
// in a repository with a workspace manifest makes that skill guess the filter.
function workspaceWarnings() {
  if (!Array.isArray(config?.workspaces) || config.workspaces.length) return [];
  let manifest = existsSync(join(ROOT, 'pnpm-workspace.yaml')) ? 'pnpm-workspace.yaml' : '';
  if (!manifest && existsSync(join(ROOT, 'package.json'))) {
    try {
      if (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).workspaces) manifest = 'package.json';
    } catch {
      // A broken package.json is not a docs matter.
    }
  }
  if (!manifest) return [];
  return [`.agent-sdd/config.json: "workspaces" is empty, and ${manifest} names workspaces. List each workspace there with its path prefix and its task-runner filter, so the commit-changes skill runs the right tests.`];
}

function printWarnings() {
  const warnings = [...standardWarnings({ files: allFiles, read }), ...workspaceWarnings()];
  if (!warnings.length) return;
  console.log(`check-docs: ${warnings.length} warning(s). They are advice and never fail the gate:`);
  for (const warning of warnings.slice(0, MAX_WARNINGS)) console.log(`  ! ${warning}`);
  if (warnings.length > MAX_WARNINGS) console.log(`  ! and ${warnings.length - MAX_WARNINGS} more of the same kinds.`);
}

function main() {
  const docs = docsOfRecord(ROOT, allFiles);
  checkModules(docs);
  checkRootAgents();
  checkStandard();
  printWarnings();
  if (problems.length) {
    console.error(`check-docs found ${problems.length} problem(s). Each line says what is wrong and how to fix it:`);
    for (const problem of problems) console.error(`  x ${problem}`);
    console.error(`Shapes and rules: ${DOC_RULES}.`);
    process.exit(1);
  }
  console.log('check-docs: ok');
}

main();
