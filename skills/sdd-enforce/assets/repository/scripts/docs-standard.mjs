/**
 * The checks of the docs standard that a script can decide, for scripts/check-docs.mjs: where docs live, how they
 * are named, how large agent docs grow, the ADR status in both directions, research notes, open check boxes and
 * signature lines in a doc of record, the source file that names each API contract, and each migration's detect
 * check. A migration that needs a reader's judgment stays out; the docs audit asks it. standardWarnings() lists what
 * a script can only suspect: history words and dates in a doc of record, and a name that reads as a dated copy.
 *
 * Test fixtures (any path under evals/, fixture/, fixtures/, __fixtures__/ or testdata/) are outside every check,
 * as in the audit. docs/map.md is outside the migration checks: it names the old homes on purpose.
 */
import { basename, dirname, posix } from 'node:path';
import { FIXTURE_DIR, docOfRecord, frontmatter, frontmatterList, frontmatterScalar, matchesGlob } from './sdd-lib.mjs';

const MAX_AGENTS_LINES = 200;
const MAX_SKILL_LINES = 500;
const MAX_DESCRIPTION = 1024;
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
  'Workspace', 'Doc type', 'Audience', 'Gotcha', 'Header comment', 'Look-up', 'Missed fact', 'Dated copy', 'Legacy code',
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
  problems.push(...interfaceProblems(inScope, read));
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
    // Only a superseded status names a superseding ADR. An accepted ADR may name others in its note.
    if (!status.startsWith('superseded')) continue;
    const number = path.match(ADR_FILE)[1];
    for (const [, later] of status.matchAll(/ADR-(\d{4})/g)) {
      const laterPath = adrs.find((item) => item.match(ADR_FILE)[1] === later && dirname(item) === dirname(path));
      if (!laterPath) {
        out.push(`${path}: the status names ADR-${later}, which does not exist. Fix the number, or write that ADR.`);
        continue;
      }
      // An ADR names another as ADR-0005, ADR 5, a link to its file, or by its decision id: D5 or §D5.
      const id = String(Number(number));
      const body = read(laterPath);
      const named = new RegExp(`(?:\\bADR[- ]0*${id}|(?:§|\\b)D0*${id})\\b`).test(body) || linksIn(laterPath, read).has(path);
      if (!named) {
        out.push(`${laterPath} does not name ADR-${number}, which its status says it supersedes. Name ADR-${number} in its first paragraph.`);
      }
    }
  }
  return [...out, ...supersededSilently(adrs, read)];
}

/**
 * The other direction: an ADR whose text says it supersedes an older one, while the status of the older one does not
 * name it. "supersedes ADR-0002" and "superseding ADR 2" claim it; "does not supersede" and a bare mention do not.
 */
