import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), 'sdd-enforce.mjs');
const SKILL_ROOT = resolve(dirname(CLI), '..');
const SKILL_NAME = 'sdd-enforce';
const fixtures = [];

after(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A repository with one runtime file, so the doc-of-record rule has a folder to govern. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sdd-enforce-test-'));
  fixtures.push(root);
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'SDD Enforce Test']);
  git(root, ['config', 'user.email', 'sdd-enforce@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(root, 'README.md'), '# Fixture\n', 'utf8');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'index.js'), 'export const index = 0;\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: initialize fixture']);
  return root;
}

function installed() {
  const root = fixture();
  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: install sdd-enforce']);
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

function docsGate(root) {
  return spawnSync(process.execPath, [join(root, 'scripts', 'check-docs.mjs')], { cwd: root, encoding: 'utf8' });
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

/** Adds a link line to a Markdown file (created with `heading`) unless it links `target` already. */
function addLink(root, file, target, label, heading) {
  const path = join(root, file);
  const body = existsSync(path) ? readFileSync(path, 'utf8') : `${heading}\n`;
  if (!body.includes(`](${target})`)) writeFileSync(path, `${body.trimEnd()}\n\n- [${label}](${target})\n`, 'utf8');
}

/** A doc of record at `relPath`, listed in its docs/README.md index, which the root AGENTS.md links. */
function writeDoc(root, relPath, { id, code = 'src', critical = [], body = '## Goal\n\nThe fixture exists.\n' }) {
  const lines = ['---', `id: ${id}`];
  if (code !== null) lines.push(`code: ${code}`);
  if (critical.length) lines.push('critical:', ...critical.map((item) => `  - ${item}`));
  lines.push('---', '', `# ${id}`, '', body);
  mkdirSync(dirname(join(root, relPath)), { recursive: true });
  writeFileSync(join(root, relPath), lines.join('\n'), 'utf8');
  const index = `${dirname(relPath)}/README.md`;
  addLink(root, index, relPath.slice(dirname(relPath).length + 1), id, '# Docs of record');
  addLink(root, 'AGENTS.md', index, 'docs of record', '# Fixture agents');
}

const NO_IMPACT = 'exports a fixture constant without observable runtime behavior';
const POINTER = 'Before you edit code, read every doc of record that covers it: [doc of record](docs/doc-of-record.md).';
const LEGACY_IMPORT = '@./docs/workflows/SPEC-FIRST-WORKFLOW.md';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** A repository as cross-agent-sdd 0.4.0 left it: a managed AGENTS.md block and a generated rules index. */
function legacyInstalled({ editBlock = false, editIndex = false } = {}) {
  const root = installed();
  const block = [
    '<!-- cross-agent-sdd:start -->',
    '## Specification-driven development',
    '',
    'Reading order before maintained-code edits: nearest SPEC.md first.',
    '',
    LEGACY_IMPORT,
    '<!-- cross-agent-sdd:end -->',
  ].join('\n');
  const index = '# Project rules\n\n| Rule | Scope |\n|---|---|\n| [doc-of-record.md](doc-of-record.md) | `src/**` |\n';
  writeFileSync(join(root, 'AGENTS.md'), `# Repository agent instructions\n\n## Team notes\n\nDeploy through make deploy.\n\n${block}\n`, 'utf8');
  writeFileSync(join(root, '.claude', 'rules', 'INDEX.md'), index, 'utf8');
  const manifestPath = join(root, '.agent-toolchain.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.generator.version = '0.4.0';
  manifest.managedFiles['AGENTS.md'] = { kind: 'managed-block', mode: 'created', sha256: sha256(block) };
  manifest.managedFiles['.claude/rules/INDEX.md'] = { kind: 'generated', mode: 'created', sha256: sha256(index) };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (editBlock) {
    const agentsPath = join(root, 'AGENTS.md');
    writeFileSync(agentsPath, readFileSync(agentsPath, 'utf8').replace('<!-- cross-agent-sdd:end -->', '## Local\n\nKeep me.\n<!-- cross-agent-sdd:end -->'), 'utf8');
  }
  if (editIndex) writeFileSync(join(root, '.claude', 'rules', 'INDEX.md'), `${index}| [team.md](doc-of-record.md) | \`lib/**\` |\n`, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: state left by cross-agent-sdd 0.4.0']);
  return root;
}

/** Files only a 0.6.0 install generated: path -> content. */
const LEGACY_06_FILES = {
  'docs/workflows/SPEC-FIRST-WORKFLOW.md': '# SPEC-first workflow\n',
  'docs/workflows/COMMIT-WORKFLOW.md': '# Commit workflow\n',
  'docs/agent-sdd/FORMAT.md': '# Agent documentation format\n',
  'scripts/hooks/post-edit-reminder.mjs': '// reminder before 1.0.0\n',
  '.claude/rules/spec-first.md': '---\ndescription: old\npaths:\n  - "src/**"\n---\n\n# SPEC-first\n',
  '.cursor/rules/spec-first.mdc': '---\ndescription: old\n---\n',
  '.claude/rules/finishing-branch-commit-order.md': '---\ndescription: old\n---\n\n# Flush the log\n',
  '.claude/skills/commit-changes/SKILL.md': '---\nname: commit-changes\ndescription: old\n---\n',
  '.agents/skills/commit-changes/SKILL.md': '---\nname: commit-changes\ndescription: old\n---\n',
  '.agents/skills/commit-changes/agents/openai.yaml': 'interface:\n  display_name: "Commit changes"\n',
};

/** A repository as sdd-enforce 0.6.0 left it: workflow docs, a CLAUDE.md import, a .gitignore block, old hook path. */
function legacy06Installed({ editCommitWorkflow = false } = {}) {
  const root = installed();
  const manifestPath = join(root, '.agent-toolchain.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.generator.version = '0.6.0';
  for (const [path, content] of Object.entries(LEGACY_06_FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content, 'utf8');
    manifest.managedFiles[path] = { kind: 'generated', mode: 'created', sha256: sha256(content) };
  }
  if (editCommitWorkflow) writeFileSync(join(root, 'docs/workflows/COMMIT-WORKFLOW.md'), '# Commit workflow\n\nOur filter table.\n', 'utf8');
  writeFileSync(join(root, 'CLAUDE.md'), '@AGENTS.md\n', 'utf8');
  manifest.managedFiles['CLAUDE.md'] = { kind: 'merged', mode: 'created' };
  writeFileSync(join(root, '.gitignore'), '# cross-agent-sdd:start\nchanges-log.md\n# cross-agent-sdd:end\n', 'utf8');
  manifest.managedFiles['.gitignore'] = { kind: 'merged', mode: 'created' };
  writeFileSync(join(root, 'AGENTS.md'), `# Repository agent instructions\n\n${LEGACY_IMPORT}\n`, 'utf8');
  manifest.managedFiles['AGENTS.md'] = { kind: 'managed-line', mode: 'created' };
  for (const path of ['.claude/settings.json', '.codex/hooks.json', '.cursor/hooks.json']) {
    const body = readFileSync(join(root, path), 'utf8').replaceAll('.claude/hooks/post-edit-reminder.mjs', 'scripts/hooks/post-edit-reminder.mjs').replaceAll('.claude\\\\hooks\\\\', 'scripts\\\\hooks\\\\');
    writeFileSync(join(root, path), body, 'utf8');
  }
  rmSync(join(root, 'docs', 'map.md'));
  delete manifest.managedFiles['docs/map.md'];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'chore: state left by sdd-enforce 0.6.0']);
  return root;
}

test('skill metadata is discoverable and matches its directory', () => {
  const body = readFileSync(join(SKILL_ROOT, 'SKILL.md'), 'utf8');
  assert.match(body, new RegExp(`^---\\r?\\nname: ${SKILL_NAME}\\r?\\n`));
  assert.match(body, /^description: Use when .+$/m);
  assert.doesNotMatch(body, /^description: .*\b(?:audit|bootstrap|repair|upgrade)s?, /im);
  assert.match(readFileSync(join(SKILL_ROOT, 'agents', 'openai.yaml'), 'utf8'), new RegExp(`\\$${SKILL_NAME}\\b`));
});

test('run with no arguments, the skill offers a menu of audit, apply, verify, and remove', () => {
  const body = readFileSync(join(SKILL_ROOT, 'SKILL.md'), 'utf8');
  assert.match(body, /^argument-hint: "\[audit \| apply \| verify \| remove\] \[repo path\]"$/m);
  assert.match(body, /^Arguments: `\$ARGUMENTS`$/m);
  const options = [...body.matchAll(/^\s*\| (Audit \(Recommended\)|Apply SDD|Verify|Remove) \|/gm)].map((match) => match[1]);
  assert.deepEqual(options, ['Audit (Recommended)', 'Apply SDD', 'Verify', 'Remove']);
  assert.ok(body.split('\n').length < 500);
});

test('audit is read-only and reports a Git repository', () => {
  const root = fixture();
  const before = tree(root);
  const result = run(['audit', root, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.root, root);
  assert.equal(report.dirty, false);
  assert.deepEqual(report.legacy, []);
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

test('audit lists every old-format item an agent moves by hand [@invariant sdd-enforce.gates:V15]', () => {
  const root = fixture();
  writeFileSync(join(root, 'src', 'SPEC.md'), '---\nid: fixture.core\n---\n\n## §G\n\nfixture\n', 'utf8');
  writeFileSync(join(root, 'CLAUDE.md'), '@AGENTS.md\n', 'utf8');
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'STYLING_GUIDE.md'), '# Styling\n', 'utf8');
  writeFileSync(join(root, 'src', 'core.test.js'), "test('holds [@spec fixture.core:V1]', () => {});\n", 'utf8');
  const result = run(['audit', root]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Old-format items \(4\)/);
  assert.match(result.stdout, /src\/SPEC\.md: move to <workspace>\/docs\/<module>\.md/);
  assert.match(result.stdout, /CLAUDE\.md: move each line/);
  assert.match(result.stdout, /docs\/STYLING_GUIDE\.md: git mv to a kebab-case name/);
  assert.match(result.stdout, /src\/core\.test\.js: rewrite 1 "@spec <id>:V<n>" citation/);
});

test('apply is idempotent, follows rule-vs-skill ownership, and verifies', () => {
  const root = fixture();
  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.ok(existsSync(join(root, 'AGENTS.md')));
  assert.ok(existsSync(join(root, 'scripts', 'check-sdd.mjs')));
  assert.ok(existsSync(join(root, 'scripts', 'sdd-lib.mjs')));
  assert.ok(existsSync(join(root, 'scripts', 'gen-cursor-rules.mjs')));
  assert.ok(existsSync(join(root, '.claude', 'hooks', 'post-edit-reminder.mjs')));
  assert.ok(existsSync(join(root, 'docs', 'map.md')));
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.agent-sdd', 'waivers.json'), 'utf8')), []);
  // The docs standard: no CLAUDE.md, no changes-log rule, kebab-case concern docs.
  assert.equal(existsSync(join(root, 'CLAUDE.md')), false);
  assert.equal(existsSync(join(root, '.gitignore')), false);
  assert.equal(existsSync(join(root, 'docs', 'workflows')), false);

  // Path-scoped concern: Claude rule + Codex/Cursor adapter, no Claude skill duplicate.
  assert.ok(existsSync(join(root, '.claude', 'rules', 'doc-of-record.md')));
  assert.ok(existsSync(join(root, '.agents', 'skills', 'doc-of-record', 'SKILL.md')));
  assert.equal(existsSync(join(root, '.claude', 'skills', 'doc-of-record')), false);
  assert.equal(existsSync(join(root, '.claude', 'skills', 'agent-parity')), false);
  assert.match(readFileSync(join(root, '.claude', 'rules', 'doc-of-record.md'), 'utf8'), /paths:\n  - "src\/\*\*"\n/);
  // Procedure: Claude skill + twin that links it.
  assert.ok(existsSync(join(root, '.claude', 'skills', 'committing-changes', 'SKILL.md')));
  assert.match(readFileSync(join(root, '.agents', 'skills', 'committing-changes', 'SKILL.md'), 'utf8'), /\.claude\/skills\/committing-changes\/SKILL\.md/);
  for (const name of readdirSync(join(root, '.agents', 'skills'))) {
    assert.ok(existsSync(join(root, '.agents', 'skills', name, 'agents', 'openai.yaml')), `${name} openai.yaml`);
  }
  // Cursor rules are generated from Claude rules.
  const mdc = readFileSync(join(root, '.cursor', 'rules', 'doc-of-record.mdc'), 'utf8');
  assert.match(mdc, /GENERATED from \.claude\/rules\/doc-of-record\.md/);
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

test('a rule keeps only the globs that match a file, and a rule with none is not written [@invariant sdd-enforce.gates:V17]', () => {
  const root = fixture();
  git(root, ['rm', '-q', 'src/index.js']);
  git(root, ['commit', '-q', '-m', 'chore: no code yet']);
  const applied = run(['apply', root, '--write', '--agents', 'claude']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /Not written:\n {2}- \.claude\/rules\/doc-of-record\.md: no file matches its paths \(src\/\*\*\)/);
  assert.equal(existsSync(join(root, '.claude', 'rules', 'doc-of-record.md')), false);
  assert.equal(existsSync(join(root, '.agents', 'skills', 'doc-of-record')), false);
  assert.doesNotMatch(readFileSync(join(root, 'docs', 'doc-of-record.md'), 'utf8'), /\.claude\/rules\/doc-of-record\.md/);
  // Codex is off, so the agent-parity rule drops ".codex/**" and keeps the globs that match a file.
  const parity = readFileSync(join(root, '.claude', 'rules', 'agent-parity.md'), 'utf8');
  assert.match(parity, /paths:\n {2}- "\.claude\/\*\*"\n {2}- "\.cursor\/\*\*"\n {2}- "\.agents\/\*\*"\n---/);
  assert.equal(docsGate(root).status, 0, docsGate(root).stderr);
  const checked = gate(root);
  assert.equal(checked.status, 0, checked.stderr);
});

test('gate rejects stale Cursor mirror after Claude rule edit [@invariant sdd-enforce.gates:V2]', () => {
  const root = installed();
  const rule = join(root, '.claude', 'rules', 'doc-of-record.md');
  writeFileSync(rule, `${readFileSync(rule, 'utf8')}\n- **Additional shared policy line**, for the test.\n`, 'utf8');
  let checked = gate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /\.cursor\/rules\/doc-of-record\.mdc stale/);

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

test('a doc of record needs id and one live code: folder inside its workspace [@invariant sdd-enforce.gates:V1]', () => {
  const root = installed();
  writeDoc(root, 'docs/core.md', { id: 'fixture.core', body: '## Invariants\n\nV1: Fixture remains stable.\n\n## Tasks\n\nT1|.|later|V1\n' });
  let checked = gate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /docs\/core\.md: "## Tasks" does not belong in a doc of record/);

  writeDoc(root, 'docs/core.md', { id: 'fixture.core', code: null, body: '## Invariants\n\nV1: Fixture remains stable.\n\n## §B bugs\n' });
  checked = gate(root);
  assert.match(checked.stderr, /docs\/core\.md has no "code:" folder/);
  assert.match(checked.stderr, /"## §B bugs" does not belong/);

  writeDoc(root, 'docs/core.md', { id: 'fixture.core', code: 'lib', body: '## Invariants\n\nV1: Fixture remains stable.\n' });
  checked = gate(root);
  assert.match(checked.stderr, /docs\/core\.md: the "code:" folder "lib" does not exist/);

  // A backslash and a trailing slash are Windows habits; the gate reads the same folder.
  writeDoc(root, 'docs/core.md', { id: 'fixture.core', code: 'src\\', body: '## Invariants\n\nV1: Fixture remains stable.\n' });
  checked = gate(root);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(docsGate(root).status, 0, docsGate(root).stderr);

  // CRLF line endings in the frontmatter read the same.
  const corePath = join(root, 'docs', 'core.md');
  writeFileSync(corePath, readFileSync(corePath, 'utf8').replaceAll('\n', '\r\n'), 'utf8');
  checked = gate(root);
  assert.equal(checked.status, 0, checked.stderr);

  // One folder has one doc.
  writeDoc(root, 'docs/other.md', { id: 'fixture.other' });
  checked = gate(root);
  assert.match(checked.stderr, /docs\/core\.md and docs\/other\.md both claim the "code:" folder "src"/);
  rmSync(join(root, 'docs', 'other.md'));

  // A doc of record in a workspace docs/ folder owns a folder of that workspace only.
  writeFileSync(join(root, 'src', 'package.json'), '{ "name": "src" }\n', 'utf8');
  mkdirSync(join(root, 'tools'), { recursive: true });
  writeFileSync(join(root, 'tools', 'build.js'), 'export const build = 1;\n', 'utf8');
  writeDoc(root, 'src/docs/web.md', { id: 'fixture.web', code: 'tools' });
  checked = gate(root);
  assert.match(checked.stderr, /src\/docs\/web\.md: the "code:" folder "tools" is outside src/);
});

test('the owner of a runtime file is the doc with the longest code: folder [@invariant sdd-enforce.gates:V18]', () => {
  const root = installed();
  mkdirSync(join(root, 'src', 'auth'), { recursive: true });
  writeFileSync(join(root, 'src', 'auth', 'login.js'), 'export const login = 1;\n', 'utf8');
  writeDoc(root, 'docs/app.md', { id: 'fixture.app', code: 'src' });
  writeDoc(root, 'docs/auth.md', { id: 'fixture.auth', code: 'src/auth' });
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', `docs: add the owner docs\n\nDoc-Impact: none - src/auth/login.js ${NO_IMPACT}`]);

  const messagePath = join(root, '.git', 'TEST_COMMIT_MSG');
  writeFileSync(messagePath, 'feat: change login\n', 'utf8');
  writeFileSync(join(root, 'src', 'auth', 'login.js'), 'export const login = 2;\n', 'utf8');
  writeFileSync(join(root, 'docs', 'app.md'), `${readFileSync(join(root, 'docs', 'app.md'), 'utf8')}\nThe parent doc changed.\n`, 'utf8');
  git(root, ['add', 'src/auth/login.js', 'docs/app.md']);
  let checked = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /src\/auth\/login\.js \(owner: docs\/auth\.md\)/);

  writeFileSync(join(root, 'docs', 'auth.md'), `${readFileSync(join(root, 'docs', 'auth.md'), 'utf8')}\nLogin returns 2.\n`, 'utf8');
  git(root, ['add', 'docs/auth.md']);
  checked = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.equal(checked.status, 0, checked.stderr);
});

test('the gate fails on a SPEC.md and on an @spec citation, and names the new form [@invariant sdd-enforce.gates:V1]', () => {
  const root = installed();
  writeFileSync(join(root, 'src', 'SPEC.md'), '---\nid: fixture.old\n---\n\nV1: Old.\n', 'utf8');
  writeFileSync(join(root, 'src', 'old.test.js'), "test('old [@spec fixture.old:V1]', () => {});\n", 'utf8');
  const checked = gate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /src\/SPEC\.md: a module doc is no longer a SPEC\.md\. Move it to <workspace>\/docs\/<module>\.md/);
  assert.match(checked.stderr, /src\/old\.test\.js: "@spec fixture\.old:V1" is the citation form before 1\.0\.0\. Write "@invariant fixture\.old:V1" instead/);
});

test('existing AGENTS.md requires an explicit merge before the tool lines are added [@invariant sdd-enforce.gates:V13]', () => {
  const root = fixture();
  writeFileSync(join(root, 'AGENTS.md'), '# Existing policy\n\nTeam text.\n', 'utf8');
  git(root, ['add', 'AGENTS.md']);
  git(root, ['commit', '-m', 'docs: add existing agent policy']);

  const planned = run(['plan', root]);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /AGENTS\.md: this file already exists without the tool lines/);
  assert.match(planned.stdout, /re-run with --merge-agents/);
  assert.match(planned.stdout, /conflict = /);

  const blocked = run(['apply', root, '--write']);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /cannot apply with conflicts: AGENTS\.md/);

  const merged = run(['apply', root, '--write', '--merge-agents']);
  assert.equal(merged.status, 0, merged.stderr);
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), `# Existing policy\n\n${POINTER}\n\nTeam text.\n`);
});

test('the docs standard line from the config goes into AGENTS.md and check-docs asserts it [@invariant sdd-enforce.gates:V13]', () => {
  const root = installed();
  const line = 'Where each doc goes and how to write it: the [docs standard](https://example.invalid/map.md).';
  const configPath = join(root, '.agent-sdd', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(config.docsStandardLine, '', 'empty by default: the templates stay organization-neutral');
  config.docsStandardLine = line;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  let checked = docsGate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /AGENTS\.md lacks the docs standard line/);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: set the docs standard line']);

  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), `# Repository agent instructions\n\n${line}\n\n${POINTER}\n`);
  checked = docsGate(root);
  assert.equal(checked.status, 0, checked.stderr);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: apply']);

  // A changed line replaces the one the tool wrote before, so uninstall still finds every tool line.
  const next = 'Where each doc goes: the [docs standard, version 2](https://example.invalid/v2/map.md).';
  writeFileSync(configPath, `${JSON.stringify({ ...config, docsStandardLine: next }, null, 2)}\n`, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: new docs standard line']);
  assert.equal(run(['apply', root, '--write']).status, 0);
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), `# Repository agent instructions\n\n${next}\n\n${POINTER}\n`);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: apply again']);
  const removed = run(['uninstall', root, '--write', '--yes']);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(existsSync(join(root, 'AGENTS.md')), false);
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
  assert.match(readFileSync(join(root, '.claude', 'rules', 'app-config-updates.md'), 'utf8'), /paths:\n {2}- "\*\*\/config\/\*\*"\n---/);
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

