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
  return [...found].filter((path) => !path.includes('changes-log'));
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
    '(1) append an entry to changes-log.md at the repository root (create it if missing) that names the files, ' +
    'says what changed and why, and ends with "Spec impact: changed" or "Spec impact: none - <concrete reason>"; ' +
    '(2) if behavior changed, update the SPEC.md that owns these files and the test that proves it; ' +
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