function supersededSilently(adrs, read) {
  const out = [];
  const seen = new Set();
  for (const path of adrs) {
    const number = path.match(ADR_FILE)[1];
    const text = read(path).replace(/^---\n[\s\S]*?\n---\n/, '');
    for (const [, clause] of text.matchAll(/\bsupersed(?:es|ing)\b([^.\n]*)/gi)) {
      for (const [, older] of clause.matchAll(/\bADR[- ]0*(\d+)\b/g)) {
        const olderPath = adrs.find((item) => Number(item.match(ADR_FILE)[1]) === Number(older) && dirname(item) === dirname(path));
        if (!olderPath || olderPath === path || seen.has(`${olderPath}|${number}`)) continue;
        seen.add(`${olderPath}|${number}`);
        const block = frontmatter(read(olderPath));
        const status = block ? frontmatterScalar(block, 'status') : null;
        // A missing or malformed status has its own line above.
        if (!status || !ADR_STATUS.test(status)) continue;
        if (![...status.matchAll(/ADR-(\d{4})/g)].some(([, named]) => named === number)) {
          out.push(`${olderPath}: ADR-${number} says it supersedes this ADR, but the status does not name ADR-${number}. Set status: 'superseded by ADR-${number} (<what>, <date>)', or append " and ADR-${number} (<what>, <date>)" to a superseded status.`);
        }
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

/**
 * An open check box in a doc of record is open work, which belongs in the issue tracker. A checklist in a guide or
 * a skill is a procedure, so other docs keep theirs. Fenced examples never count.
 */
function openBoxProblems(files, read) {
  const out = [];
  for (const path of files.filter((item) => item.endsWith('.md') && isLivingDoc(item) && docOfRecord(item, read(item)))) {
    let fenced = false;
    read(path).split('\n').forEach((line, index) => {
      if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
      else if (!fenced && /^\s*[-*] \[ \]/.test(line)) {
        out.push(`${path}:${index + 1}: an open check box is open work. A doc of record states the current code: move the item to the issue tracker and delete the line.`);
      }
    });
  }
  return out;
}

/**
 * A line of the Interfaces section that starts with "fn:" or "type:" copies a signature or a type. The source declares
 * both, so the copy is a look-up that goes stale. "§I" is the heading of a repository with its own encoding.
 */
function interfaceProblems(files, read) {
  const out = [];
  for (const path of files.filter((item) => item.endsWith('.md') && isLivingDoc(item) && docOfRecord(item, read(item)))) {
    let fenced = false;
    let interfaces = false;
    read(path).split('\n').forEach((line, index) => {
      if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
      else if (!fenced && /^##\s/.test(line)) interfaces = /^##\s+(?:Interfaces|§I)\b/.test(line);
      else if (interfaces && /^\s*(?:fn|type):\s/.test(line)) {
        const kind = line.trim().split(':')[0];
        out.push(`${path}:${index + 1}: the "${kind}:" line restates what the source declares, and a copy goes stale. Delete the line, and write a rule about the function or type as an invariant.`);
      }
    });
  }
  return out;
}

// A file with no comment syntax, or no text, has no header comment that could name a contract.
const NOT_SOURCE = /(?:\.(?:md|mdc|json|lock|png|jpe?g|gif|svg|ico|pdf|woff2?|ttf|eot|zip|gz|tgz|jar|map|snap)|(?:^|\/)pnpm-lock\.yaml)$/i;

/**
 * The header comment of each source file that serves or reads a wire links its API contract. A script cannot tell
 * which files those are, so the check is: at least one source file names the contract file. A contract in
 * <workspace>/docs/ belongs to that workspace, so a file of that workspace names it. A contract in the root docs/ is
 * shared, so any source file may.
 */
function contractProblems(files, read) {
  const contracts = files
    .filter((item) => /(?:^|\/)docs\/[^/]+-contract\.md$/.test(item))
    .map((path) => {
      const workspace = dirname(dirname(path));
      return { path, name: basename(path), workspace, prefix: workspace === '.' ? '' : `${workspace}/`, named: false };
    });
  if (!contracts.length) return [];
  for (const source of files) {
    if (NOT_SOURCE.test(source)) continue;
    const open = contracts.filter((contract) => !contract.named && source.startsWith(contract.prefix));
    if (!open.length) continue;
    const body = read(source);
    for (const contract of open) contract.named = body.includes(contract.name);
  }
  const fix = 'Name its path in the header comment of each source file that serves or reads the wire.';
  return contracts
    .filter((contract) => !contract.named)
    .map((contract) =>
      contract.prefix
        ? `${contract.path}: no source file under ${contract.workspace} names this API contract. ${fix} A wire that another workspace also serves or reads has its contract in the root docs/.`
        : `${contract.path}: no source file names this API contract. ${fix}`,
    );
}

const HISTORY_WORDS = /\b(used to|no longer|any ?more|was fixed|known gap|revisit|not chosen|today|planned)\b/i;
const ISO_DATE = /\b(?:19|20)\d\d-\d\d-\d\d\b/;
const DATED_COPY = /(?:^|\/)archive\/|(?:[-_.]old|[-_.](?:19|20)\d\d|\.v\d+)\.md$/i;

/**
 * What a script can suspect and only a reader can decide, one line each. The gate prints these and stays green:
 * a history word or a date in a doc of record (fenced examples never count), and a living doc whose name reads as a
 * dated copy (setup-old.md, setup-2025.md, setup.v1.md, a file under archive/).
 */
export function standardWarnings({ files, read }) {
  const out = [];
  for (const path of files.filter((item) => item.endsWith('.md') && !FIXTURE_DIR.test(item) && isLivingDoc(item))) {
    if (DATED_COPY.test(path)) {
      out.push(`${path}: the name reads as a dated copy of a living doc. Fold what the living doc lacks into it and delete this file. Git keeps the history.`);
    }
    if (!docOfRecord(path, read(path))) continue;
    let fenced = false;
    read(path).split('\n').forEach((line, index) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        fenced = !fenced;
        return;
      }
      if (fenced) return;
      const word = line.match(HISTORY_WORDS)?.[1];
      const date = line.match(ISO_DATE)?.[0];
      if (word) {
        out.push(`${path}:${index + 1}: "${word}" reads as history or a plan. A doc of record states the current code: state the rule as it is now, and put open work in the issue tracker.`);
      } else if (date) {
        out.push(`${path}:${index + 1}: the date ${date} reads as history. A doc of record states the current code, and Git keeps the history: delete the date.`);
      }
    });
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
