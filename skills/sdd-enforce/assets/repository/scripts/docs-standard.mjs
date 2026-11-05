/**
 * The checks of the docs standard that a script can decide, for scripts/check-docs.mjs: where docs live, how they
 * are named, how large agent docs grow, and each migration's detect check. A migration that needs a reader's
 * judgment stays out; the docs audit asks it.
 *
 * Test fixtures (any path under evals/, fixture/, fixtures/, __fixtures__/ or testdata/) are outside every check,
 * as in the audit. docs/map.md is outside the migration checks: it names the old homes on purpose.
 */
import { basename, dirname } from 'node:path';
import { frontmatter, frontmatterList, frontmatterScalar, matchesGlob } from './sdd-lib.mjs';

const MAX_AGENTS_LINES = 200;
const MAX_SKILL_LINES = 500;
const MAX_DESCRIPTION = 1024;
const FIXTURE_DIR = /(?:^|\/)(?:evals|fixture|fixtures|__fixtures__|testdata)\//;
const MIGRATION_EXEMPT = ['docs/map.md'];

/**
 * The migrations a script can detect, ported from the docs standard. Two more are checks of their own below:
 * "agents-md-not-claude-md" and "kebab-case-doc-names". scripts/check-sdd.mjs reports a SPEC.md, the third glob
 * of "plans-in-jira-not-files", with the move it needs. The root AGENTS.md line that links the standard comes from
 * "docsStandardLine" in .agent-sdd/config.json.
 */