test('a staged runtime edit needs a covering doc of record or a concrete Doc-Impact trailer [@invariant sdd-enforce.gates:V18]', () => {
  const root = installed();
  writeFileSync(join(root, 'src', 'feature.js'), 'export const value = 1;\n', { encoding: 'utf8', flag: 'wx' });
  git(root, ['add', 'src/feature.js']);
  const messagePath = join(root, '.git', 'TEST_COMMIT_MSG');
  writeFileSync(messagePath, 'feat: add feature\n', 'utf8');
  let checked = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /runtime paths lack an owner change: src\/feature\.js \(owner: none found/);

  writeFileSync(messagePath, 'feat: add feature\n\nDoc-Impact: none - refactor only in src/feature.js with no behavior change at all\n', 'utf8');
  checked = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /generic/);

  writeFileSync(messagePath, `feat: add feature\n\nDoc-Impact: none - src/feature.js ${NO_IMPACT}\n`, 'utf8');
  checked = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.equal(checked.status, 0, checked.stderr);
  // The trailer name before 1.0.0 stays valid, because commits already on shared branches carry it.
  writeFileSync(messagePath, `feat: add feature\n\nSpec-Impact: none - src/feature.js ${NO_IMPACT}\n`, 'utf8');
  checked = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.equal(checked.status, 0, checked.stderr);

  // The doc of record whose code: folder holds the file owns it: staging the doc with the code needs no trailer.
  writeDoc(root, 'docs/core.md', { id: 'fixture.core' });
  writeFileSync(messagePath, 'feat: add feature\n', 'utf8');
  checked = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.match(checked.stderr, /src\/feature\.js \(owner: docs\/core\.md\)/);
  git(root, ['add', 'docs/core.md', 'AGENTS.md']);
  checked = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.equal(checked.status, 0, checked.stderr);
});

