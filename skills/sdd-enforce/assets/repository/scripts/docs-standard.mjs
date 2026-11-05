/**
 * The checks of the docs standard that a script can decide, for scripts/check-docs.mjs: where docs live, how they
 * are named, how large agent docs grow, the ADR status, research notes, open check boxes, contract links, and each
 * migration's detect check. A migration that needs a reader's judgment stays out; the docs audit asks it.
 *
 * Test fixtures (any path under evals/, fixture/, fixtures/, __fixtures__/ or testdata/) are outside every check,
 * as in the audit. docs/map.md is outside the migration checks: it names the old homes on purpose.
 */
import { basename, dirname, posix } from 'node:path';
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

  problems.push(...adrProblems(inScope, read));
  problems.push(...researchNoteProblems(inScope, read));
  problems.push(...openBoxProblems(inScope, read));
  problems.push(...contractProblems(inScope, read));
  problems.push(...migrationProblems(inScope, read, isIgnored));
  return problems;
}

/** Repo-relative targets of the relative Markdown links in `path`, without anchors; escapes decoded. */
function linksIn(path, read) {
  const out = new Set();
  for (const match of read(path).matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    let target = match[1].replace(/^<|>$/g, '').split('#')[0].split('?')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    try {
      target = decodeURIComponent(target);
    } catch {
      // A bad escape stays literal and names no file.
    }
    out.add(posix.normalize(posix.join(posix.dirname(path), target)));
  }
  return out;
}

const ADR_FILE = /(?:^|\/)docs\/adr\/(\d{4})-[^/]+\.md$/;
const ADR_STATUS = /^(?:accepted(?: \(.+\))?|superseded(?: in part)? by ADR-\d{4} \([^)]*\)(?: and ADR-\d{4} \([^)]*\))*)$/;

/** Each ADR has a status in one of the standard's forms, and each ADR its status names exists and names it back. */
function adrProblems(files, read) {
  const out = [];
  const adrs = files.filter((path) => ADR_FILE.test(path));
  for (const path of adrs) {
    const block = frontmatter(read(path));
    const status = block ? frontmatterScalar(block, 'status') : null;
    if (!status) {
      out.push(`${path} has no "status:" in its frontmatter. Add status: 'accepted', or the superseded form that names the later ADR.`);
      continue;
    }
    if (!ADR_STATUS.test(status)) {
      out.push(`${path}: status "${status}" is not a standard form. Use 'accepted', 'superseded by ADR-NNNN (<what>, <date>)' or 'superseded in part by ADR-NNNN (<what>, <date>)', several joined with " and ".`);
      continue;
    }
    const number = path.match(ADR_FILE)[1];
    for (const [, later] of status.matchAll(/ADR-(\d{4})/g)) {
      const laterPath = adrs.find((item) => item.match(ADR_FILE)[1] === later && dirname(item) === dirname(path));
      if (!laterPath) {
        out.push(`${path}: the status names ADR-${later}, which does not exist. Fix the number, or write that ADR.`);
        continue;
      }
      const body = read(laterPath);
      const named = new RegExp(`ADR[- ]${number}\\b`).test(body) || linksIn(laterPath, read).has(path);
      if (!named) {
        out.push(`${laterPath} does not name ADR-${number}, which its status says it supersedes. Name ADR-${number} in its first paragraph.`);
      }
    }
  }
  return out;
}

/** A research note has its date and question in frontmatter, and the Findings and Not covered sections. */
function researchNoteProblems(files, read) {
  const out = [];
  for (const path of files.filter((item) => /(?:^|\/)docs\/research\/[^/]+\.md$/.test(item) && basename(item) !== 'README.md')) {
    const body = read(path);
    const block = frontmatter(body);
    const date = block ? frontmatterScalar(block, 'date') : null;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) out.push(`${path} needs frontmatter "date:" as YYYY-MM-DD, the day the findings were true.`);
    if (!block || !frontmatterScalar(block, 'question')) out.push(`${path} needs frontmatter "question:", the one question the note answers.`);
    for (const heading of ['## Findings', '## Not covered']) {
      if (!body.split('\n').some((line) => line.trim() === heading)) out.push(`${path} needs a "${heading}" section.`);
    }
  }
  return out;
}

/** An open check box in a living doc is open work, which belongs in the issue tracker. Fenced examples do not count. */
function openBoxProblems(files, read) {
  const out = [];
  for (const path of files.filter((item) => item.endsWith('.md') && isLivingDoc(item))) {
    let fenced = false;
    read(path).split('\n').forEach((line, index) => {
      if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
      else if (!fenced && /^\s*[-*] \[ \]/.test(line)) {
        out.push(`${path}:${index + 1}: an open check box is open work. A living doc states the current code: move the item to the issue tracker and delete the line.`);
      }
    });
  }
  return out;
}

/**
 * An API contract is linked from the AGENTS.md of the workspace that holds it. A contract in the root docs/ is
 * shared, so at least one AGENTS.md links it; which ones read the wire is a judgment the audit makes.
 */
function contractProblems(files, read) {
  const out = [];
  const agentsFiles = files.filter((path) => basename(path) === 'AGENTS.md');
  for (const path of files.filter((item) => /(?:^|\/)docs\/[^/]+-contract\.md$/.test(item))) {
    const workspace = dirname(dirname(path));
    if (workspace !== '.') {
      const agents = `${workspace}/AGENTS.md`;
      if (!files.includes(agents) || !linksIn(agents, read).has(path)) {
        out.push(`${agents} does not link ${path}. Each workspace that serves or reads a wire links its API contract from its AGENTS.md.`);
      }
    } else if (!agentsFiles.some((agents) => linksIn(agents, read).has(path))) {
      out.push(`${path}: no AGENTS.md links this API contract. Link it from the AGENTS.md of each workspace that serves or reads the wire.`);
    }
  }
  return out;
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