export const MIGRATIONS = [
  {
    slug: 'context-md-to-glossary-md',
    step: 'Rename CONTEXT.md to GLOSSARY.md and CONTEXT-MAP.md to GLOSSARY-MAP.md with "git mv", then update every reference outside docs/adr/.',
    detect: [{ glob: '**/CONTEXT.md' }, { glob: '**/CONTEXT-MAP.md' }, { rg: /CONTEXT(-MAP)?\.md/, glob: '**/*.md' }],
    exempt: ['**/docs/adr/**'],
  },
  {
    slug: 'plans-in-jira-not-files',
    step: 'A plan lives in its issue tracker ticket: attach it there and delete the file. When the work shipped, move what is still true into the living doc that owns it.',
    detect: ['**/docs/plans/**', '**/docs/superpowers/**', '**/specs/**/*.md', '**/.scratch/**', '**/tasks/plan.md', '**/tasks/todo.md'].map((glob) => ({ glob })),
    exempt: [],
  },
  {
    slug: 'spec-of-record-to-doc-of-record',
    step: 'Write "doc of record" instead of "spec of record".',
    detect: [{ rg: /spec of record/i, glob: '**/*.md' }],
    exempt: ['**/docs/adr/**', '**/docs/research/**'],
  },
  {
    slug: 'adr-status-in-frontmatter',
    step: "Move the status into the frontmatter as status: '<value>' and delete the status line from the body.",
    detect: [{ rg: /^(\*\*)?Status(\*\*)?:/, glob: '**/docs/adr/*.md' }],
    exempt: [],
  },
  {
    slug: 'research-notes-in-docs-research',
    step: 'Findings live in docs/research/<topic>.md. Replace the line that sends research to a scratchpad with a pointer to the docs map.',
    detect: [{ rg: /research (lives |stays |goes )?in the (session )?scratchpad/i, glob: '**/AGENTS.md' }],
    exempt: [],
  },
  {
    slug: 'writing-terms-out-of-glossary',
    step: 'Writing terms live in the vocabulary of the docs standard. Delete the "## Writing" section from the glossary.',
    detect: [{ rg: /^## Writing\b/, glob: '**/GLOSSARY.md' }],
    exempt: [],
  },
];

/** The writing terms of the docs standard. A repo GLOSSARY.md holds domain terms and none of these. */
export const WRITING_TERMS = [
  'Docs standard', 'Migration', 'Living doc', 'Doc of record', 'API contract', 'Spec', 'ADR', 'Research note', 'Rule',
  'Workspace', 'Doc type', 'Audience', 'Covered module',
];

/** A living doc states the code as it is. ADRs and research notes keep their date instead. */
export function isLivingDoc(path) {
  return !/(?:^|\/)docs\/(?:adr|research)\//.test(path);
}

const lineCount = (body) => body.replace(/\n$/, '').split('\n').length;

/**
 * Every finding of the standard's script checks, one line each with its fix.
 * `files`: repo-relative paths with forward slashes. `read(path)`: the file text with LF line ends.
 * `isIgnored(path)`: true for a file Git ignores; a local scratch file then hits no migration.
 */
export function standardProblems({ files, read, isIgnored = () => false }) {
  const problems = [];
  const fail = (message) => problems.push(message);
  const inScope = files.filter((path) => !FIXTURE_DIR.test(path));

  if (!inScope.includes('AGENTS.md')) {
    fail('missing AGENTS.md at the repository root. Create it with the gotchas every session needs; the sdd-enforce "apply --write" command adds its own lines.');
  }
  if (!inScope.includes('README.md')) {
    fail('missing README.md at the repository root. Say what the code is, then how to set it up and run it.');
  } else if (read('README.md').split('\n').filter((line) => line.trim()).filter((line) => !/^#{1,6}\s/.test(line)).length === 0) {
    fail('README.md holds only a heading. Say what the code is, then how to set it up and run it.');
  }

  for (const path of inScope) {
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
    if (name === 'SKILL.md') problems.push(...skillProblems(path, read(path)));
    if (name === 'GLOSSARY.md') problems.push(...glossaryProblems(path, read(path)));
  }

  for (const path of inScope.filter((item) => /^\.claude\/rules\/[^/]+\.md$/.test(item))) {
    const block = frontmatter(read(path));
    for (const glob of (block ? frontmatterList(block, 'paths') : null) ?? []) {
      if (!files.some((file) => matchesGlob(file, glob))) {
        fail(`${path}: the "paths:" glob "${glob}" matches no file, so the rule never loads there. Fix the glob or remove it.`);
      }
    }
  }

  problems.push(...migrationProblems(inScope, read, isIgnored));
  return problems;
}

function skillProblems(path, body) {
  const out = [];
  if (lineCount(body) >= MAX_SKILL_LINES) {
    out.push(`${path} has ${lineCount(body)} lines; keep a SKILL.md under ${MAX_SKILL_LINES}. Move reference material one level down into references/.`);
  }
  const block = frontmatter(body);
  const folder = basename(dirname(path));
  const name = block ? frontmatterScalar(block, 'name') : null;
  if (name !== folder) {
    out.push(`${path}: the frontmatter "name" is ${name === null ? 'missing' : `"${name}"`}; set it to the folder name "${folder}".`);
  }
  const description = block ? (frontmatterScalar(block, 'description') ?? '') : '';
  if (description.length > MAX_DESCRIPTION) {
    out.push(`${path}: the description has ${description.length} characters; keep it at most ${MAX_DESCRIPTION}.`);
  }
  return out;
}

function glossaryProblems(path, body) {
  const out = [];
  const writing = new Map(WRITING_TERMS.map((term) => [term.toLowerCase(), term]));
  for (const match of body.matchAll(/^\*\*([^*]+)\*\*:\s*$/gm)) {
    const term = match[1].trim();
    if (writing.has(term.toLowerCase())) {
      out.push(`${path}: the term "${term}" collides with the writing term "${writing.get(term.toLowerCase())}" of the docs standard. Delete it from the glossary, or give the domain term another name.`);
    }
  }
  return out;
}

function migrationProblems(files, read, isIgnored) {
  const out = [];
  for (const migration of MIGRATIONS) {
    const exempt = [...MIGRATION_EXEMPT, ...migration.exempt];
    const hits = new Set();
    for (const detect of migration.detect) {
      for (const path of files) {
        if (hits.has(path) || exempt.some((glob) => matchesGlob(path, glob)) || !matchesGlob(path, detect.glob)) continue;
        if (detect.rg && !read(path).split('\n').some((line) => detect.rg.test(line))) continue;
        hits.add(path);
      }
    }
    for (const path of hits) {
      if (!isIgnored(path)) out.push(`${path}: hits the docs standard migration "${migration.slug}". ${migration.step}`);
    }
  }
  return out;
}
