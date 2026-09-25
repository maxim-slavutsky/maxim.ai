import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), 'cross-agent-sdd.mjs');
const SKILL_ROOT = resolve(dirname(CLI), '..');
const SKILL_NAME = 'cross-agent-sdd';
const fixtures = [];

after(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cross-agent-sdd-test-'));
  fixtures.push(root);
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'Cross Agent SDD Test']);
  git(root, ['config', 'user.email', 'cross-agent-sdd@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(root, 'README.md'), '# Fixture\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'chore: initialize fixture']);
  return root;
}

function installed() {
  const root = fixture();
  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: install cross-agent SDD']);
  return root;
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...options });
}

function gate(root, args = [], env = {}) {
  return spawnSync(process.execPath, [join(root, 'scripts', 'check-sdd.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CHANGE_TARGET: '',
      SDD_BASE_REF: '',
      GIT_PREVIOUS_COMMIT: '',
      GIT_PREVIOUS_SUCCESSFUL_COMMIT: '',
      ...env,
    },
  });
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

function runtimeCommit(root, name, message) {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', name), 'export const value = 1;\n', 'utf8');
  git(root, ['add', `src/${name}`]);
  git(root, ['commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

const NO_IMPACT = 'exports a fixture constant without observable runtime behavior';

test('skill metadata is discoverable and matches its directory', () => {
  const body = readFileSync(join(SKILL_ROOT, 'SKILL.md'), 'utf8');
  assert.match(body, new RegExp(`^---\\r?\\nname: ${SKILL_NAME}\\r?\\n`));
  assert.match(body, /^description: Use when .+$/m);
  assert.doesNotMatch(body, /^description: .*\b(?:audit|bootstrap|repair|upgrade)s?, /im);
  assert.match(readFileSync(join(SKILL_ROOT, 'agents', 'openai.yaml'), 'utf8'), new RegExp(`\\$${SKILL_NAME}\\b`));
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

test('audit counts tracked and untracked files but never gitignored ones', () => {
  const root = fixture();
  writeFileSync(join(root, '.gitignore'), 'samples/\n', 'utf8');
  mkdirSync(join(root, 'samples', 'demo', 'chart'), { recursive: true });
  writeFileSync(join(root, 'samples', 'demo', 'chart', 'Chart.yaml'), 'name: demo\n', 'utf8');
  mkdirSync(join(root, 'samples', 'demo', 'config'), { recursive: true });
  writeFileSync(join(root, 'samples', 'demo', 'config', 'app.json'), '{}\n', 'utf8');
  mkdirSync(join(root, 'apps', 'web', 'chart'), { recursive: true });
  writeFileSync(join(root, 'apps', 'web', 'chart', 'Chart.yaml'), 'name: web\n', 'utf8');
  const result = run(['audit', root, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.charts, ['apps/web/chart']);
  assert.equal(report.configFileCount, 0);
  assert.deepEqual(report.suggestedProfiles, ['core', 'sdd', 'helm']);
});

test('apply is idempotent, follows rule-vs-skill ownership, and verifies', () => {
  const root = fixture();
  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.ok(existsSync(join(root, 'AGENTS.md')));
  assert.ok(existsSync(join(root, 'scripts', 'check-sdd.mjs')));
  assert.ok(existsSync(join(root, 'scripts', 'gen-cursor-rules.mjs')));
  assert.ok(existsSync(join(root, '.agent-sdd', 'waivers.json')));
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.agent-sdd', 'waivers.json'), 'utf8')), []);

  // Path-scoped concern: Claude rule + Codex/Cursor skill, no Claude skill duplicate.
  assert.ok(existsSync(join(root, '.claude', 'rules', 'spec-first.md')));
  assert.ok(existsSync(join(root, '.agents', 'skills', 'spec-first', 'SKILL.md')));
  assert.equal(existsSync(join(root, '.claude', 'skills', 'spec-first')), false);
  assert.equal(existsSync(join(root, '.claude', 'skills', 'agent-parity')), false);
  // Invocable workflow: skill on both sides.
  assert.ok(existsSync(join(root, '.claude', 'skills', 'commit-changes', 'SKILL.md')));
  assert.ok(existsSync(join(root, '.agents', 'skills', 'commit-changes', 'SKILL.md')));
  // Codex metadata for every shared skill.
  for (const name of readdirSync(join(root, '.agents', 'skills'))) {
    assert.ok(existsSync(join(root, '.agents', 'skills', name, 'agents', 'openai.yaml')), `${name} openai.yaml`);
  }
  // Cursor rules are generated from Claude rules.
  const mdc = readFileSync(join(root, '.cursor', 'rules', 'spec-first.mdc'), 'utf8');
  assert.match(mdc, /GENERATED from \.claude\/rules\/spec-first\.md/);
  assert.doesNotMatch(mdc, /Claude/);

  const verified = run(['verify', root]);
  assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`);
  assert.match(verified.stdout, /verify: ok/);

  const planned = run(['plan', root, '--json']);
  assert.equal(planned.status, 0, planned.stderr);
  const plan = JSON.parse(planned.stdout);
  assert.deepEqual(
    plan.actions.filter((action) => action.action !== 'preserve'),
    [],
  );
});

test('gate rejects stale Cursor mirror after Claude rule edit [@spec cross-agent-sdd.gates:V2]', () => {
  const root = installed();
  const rule = join(root, '.claude', 'rules', 'spec-first.md');
  writeFileSync(rule, `${readFileSync(rule, 'utf8')}\nAdditional shared policy line.\n`, 'utf8');
  let checked = gate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /\.cursor\/rules\/spec-first\.mdc stale/);

  const generated = spawnSync(process.execPath, [join(root, 'scripts', 'gen-cursor-rules.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(generated.status, 0, generated.stderr);
  checked = gate(root);
  assert.equal(checked.status, 0, checked.stderr);

  writeFileSync(join(root, '.cursor', 'rules', 'stray.mdc'), '---\ndescription: stray\n---\n', 'utf8');
  checked = gate(root);
  assert.match(checked.stderr, /\.cursor\/rules\/stray\.mdc has no source rule/);
});

test('ledger parser reads header rows through next heading or EOF [@spec cross-agent-sdd.gates:V1]', () => {
  const root = installed();
  mkdirSync(join(root, 'src'), { recursive: true });
  const specPath = join(root, 'src', 'SPEC.md');
  const head = [
    '---',
    'id: fixture.ledger',
    '---',
    '',
    '# Fixture ledger',
    '',
    '## Invariants',
    '',
    'V1: Fixture remains stable.',
    '',
    '## Tasks',
    '',
    'id|status|task|cites',
    '---|---|---|---',
    '',
  ].join('\n');
  const bugs = ['## §B - bugs', '', 'id|date|cause|fix', '---|---|---|---', ''].join('\n');
  writeFileSync(specPath, `${head}\n${bugs}`, 'utf8');
  writeFileSync(join(root, 'README.md'), '# Fixture\n\n[Ledger contract](src/SPEC.md)\n', 'utf8');
  let checked = gate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /empty Tasks ledger/);
  assert.match(checked.stderr, /empty Bugs ledger/);
  assert.match(checked.stderr, /T1\|/);
  assert.match(checked.stderr, /docs\/agent-sdd\/FORMAT\.md/);

  writeFileSync(specPath, `${head}T1|todo|exercise multiline task ledger|V1\n\n${bugs}B1|2026-09-19|fixture cause|V1\n`, 'utf8');
  checked = gate(root);
  assert.equal(checked.status, 0, checked.stderr);
});

test('existing AGENTS.md requires explicit managed-block merge', () => {
  const root = fixture();
  writeFileSync(join(root, 'AGENTS.md'), '# Existing policy\n', 'utf8');
  git(root, ['add', 'AGENTS.md']);
  git(root, ['commit', '-m', 'docs: add existing agent policy']);

  const planned = run(['plan', root]);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /AGENTS\.md: this file already exists/);
  assert.match(planned.stdout, /re-run with --merge-agents/);
  assert.match(planned.stdout, /conflict = /);

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
  assert.ok(existsSync(join(root, '.agents', 'skills', SKILL_NAME, 'SKILL.md')));
  assert.ok(existsSync(join(root, '.claude', 'skills', SKILL_NAME, 'SKILL.md')));
  assert.equal(existsSync(join(root, '.cursor', 'skills', SKILL_NAME)), false);
});

test('config profile requires and validates repository-specific surface mapping', () => {
  const root = fixture();
  const source = join(root, 'src', 'config', 'local.json');
  const mirror = join(root, 'src', 'config', 'default.json');
  const reader = join(root, 'src', 'config', 'reader.ts');
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, '{"server":{"port":3000}}\n', { encoding: 'utf8', flag: 'wx' });
  writeFileSync(mirror, '{"server":{"port":8080}}\n', { encoding: 'utf8', flag: 'wx' });
  writeFileSync(reader, 'export const port = config.server.port;\n', { encoding: 'utf8', flag: 'wx' });
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
  const root = installed();
  const runtime = join(root, 'src', 'feature.js');
  mkdirSync(dirname(runtime), { recursive: true });
  writeFileSync(runtime, 'export const value = 1;\n', { encoding: 'utf8', flag: 'wx' });
  git(root, ['add', 'src/feature.js']);
  const messagePath = join(root, '.git', 'TEST_COMMIT_MSG');
  writeFileSync(messagePath, 'feat: add feature\n', 'utf8');
  let checked = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /runtime paths lack owning contract change/);

  writeFileSync(
    messagePath,
    'feat: add feature\n\nSpec-Impact: none - refactor only in src/feature.js with no behavior change at all\n',
    'utf8',
  );
  checked = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /generic/);

  writeFileSync(messagePath, `feat: add feature\n\nSpec-Impact: none - src/feature.js ${NO_IMPACT}\n`, 'utf8');
  checked = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.equal(checked.status, 0, checked.stderr);
});

test('--changed resolves origin/<CHANGE_TARGET> before falling back [@spec cross-agent-sdd.gates:V3]', () => {
  const root = installed();
  git(root, ['update-ref', 'refs/remotes/origin/develop', 'HEAD']);
  git(root, ['checkout', '-q', '-b', 'feature']);
  runtimeCommit(root, 'a.js', `feat: a\n\nSpec-Impact: none - src/a.js ${NO_IMPACT}`);

  let checked = gate(root, ['--changed'], { CHANGE_TARGET: 'develop' });
  assert.equal(checked.status, 0, checked.stderr);
  assert.doesNotMatch(checked.stderr, /cannot inspect/);

  checked = gate(root, ['--changed'], { CHANGE_TARGET: 'missing-branch' });
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /no resolvable base/);

  runtimeCommit(root, 'b.js', 'feat: b');
  checked = gate(root, ['--changed'], { CHANGE_TARGET: 'develop' });
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /src\/b\.js/);
  checked = gate(root, ['--changed'], { SDD_BASE_REF: 'HEAD^' });
  assert.notEqual(checked.status, 0);
  checked = gate(root, ['--changed', '--base', 'HEAD']);
  assert.equal(checked.status, 0, checked.stderr);
});

test('waivers skip a named commit in --changed mode only [@spec cross-agent-sdd.gates:V4]', () => {
  const root = installed();
  git(root, ['checkout', '-q', '-b', 'feature']);
  const sha = runtimeCommit(root, 'a.js', 'feat: a without trailer');
  let checked = gate(root, ['--changed', '--base', 'main']);
  assert.notEqual(checked.status, 0);

  const waivers = join(root, '.agent-sdd', 'waivers.json');
  writeFileSync(waivers, JSON.stringify([{ commit: sha, gates: ['spec-impact'], reason: 'too short' }]), 'utf8');
  checked = gate(root, ['--changed', '--base', 'main']);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /waivers\.json/);

  writeFileSync(
    waivers,
    JSON.stringify([
      {
        commit: sha,
        gates: ['spec-impact'],
        reason: 'Commit landed on the shared branch before the gate existed and rewriting shared history was declined.',
      },
    ]),
    'utf8',
  );
  checked = gate(root, ['--changed', '--base', 'main']);
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /waived/);

  writeFileSync(join(root, 'src', 'b.js'), 'export const value = 2;\n', 'utf8');
  git(root, ['add', 'src/b.js']);
  const messagePath = join(root, '.git', 'TEST_COMMIT_MSG');
  writeFileSync(messagePath, 'feat: b without trailer\n', 'utf8');
  checked = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /runtime paths lack owning contract change/);
});

test('shared skills need Codex metadata and two-way workflow links [@spec cross-agent-sdd.gates:V5]', () => {
  const root = installed();
  rmSync(join(root, '.agents', 'skills', 'commit-changes', 'agents'), { recursive: true });
  let checked = gate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /commit-changes lacks agents\/openai\.yaml/);
  git(root, ['checkout', '--', '.']);

  const workflow = join(root, 'docs', 'workflows', 'COMMIT-WORKFLOW.md');
  writeFileSync(workflow, readFileSync(workflow, 'utf8').replace(/^- \[Claude Code skill\].*\n/m, ''), 'utf8');
  checked = gate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /does not link back to \.claude\/skills\/commit-changes\/SKILL\.md/);
});

test('cursor hook must pass --cursor to the shared reminder', () => {
  const root = installed();
  const path = join(root, '.cursor', 'hooks.json');
  writeFileSync(path, readFileSync(path, 'utf8').replace(' --cursor', ''), 'utf8');
  const checked = gate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /--cursor/);
});

test('exclude entries with a slash skip a repo-relative path prefix', () => {
  const root = installed();
  mkdirSync(join(root, 'src', 'legacy'), { recursive: true });
  writeFileSync(join(root, 'src', 'legacy', 'SPEC.md'), '# no frontmatter\n', 'utf8');
  let checked = gate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /missing SPEC frontmatter: src\/legacy\/SPEC\.md/);

  const configPath = join(root, '.agent-sdd', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.exclude.push('src/legacy');
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  checked = gate(root);
  assert.equal(checked.status, 0, checked.stderr);
});

test('help, dry runs, and the applied summary explain themselves to a newcomer', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /dry run/i);
  assert.match(help.stdout, /Changes nothing/);
  assert.match(help.stdout, /audit <repo>.*\n.*plan <repo>/);

  const root = fixture();
  const dry = run(['apply', root]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /nothing was written/i);
  assert.match(dry.stdout, /--write/);
  assert.equal(existsSync(join(root, 'AGENTS.md')), false);

  const applied = run(['apply', root, '--write']);
  assert.match(applied.stdout, /Next steps:/);
  assert.match(applied.stdout, /node scripts\/check-sdd\.mjs/);
  assert.match(applied.stdout, /pre-commit/);
  assert.match(applied.stdout, /old plans, samples[^\n]*"exclude"/);

  const install = run(['install-skill', '--scope', 'project', '--repo', root]);
  assert.equal(install.status, 0, install.stderr);
  assert.match(install.stdout, /dry run/i);
  assert.match(install.stdout, /Add --write/);
  assert.doesNotMatch(install.stdout, /^\{/);
});

test('gate messages say what is wrong and how to fix it', () => {
  const root = installed();
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'SPEC.md'),
    '---\nid: fixture.core\ncritical:\n  - V1\n---\n\n# Core\n\n## Invariants\n\nV1: Fixture holds.\n',
    'utf8',
  );
  writeFileSync(join(root, 'README.md'), '# Fixture\n\n[core](src/SPEC.md) and [gone](docs/missing.md)\n', 'utf8');
  const checked = gate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /lacks executable evidence: fixture\.core:V1/);
  assert.match(checked.stderr, /@spec fixture\.core:V1/);
  assert.match(checked.stderr, /split it or remove it from "critical:"/);
  assert.match(checked.stderr, /README\.md links to "docs\/missing\.md" but that file does not exist/);

  writeFileSync(join(root, 'src', 'feature.js'), 'export const value = 1;\n', 'utf8');
  git(root, ['add', 'src/feature.js']);
  const messagePath = join(root, '.git', 'TEST_COMMIT_MSG');
  writeFileSync(messagePath, 'feat: add feature\n', 'utf8');
  const staged = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.match(staged.stderr, /Spec-Impact: none - </);
  assert.match(staged.stderr, /update the owner in the same commit/i);
});

test('post-edit reminder tells the agent what to do next in plain words', () => {
  const root = installed();
  const hook = join(root, 'scripts', 'hooks', 'post-edit-reminder.mjs');
  const result = spawnSync(process.execPath, [hook], {
    cwd: root,
    encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(root, 'src', 'a.js') } }),
  });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /You edited src\/a\.js/);
  assert.match(context, /changes-log\.md/);
  assert.match(context, /Spec impact: changed/);
  assert.match(context, /node scripts\/check-sdd\.mjs/);
});

function preExistingRepo() {
  const root = fixture();
  writeFileSync(join(root, 'AGENTS.md'), '# Acme notes\n\n- Deploy only through make deploy.\n', 'utf8');
  writeFileSync(join(root, 'CLAUDE.md'), '# Claude notes\n\nRun make lint first.\n', 'utf8');
  writeFileSync(join(root, '.gitignore'), 'node_modules\n.env\n', 'utf8');
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(
    join(root, '.claude', 'settings.json'),
    `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node scripts/guard.mjs' }] }] }, permissions: { deny: ['Bash(kubectl:*)'] } }, null, 2)}\n`,
    'utf8',
  );
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'SPEC.md'), '---\nid: acme.core\n---\n\n# Core\n\nV1: Fixture holds.\n', 'utf8');
  writeFileSync(join(root, 'README.md'), '# Fixture\n\n[core](src/SPEC.md)\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: pre-existing repository']);
  return root;
}

test('uninstall is a dry run by default and refuses --write without confirmation [@spec cross-agent-sdd.gates:V6]', () => {
  const root = installed();
  const before = tree(root);

  const dry = run(['uninstall', root]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /delete\s+scripts\/check-sdd\.mjs/);
  assert.match(dry.stdout, /nothing was changed/i);
  assert.match(dry.stdout, /--write/);
  assert.deepEqual(tree(root), before);

  const unconfirmed = run(['uninstall', root, '--write'], { input: '' });
  assert.notEqual(unconfirmed.status, 0);
  assert.match(unconfirmed.stderr, /confirmation/i);
  assert.match(unconfirmed.stderr, /--yes/);
  assert.deepEqual(tree(root), before);
});

test('uninstall --write --yes removes only what apply added and restores user files [@spec cross-agent-sdd.gates:V6]', () => {
  const root = preExistingRepo();
  const original = tree(root);
  const applied = run(['apply', root, '--write', '--merge-agents']);
  assert.equal(applied.status, 0, applied.stderr);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: install']);
  assert.ok(existsSync(join(root, '.agent-toolchain.json')));

  const removed = run(['uninstall', root, '--write', '--yes']);
  assert.equal(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
  assert.match(removed.stdout, /Uninstalled cross-agent-sdd/);
  assert.match(removed.stdout, /pre-commit/);

  const after = tree(root);
  assert.deepEqual([...after.keys()].sort(), [...original.keys()].sort());
  for (const [path, content] of original) {
    assert.equal(after.get(path).replaceAll('\r\n', '\n'), content.replaceAll('\r\n', '\n'), `${path} restored`);
  }
  for (const dir of ['.agents', '.codex', '.cursor', 'docs', 'scripts', '.agent-sdd', '.claude/rules', '.claude/skills']) {
    assert.equal(existsSync(join(root, dir)), false, `${dir} removed`);
  }
  assert.ok(existsSync(join(root, '.claude', 'settings.json')));
});

test('uninstall on a bare repository deletes files it created outright', () => {
  const root = installed();
  const removed = run(['uninstall', root, '--write', '--yes']);
  assert.equal(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
  assert.deepEqual([...tree(root).keys()], ['README.md']);
  assert.deepEqual(readdirSync(root).filter((name) => name !== '.git'), ['README.md']);
});

test('uninstall keeps a generated file that was edited unless --force is given', () => {
  const root = installed();
  const workflow = join(root, 'docs', 'workflows', 'COMMIT-WORKFLOW.md');
  writeFileSync(workflow, `${readFileSync(workflow, 'utf8')}\nLocal addition.\n`, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'docs: local tweak']);

  const kept = run(['uninstall', root, '--write', '--yes']);
  assert.equal(kept.status, 0, `${kept.stdout}\n${kept.stderr}`);
  assert.match(kept.stdout, /keep\s+docs\/workflows\/COMMIT-WORKFLOW\.md.*edited/);
  assert.ok(existsSync(workflow));
  assert.equal(existsSync(join(root, '.agent-toolchain.json')), false);
  assert.equal(existsSync(join(root, 'scripts', 'check-sdd.mjs')), false);

  const root2 = installed();
  const workflow2 = join(root2, 'docs', 'workflows', 'COMMIT-WORKFLOW.md');
  writeFileSync(workflow2, 'edited\n', 'utf8');
  git(root2, ['add', '.']);
  git(root2, ['commit', '-q', '-m', 'docs: local tweak']);
  const forced = run(['uninstall', root2, '--write', '--yes', '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(existsSync(workflow2), false);
});

test('uninstall-skill removes only installer-owned copies after confirmation', () => {
  const root = fixture();
  const install = run(['install-skill', '--scope', 'project', '--repo', root, '--agents', 'all', '--write']);
  assert.equal(install.status, 0, install.stderr);
  mkdirSync(join(root, '.claude', 'skills', 'mine'), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', 'mine', 'SKILL.md'), '---\nname: mine\n---\n', 'utf8');

  const dry = run(['uninstall-skill', '--scope', 'project', '--repo', root]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /dry run/i);
  assert.ok(existsSync(join(root, '.claude', 'skills', SKILL_NAME, 'SKILL.md')));

  const unconfirmed = run(['uninstall-skill', '--scope', 'project', '--repo', root, '--write'], { input: '' });
  assert.notEqual(unconfirmed.status, 0);
  assert.match(unconfirmed.stderr, /--yes/);

  const removed = run(['uninstall-skill', '--scope', 'project', '--repo', root, '--write', '--yes']);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(existsSync(join(root, '.claude', 'skills', SKILL_NAME)), false);
  assert.equal(existsSync(join(root, '.agents', 'skills', SKILL_NAME)), false);
  assert.ok(existsSync(join(root, '.claude', 'skills', 'mine', 'SKILL.md')));
});

test('asset templates never use harness-discoverable directory names', () => {
  const assetRoot = join(SKILL_ROOT, 'assets', 'repository');
  const names = readdirSync(assetRoot);
  for (const name of names) assert.doesNotMatch(name, /^\./, `asset dir ${name} would be loaded as a live harness dir`);
  assert.ok(existsSync(join(assetRoot, '_claude', 'rules', 'spec-first.md')));
  assert.ok(existsSync(join(assetRoot, '_agents', 'skills', 'spec-first', 'SKILL.md')));
});

test('uninstall removes only its own hook command and keeps a user hook beside it [@spec cross-agent-sdd.gates:V6]', () => {
  const root = installed();
  const path = join(root, '.claude', 'settings.json');
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  settings.hooks.PostToolUse[0].hooks.push({ type: 'command', command: 'node scripts/my-lint.mjs' });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: add my own hook beside the reminder']);

  const dry = run(['uninstall', root]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /edit\s+\.claude\/settings\.json/);

  const removed = run(['uninstall', root, '--write', '--yes']);
  assert.equal(removed.status, 0, removed.stderr);
  const after = JSON.parse(readFileSync(path, 'utf8'));
  const commands = after.hooks.PostToolUse.flatMap((entry) => entry.hooks.map((hook) => hook.command));
  assert.deepEqual(commands, ['node scripts/my-lint.mjs']);
});

test('uninstall keeps a file that existed with template content before install [@spec cross-agent-sdd.gates:V6]', () => {
  const root = fixture();
  const relPath = 'docs/workflows/SPEC-FIRST-WORKFLOW.md';
  const template = readFileSync(join(SKILL_ROOT, 'assets', 'repository', relPath), 'utf8');
  mkdirSync(join(root, 'docs', 'workflows'), { recursive: true });
  writeFileSync(join(root, relPath), template, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'docs: workflow already present']);

  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  const manifest = JSON.parse(readFileSync(join(root, '.agent-toolchain.json'), 'utf8'));
  assert.equal(manifest.managedFiles[relPath].mode, 'preserved');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: install cross-agent SDD']);

  const removed = run(['uninstall', root, '--write', '--yes']);
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(removed.stdout, /keep\s+docs\/workflows\/SPEC-FIRST-WORKFLOW\.md.*before install/);
  assert.equal(readFileSync(join(root, relPath), 'utf8'), template);

  // A file this tool created stays deletable after a second apply finds it unchanged.
  const root2 = installed();
  assert.equal(run(['apply', root2, '--write']).status, 0); // idempotent: nothing changes, tree stays clean
  const dry2 = run(['uninstall', root2]);
  assert.match(dry2.stdout, /delete\s+docs\/workflows\/SPEC-FIRST-WORKFLOW\.md/);
});

test('gate ignores the skill installed into the repository by install-skill --scope project [@spec cross-agent-sdd.gates:V9]', () => {
  const root = fixture();
  const install = run(['install-skill', '--scope', 'project', '--repo', root, '--agents', 'all', '--write']);
  assert.equal(install.status, 0, install.stderr);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: install skill into the repository']);
  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  const checked = gate(root);
  assert.equal(checked.status, 0, checked.stderr);
});

test('a hook config change needs every other enabled hook config, never itself [@spec cross-agent-sdd.gates:V8]', () => {
  const root = installed();
  const message = join(root, 'msg.txt');
  writeFileSync(message, 'chore: widen matcher\n', 'utf8');
  const widen = (relPath, from, to) => {
    const path = join(root, relPath);
    writeFileSync(path, readFileSync(path, 'utf8').replace(from, to), 'utf8');
    git(root, ['add', relPath]);
  };

  widen('.claude/settings.json', 'Edit|Write', 'Edit|Write|MultiEdit');
  let checked = gate(root, ['--staged', '--commit-msg', message]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /harness paths lack partner change: \.claude\/settings\.json/);

  widen('.codex/hooks.json', '"timeout": 5', '"timeout": 6');
  checked = gate(root, ['--staged', '--commit-msg', message]);
  assert.notEqual(checked.status, 0, 'two of three configs is still not parity');

  widen('.cursor/hooks.json', '"timeout": 5', '"timeout": 6');
  checked = gate(root, ['--staged', '--commit-msg', message]);
  assert.equal(checked.status, 0, checked.stderr);

  git(root, ['reset', '-q', '--hard']);
  const script = 'scripts/hooks/post-edit-reminder.mjs';
  writeFileSync(join(root, script), `${readFileSync(join(root, script), 'utf8')}\n// note\n`, 'utf8');
  git(root, ['add', script]);
  checked = gate(root, ['--staged', '--commit-msg', message]);
  assert.equal(checked.status, 0, `the hook script alone needs no partner: ${checked.stderr}`);
});

test('.claude/rules/INDEX.md is not a rule: no .cursor mirror, no Agent-Parity trailer [@spec cross-agent-sdd.gates:V2]', () => {
  const root = installed();
  const message = join(root, 'msg.txt');
  writeFileSync(message, 'docs: index the rules\n', 'utf8');
  const index = '.claude/rules/INDEX.md';
  writeFileSync(join(root, index), '# Rules\n\n- [spec-first](spec-first.md)\n', 'utf8');
  git(root, ['add', index]);

  let checked = gate(root);
  assert.equal(checked.status, 0, `static gate must not expect .cursor/rules/INDEX.mdc: ${checked.stderr}`);
  checked = gate(root, ['--staged', '--commit-msg', message]);
  assert.equal(checked.status, 0, `the index alone is not a one-sided harness edit: ${checked.stderr}`);

  // A real rule still needs its mirror in the same commit.
  const rule = '.claude/rules/spec-first.md';
  writeFileSync(join(root, rule), `${readFileSync(join(root, rule), 'utf8')}\n<!-- touched -->\n`, 'utf8');
  git(root, ['add', rule]);
  checked = gate(root, ['--staged', '--commit-msg', message]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /harness paths lack partner change: \.claude\/rules\/spec-first\.md/);
});

test('docs tell CI to run the per-commit gate, not only the static one', () => {
  const ciMentionsChanged = /\bCI\b[^\n]*--changed|--changed[^\n]*\bCI\b/;
  assert.match(readFileSync(join(SKILL_ROOT, 'references', 'configuration.md'), 'utf8'), ciMentionsChanged);
  assert.match(readFileSync(join(SKILL_ROOT, 'SKILL.md'), 'utf8'), ciMentionsChanged);
  assert.match(readFileSync(join(SKILL_ROOT, 'README.md'), 'utf8'), /static[^\n]*alone[^\n]*--changed|--changed[^\n]*static[^\n]*alone/i);
});

test('re-apply with fewer profiles keeps ownership of files still on disk [@spec cross-agent-sdd.gates:V7]', () => {
  const root = fixture();
  const full = run(['apply', root, '--write', '--profiles', 'core,sdd,helm']);
  assert.equal(full.status, 0, full.stderr);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: install with helm']);

  const shrunk = run(['apply', root, '--write', '--profiles', 'core,sdd']);
  assert.equal(shrunk.status, 0, shrunk.stderr);
  assert.match(shrunk.stdout, /no longer in the selected profiles[^\n]*HELM-VALIDATION-WORKFLOW\.md/);
  const manifest = JSON.parse(readFileSync(join(root, '.agent-toolchain.json'), 'utf8'));
  assert.ok(manifest.managedFiles['docs/workflows/HELM-VALIDATION-WORKFLOW.md'], 'record kept');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: drop helm profile']);

  const dry = run(['uninstall', root]);
  assert.match(dry.stdout, /delete\s+docs\/workflows\/HELM-VALIDATION-WORKFLOW\.md/);
});

test('apply skips a generated file you edited and upgrades the rest [@spec cross-agent-sdd.gates:V7]', () => {
  const root = installed();
  const manifestPath = join(root, '.agent-toolchain.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const originalGateSha = manifest.managedFiles['scripts/check-sdd.mjs'].sha256;

  const gatePath = join(root, 'scripts', 'check-sdd.mjs');
  writeFileSync(gatePath, `${readFileSync(gatePath, 'utf8')}\n// local tweak\n`, 'utf8');
  // Simulate an older installed version of one workflow: content and recorded hash agree, template differs.
  const workflowRel = 'docs/workflows/COMMIT-WORKFLOW.md';
  writeFileSync(join(root, workflowRel), 'old generated content\n', 'utf8');
  manifest.managedFiles[workflowRel].sha256 = createHash('sha256').update('old generated content\n').digest('hex');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: local gate tweak and stale workflow']);

  const planned = run(['plan', root]);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /keep\s+scripts\/check-sdd\.mjs/);
  assert.match(planned.stdout, /update-generated\s+docs\/workflows\/COMMIT-WORKFLOW\.md/);
  assert.match(planned.stdout, /No conflicts\. Apply can run\./);

  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /scripts\/check-sdd\.mjs[^\n]*edited/);
  assert.match(readFileSync(gatePath, 'utf8'), /local tweak/);
  const template = readFileSync(join(SKILL_ROOT, 'assets', 'repository', workflowRel), 'utf8');
  assert.equal(readFileSync(join(root, workflowRel), 'utf8'), template);

  const after = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(after.managedFiles['scripts/check-sdd.mjs'].sha256, originalGateSha, 'record keeps the install-time hash');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: upgrade']);
  const dry = run(['uninstall', root]);
  assert.match(dry.stdout, /keep\s+scripts\/check-sdd\.mjs.*edited/);
});

test('apply never upgrades a preserved file and verify does not police it [@spec cross-agent-sdd.gates:V7]', () => {
  const root = fixture();
  const relPath = 'docs/workflows/SPEC-FIRST-WORKFLOW.md';
  const template = readFileSync(join(SKILL_ROOT, 'assets', 'repository', relPath), 'utf8');
  mkdirSync(join(root, 'docs', 'workflows'), { recursive: true });
  writeFileSync(join(root, relPath), template, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'docs: workflow already present']);
  assert.equal(run(['apply', root, '--write']).status, 0);

  // Simulate a newer template: the preserved file and its record still agree, the template no longer does.
  const teamVersion = 'the team wrote this before the tool arrived\n';
  const manifestPath = join(root, '.agent-toolchain.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(join(root, relPath), teamVersion, 'utf8');
  manifest.managedFiles[relPath].sha256 = createHash('sha256').update(teamVersion).digest('hex');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: install']);

  const planned = run(['plan', root]);
  assert.match(planned.stdout, /keep\s+docs\/workflows\/SPEC-FIRST-WORKFLOW\.md/);
  assert.match(planned.stdout, /SPEC-FIRST-WORKFLOW\.md: existed[^\n]*before install/);
  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(readFileSync(join(root, relPath), 'utf8'), teamVersion);

  // Their file, their edits: verify does not report it as a tool file changed outside the installer.
  writeFileSync(join(root, relPath), 'edited again by the team\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'docs: team edit']);
  const verified = run(['verify', root]);
  assert.doesNotMatch(`${verified.stdout}${verified.stderr}`, /changed outside installer: docs\/workflows\/SPEC-FIRST-WORKFLOW\.md/);
});

test('apply --replace takes the tool version back with the documented pre-commit hook installed', () => {
  const root = installed();
  // The documented pre-commit hook: the gate runs before every commit, so the file must never be missing.
  writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nnode scripts/check-sdd.mjs\n', { encoding: 'utf8', mode: 0o755 });
  const gatePath = join(root, 'scripts', 'check-sdd.mjs');
  const template = readFileSync(join(SKILL_ROOT, 'assets', 'repository', 'scripts', 'check-sdd.mjs'), 'utf8');
  writeFileSync(gatePath, `${readFileSync(gatePath, 'utf8')}\n// local tweak\n`, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: customize gate']);

  const verified = run(['verify', root]);
  assert.notEqual(verified.status, 0);
  const output = `${verified.stdout}${verified.stderr}`;
  assert.match(output, /changed outside installer: scripts\/check-sdd\.mjs/);
  assert.match(output, /apply <repo> --write --replace scripts\/check-sdd\.mjs/);
  assert.doesNotMatch(output, /git rm|git checkout/);

  // Proof the hook is live: a commit without the gate file fails, so "delete, commit, apply" is no procedure.
  git(root, ['rm', '-q', 'scripts/check-sdd.mjs']);
  assert.throws(() => git(root, ['commit', '-m', 'chore: drop gate']), /Cannot find module|MODULE_NOT_FOUND/);
  git(root, ['reset', '-q', '--hard']);

  const applied = run(['apply', root, '--write', '--replace', 'scripts/check-sdd.mjs']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /update-generated\s+scripts\/check-sdd\.mjs/);
  assert.equal(readFileSync(gatePath, 'utf8'), template);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: take the tool gate back']); // hook runs the restored gate
  const again = run(['verify', root]);
  assert.equal(again.status, 0, `${again.stdout}${again.stderr}`);

  const unknown = run(['apply', root, '--write', '--replace', 'src/app.ts']);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /--replace src\/app\.ts/);
});

test('a workflow back-link to the Claude rule covers its generated Cursor mirror [@spec cross-agent-sdd.gates:V5]', () => {
  const root = installed();
  const workflow = join(root, 'docs', 'workflows', 'SPEC-FIRST-WORKFLOW.md');
  const withoutMirrorLink = readFileSync(workflow, 'utf8').replace(/^- \[Cursor rule\]\(\.\.\/\.\.\/\.cursor\/rules\/spec-first\.mdc\)[^\n]*\r?\n/m, '');
  assert.notEqual(withoutMirrorLink, readFileSync(workflow, 'utf8'), 'fixture must drop the .mdc link');
  writeFileSync(workflow, withoutMirrorLink, 'utf8');
  let checked = gate(root);
  assert.equal(checked.status, 0, checked.stderr);

  // Without the rule link either, the gate names the source rule, not only the mirror.
  writeFileSync(workflow, withoutMirrorLink.replace(/^- \[Claude Code rule\]\(\.\.\/\.\.\/\.claude\/rules\/spec-first\.md\)[^\n]*\r?\n/m, ''), 'utf8');
  checked = gate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /does not link back to \.claude\/rules\/spec-first\.md/);
});

test('adopting a preserved file makes it tool-owned, by --replace or by delete and re-apply [@spec cross-agent-sdd.gates:V7]', () => {
  const relPath = 'docs/workflows/SPEC-FIRST-WORKFLOW.md';
  const template = readFileSync(join(SKILL_ROOT, 'assets', 'repository', relPath), 'utf8');
  const preserved = () => {
    const root = fixture();
    mkdirSync(join(root, 'docs', 'workflows'), { recursive: true });
    writeFileSync(join(root, relPath), template, 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'docs: workflow already present']);
    assert.equal(run(['apply', root, '--write']).status, 0);
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'chore: install']);
    assert.equal(JSON.parse(readFileSync(join(root, '.agent-toolchain.json'), 'utf8')).managedFiles[relPath].mode, 'preserved');
    return root;
  };
  const mode = (root) => JSON.parse(readFileSync(join(root, '.agent-toolchain.json'), 'utf8')).managedFiles[relPath].mode;

  const byReplace = preserved();
  const replaced = run(['apply', byReplace, '--write', '--replace', relPath]);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(mode(byReplace), 'created');
  git(byReplace, ['add', '.']);
  git(byReplace, ['commit', '-m', 'chore: adopt']);
  assert.match(run(['uninstall', byReplace]).stdout, /delete\s+docs\/workflows\/SPEC-FIRST-WORKFLOW\.md/);

  const byDelete = preserved();
  git(byDelete, ['rm', '-q', relPath]);
  git(byDelete, ['commit', '-m', 'chore: drop the old copy']);
  assert.equal(run(['apply', byDelete, '--write']).status, 0);
  assert.equal(mode(byDelete), 'created');
});

test('a Spec-Impact reason may fold over continuation lines, like a Git trailer [@spec cross-agent-sdd.gates:V10]', () => {
  const root = installed();
  const message = join(root, 'msg.txt');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'folded.js'), 'export const value = 1;\n', 'utf8');
  git(root, ['add', 'src/folded.js']);

  // Folded: the continuation line starts with whitespace and carries the file name the gate needs.
  writeFileSync(
    message,
    'feat: fold\n\nSpec-Impact: none - exports a fixture constant without observable runtime behavior,\n src/folded.js is the only path and stays a constant\n',
    'utf8',
  );
  let checked = gate(root, ['--staged', '--commit-msg', message]);
  assert.equal(checked.status, 0, `folded reason must be joined: ${checked.stderr}`);

  // Not folded: a following line without leading whitespace is a new paragraph, not part of the reason.
  writeFileSync(
    message,
    'feat: fold\n\nSpec-Impact: none - exports a fixture constant without observable runtime behavior,\nsrc/folded.js is the only path and stays a constant\n',
    'utf8',
  );
  checked = gate(root, ['--staged', '--commit-msg', message]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /does not name src\/folded\.js/);
});

test('check-docs demands AGENTS.md per workspace, SPEC.md per module, the SPEC link, and the workflow import [@spec cross-agent-sdd.gates:V11]', () => {
  const root = fixture();
  mkdirSync(join(root, 'apps', 'api', 'src', 'modules', 'auth'), { recursive: true });
  writeFileSync(join(root, 'apps', 'api', 'package.json'), '{ "name": "api" }\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: workspace layout']);
  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  const config = JSON.parse(readFileSync(join(root, '.agent-sdd', 'config.json'), 'utf8'));
  assert.deepEqual(config.moduleRoots, ['apps/*/src/modules'], 'module roots detected from the workspace layout');

  const docs = (args = []) => spawnSync(process.execPath, [join(root, 'scripts', 'check-docs.mjs'), ...args], { cwd: root, encoding: 'utf8' });
  let checked = docs();
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /missing AGENTS\.md: apps\/api/);
  assert.match(checked.stderr, /missing SPEC\.md: apps\/api\/src\/modules\/auth/);

  writeFileSync(join(root, 'apps', 'api', 'AGENTS.md'), '# api\n', 'utf8');
  writeFileSync(join(root, 'apps', 'api', 'src', 'modules', 'auth', 'SPEC.md'), '---\nid: api.auth\n---\n\n# auth\n\n## §G\n\nlogin\n', 'utf8');
  checked = docs();
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /apps\/api\/AGENTS\.md does not link apps\/api\/src\/modules\/auth\/SPEC\.md/);

  writeFileSync(join(root, 'apps', 'api', 'AGENTS.md'), '# api\n\n| Module | Spec |\n|---|---|\n| auth | [auth/SPEC.md](src/modules/auth/SPEC.md) |\n', 'utf8');
  checked = docs();
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /check-docs: ok/);

  // The root AGENTS.md import is what keeps the working rules in context; dropping it is a gate failure.
  const agentsPath = join(root, 'AGENTS.md');
  const agents = readFileSync(agentsPath, 'utf8');
  assert.match(agents, /^@\.\/docs\/workflows\/SPEC-FIRST-WORKFLOW\.md$/m);
  writeFileSync(agentsPath, agents.replace(/^@\.\/docs\/workflows\/SPEC-FIRST-WORKFLOW\.md$/m, ''), 'utf8');
  checked = docs();
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /no longer imports the working rules/);
  writeFileSync(agentsPath, agents, 'utf8');

  // verify runs check-docs too, so a missing module SPEC fails verify.
  writeFileSync(join(root, 'AGENTS.md'), `${agents}\n- [api](apps/api/AGENTS.md)\n`, 'utf8');
  rmSync(join(root, 'apps', 'api', 'src', 'modules', 'auth', 'SPEC.md'));
  writeFileSync(join(root, 'apps', 'api', 'AGENTS.md'), '# api\n', 'utf8');
  const verified = run(['verify', root]);
  assert.notEqual(verified.status, 0);
  assert.match(verified.stderr, /scripts\/check-docs\.mjs\) reported problems/);
});

