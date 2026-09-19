import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), 'cross-agent-sdd.mjs');
const SKILL_ROOT = resolve(dirname(CLI), '..');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cross-agent-sdd-test-'));
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'Cross Agent SDD Test']);
  git(root, ['config', 'user.email', 'cross-agent-sdd@example.invalid']);
  writeFileSync(join(root, 'README.md'), '# Fixture\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'chore: initialize fixture']);
  return root;
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function tree(root) {
  const out = new Map();
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const name of readdirSync(current)) {
      if (name === '.git') continue;
      const path = join(current, name);
      if (statSync(path).isDirectory()) stack.push(path);
      else out.set(relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8'));
    }
  }
  return out;
}

test('skill metadata is discoverable and matches its directory', () => {
  const body = readFileSync(join(SKILL_ROOT, 'SKILL.md'), 'utf8');
  assert.match(body, /^---\r?\nname: cross-agent-sdd-skill\r?\n/);
  assert.match(body, /^description: .+$/m);
  assert.match(readFileSync(join(SKILL_ROOT, 'agents', 'openai.yaml'), 'utf8'), /\$cross-agent-sdd-skill/);
});

test('audit is read-only and reports a Git repository', () => {
  const root = fixture();
  const before = tree(root);
  const result = run(['audit', root, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.root, root);
  assert.equal(report.dirty, false);
  assert.deepEqual(tree(root), before);
});

test('apply is idempotent and generated repository verifies', () => {
  const root = fixture();
  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.ok(existsSync(join(root, 'AGENTS.md')));
  assert.ok(existsSync(join(root, '.agents', 'skills', 'spec-first', 'SKILL.md')));
  assert.ok(existsSync(join(root, '.claude', 'skills', 'spec-first', 'SKILL.md')));
  assert.ok(existsSync(join(root, '.cursor', 'rules', 'spec-first.mdc')));
  assert.ok(existsSync(join(root, 'scripts', 'check-sdd.mjs')));

  const verified = run(['verify', root]);
  assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`);

  const planned = run(['plan', root, '--json']);
  assert.equal(planned.status, 0, planned.stderr);
  const plan = JSON.parse(planned.stdout);
  assert.equal(plan.actions.filter((action) => action.action !== 'preserve').length, 0);
});

test('existing AGENTS.md requires explicit managed-block merge', () => {
  const root = fixture();
  writeFileSync(join(root, 'AGENTS.md'), '# Existing policy\n', 'utf8');
  git(root, ['add', 'AGENTS.md']);
  git(root, ['commit', '-m', 'docs: add existing agent policy']);

  const blocked = run(['apply', root, '--write']);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /cannot apply with conflicts: AGENTS\.md/);

  const merged = run(['apply', root, '--write', '--merge-agents']);
  assert.equal(merged.status, 0, merged.stderr);
  const body = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.match(body, /# Existing policy/);
  assert.match(body, /<!-- cross-agent-sdd:start -->/);
});

test('project install writes owned skill copies without a Cursor duplicate', () => {
  const root = fixture();
  const result = run(['install-skill', '--scope', 'project', '--repo', root, '--agents', 'all', '--write']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(root, '.agents', 'skills', 'cross-agent-sdd-skill', 'SKILL.md')));
  assert.ok(existsSync(join(root, '.claude', 'skills', 'cross-agent-sdd-skill', 'SKILL.md')));
  assert.equal(existsSync(join(root, '.cursor', 'skills', 'cross-agent-sdd-skill')), false);
});

test('config profile requires and validates repository-specific surface mapping', () => {
  const root = fixture();
  const source = join(root, 'src', 'config', 'local.json');
  const mirror = join(root, 'src', 'config', 'default.json');
  const reader = join(root, 'src', 'config', 'reader.ts');
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, '{"server":{"port":3000}}\n', { encoding: 'utf8', flag: 'wx' });
  writeFileSync(mirror, '{"server":{"port":8080}}\n', { encoding: 'utf8', flag: 'wx' });
  writeFileSync(reader, "export const port = config.server.port;\n", { encoding: 'utf8', flag: 'wx' });
  git(root, ['add', 'src']);
  git(root, ['commit', '-m', 'feat: add fixture config']);

  const applied = run(['apply', root, '--write', '--profiles', 'core,sdd,config']);
  assert.equal(applied.status, 0, applied.stderr);
  const incomplete = run(['verify', root]);
  assert.notEqual(incomplete.status, 0);
  assert.match(incomplete.stderr, /no configGroups/);

  const configPath = join(root, '.agent-sdd', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.configGroups = [
    {
      name: 'fixture',
      source: 'src/config/local.json',
      surfaces: [
        { path: 'src/config/default.json', mode: 'json' },
        { path: 'src/config/reader.ts', mode: 'text' },
      ],
    },
  ];
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  const complete = run(['verify', root]);
  assert.equal(complete.status, 0, `${complete.stdout}\n${complete.stderr}`);
});

test('staged runtime edit requires owning contract or concrete no-impact trailer', () => {
  const root = fixture();
  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: install cross-agent SDD']);

  const runtime = join(root, 'src', 'feature.js');
  mkdirSync(dirname(runtime), { recursive: true });
  writeFileSync(runtime, 'export const value = 1;\n', { encoding: 'utf8', flag: 'wx' });
  git(root, ['add', 'src/feature.js']);
  const messagePath = join(root, '.git', 'TEST_COMMIT_MSG');
  writeFileSync(messagePath, 'feat: add feature\n', 'utf8');
  const gate = join(root, 'scripts', 'check-sdd.mjs');
  let checked = spawnSync(process.execPath, [gate, '--staged', '--commit-msg', messagePath], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /runtime paths lack owning contract change/);

  writeFileSync(
    messagePath,
    'feat: add feature\n\nSpec-Impact: none - src/feature.js exports a fixture constant without observable runtime behavior\n',
    'utf8',
  );
  checked = spawnSync(process.execPath, [gate, '--staged', '--commit-msg', messagePath], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(checked.status, 0, checked.stderr);
});
