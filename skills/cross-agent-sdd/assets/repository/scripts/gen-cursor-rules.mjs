#!/usr/bin/env node
/**
 * Generates `.cursor/rules/<name>.mdc` from `.claude/rules/<name>.md`.
 *
 * Cursor auto-attaches a rule by its `globs:` frontmatter, exactly like Claude Code's `paths:`,
 * but only from `.mdc` files under `.cursor/rules`. Hand-written copies drift; generated ones
 * cannot. `.claude/rules/*.md` stays the single source.
 *
 *   node scripts/gen-cursor-rules.mjs           # write / refresh, delete stale .mdc
 *   node scripts/gen-cursor-rules.mjs --check   # exit 1 when committed .mdc files differ
 *
 * `node scripts/check-sdd.mjs` runs the --check form, so a rule edit cannot be committed with a
 * stale mirror.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_DIR = '.claude/rules';
export const TARGET_DIR = '.cursor/rules';

const normalize = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replaceAll('\r\n', '\n');

export function parseRule(body) {
  const text = normalize(body);
  const end = text.startsWith('---\n') ? text.indexOf('\n---\n', 4) : -1;
  if (end < 0) return null;
  const frontmatter = text.slice(4, end);
  const description = frontmatter.match(/^description:\s*(.+?)\s*$/m)?.[1] ?? '';
  const pathsBlock = frontmatter.match(/^paths:\s*\n((?:\s+-\s+.+\n?)+)/m)?.[1] ?? '';
  const paths = [...pathsBlock.matchAll(/^\s+-\s+['"]?([^'"\n]+?)['"]?\s*$/gm)].map((match) => match[1]);
  return { description, paths, body: text.slice(end + 5).trim() };
}

/** `.claude/rules/<name>.md` body → `{ file, content }` for `.cursor/rules/<name>.mdc`. */
export function toMdc(name, body) {
  const rule = parseRule(body);
  if (!rule) throw new Error(`${SOURCE_DIR}/${name}: missing frontmatter`);
  const vendorSyntax = ['# Claude Code adapter', 'Claude-specific', 'Skill("'];
  const found = vendorSyntax.find((token) => rule.body.includes(token));
  if (found) throw new Error(`${SOURCE_DIR}/${name}: body is not tool-neutral (contains ${JSON.stringify(found)})`);
  const lines = ['---', `description: ${rule.description}`];
  if (rule.paths.length) lines.push(`globs: ${rule.paths.join(', ')}`);
  lines.push('alwaysApply: false', '---', '');
  lines.push(
    `<!-- GENERATED from ${SOURCE_DIR}/${name} by scripts/gen-cursor-rules.mjs. Edit the source, then run \`node scripts/gen-cursor-rules.mjs\`. -->`,
    '',
  );
  lines.push(rule.body, '');
  return { file: name.replace(/\.md$/, '.mdc'), content: lines.join('\n') };
}

export function expectedRules(root = ROOT) {
  const dir = join(root, SOURCE_DIR);
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (name === 'INDEX.md' || !name.endsWith('.md')) continue;
    const { file, content } = toMdc(name, readFileSync(join(dir, name), 'utf8'));
    out.set(file, content);
  }
  return out;
}

/** Drift between generated content and what is on disk. Empty array = in sync. */
export function cursorRulesProblems(root = ROOT) {
  const expected = expectedRules(root);
  const dir = join(root, TARGET_DIR);
  const problems = [];
  const onDisk = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.mdc')) : [];
  for (const [file, content] of expected) {
    const path = join(dir, file);
    if (!existsSync(path)) problems.push(`${TARGET_DIR}/${file} missing`);
    else if (normalize(readFileSync(path, 'utf8')) !== content) problems.push(`${TARGET_DIR}/${file} stale`);
  }
  for (const file of onDisk) if (!expected.has(file)) problems.push(`${TARGET_DIR}/${file} has no source rule`);
  return problems;
}

export function writeCursorRules(root = ROOT) {
  const expected = expectedRules(root);
  const dir = join(root, TARGET_DIR);
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) if (name.endsWith('.mdc') && !expected.has(name)) rmSync(join(dir, name));
  for (const [file, content] of expected) writeFileSync(join(dir, file), content);
  return [...expected.keys()];
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.argv.includes('--check')) {
    const problems = cursorRulesProblems();
    if (problems.length) {
      console.error(`gen-cursor-rules: ${problems.length} problem(s); run \`node scripts/gen-cursor-rules.mjs\``);
      for (const problem of problems) console.error(`  x ${problem}`);
      process.exit(1);
    }
    console.log('gen-cursor-rules: ok');
  } else {
    const files = writeCursorRules();
    console.log(`gen-cursor-rules: wrote ${files.length} file(s) to ${TARGET_DIR}`);
  }
}
