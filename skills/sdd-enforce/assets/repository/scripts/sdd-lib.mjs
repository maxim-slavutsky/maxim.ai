/**
 * Shared helpers for the generated gates (scripts/check-docs.mjs, scripts/check-sdd.mjs): the repository walk,
 * glob matching, and the frontmatter of a doc of record. Shapes: docs/doc-of-record.md.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const normalize = (value) => value.replace(/^﻿/, '').replaceAll('\r\n', '\n');

// A copy of the sdd-enforce skill itself may be kept inside the repository (.claude/.agents/.cursor skills).
// Its bundled templates and SKILL.md are tooling, not repository policy, so the gates never read them.
// cross-agent-sdd is the skill's former name; copies installed under it are skipped too.
export const TOOL_SKILL_DIRS = ['.claude', '.agents', '.cursor'].flatMap((root) =>
  ['sdd-enforce', 'cross-agent-sdd'].map((name) => `${root}/skills/${name}`),
);
// Claude Code keeps its worktrees inside the checkout (.claude/worktrees/<name>), each one a full copy of the
// repository. Reading them reports every doc twice and blocks every commit while any worktree exists. Skipped by
// path, not by name: "worktrees" is too ordinary a name to skip anywhere.
export const WORKTREE_DIRS = ['.claude/worktrees'];

/** Skip rules from `.agent-sdd/config.json` "exclude": a bare name skips that name anywhere, a path skips a prefix. */
export function skipRules(config) {
  const names = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.turbo']);
  const prefixes = [...TOOL_SKILL_DIRS, ...WORKTREE_DIRS];
  for (const entry of config?.exclude ?? []) {
    const value = String(entry).replaceAll('\\', '/').replace(/^\.?\//, '').replace(/\/+$/, '');
    if (!value) continue;
    if (value.includes('/')) prefixes.push(value);
    else names.add(value);
  }
  const isSkipped = (key) => key.split('/').some((part) => names.has(part)) || prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}/`));
  return { names, prefixes, isSkipped };
}

/** Every file under `root` that the skip rules keep, as repo-relative paths with forward slashes. */
export function walkFiles(root, config) {
  const { names, isSkipped } = skipRules(config);
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const name of readdirSync(current)) {
      if (names.has(name)) continue;
      const path = join(current, name);
      const key = relative(root, path).replaceAll('\\', '/');
      if (isSkipped(key)) continue;
      const info = statSync(path);
      if (info.isDirectory()) stack.push(path);
      else if (info.isFile()) out.push(key);
    }
  }
  return out.sort();
}

/** Glob to RegExp: `**` spans folders, `*` and `?` stay inside one segment, `{a,b}` is a choice. */
export function globRegExp(glob) {
  const source = String(glob).replaceAll('\\', '/').replace(/^\.?\//, '');
  let out = '';
  let braces = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '*' && source[index + 1] === '*') {
      const slash = source[index + 2] === '/';
      out += slash ? '(?:.*/)?' : '.*';
      index += slash ? 2 : 1;
    } else if (character === '*') out += '[^/]*';
    else if (character === '?') out += '[^/]';
    else if (character === '{') {
      braces += 1;
      out += '(?:';
    } else if (character === '}' && braces) {
      braces -= 1;
      out += ')';
    } else if (character === ',' && braces) out += '|';
    else out += /[\\^$.+()[\]|]/.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`^${out}$`);
}

export function matchesGlob(path, glob) {
  return globRegExp(glob).test(path);
}

/** The text between the opening and closing `---` lines, or null when the body has no frontmatter. */
export function frontmatter(body) {
  const text = normalize(body);
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return text.endsWith('\n---') ? text.slice(4, -4) : undefined;
  return text.slice(4, end);
}

export function frontmatterScalar(block, key) {
  return block.match(new RegExp(`^${key}:[ \\t]*['"]?([^'"\\n]*?)['"]?[ \\t]*$`, 'm'))?.[1] ?? null;
}

/** Items of a YAML block list (`key:` then `  - item` lines); null when the key is absent. */
export function frontmatterList(block, key) {
  const lines = block.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*$`).test(line));
  if (start < 0) return null;
  const items = [];
  for (const line of lines.slice(start + 1)) {
    const item = line.match(/^\s+-\s+['"]?(.+?)['"]?\s*$/)?.[1];
    if (item) items.push(item);
    else if (line.trim() && !/^\s/.test(line)) break;
  }
  return items;
}

export const DOC_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** A repo-relative folder with forward slashes and no leading "./" or trailing "/" (Windows input reads the same). */
export const normalizeFolder = (value) => String(value).trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');

/**
 * A Markdown file directly under a `docs/` folder whose frontmatter has `id:` or `code:`; null for any other file.
 * `code` is the one folder the doc owns, normalized; null when the key is absent or empty.
 */
export function docOfRecord(path, body) {
  if (!/(?:^|\/)docs\/[^/]+\.md$/.test(path)) return null;
  const block = frontmatter(body);
  if (!block) return null;
  const id = frontmatterScalar(block, 'id');
  const rawCode = frontmatterScalar(block, 'code');
  if (id === null && rawCode === null) return null;
  const code = rawCode === null ? null : normalizeFolder(rawCode) || null;
  return { path, id, code, critical: frontmatterList(block, 'critical') ?? [] };
}

/** The doc whose `code:` folder holds `path` with the longest match, or null. A folder holds itself and what is below it. */
export function ownerDoc(path, docs) {
  let best = null;
  for (const doc of docs) {
    if (!doc.code || !(path === doc.code || path.startsWith(`${doc.code}/`))) continue;
    if (!best || doc.code.length > best.code.length) best = doc;
  }
  return best;
}

/** Every doc of record in `files` (repo-relative), read from `root`. */
export function docsOfRecord(root, files) {
  const out = [];
  for (const path of files) {
    if (!path.endsWith('.md')) continue;
    const absolute = join(root, path);
    if (!existsSync(absolute)) continue;
    const doc = docOfRecord(path, readFileSync(absolute, 'utf8'));
    if (doc) out.push(doc);
  }
  return out;
}