test('--changed resolves origin/<CHANGE_TARGET> before falling back [@invariant sdd-enforce.gates:V3]', () => {
  const root = installed();
  git(root, ['update-ref', 'refs/remotes/origin/develop', 'HEAD']);
  git(root, ['checkout', '-q', '-b', 'feature']);
  runtimeCommit(root, 'a.js', `feat: a\n\nDoc-Impact: none - src/a.js ${NO_IMPACT}`);

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

test('waivers skip a named commit in --changed mode only [@invariant sdd-enforce.gates:V4]', () => {
  const root = installed();
  git(root, ['checkout', '-q', '-b', 'feature']);
  const sha = runtimeCommit(root, 'a.js', 'feat: a without trailer');
  let checked = gate(root, ['--changed', '--base', 'main']);
  assert.notEqual(checked.status, 0);

  const waivers = join(root, '.agent-sdd', 'waivers.json');
  writeFileSync(waivers, JSON.stringify([{ commit: sha, gates: ['doc-impact'], reason: 'too short' }]), 'utf8');
  checked = gate(root, ['--changed', '--base', 'main']);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /waivers\.json/);

  const reason = 'Commit landed on the shared branch before the gate existed and rewriting shared history was declined.';
  for (const name of ['doc-impact', 'spec-impact']) {
    writeFileSync(waivers, JSON.stringify([{ commit: sha, gates: [name], reason }]), 'utf8');
    checked = gate(root, ['--changed', '--base', 'main']);
    assert.equal(checked.status, 0, `${name}: ${checked.stderr}`);
    assert.match(checked.stdout, /waived/);
  }

  writeFileSync(join(root, 'src', 'b.js'), 'export const value = 2;\n', 'utf8');
  git(root, ['add', 'src/b.js']);
  const messagePath = join(root, '.git', 'TEST_COMMIT_MSG');
  writeFileSync(messagePath, 'feat: b without trailer\n', 'utf8');
  checked = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /runtime paths lack an owner change/);
});

