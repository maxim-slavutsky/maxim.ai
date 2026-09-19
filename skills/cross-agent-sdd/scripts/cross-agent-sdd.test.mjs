import assert from 'node:assert/strict';
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

test('asset templates never use harness-discoverable directory names', () => {
  const assetRoot = join(SKILL_ROOT, 'assets', 'repository');
  const names = readdirSync(assetRoot);
  for (const name of names) assert.doesNotMatch(name, /^\./, `asset dir ${name} would be loaded as a live harness dir`);
  assert.ok(existsSync(join(assetRoot, '_claude', 'rules', 'spec-first.md')));
  assert.ok(existsSync(join(assetRoot, '_agents', 'skills', 'spec-first', 'SKILL.md')));
});
