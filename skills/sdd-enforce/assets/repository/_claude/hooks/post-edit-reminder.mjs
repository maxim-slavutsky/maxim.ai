#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cursorOutput = process.argv.includes('--cursor');
const READ_ONLY_TOOL = /^(?:read|grep|glob|search|list|ls|shell|bash|task|web|fetch|mcp:)/i;

function repoPath(value) {
  const absolute = isAbsolute(value) ? value : resolve(ROOT, value);
  return relative(ROOT, absolute).replaceAll('\\', '/');
}

function editedPaths(input) {
  if (!input || typeof input !== 'object') return [];
  const found = new Set();
  for (const key of ['file_path', 'path', 'notebook_path', 'target_file', 'relative_workspace_path']) {
    if (typeof input[key] === 'string' && input[key]) found.add(repoPath(input[key]));
  }
  for (const value of Object.values(input)) {
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+?)\s*$/gm)) {
      found.add(repoPath(match[1]));
    }
    for (const match of value.matchAll(/^\*\*\* Move to: (.+?)\s*$/gm)) found.add(repoPath(match[1]));
  }
  return [...found];
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  if (typeof payload?.tool_name === 'string' && READ_ONLY_TOOL.test(payload.tool_name)) return;
  const paths = editedPaths(payload?.tool_input);
  if (!paths.length) return;
  const context =
    `You edited ${paths.join(', ')}. Before you finish this task: ` +
    '(1) if behavior, an interface or an invariant changed, update the doc of record whose code: folder holds ' +
    'these files, and the test that cites the invariant with @invariant <id>:V<n>; ' +
    '(2) if no owner doc changes, plan the commit trailer "Doc-Impact: none - <reason that names each file>"; ' +
    '(3) run "node scripts/check-sdd.mjs" and fix what it reports.';
  process.stdout.write(
    JSON.stringify(
      cursorOutput
        ? { additional_context: context }
        : { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } },
    ),
  );
}

main();