test('adapters need Codex metadata and the right links: rule to concern doc and back, twin to skill [@invariant sdd-enforce.gates:V5]', () => {
  const root = installed();
  rmSync(join(root, '.agents', 'skills', 'committing-changes', 'agents'), { recursive: true });
  let checked = gate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /committing-changes lacks agents\/openai\.yaml/);
  git(root, ['checkout', '--', '.']);

  const twin = join(root, '.agents', 'skills', 'committing-changes', 'SKILL.md');
  writeFileSync(twin, readFileSync(twin, 'utf8').replace(/\[committing-changes\]\([^)]+\)/, 'the Claude skill'), 'utf8');
  checked = gate(root);
  assert.match(checked.stderr, /\.agents\/skills\/committing-changes\/SKILL\.md does not link \.claude\/skills\/committing-changes\/SKILL\.md/);
  git(root, ['checkout', '--', '.']);

  const ruleTwin = join(root, '.agents', 'skills', 'doc-of-record', 'SKILL.md');
  writeFileSync(ruleTwin, readFileSync(ruleTwin, 'utf8').replace(/\[doc of record\]\([^)]+\)/, 'the doc'), 'utf8');
  checked = gate(root);
  assert.match(checked.stderr, /\.agents\/skills\/doc-of-record\/SKILL\.md does not link docs\/doc-of-record\.md/);
  git(root, ['checkout', '--', '.']);

  // The concern doc links the rule; that one link also covers the generated Cursor mirror.
  const doc = join(root, 'docs', 'doc-of-record.md');
  assert.doesNotMatch(readFileSync(doc, 'utf8'), /\.cursor\/rules/);
  writeFileSync(doc, readFileSync(doc, 'utf8').replace(/^The rule \[[^\n]*\r?\n/m, ''), 'utf8');
  checked = gate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /docs\/doc-of-record\.md does not link back to \.claude\/rules\/doc-of-record\.md/);
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
  assert.match(checked.stderr, /src\/legacy\/SPEC\.md: a module doc is no longer a SPEC\.md/);

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
  assert.match(applied.stdout, /\.husky\/ for JS, \.pre-commit-config\.yaml for pre-commit/);
  assert.match(applied.stdout, /old plans, samples[^\n]*"exclude"/);
});

test('gate messages say what is wrong and how to fix it', () => {
  const root = installed();
  writeDoc(root, 'docs/core.md', { id: 'fixture.core', critical: ['V1'], body: '## Invariants\n\nV1: Fixture holds.\n' });
  writeFileSync(join(root, 'README.md'), '# Fixture\n\n[gone](docs/missing.md)\n', 'utf8');
  const checked = gate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /lacks executable evidence: fixture\.core:V1/);
  assert.match(checked.stderr, /@invariant fixture\.core:V1/);
  assert.match(checked.stderr, /split it or remove it from "critical:"/);
  assert.match(checked.stderr, /README\.md links to "docs\/missing\.md" but that file does not exist/);

  writeFileSync(join(root, 'src', 'core.test.js'), "test('holds [@invariant fixture.core:V1]', () => {});\n", 'utf8');
  writeFileSync(join(root, 'README.md'), '# Fixture\n', 'utf8');
  assert.equal(gate(root).status, 0, gate(root).stderr);

  writeFileSync(join(root, 'src', 'feature.js'), 'export const value = 1;\n', 'utf8');
  git(root, ['add', 'src/feature.js']);
  const messagePath = join(root, '.git', 'TEST_COMMIT_MSG');
  writeFileSync(messagePath, 'feat: add feature\n', 'utf8');
  const staged = gate(root, ['--staged', '--commit-msg', messagePath]);
  assert.match(staged.stderr, /Doc-Impact: none - </);
  assert.match(staged.stderr, /update an owner in the same commit/i);
});

test('post-edit reminder tells the agent what to do next in plain words', () => {
  const root = installed();
  const hook = join(root, '.claude', 'hooks', 'post-edit-reminder.mjs');
  const result = spawnSync(process.execPath, [hook], {
    cwd: root,
    encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(root, 'src', 'a.js') } }),
  });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /You edited src\/a\.js/);
  assert.match(context, /the doc of record whose code: folder holds/);
  assert.match(context, /Doc-Impact: none - /);
  assert.match(context, /node scripts\/check-sdd\.mjs/);
  assert.doesNotMatch(context, /changes-log/);
});