test('both gates skip Claude Code worktrees nested inside the checkout [@spec cross-agent-sdd.gates:V12]', () => {
  const root = installed();
  const spec = '---\nid: acme.core\n---\n\n# Core\n\nV1: Fixture holds.\n';
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'SPEC.md'), spec, 'utf8');
  writeFileSync(join(root, 'README.md'), '# Fixture\n\n[core](src/SPEC.md)\n', 'utf8');
  // A worktree is a full copy of the repository: the same SPEC id again, and a broken link.
  mkdirSync(join(root, '.claude', 'worktrees', 'feature-x', 'src'), { recursive: true });
  writeFileSync(join(root, '.claude', 'worktrees', 'feature-x', 'src', 'SPEC.md'), spec, 'utf8');
  writeFileSync(join(root, '.claude', 'worktrees', 'feature-x', 'README.md'), '[gone](missing.md)\n', 'utf8');
  mkdirSync(join(root, '.claude', 'worktrees', 'feature-x', 'apps', 'api', 'src', 'modules', 'auth'), { recursive: true });
  writeFileSync(join(root, '.claude', 'worktrees', 'feature-x', 'apps', 'api', 'package.json'), '{}\n', 'utf8');

  const checked = gate(root);
  assert.equal(checked.status, 0, `duplicate id inside a worktree must be ignored: ${checked.stderr}`);
  const docs = spawnSync(process.execPath, [join(root, 'scripts', 'check-docs.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(docs.status, 0, docs.stderr);
});

test('an edited managed AGENTS block is kept by upgrades until --replace AGENTS.md [@spec cross-agent-sdd.gates:V13]', () => {
  const root = installed();
  const agentsPath = join(root, 'AGENTS.md');
  const edited = readFileSync(agentsPath, 'utf8').replace(
    '<!-- cross-agent-sdd:end -->',
    '## Team notes\n\nDeploy through make deploy.\n<!-- cross-agent-sdd:end -->',
  );
  writeFileSync(agentsPath, edited, 'utf8');
  git(root, ['add', 'AGENTS.md']);
  git(root, ['commit', '-q', '-m', 'docs: notes inside the managed block']);

  const planned = run(['plan', root]);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /keep\s+AGENTS\.md/);
  assert.match(planned.stdout, /AGENTS\.md: the text between the [^\n]*edited after install/);
  assert.match(planned.stdout, /No conflicts\. Apply can run\./);

  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(readFileSync(agentsPath, 'utf8'), /Deploy through make deploy/);

  const replaced = run(['apply', root, '--write', '--replace', 'AGENTS.md', '--allow-dirty']);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.match(replaced.stdout, /update\s+AGENTS\.md/);
  assert.doesNotMatch(readFileSync(agentsPath, 'utf8'), /Deploy through make deploy/);
  const verified = run(['verify', root]);
  assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`);
});

test('the rules index is generated from the shipped rules and stays out of parity checks [@spec cross-agent-sdd.gates:V14]', () => {
  const root = installed();
  const index = readFileSync(join(root, '.claude', 'rules', 'INDEX.md'), 'utf8');
  for (const name of readdirSync(join(root, '.claude', 'rules'))) {
    if (name === 'INDEX.md') continue;
    const escaped = name.replace('.', '\\.');
    assert.match(index, new RegExp(`\\[${escaped}\\]\\(${escaped}\\)`), `${name} listed`);
  }
  assert.match(index, /finishing-branch-commit-order\.md[^\n]*no glob: loads for every task/);
  assert.equal(existsSync(join(root, '.cursor', 'rules', 'INDEX.mdc')), false);
  assert.ok(existsSync(join(root, '.cursor', 'rules', 'finishing-branch-commit-order.mdc')));
  const manifest = JSON.parse(readFileSync(join(root, '.agent-toolchain.json'), 'utf8'));
  assert.equal(manifest.managedFiles['.claude/rules/INDEX.md'].kind, 'generated');
  const checked = gate(root);
  assert.equal(checked.status, 0, checked.stderr);
});
