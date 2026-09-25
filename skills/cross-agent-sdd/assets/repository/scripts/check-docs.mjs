#!/usr/bin/env node
/**
 * Generated documentation existence gate.
 *
 * Asserts that the documents a reader is entitled to expect actually exist and are wired in:
 *
 *   - every workspace under a runtime root (a folder with its own package manifest) carries an AGENTS.md;
 *   - every module folder under a configured module root carries a SPEC.md;
 *   - every module SPEC.md is linked from the AGENTS.md that owns it;
 *   - the root AGENTS.md still imports the SPEC-first workflow, so the working rules reach every agent.
 *
 * Nothing here inspects document content. scripts/check-sdd.mjs owns link resolution, SPEC ids, evidence,
 * and agent parity. Both run in pre-commit and CI.
 *
 *   node scripts/check-docs.mjs
 *
 * Configuration: .agent-sdd/config.json ("runtimeRoots", "moduleRoots", "exclude").
 * File shapes: docs/agent-sdd/FORMAT.md.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, '.agent-sdd', 'config.json');
const FORMAT_DOC = 'docs/agent-sdd/FORMAT.md';
const SPEC_DOC = 'docs/workflows/SPEC-FIRST-WORKFLOW.md';
const WORKFLOW_IMPORT = /^@(?:\.\/)?docs\/workflows\/SPEC-FIRST-WORKFLOW\.md\s*$/m;
const WORKSPACE_MANIFESTS = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'Chart.yaml'];
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
  fail('missing or invalid .agent-sdd/config.json. This file tells the gate where workspaces and modules live; re-run the cross-agent-sdd "apply --write" command to recreate it.');
}

const skippedNames = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.turbo']);
const skippedPrefixes = ['.claude/worktrees'];
for (const entry of config?.exclude ?? []) {
  const value = String(entry).replaceAll('\\', '/').replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!value) continue;
  if (value.includes('/')) skippedPrefixes.push(value);
  else skippedNames.add(value);
}

function isSkipped(path) {
  const key = rel(path);
  if (skippedNames.has(basename(path))) return true;
  return skippedPrefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}/`));
}

function directories(path) {
  if (!existsSync(path) || !statSync(path).isDirectory()) return [];
  return readdirSync(path)
    .sort()
    .map((name) => join(path, name))
    .filter((child) => statSync(child).isDirectory() && !isSkipped(child));
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
        if (existsSync(candidate) && statSync(candidate).isDirectory() && !isSkipped(candidate)) next.push(candidate);
      }
    }
    current = next;
  }
  return current;
}

function isWorkspace(dir) {
  return WORKSPACE_MANIFESTS.some((name) => existsSync(join(dir, name)));
}

function owningAgents(dir) {
  let cursor = dir;
  while (cursor !== ROOT && cursor.startsWith(ROOT)) {
    const candidate = join(cursor, 'AGENTS.md');
    if (existsSync(candidate)) return candidate;
    cursor = dirname(cursor);
  }
  return null;
}

// 1. Every workspace under a runtime root carries an AGENTS.md (FORMAT.md, document ownership).
function checkWorkspaces() {
  for (const root of config?.runtimeRoots ?? []) {
    for (const dir of directories(join(ROOT, String(root)))) {
      if (!isWorkspace(dir)) continue;
      if (!existsSync(join(dir, 'AGENTS.md'))) {
        fail(`missing AGENTS.md: ${rel(dir)}. Every app or package needs an AGENTS.md with its purpose, commands, and module SPEC index (${FORMAT_DOC}).`);
      }
    }
  }
}

// 2 + 3. Every module folder carries a SPEC.md, and its owning AGENTS.md links it.
function checkModules() {
  for (const pattern of config?.moduleRoots ?? []) {
    for (const moduleRoot of expand(pattern)) {
      for (const module of directories(moduleRoot)) {
        const spec = join(module, 'SPEC.md');
        if (!existsSync(spec)) {
          fail(`missing SPEC.md: ${rel(module)}. Every module under "${pattern}" needs a SPEC.md (shape in ${FORMAT_DOC}); write it or remove the folder from "moduleRoots" in .agent-sdd/config.json.`);
          continue;
        }
        const agents = owningAgents(dirname(module));
        if (!agents) {
          fail(`${rel(spec)} has no owning AGENTS.md above it. Add an AGENTS.md to the workspace and link the SPEC from its module table.`);
          continue;
        }
        const needle = `${basename(module)}/SPEC.md`;
        if (!readFileSync(agents, 'utf8').includes(needle)) {
          fail(`${rel(agents)} does not link ${rel(spec)}. Add a row for "${needle}" to its module SPEC table so readers can find the contract.`);
        }
      }
    }
  }
}

// 4. The root AGENTS.md imports the working rules; without that line the SPEC-first policy never reaches an agent.
function checkImport() {
  if (!(config?.profiles ?? []).includes('sdd')) return;
  const rootAgents = join(ROOT, 'AGENTS.md');
  if (!existsSync(rootAgents)) {
    fail('missing AGENTS.md at the repository root. Run the cross-agent-sdd "apply --write" command to recreate the managed block.');
    return;
  }
  if (!WORKFLOW_IMPORT.test(readFileSync(rootAgents, 'utf8'))) {
    fail(`AGENTS.md no longer imports the working rules. Restore this line on its own: @./${SPEC_DOC}`);
  }
}

function main() {
  checkWorkspaces();
  checkModules();
  checkImport();
  if (problems.length) {
    console.error(`check-docs found ${problems.length} problem(s). Each line says what is wrong and how to fix it:`);
    for (const problem of problems) console.error(`  x ${problem}`);
    console.error(`File shapes: ${FORMAT_DOC}. Procedure: ${SPEC_DOC}.`);
    process.exit(1);
  }
  console.log('check-docs: ok');
}

main();