function preExistingRepo() {
  const root = fixture();
  writeFileSync(join(root, 'AGENTS.md'), '# Acme notes\n\n- Deploy only through make deploy.\n', 'utf8');
  writeFileSync(join(root, '.gitignore'), 'node_modules\n.env\n', 'utf8');
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(
    join(root, '.claude', 'settings.json'),
    `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node scripts/guard.mjs' }] }] }, permissions: { deny: ['Bash(kubectl:*)'] } }, null, 2)}\n`,
    'utf8',
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: pre-existing repository']);
  return root;
}

test('uninstall is a dry run by default and refuses --write without confirmation [@invariant sdd-enforce.gates:V6]', () => {
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

test('uninstall --write --yes removes only what apply added and restores user files [@invariant sdd-enforce.gates:V6]', () => {
  const root = preExistingRepo();
  const original = tree(root);
  const applied = run(['apply', root, '--write', '--merge-agents']);
  assert.equal(applied.status, 0, applied.stderr);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: install']);
  assert.ok(existsSync(join(root, '.agent-toolchain.json')));
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), 'node_modules\n.env\n', 'apply leaves .gitignore alone');

  const removed = run(['uninstall', root, '--write', '--yes']);
  assert.equal(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
  assert.match(removed.stdout, /Uninstalled sdd-enforce/);
  assert.match(removed.stdout, /pre-commit/);

  const after = tree(root);
  assert.deepEqual([...after.keys()].sort(), [...original.keys()].sort());
  for (const [path, content] of original) {
    assert.equal(after.get(path).replaceAll('\r\n', '\n'), content.replaceAll('\r\n', '\n'), `${path} restored`);
  }
  for (const dir of ['.agents', '.codex', '.cursor', 'docs', 'scripts', '.agent-sdd', '.claude/rules', '.claude/skills', '.claude/hooks']) {
    assert.equal(existsSync(join(root, dir)), false, `${dir} removed`);
  }
  assert.ok(existsSync(join(root, '.claude', 'settings.json')));
});

test('uninstall on a bare repository deletes files it created outright', () => {
  const root = installed();
  const removed = run(['uninstall', root, '--write', '--yes']);
  assert.equal(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
  assert.deepEqual([...tree(root).keys()].sort(), ['README.md', 'src/index.js']);
  assert.deepEqual(readdirSync(root).filter((name) => name !== '.git').sort(), ['README.md', 'src']);
});

test('uninstall keeps a generated file that was edited unless --force is given', () => {
  const root = installed();
  const doc = join(root, 'docs', 'doc-of-record.md');
  writeFileSync(doc, `${readFileSync(doc, 'utf8')}\nLocal addition.\n`, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'docs: local tweak']);

  const kept = run(['uninstall', root, '--write', '--yes']);
  assert.equal(kept.status, 0, `${kept.stdout}\n${kept.stderr}`);
  assert.match(kept.stdout, /keep\s+docs\/doc-of-record\.md.*edited/);
  assert.ok(existsSync(doc));
  assert.equal(existsSync(join(root, '.agent-toolchain.json')), false);
  assert.equal(existsSync(join(root, 'scripts', 'check-sdd.mjs')), false);

  const root2 = installed();
  const doc2 = join(root2, 'docs', 'doc-of-record.md');
  writeFileSync(doc2, 'edited\n', 'utf8');
  git(root2, ['add', '.']);
  git(root2, ['commit', '-q', '-m', 'docs: local tweak']);
  const forced = run(['uninstall', root2, '--write', '--yes', '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(existsSync(doc2), false);
});

test('asset templates never use harness-discoverable directory names', () => {
  const assetRoot = join(SKILL_ROOT, 'assets', 'repository');
  const names = readdirSync(assetRoot);
  for (const name of names) assert.doesNotMatch(name, /^\./, `asset dir ${name} would be loaded as a live harness dir`);
  assert.ok(existsSync(join(assetRoot, '_claude', 'rules', 'doc-of-record.md')));
  assert.ok(existsSync(join(assetRoot, '_claude', 'hooks', 'post-edit-reminder.mjs')));
  assert.ok(existsSync(join(assetRoot, '_agents', 'skills', 'doc-of-record', 'SKILL.md')));
});

test('uninstall removes only its own hook command and keeps a user hook beside it [@invariant sdd-enforce.gates:V6]', () => {
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

test('uninstall keeps a file that existed with template content before install [@invariant sdd-enforce.gates:V6]', () => {
  const root = fixture();
  const relPath = 'docs/doc-of-record.md';
  const template = readFileSync(join(SKILL_ROOT, 'assets', 'repository', relPath), 'utf8');
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, relPath), template, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'docs: doc already present']);

  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  const manifest = JSON.parse(readFileSync(join(root, '.agent-toolchain.json'), 'utf8'));
  assert.equal(manifest.managedFiles[relPath].mode, 'preserved');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: install sdd-enforce']);

  const removed = run(['uninstall', root, '--write', '--yes']);
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(removed.stdout, /keep\s+docs\/doc-of-record\.md.*before install/);
  assert.equal(readFileSync(join(root, relPath), 'utf8'), template);

  // A file this tool created stays deletable after a second apply finds it unchanged.
  const root2 = installed();
  assert.equal(run(['apply', root2, '--write']).status, 0); // idempotent: nothing changes, tree stays clean
  const dry2 = run(['uninstall', root2]);
  assert.match(dry2.stdout, /delete\s+docs\/doc-of-record\.md/);
});

for (const name of [SKILL_NAME, 'cross-agent-sdd']) {
  test(`gate ignores a copy of the skill kept in the repository as ${name} [@invariant sdd-enforce.gates:V9]`, () => {
    const root = fixture();
    for (const harness of ['.claude', '.agents', '.cursor']) {
      cpSync(SKILL_ROOT, join(root, harness, 'skills', name), { recursive: true });
    }
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'chore: keep the skill in the repository']);
    const applied = run(['apply', root, '--write']);
    assert.equal(applied.status, 0, applied.stderr);
    const checked = gate(root);
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(docsGate(root).status, 0, docsGate(root).stderr);
  });
}

test('upgrade from 0.6.0 removes retired files, the CLAUDE.md import and the .gitignore block, and moves the hook [@invariant sdd-enforce.gates:V15]', () => {
  const root = legacy06Installed();
  const planned = run(['plan', root]);
  assert.equal(planned.status, 0, planned.stderr);
  for (const path of [...Object.keys(LEGACY_06_FILES), 'CLAUDE.md', '.gitignore']) {
    assert.match(planned.stdout, new RegExp(`delete\\s+${path.replace(/[.]/g, '\\.')}`), `${path} deleted`);
  }
  assert.match(planned.stdout, /update\s+AGENTS\.md/);
  assert.match(planned.stdout, /create\s+docs\/map\.md/);

  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  for (const path of [...Object.keys(LEGACY_06_FILES), 'CLAUDE.md', '.gitignore']) assert.equal(existsSync(join(root, path)), false, `${path} gone`);
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), `# Repository agent instructions\n\n${POINTER}\n`);
  for (const path of ['.claude/settings.json', '.codex/hooks.json', '.cursor/hooks.json']) {
    const body = readFileSync(join(root, path), 'utf8');
    assert.match(body, /\.claude\/hooks\/post-edit-reminder\.mjs/, path);
    assert.doesNotMatch(body, /scripts[\\/]+hooks/, path);
  }
  const manifest = JSON.parse(readFileSync(join(root, '.agent-toolchain.json'), 'utf8'));
  for (const path of [...Object.keys(LEGACY_06_FILES), 'CLAUDE.md', '.gitignore']) assert.equal(manifest.managedFiles[path], undefined, `${path} record gone`);
  const verified = run(['verify', root]);
  assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'chore: upgrade']);
  assert.equal(run(['apply', root, '--write']).status, 0);
  assert.equal(git(root, ['status', '--porcelain']), '');

  // An edited retired file stays, and the gate then fails on its old name until someone moves it.
  const edited = legacy06Installed({ editCommitWorkflow: true });
  const kept = run(['plan', edited]);
  assert.match(kept.stdout, /keep\s+docs\/workflows\/COMMIT-WORKFLOW\.md/);
  assert.match(kept.stdout, /COMMIT-WORKFLOW\.md: no longer shipped, and it is yours/);
  assert.equal(run(['apply', edited, '--write']).status, 0);
  const failing = run(['verify', edited]);
  assert.notEqual(failing.status, 0);
  assert.match(failing.stderr, /docs\/workflows\/COMMIT-WORKFLOW\.md: a doc under docs\/ needs a kebab-case name/);
});

test('apply stops on a CLAUDE.md it did not create [@invariant sdd-enforce.gates:V15]', () => {
  const root = fixture();
  writeFileSync(join(root, 'CLAUDE.md'), '# Claude notes\n\nRun make lint first.\n', 'utf8');
  git(root, ['add', 'CLAUDE.md']);
  git(root, ['commit', '-q', '-m', 'docs: claude notes']);
  const planned = run(['plan', root]);
  assert.match(planned.stdout, /conflict\s+CLAUDE\.md/);
  assert.match(planned.stdout, /CLAUDE\.md: a CLAUDE\.md hides every AGENTS\.md from Claude Code/);
  const blocked = run(['apply', root, '--write']);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /cannot apply with conflicts: CLAUDE\.md/);
  assert.ok(existsSync(join(root, 'CLAUDE.md')));
});

test('check-docs applies the docs standard: no CLAUDE.md, kebab-case docs, sizes, skill names, live rule globs [@invariant sdd-enforce.gates:V16]', () => {
  const root = installed();
  assert.equal(docsGate(root).status, 0, docsGate(root).stderr);
  mkdirSync(join(root, 'apps', 'web'), { recursive: true });
  writeFileSync(join(root, 'apps', 'web', 'CLAUDE.md'), '@AGENTS.md\n', 'utf8');
  writeFileSync(join(root, 'docs', 'Styling_Guide.md'), '# Styling\n', 'utf8');
  writeFileSync(join(root, 'AGENTS.md'), `${readFileSync(join(root, 'AGENTS.md'), 'utf8')}${'- line\n'.repeat(200)}`, 'utf8');
  mkdirSync(join(root, '.claude', 'skills', 'deploying'), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', 'deploying', 'SKILL.md'), `---\nname: deploy\ndescription: ${'x'.repeat(1025)}\n---\n${'step\n'.repeat(500)}`, 'utf8');
  writeFileSync(join(root, '.claude', 'rules', 'lib.md'), '---\ndescription: lib\npaths:\n  - "lib/**"\n---\n\n# Lib\n', 'utf8');
  const checked = docsGate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /apps\/web\/CLAUDE\.md: the repository ships AGENTS\.md, never CLAUDE\.md/);
  assert.match(checked.stderr, /docs\/Styling_Guide\.md: a doc under docs\/ needs a kebab-case name\. Run "git mv docs\/Styling_Guide\.md docs\/styling-guide\.md"/);
  assert.match(checked.stderr, /AGENTS\.md has \d+ lines; keep an AGENTS\.md under 200/);
  assert.match(checked.stderr, /\.claude\/skills\/deploying\/SKILL\.md has \d+ lines; keep a SKILL\.md under 500/);
  assert.match(checked.stderr, /deploying\/SKILL\.md: the frontmatter "name" is "deploy"; set it to the folder name "deploying"/);
  assert.match(checked.stderr, /the description has 1025 characters; keep it at most 1024/);
  assert.match(checked.stderr, /\.claude\/rules\/lib\.md: the "paths:" glob "lib\/\*\*" matches no file/);
});

