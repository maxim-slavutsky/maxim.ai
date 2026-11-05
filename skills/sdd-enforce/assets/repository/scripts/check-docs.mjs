#!/usr/bin/env node
/**
 * Generated documentation gate: the docs a reader expects exist, are linked, and sit where the docs standard
 * puts them.
 *
 *   - every workspace under a runtime root (a folder with its own package manifest) carries an AGENTS.md;
 *   - every module folder under a configured module root is covered by a doc of record;
 *   - every doc of record is linked from the nearest AGENTS.md above its docs/ folder;
 *   - the root AGENTS.md links docs/doc-of-record.md, and carries "docsStandardLine" when the config sets one;
 *   - no CLAUDE.md, kebab-case names under docs/, AGENTS.md under 200 lines, SKILL.md under 500 lines, a skill
 *     name equal to its folder name, a skill description of at most 1,024 characters, and rule paths: globs that
 *     each match a file.
 *
 * Nothing here inspects meaning. scripts/check-sdd.mjs owns link resolution, doc-of-record frontmatter, evidence,
 * and agent parity. Both run in pre-commit and CI.
 *
 *   node scripts/check-docs.mjs
 *
 * Configuration: .agent-sdd/config.json ("runtimeRoots", "moduleRoots", "exclude", "docsStandardLine").
 * Shapes: docs/doc-of-record.md.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docsOfRecord, frontmatter, frontmatterList, frontmatterScalar, matchesGlob, normalize, skipRules, walkFiles } from './sdd-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, '.agent-sdd', 'config.json');
const DOC_RULES = 'docs/doc-of-record.md';
const WORKSPACE_MANIFESTS = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'Chart.yaml'];
const MAX_AGENTS_LINES = 200;
const MAX_SKILL_LINES = 500;
const MAX_DESCRIPTION = 1024;
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
  fail('missing or invalid .agent-sdd/config.json. This file tells the gate where workspaces and modules live; re-run the sdd-enforce "apply --write" command to recreate it.');
}

const { isSkipped } = skipRules(config);
const allFiles = walkFiles(ROOT, config);
const read = (path) => normalize(readFileSync(join(ROOT, path), 'utf8'));
const lineCount = (body) => body.replace(/\n$/, '').split('\n').length;

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

function isWorkspace(dir) {
  return WORKSPACE_MANIFESTS.some((name) => existsSync(join(dir, name)));
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
    const target = match[1].trim().replace(/^<|>$/g, '').split('#')[0].split('?')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    out.add(rel(resolve(ROOT, dirname(path), target)));
  }
  return out;
}

// 1. Every workspace under a runtime root carries an AGENTS.md.
function checkWorkspaces() {
  for (const root of config?.runtimeRoots ?? []) {
    for (const dir of directories(join(ROOT, String(root)))) {
      if (!isWorkspace(dir)) continue;
      if (!existsSync(join(dir, 'AGENTS.md'))) {
        fail(`missing AGENTS.md: ${rel(dir)}. Every app or package needs an AGENTS.md with its gotchas and links to its docs of record (${DOC_RULES}).`);
      }
    }
  }
}

// 2 + 3. Every module folder is covered by a doc of record, and the nearest AGENTS.md links every doc of record.
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
  for (const doc of docs) {
    const docsDir = dirname(doc.path);
    const owner = docsDir === 'docs' ? '' : docsDir.slice(0, -'/docs'.length);
    const agents = nearestAgents(owner);
    if (!agents) {
      fail(`${doc.path} has no AGENTS.md above it. Add an AGENTS.md to the workspace and link the doc of record from it.`);
    } else if (!linkTargets(agents).has(doc.path)) {
      fail(`${agents} does not link ${doc.path}. Add a Markdown link to it so readers can find the doc of record.`);
    }
  }
}

// 4. The root AGENTS.md points at the doc-of-record rules, and carries the docs standard line when configured.
function checkRootAgents() {
  const sdd = (config?.profiles ?? []).includes('sdd');
  const standard = String(config?.docsStandardLine ?? '').trim();
  if (!sdd && !standard) return;
  if (!existsSync(join(ROOT, 'AGENTS.md'))) {
    fail(`missing AGENTS.md at the repository root. Re-run the sdd-enforce "apply --write" command to create it with the line that links ${DOC_RULES}.`);
    return;
  }
  if (sdd && !linkTargets('AGENTS.md').has(DOC_RULES)) {
    fail(`AGENTS.md does not link ${DOC_RULES}. Restore the line that points at it, so every agent reads the doc of record before an edit.`);
  }
  if (standard && !read('AGENTS.md').split('\n').some((line) => line.trim() === standard)) {
    fail(`AGENTS.md lacks the docs standard line that "docsStandardLine" in .agent-sdd/config.json sets. Add this line near the top: ${standard}`);
  }
}

// 5. The docs standard: where docs live, how they are named, and how large agent docs may grow.
function checkStandard() {
  for (const path of allFiles) {
    const name = basename(path);
    if (name === 'CLAUDE.md') {
      fail(`${path}: the repository ships AGENTS.md, never CLAUDE.md, because a CLAUDE.md hides every AGENTS.md from Claude Code. Move each line that AGENTS.md lacks into the AGENTS.md beside it, then delete ${path}.`);
    }
    if (/(?:^|\/)docs\/(?:.*\/)?[^/]*[A-Z_][^/]*\.md$/.test(path) && !['README.md', 'AGENTS.md'].includes(name)) {
      const target = path.slice(0, -name.length) + name.replace(/\.md$/, '').replace(/_/g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() + '.md';
      fail(`${path}: a doc under docs/ needs a kebab-case name. Run "git mv ${path} ${target}" and update every link to it.`);
    }
    if (name === 'AGENTS.md' && lineCount(read(path)) >= MAX_AGENTS_LINES) {
      fail(`${path} has ${lineCount(read(path))} lines; keep an AGENTS.md under ${MAX_AGENTS_LINES}. Move reference material into the docs it points at.`);
    }
    if (name === 'SKILL.md') checkSkill(path);
  }
  for (const path of allFiles.filter((item) => /^\.claude\/rules\/[^/]+\.md$/.test(item))) {
    const block = frontmatter(read(path));
    for (const glob of (block ? frontmatterList(block, 'paths') : null) ?? []) {
      if (!allFiles.some((file) => matchesGlob(file, glob))) {
        fail(`${path}: the "paths:" glob "${glob}" matches no file, so the rule never loads there. Fix the glob or remove it.`);
      }
    }
  }
}

function checkSkill(path) {
  const body = read(path);
  if (lineCount(body) >= MAX_SKILL_LINES) {
    fail(`${path} has ${lineCount(body)} lines; keep a SKILL.md under ${MAX_SKILL_LINES}. Move reference material one level down into references/.`);
  }
  const block = frontmatter(body);
  const folder = basename(dirname(path));
  const name = block ? frontmatterScalar(block, 'name') : null;
  if (name !== folder) {
    fail(`${path}: the frontmatter "name" is ${name === null ? 'missing' : `"${name}"`}; set it to the folder name "${folder}".`);
  }
  const description = block ? (frontmatterScalar(block, 'description') ?? '') : '';
  if (description.length > MAX_DESCRIPTION) {
    fail(`${path}: the description has ${description.length} characters; keep it at most ${MAX_DESCRIPTION}.`);
  }
}

function main() {
  const docs = docsOfRecord(ROOT, allFiles);
  checkWorkspaces();
  checkModules(docs);
  checkRootAgents();
  checkStandard();
  if (problems.length) {
    console.error(`check-docs found ${problems.length} problem(s). Each line says what is wrong and how to fix it:`);
    for (const problem of problems) console.error(`  x ${problem}`);
    console.error(`Shapes and rules: ${DOC_RULES}.`);
    process.exit(1);
  }
  console.log('check-docs: ok');
}

main();