test('docs/map.md holds the rows the tool adds, in a block that merge and uninstall respect [@invariant sdd-enforce.gates:V19]', () => {
  const lean = fixture();
  assert.equal(run(['apply', lean, '--write', '--agents', 'claude']).status, 0);
  const leanMap = readFileSync(join(lean, 'docs', 'map.md'), 'utf8');
  assert.match(leanMap, /^# Docs map: rows this repository adds\n/);
  assert.match(leanMap, /<!-- sdd-enforce:start -->\n\| You have… \| It goes in \| Living \| Loaded \|/);
  assert.match(leanMap, /`\.agent-sdd\/waivers\.json`/);
  assert.doesNotMatch(leanMap, /\.agents\/skills|\.codex\/hooks\.json/, 'rows follow the enabled agents');

  const root = fixture();
  mkdirSync(join(root, 'docs'), { recursive: true });
  const own = '# Docs map\n\n| You have… | It goes in | Living | Loaded |\n|---|---|---|---|\n| a load test | `perf/` | yes | by CI |\n';
  writeFileSync(join(root, 'docs', 'map.md'), own, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'docs: own map rows']);
  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /merge\s+docs\/map\.md/);
  const merged = readFileSync(join(root, 'docs', 'map.md'), 'utf8');
  assert.ok(merged.startsWith(own.trimEnd()), 'own rows stay first');
  assert.match(merged, /\.agents\/skills\/<name>\/SKILL\.md/);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: install']);
  assert.equal(run(['uninstall', root, '--write', '--yes']).status, 0);
  assert.equal(readFileSync(join(root, 'docs', 'map.md'), 'utf8'), own);
});

test('a hook config change needs every other enabled hook config, never itself; a skill or its twin may change alone [@invariant sdd-enforce.gates:V8]', () => {
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
  for (const path of ['.claude/hooks/post-edit-reminder.mjs', '.claude/skills/committing-changes/SKILL.md', '.agents/skills/committing-changes/SKILL.md']) {
    writeFileSync(join(root, path), `${readFileSync(join(root, path), 'utf8')}\n<!-- note -->\n`, 'utf8');
    git(root, ['add', path]);
    checked = gate(root, ['--staged', '--commit-msg', message]);
    assert.equal(checked.status, 0, `${path} alone needs no partner: ${checked.stderr}`);
    git(root, ['reset', '-q', '--hard']);
  }
});

test('.claude/rules/INDEX.md is not a rule: no .cursor mirror, no Agent-Parity trailer [@invariant sdd-enforce.gates:V2]', () => {
  const root = installed();
  const message = join(root, 'msg.txt');
  writeFileSync(message, 'docs: index the rules\n', 'utf8');
  const index = '.claude/rules/INDEX.md';
  writeFileSync(join(root, index), '# Rules\n\n- [doc-of-record](doc-of-record.md)\n', 'utf8');
  git(root, ['add', index]);

  let checked = gate(root);
  assert.equal(checked.status, 0, `static gate must not expect .cursor/rules/INDEX.mdc: ${checked.stderr}`);
  checked = gate(root, ['--staged', '--commit-msg', message]);
  assert.equal(checked.status, 0, `the index alone is not a one-sided harness edit: ${checked.stderr}`);

  // A real rule still needs its mirror in the same commit.
  const rule = '.claude/rules/doc-of-record.md';
  writeFileSync(join(root, rule), `${readFileSync(join(root, rule), 'utf8')}\n<!-- touched -->\n`, 'utf8');
  git(root, ['add', rule]);
  checked = gate(root, ['--staged', '--commit-msg', message]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /harness paths lack partner change: \.claude\/rules\/doc-of-record\.md/);
});

test('docs tell CI to run the per-commit gate, not only the static one', () => {
  const ciMentionsChanged = /\bCI\b[^\n]*--changed|--changed[^\n]*\bCI\b/;
  assert.match(readFileSync(join(SKILL_ROOT, 'references', 'configuration.md'), 'utf8'), ciMentionsChanged);
  assert.match(readFileSync(join(SKILL_ROOT, 'SKILL.md'), 'utf8'), ciMentionsChanged);
  assert.match(readFileSync(join(SKILL_ROOT, 'README.md'), 'utf8'), /static[^\n]*alone[^\n]*--changed|--changed[^\n]*static[^\n]*alone/i);
});

test('re-apply with fewer profiles keeps ownership of files still on disk [@invariant sdd-enforce.gates:V7]', () => {
  const root = fixture();
  const full = run(['apply', root, '--write', '--profiles', 'core,sdd,helm']);
  assert.equal(full.status, 0, full.stderr);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: install with helm']);

  const shrunk = run(['apply', root, '--write', '--profiles', 'core,sdd']);
  assert.equal(shrunk.status, 0, shrunk.stderr);
  assert.match(shrunk.stdout, /no longer in the selected profiles[^\n]*docs\/helm-validation\.md/);
  const manifest = JSON.parse(readFileSync(join(root, '.agent-toolchain.json'), 'utf8'));
  assert.ok(manifest.managedFiles['docs/helm-validation.md'], 'record kept');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: drop helm profile']);

  const dry = run(['uninstall', root]);
  assert.match(dry.stdout, /delete\s+docs\/helm-validation\.md/);
});

test('apply skips a generated file you edited and upgrades the rest [@invariant sdd-enforce.gates:V7]', () => {
  const root = installed();
  const manifestPath = join(root, '.agent-toolchain.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const originalGateSha = manifest.managedFiles['scripts/check-sdd.mjs'].sha256;

  const gatePath = join(root, 'scripts', 'check-sdd.mjs');
  writeFileSync(gatePath, `${readFileSync(gatePath, 'utf8')}\n// local tweak\n`, 'utf8');
  // Simulate an older installed version of one doc: content and recorded hash agree, template differs.
  const docRel = 'docs/doc-of-record.md';
  writeFileSync(join(root, docRel), 'old generated content\n', 'utf8');
  manifest.managedFiles[docRel].sha256 = createHash('sha256').update('old generated content\n').digest('hex');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: local gate tweak and stale doc']);

  const planned = run(['plan', root]);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /keep\s+scripts\/check-sdd\.mjs/);
  assert.match(planned.stdout, /update-generated\s+docs\/doc-of-record\.md/);
  assert.match(planned.stdout, /No conflicts\. Apply can run\./);

  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /scripts\/check-sdd\.mjs[^\n]*edited/);
  assert.match(readFileSync(gatePath, 'utf8'), /local tweak/);
  const template = readFileSync(join(SKILL_ROOT, 'assets', 'repository', docRel), 'utf8');
  assert.equal(readFileSync(join(root, docRel), 'utf8'), template);

  const after = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(after.managedFiles['scripts/check-sdd.mjs'].sha256, originalGateSha, 'record keeps the install-time hash');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: upgrade']);
  const dry = run(['uninstall', root]);
  assert.match(dry.stdout, /keep\s+scripts\/check-sdd\.mjs.*edited/);
});

test('apply never upgrades a preserved file and verify does not police it [@invariant sdd-enforce.gates:V7]', () => {
  const root = fixture();
  const relPath = 'docs/doc-of-record.md';
  const template = readFileSync(join(SKILL_ROOT, 'assets', 'repository', relPath), 'utf8');
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, relPath), template, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'docs: doc already present']);
  assert.equal(run(['apply', root, '--write']).status, 0);

  // Simulate a newer template: the preserved file and its record still agree, the template no longer does.
  const teamVersion = '# Doc of record\n\nThe team wrote this before the tool arrived. [Rule](../.claude/rules/doc-of-record.md)\n';
  const manifestPath = join(root, '.agent-toolchain.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(join(root, relPath), teamVersion, 'utf8');
  manifest.managedFiles[relPath].sha256 = createHash('sha256').update(teamVersion).digest('hex');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: install']);

  const planned = run(['plan', root]);
  assert.match(planned.stdout, /keep\s+docs\/doc-of-record\.md/);
  assert.match(planned.stdout, /doc-of-record\.md: existed[^\n]*before install/);
  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(readFileSync(join(root, relPath), 'utf8'), teamVersion);

  // Their file, their edits: verify does not report it as a tool file changed outside the installer.
  writeFileSync(join(root, relPath), `${teamVersion}\nEdited again by the team.\n`, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'docs: team edit']);
  const verified = run(['verify', root]);
  assert.doesNotMatch(`${verified.stdout}${verified.stderr}`, /changed outside installer: docs\/doc-of-record\.md/);
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

test('adopting a preserved file makes it tool-owned, by --replace or by delete and re-apply [@invariant sdd-enforce.gates:V7]', () => {
  const relPath = 'docs/doc-of-record.md';
  const template = readFileSync(join(SKILL_ROOT, 'assets', 'repository', relPath), 'utf8');
  const preserved = () => {
    const root = fixture();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, relPath), template, 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'docs: doc already present']);
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
  assert.match(run(['uninstall', byReplace]).stdout, /delete\s+docs\/doc-of-record\.md/);

  const byDelete = preserved();
  git(byDelete, ['rm', '-q', relPath]);
  git(byDelete, ['commit', '-m', 'chore: drop the old copy']);
  assert.equal(run(['apply', byDelete, '--write']).status, 0);
  assert.equal(mode(byDelete), 'created');
});

test('a Doc-Impact reason may fold over continuation lines, like a Git trailer [@invariant sdd-enforce.gates:V10]', () => {
  const root = installed();
  const message = join(root, 'msg.txt');
  writeFileSync(join(root, 'src', 'folded.js'), 'export const value = 1;\n', 'utf8');
  git(root, ['add', 'src/folded.js']);

  // Folded: the continuation line starts with whitespace and carries the file name the gate needs.
  writeFileSync(
    message,
    'feat: fold\n\nDoc-Impact: none - exports a fixture constant without observable runtime behavior,\n src/folded.js is the only path and stays a constant\n',
    'utf8',
  );
  let checked = gate(root, ['--staged', '--commit-msg', message]);
  assert.equal(checked.status, 0, `folded reason must be joined: ${checked.stderr}`);

  // Not folded: a following line without leading whitespace is a new paragraph, not part of the reason.
  writeFileSync(
    message,
    'feat: fold\n\nDoc-Impact: none - exports a fixture constant without observable runtime behavior,\nsrc/folded.js is the only path and stays a constant\n',
    'utf8',
  );
  checked = gate(root, ['--staged', '--commit-msg', message]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /does not name src\/folded\.js/);
});

test('docs/README.md indexes every doc of record, and the nearest AGENTS.md links the index [@invariant sdd-enforce.gates:V11]', () => {
  const root = installed();
  // A repo with no workspace: the root is the one workspace, so its index is docs/README.md.
  writeFileSync(join(root, 'docs', 'core.md'), '---\nid: fixture.core\ncode: src\n---\n\n# Core\n\n## Goal\n\nThe fixture exists.\n', 'utf8');
  let checked = docsGate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /docs\/README\.md does not list docs\/core\.md/);

  // A link with an anchor or an encoded character still counts.
  writeFileSync(join(root, 'docs', 'net-tools.md'), '---\nid: fixture.net\ncode: tools\n---\n\n# Net\n', 'utf8');
  mkdirSync(join(root, 'tools'), { recursive: true });
  writeFileSync(join(root, 'tools', 'ping.js'), 'export const ping = 1;\n', 'utf8');
  writeFileSync(join(root, 'docs', 'README.md'), '# Docs of record\n\n- [core](core.md#v1)\n- [net](net%2Dtools.md)\n', 'utf8');
  checked = docsGate(root);
  assert.notEqual(checked.status, 0);
  assert.doesNotMatch(checked.stderr, /does not list/);
  assert.match(checked.stderr, /AGENTS\.md does not link docs\/README\.md/);

  addLink(root, 'AGENTS.md', 'docs/README.md', 'docs of record', '# Fixture agents');
  checked = docsGate(root);
  assert.equal(checked.status, 0, checked.stderr);
});

test('check-docs demands AGENTS.md per workspace, a covering doc per module, its link, and the root pointer [@invariant sdd-enforce.gates:V11]', () => {
  const root = fixture();
  mkdirSync(join(root, 'apps', 'api', 'src', 'modules', 'auth'), { recursive: true });
  writeFileSync(join(root, 'apps', 'api', 'package.json'), '{ "name": "api" }\n', 'utf8');
  writeFileSync(join(root, 'apps', 'api', 'src', 'modules', 'auth', 'index.ts'), 'export const login = 1;\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: workspace layout']);
  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  const config = JSON.parse(readFileSync(join(root, '.agent-sdd', 'config.json'), 'utf8'));
  assert.deepEqual(config.moduleRoots, ['apps/*/src/modules'], 'module roots detected from the workspace layout');

  let checked = docsGate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /missing AGENTS\.md: apps\/api/);
  assert.match(checked.stderr, /module not covered: apps\/api\/src\/modules\/auth/);

  writeFileSync(join(root, 'apps', 'api', 'AGENTS.md'), '# api\n', 'utf8');
  mkdirSync(join(root, 'apps', 'api', 'docs'), { recursive: true });
  writeFileSync(join(root, 'apps', 'api', 'docs', 'auth.md'), "---\nid: api.auth\ncode: apps/api/src/modules/auth\n---\n\n# Auth\n\n## Goal\n\nLog users in.\n", 'utf8');
  checked = docsGate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /apps\/api\/docs\/README\.md does not list apps\/api\/docs\/auth\.md/);

  writeFileSync(join(root, 'apps', 'api', 'docs', 'README.md'), '# api docs\n\n- [auth](auth.md): the auth module\n', 'utf8');
  checked = docsGate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /apps\/api\/AGENTS\.md does not link apps\/api\/docs\/README\.md/);

  writeFileSync(join(root, 'apps', 'api', 'AGENTS.md'), '# api\n\n- [docs of record](docs/README.md): one per module\n', 'utf8');
  checked = docsGate(root);
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /check-docs: ok/);

  // The root pointer is what sends every agent to the doc-of-record rules; dropping it is a gate failure.
  const agentsPath = join(root, 'AGENTS.md');
  const agents = readFileSync(agentsPath, 'utf8');
  assert.ok(agents.includes(POINTER));
  writeFileSync(agentsPath, agents.replace(POINTER, ''), 'utf8');
  checked = docsGate(root);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /AGENTS\.md does not link docs\/doc-of-record\.md/);
  writeFileSync(agentsPath, agents, 'utf8');

  // verify runs check-docs too, so an uncovered module fails verify.
  rmSync(join(root, 'apps', 'api', 'docs', 'auth.md'));
  writeFileSync(join(root, 'apps', 'api', 'AGENTS.md'), '# api\n', 'utf8');
  const verified = run(['verify', root]);
  assert.notEqual(verified.status, 0);
  assert.match(verified.stderr, /scripts\/check-docs\.mjs\) reported problems/);
});

test('both gates skip Claude Code worktrees nested inside the checkout [@invariant sdd-enforce.gates:V12]', () => {
  const root = installed();
  writeDoc(root, 'docs/core.md', { id: 'acme.core', body: '## Invariants\n\nV1: Fixture holds.\n' });
  // A worktree is a full copy of the repository: the same doc id again, and a broken link.
  const copy = join(root, '.claude', 'worktrees', 'feature-x');
  mkdirSync(join(copy, 'docs'), { recursive: true });
  writeFileSync(join(copy, 'docs', 'core.md'), readFileSync(join(root, 'docs', 'core.md'), 'utf8'), 'utf8');
  writeFileSync(join(copy, 'README.md'), '[gone](missing.md)\n', 'utf8');
  writeFileSync(join(copy, 'CLAUDE.md'), '@AGENTS.md\n', 'utf8');
  mkdirSync(join(copy, 'apps', 'api', 'src', 'modules', 'auth'), { recursive: true });
  writeFileSync(join(copy, 'apps', 'api', 'package.json'), '{}\n', 'utf8');

  const checked = gate(root);
  assert.equal(checked.status, 0, `duplicate id inside a worktree must be ignored: ${checked.stderr}`);
  const docs = docsGate(root);
  assert.equal(docs.status, 0, docs.stderr);
});

test('the root AGENTS.md gets only the tool lines, never a managed block [@invariant sdd-enforce.gates:V13]', () => {
  const root = installed();
  const agentsPath = join(root, 'AGENTS.md');
  assert.equal(readFileSync(agentsPath, 'utf8'), `# Repository agent instructions\n\n${POINTER}\n`);
  const manifest = JSON.parse(readFileSync(join(root, '.agent-toolchain.json'), 'utf8'));
  assert.equal(manifest.managedFiles['AGENTS.md'].kind, 'managed-line');
  assert.deepEqual(manifest.managedFiles['AGENTS.md'].lines, [POINTER]);

  // The repository owns the rest of the file; the line may sit anywhere in it.
  writeFileSync(agentsPath, `# Team map\n\n| Doc | Role |\n|---|---|\n| [README](README.md) | onboarding |\n\n${POINTER}\n\n## Notes\n\nDeploy through make deploy.\n`, 'utf8');
  git(root, ['add', 'AGENTS.md']);
  git(root, ['commit', '-q', '-m', 'docs: team doc map around the pointer']);
  let verified = run(['verify', root]);
  assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`);
  const planned = run(['plan', root]);
  assert.match(planned.stdout, /preserve\s+AGENTS\.md/);

  // An AGENTS.md that already holds the pointer needs no --merge-agents.
  const other = fixture();
  const own = `# Team\n\nDoc map.\n\n${POINTER}\n\nMore.\n`;
  writeFileSync(join(other, 'AGENTS.md'), own, 'utf8');
  git(other, ['add', 'AGENTS.md']);
  git(other, ['commit', '-q', '-m', 'docs: own agent policy']);
  const applied = run(['apply', other, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(readFileSync(join(other, 'AGENTS.md'), 'utf8'), own);

  // Without the pointer, agents never reach the doc-of-record rules: verify fails through check-docs.
  writeFileSync(agentsPath, '# Team map\n', 'utf8');
  verified = run(['verify', root]);
  assert.notEqual(verified.status, 0);
  assert.match(verified.stderr, /does not link docs\/doc-of-record\.md/);
});

test('upgrade turns an unedited 0.4.0 AGENTS block into the pointer and keeps an edited one until --replace [@invariant sdd-enforce.gates:V13]', () => {
  const root = legacyInstalled();
  const agentsPath = join(root, 'AGENTS.md');
  const planned = run(['plan', root]);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /update\s+AGENTS\.md/);
  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  let body = readFileSync(agentsPath, 'utf8');
  assert.match(body, /Deploy through make deploy/);
  assert.doesNotMatch(body, /cross-agent-sdd:start|Reading order|SPEC-FIRST-WORKFLOW/);
  assert.equal(body.split('\n').filter((line) => line === POINTER).length, 1);
  const manifest = JSON.parse(readFileSync(join(root, '.agent-toolchain.json'), 'utf8'));
  assert.equal(manifest.managedFiles['AGENTS.md'].kind, 'managed-line');
  let verified = run(['verify', root]);
  assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`);

  const edited = legacyInstalled({ editBlock: true });
  const editedPath = join(edited, 'AGENTS.md');
  const kept = run(['plan', edited]);
  assert.match(kept.stdout, /keep\s+AGENTS\.md/);
  assert.match(kept.stdout, /AGENTS\.md: the old cross-agent-sdd block was edited after install/);
  assert.match(kept.stdout, /No conflicts\. Apply can run\./);
  assert.equal(run(['apply', edited, '--write']).status, 0);
  assert.match(readFileSync(editedPath, 'utf8'), /Keep me\./);

  const replaced = run(['apply', edited, '--write', '--replace', 'AGENTS.md', '--allow-dirty']);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.match(replaced.stdout, /update\s+AGENTS\.md/);
  body = readFileSync(editedPath, 'utf8');
  assert.doesNotMatch(body, /Keep me\.|cross-agent-sdd:start/);
  assert.match(body, /Deploy through make deploy/);
  assert.equal(body.split('\n').filter((line) => line === POINTER).length, 1);
});

test('upgrade swaps the 0.6.0 import line for the pointer and keeps the team text [@invariant sdd-enforce.gates:V13]', () => {
  const root = installed();
  const agentsPath = join(root, 'AGENTS.md');
  writeFileSync(agentsPath, `# Repository agent instructions\n\n## Doc map\n\nDeploy through make deploy.\n\n${LEGACY_IMPORT}\n`, 'utf8');
  git(root, ['add', 'AGENTS.md']);
  git(root, ['commit', '-q', '-m', 'docs: state with the old import line']);
  const planned = run(['plan', root]);
  assert.match(planned.stdout, /update\s+AGENTS\.md/);
  assert.equal(run(['apply', root, '--write']).status, 0);
  assert.equal(readFileSync(agentsPath, 'utf8'), `# Repository agent instructions\n\n${POINTER}\n\n## Doc map\n\nDeploy through make deploy.\n`);
  const verified = run(['verify', root]);
  assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`);
});

test('the rules index is a table in docs/agent-parity.md rendered from the shipped rules; no INDEX.md [@invariant sdd-enforce.gates:V14]', () => {
  const root = fixture();
  mkdirSync(join(root, 'src', 'config'), { recursive: true });
  writeFileSync(join(root, 'src', 'config', 'app.json'), '{}\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'feat: config']);
  const applied = run(['apply', root, '--write', '--profiles', 'core,sdd,config']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(existsSync(join(root, '.claude', 'rules', 'INDEX.md')), false);
  const parity = readFileSync(join(root, 'docs', 'agent-parity.md'), 'utf8');
  const rules = readdirSync(join(root, '.claude', 'rules'));
  assert.deepEqual(rules.sort(), ['agent-parity.md', 'app-config-updates.md', 'doc-of-record.md']);
  for (const name of rules) {
    assert.match(parity, new RegExp(`^\\| \\[\`${name.replace('.md', '')}\`\\]\\(\\.\\./\\.claude/rules/${name.replace('.', '\\.')}\\) \\|`, 'm'), `${name} listed`);
  }
  assert.match(parity, /`doc-of-record`[^\n]*`src\/\*\*`[^\n]*\[doc-of-record\]\(doc-of-record\.md\)/);
  assert.match(parity, /`agent-parity`[^\n]*\| this file \|/);
  assert.doesNotMatch(parity, /rules-index/);
  const manifest = JSON.parse(readFileSync(join(root, '.agent-toolchain.json'), 'utf8'));
  assert.equal(manifest.managedFiles['.claude/rules/INDEX.md'], undefined);

  const lean = installed();
  const leanParity = readFileSync(join(lean, 'docs', 'agent-parity.md'), 'utf8');
  assert.doesNotMatch(leanParity, /app-config-updates/, 'a rule of an unselected profile has no row');
  const checked = gate(lean);
  assert.equal(checked.status, 0, checked.stderr);
});

test('upgrade deletes the unedited 0.4.0 rules index and keeps an edited one [@invariant sdd-enforce.gates:V14]', () => {
  const root = legacyInstalled();
  const index = join(root, '.claude', 'rules', 'INDEX.md');
  const planned = run(['plan', root]);
  assert.match(planned.stdout, /delete\s+\.claude\/rules\/INDEX\.md/);
  const applied = run(['apply', root, '--write']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(existsSync(index), false);
  let manifest = JSON.parse(readFileSync(join(root, '.agent-toolchain.json'), 'utf8'));
  assert.equal(manifest.managedFiles['.claude/rules/INDEX.md'], undefined);
  const verified = run(['verify', root]);
  assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`);

  const edited = legacyInstalled({ editIndex: true });
  const editedIndex = join(edited, '.claude', 'rules', 'INDEX.md');
  const kept = run(['plan', edited]);
  assert.match(kept.stdout, /keep\s+\.claude\/rules\/INDEX\.md/);
  assert.match(kept.stdout, /INDEX\.md: [^\n]*loads in every Claude Code session[^\n]*docs\/agent-parity\.md/);
  assert.equal(run(['apply', edited, '--write']).status, 0);
  assert.ok(existsSync(editedIndex));
  manifest = JSON.parse(readFileSync(join(edited, '.agent-toolchain.json'), 'utf8'));
  assert.equal(manifest.managedFiles['.claude/rules/INDEX.md'].kind, 'generated', 'still tracked, so uninstall sees it');
});
