#!/usr/bin/env node
// The commit and versioning convention as code. docs/rules/git.md and docs/rules/versioning.md
// state the rules in prose and this script enforces them. When the two disagree, change one of
// them so that they match again.
//
// It needs only Node and git, so the same file runs as the commit-msg hook, in CI
// (.github/workflows/conventions.yml) and by hand:
//
//   node scripts/check-commits.mjs msg <file>
//       one commit message (the commit-msg hook)
//   node scripts/check-commits.mjs range <rev-range>
//       every commit in a pull request
//   node scripts/check-commits.mjs pr-title <title> --base <ref> [--fix] [--body-file <file>] [--head-ref <branch>]
//       the pull request title, which becomes the squash commit, and the PR body;
//       with --fix, print the title with the right version instead of checking it
//   node scripts/check-commits.mjs head [--base <ref>]
//       the commits that landed on main since <ref> (default HEAD^)
//   node scripts/check-commits.mjs next [--base <ref>] [--minor | --major]
//       print the next version (default: the next patch version on origin/main)
//   node scripts/check-commits.mjs release [--ref <ref>]
//       print the tag to create if <ref> (default HEAD) carries a new minor or major version
//
// Versions: the previous version on a ref is the highest "vX.Y.Z " subject prefix on its
// first-parent history or the highest vX.Y.Z tag merged into it, whichever is greater, and
// v0.0.0 when there is neither. After it, only the next patch (Z+1), minor (Y+1, Z=0) or
// major (X+1, Y=Z=0) version is legal.
//
// Exit codes: 0 pass, 1 convention violated, 2 usage or environment error.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const MAIN = 'main';
export const TYPES = ['feat', 'fix', 'words', 'docs', 'refactor', 'test', 'chore', 'ci', 'perf', 'revert'];
export const BRANCH_TYPES = TYPES.filter((type) => type !== 'revert');
export const SUBJECT_MAX = 72;
const RULES = 'docs/rules/git.md and docs/rules/versioning.md';

const TYPE_RE = new RegExp(`^(${TYPES.join('|')}): `);
const BRANCH_RE = new RegExp(`^(${BRANCH_TYPES.join('|')})/[a-z0-9]+(-[a-z0-9]+)*$`);
const VERSION_PREFIX_RE = /^v(\d+)\.(\d+)\.(\d+) (?=\S)/;
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
const FIXUP_RE = /^(fixup|squash|amend)! /;
const PRINTABLE_ASCII_RE = /^[\x20-\x7e]+$/;
// CJK punctuation and ideographs (U+3000 to U+9FFF) and fullwidth forms (U+FF00 to U+FF7F).
const CHINESE_RE = /[\u3000-\u9fff\uff00-\uff7f]/;
const REVERTS_RE = /^this reverts commit [0-9a-f]{7,40}\b/im;
const SCISSORS_RE = /^# -+ >8 -+$/m;
const PR_NUMBER_RE = / \(#\d+\)$/; // GitHub appends this to the subject of a squash merge

const AGENTS = 'claude|anthropic|codex|openai|chatgpt|copilot|cursor|gemini|devin|aider|windsurf';
// Each pattern is tested against every line, ignoring case. Trailers and footers must open the
// line, so prose that merely names one, as the rules themselves do, is not attribution. Agent
// email addresses and links to AI sessions count anywhere.
export const ATTRIBUTION = [
  [
    new RegExp(`^\\s*(co-authored-by|signed-off-by|assisted-by|generated-by|helped-by):.*\\b(${AGENTS})\\b`, 'i'),
    'an AI co-author or sign-off trailer',
  ],
  [new RegExp(`^[^\\p{L}\\p{N}]*generated (with|by) .*\\b(${AGENTS})\\b`, 'iu'), 'a "Generated with" footer'],
  [/^\s*claude-session:/i, 'a Claude-Session trailer'],
  [/noreply@(anthropic|openai)\.com/i, 'an AI agent email address'],
  [/claude\.ai\/code\/session|chatgpt\.com\/codex/i, 'a link to an AI session'],
];
const AGENT_EMAILS = ['noreply@anthropic.com', 'noreply@openai.com'];
const LOG_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x1e';

export class GitError extends Error {}

const problem = (where, rule, detail) => ({ where, rule, detail });
const firstLine = (message) => message.split('\n', 1)[0];

// --------------------------------------------------------------------------------------------
// Pure rules
// --------------------------------------------------------------------------------------------

// Normalizes a message the way git does before storing it: drops a byte order mark, normalizes
// line endings, cuts everything from the scissors line that `git commit --verbose` adds, drops
// comment lines (unless the message already comes from `git log`) and trims blank lines.
export function cleanMessage(raw, { stripComments = true } = {}) {
  let text = raw.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  let lines;
  if (stripComments) {
    const cut = text.search(SCISSORS_RE);
    if (cut !== -1) text = text.slice(0, cut);
    lines = text.split('\n').filter((line) => !line.startsWith('#'));
  } else {
    lines = text.split('\n');
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return lines.join('\n');
}

// Returns [version, rest] for a "vX.Y.Z <rest>" subject, or [null, subject].
export function splitVersion(subject) {
  const match = subject.match(VERSION_PREFIX_RE);
  if (!match) return [null, subject];
  return [[Number(match[1]), Number(match[2]), Number(match[3])], subject.slice(match[0].length)];
}

export function parseTag(tag) {
  const match = tag.match(TAG_RE);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export const formatVersion = (version) => `v${version.join('.')}`;
const compareVersions = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const sameVersion = (a, b) => Boolean(a && b) && compareVersions(a, b) === 0;

// The three legal versions after `previous`.
export function successors([x, y, z]) {
  return { patch: [x, y, z + 1], minor: [x, y + 1, 0], major: [x + 1, 0, 0] };
}

const isSuccessor = (version, previous) =>
  Object.values(successors(previous)).some((next) => sameVersion(next, version));

// Subject rules. `version` is 'required', 'forbidden' or 'optional'.
export function checkSubject(subject, where, { version: versionRule }) {
  const problems = [];
  const add = (rule, detail) => problems.push(problem(where, rule, detail));
  const [version, rest] = splitVersion(subject);
  if (versionRule === 'required' && !version) {
    add('version', `the subject must start with "vX.Y.Z ": "${subject}"`);
  }
  if (versionRule === 'forbidden' && version) {
    add('version', 'branch commits carry no version; the pull request title gets it');
  }
  if (!subject.trim()) {
    add('subject', 'the subject is empty');
    return problems;
  }
  if (!PRINTABLE_ASCII_RE.test(subject)) {
    add('english', `the subject must be in English, using printable ASCII only: "${subject}"`);
  }
  if (subject.length > SUBJECT_MAX) {
    add('length', `the subject is ${subject.length} characters long; the limit is ${SUBJECT_MAX}`);
  }
  if (subject !== subject.trim()) add('whitespace', 'the subject has leading or trailing whitespace');
  if (subject.trimEnd().endsWith('.')) add('period', 'the subject must not end with a period');
  const typed = rest.match(TYPE_RE);
  if (!typed) {
    add('type', `the subject must start with "<type>: ", where <type> is one of ${TYPES.join(', ')}: "${rest}"`);
    return problems;
  }
  const summary = rest.slice(typed[0].length);
  if (!/^[a-z0-9]/.test(summary)) {
    add('lowercase', `the summary must start with a lowercase letter or a digit: "${summary}"`);
  }
  return problems;
}

export function checkAttribution(message, where) {
  const problems = [];
  message.split('\n').forEach((line, index) => {
    const hit = ATTRIBUTION.find(([pattern]) => pattern.test(line));
    if (hit) {
      problems.push(problem(where, 'attribution', `${hit[1]} on line ${index + 1}: "${line.trim()}"`));
    }
  });
  return problems;
}

// The subject is covered by the printable-ASCII rule, so this looks at the body only.
function checkBodyEnglish(lines, where) {
  return lines.slice(1).flatMap((line, index) =>
    CHINESE_RE.test(line)
      ? [problem(where, 'english', `line ${index + 2} contains Chinese text: "${line.trim()}"`)]
      : [],
  );
}

// Subject, structure, language and attribution rules for one cleaned message.
export function checkMessage(message, where, { version, allowFixup = false }) {
  const lines = message.split('\n');
  let subject = lines[0] ?? '';
  const problems = [];
  if (FIXUP_RE.test(subject)) {
    if (!allowFixup) problems.push(problem(where, 'fixup', 'fixup! and squash! commits must be squashed first'));
    subject = subject.replace(FIXUP_RE, '');
  }
  problems.push(...checkSubject(subject, where, { version }));
  if (lines.length > 1 && lines[1].trim()) {
    problems.push(problem(where, 'blank-line', 'leave a blank line between the subject and the body'));
  }
  const [, rest] = splitVersion(subject);
  if (rest.startsWith('revert: ') && !REVERTS_RE.test(message)) {
    problems.push(problem(where, 'revert', 'a revert keeps the "This reverts commit <sha>." line that git writes'));
  }
  problems.push(...checkBodyEnglish(lines, where), ...checkAttribution(message, where));
  return problems;
}

export function checkIdentity(commit, where) {
  return [
    ['author', commit.authorName, commit.authorEmail],
    ['committer', commit.committerName, commit.committerEmail],
  ].flatMap(([role, name, email]) =>
    AGENT_EMAILS.includes(email.toLowerCase())
      ? [problem(where, 'identity', `the ${role}, ${name} <${email}>, is an AI agent address`)]
      : [],
  );
}

export function checkSuccessor(version, previous, where) {
  if (isSuccessor(version, previous)) return [];
  const { patch, minor, major } = successors(previous);
  return [
    problem(
      where,
      'version',
      `after ${formatVersion(previous)} the version must be ${formatVersion(patch)} (patch), ` +
        `${formatVersion(minor)} (minor) or ${formatVersion(major)} (major), not ${formatVersion(version)}`,
    ),
  ];
}

// The root package.json, when there is one, holds the minor line X.Y.0 of the current version.
export function checkPackageJson(version, text, where) {
  if (text === null) return [];
  const want = `${version[0]}.${version[1]}.0`;
  let got;
  try {
    got = JSON.parse(text).version;
  } catch {
    return [problem(where, 'package.json', 'package.json is not valid JSON')];
  }
  if (got === want) return [];
  return [
    problem(
      where,
      'package.json',
      `package.json has version "${got}", but ${formatVersion(version)} needs "${want}" (its minor line)`,
    ),
  ];
}

// The title a pull request landing after `previous` must carry. A legal next version already in
// the title is kept: that is how a maintainer asks for a minor or major version. A minor or
// major version that went stale because another PR took it moves to the next one of the same
// kind. Anything else (no version, a reused, skipped or older number) becomes the next patch.
export function fixedTitle(title, previous) {
  const [version, rest] = splitVersion(title.trim());
  const next = successors(previous);
  if (version && isSuccessor(version, previous)) return title.trim();
  if (version && version[2] === 0 && version[1] > 0) return `${formatVersion(next.minor)} ${rest}`;
  if (version && version[2] === 0 && version[1] === 0 && version[0] > 0) return `${formatVersion(next.major)} ${rest}`;
  return `${formatVersion(next.patch)} ${rest}`;
}

// --------------------------------------------------------------------------------------------
// Git
// --------------------------------------------------------------------------------------------

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw new GitError(`could not run git: ${result.error.message}`);
  return result;
}

function git(...args) {
  const result = runGit(args);
  if (result.status !== 0) {
    throw new GitError(`git ${args.join(' ')}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

const gitOk = (...args) => runGit(args).status === 0;

// The current branch, or null when HEAD is detached.
function currentBranch() {
  const result = runGit(['symbolic-ref', '--short', '-q', 'HEAD']);
  if (result.status === 0) return result.stdout.trim();
  if (result.status === 1) return null;
  throw new GitError(`git symbolic-ref: ${result.stderr.trim()}`);
}

export function previousVersion(base) {
  let best = null;
  const consider = (version) => {
    if (version && (!best || compareVersions(version, best) > 0)) best = version;
  };
  for (const subject of git('log', '--first-parent', '--format=%s', base).split('\n')) {
    consider(splitVersion(subject)[0]);
  }
  for (const tag of git('tag', '--merged', base, '--list', 'v[0-9]*').split('\n')) {
    consider(parseTag(tag.trim()));
  }
  return best ?? [0, 0, 0];
}

function commits(revRange, { firstParent = false } = {}) {
  const args = ['log', '--reverse', `--format=${LOG_FORMAT}`, ...(firstParent ? ['--first-parent'] : []), revRange];
  return git(...args)
    .split('\x1e')
    .map((record) => record.replace(/^\n+|\n+$/g, ''))
    .filter(Boolean)
    .map((record) => {
      const [sha, parents, authorName, authorEmail, committerName, committerEmail, ...body] = record.split('\x00');
      return {
        sha,
        parents: parents.split(' ').filter(Boolean),
        authorName,
        authorEmail,
        committerName,
        committerEmail,
        message: body.join('\x00'),
      };
    });
}

function rootPackageJson() {
  const path = join(git('rev-parse', '--show-toplevel').trim(), 'package.json');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

// --------------------------------------------------------------------------------------------
// Modes
// --------------------------------------------------------------------------------------------

function modeMsg(file) {
  const message = cleanMessage(readFileSync(file, 'utf8'));
  const where = 'message';
  if (gitOk('rev-parse', '-q', '--verify', 'MERGE_HEAD')) {
    return { problems: checkAttribution(message, where), note: 'merge commit: attribution rules only' };
  }
  const branch = currentBranch();
  if (branch === null) {
    return {
      problems: checkMessage(message, where, { version: 'optional', allowFixup: true }),
      note: 'detached HEAD: the version prefix is optional',
    };
  }
  if (branch !== MAIN) {
    return {
      problems: checkMessage(message, where, { version: 'forbidden', allowFixup: true }),
      note: `branch ${branch}`,
    };
  }
  // The pre-commit hook blocks commits on main, so this is a deliberate recovery commit. Like a
  // squash merge, it must carry the next version.
  const problems = checkMessage(message, where, { version: 'required' });
  const [version] = splitVersion(firstLine(message));
  if (version && gitOk('rev-parse', '-q', '--verify', 'HEAD')) {
    const [headVersion] = splitVersion(git('log', '-1', '--format=%s', 'HEAD').trim());
    if (!sameVersion(version, headVersion)) {
      // An equal version means `git commit --amend`.
      problems.push(...checkSuccessor(version, previousVersion('HEAD'), where));
    }
    problems.push(...checkPackageJson(version, rootPackageJson(), where));
  }
  return { problems, note: 'main: the subject must carry the next version' };
}

function modeRange(revRange) {
  const problems = [];
  const list = commits(revRange);
  for (const commit of list) {
    const where = commit.sha.slice(0, 7);
    const message = cleanMessage(commit.message, { stripComments: false });
    if (commit.parents.length > 1 || commit.authorName.endsWith('[bot]')) {
      problems.push(...checkAttribution(message, where));
    } else {
      problems.push(...checkMessage(message, where, { version: 'forbidden', allowFixup: true }));
    }
    problems.push(...checkIdentity(commit, where));
  }
  return { problems, note: `${list.length} commit(s) in ${revRange}` };
}

function modePrTitle(title, options) {
  if (!options.base) throw new UsageError('pr-title needs --base <ref>');
  const previous = previousVersion(options.base);
  if (options.fix) {
    console.log(fixedTitle(title, previous));
    return null;
  }
  const where = 'pr-title';
  const problems = [
    ...checkSubject(title.trim(), where, { version: 'required' }),
    ...checkAttribution(title, where),
  ];
  const [version] = splitVersion(title.trim());
  if (version) {
    problems.push(...checkSuccessor(version, previous, where));
    problems.push(...checkPackageJson(version, rootPackageJson(), where));
  }
  if (options['body-file']) {
    const body = cleanMessage(readFileSync(options['body-file'], 'utf8'), { stripComments: false });
    problems.push(...checkAttribution(body, 'pr-body'));
  }
  const branch = options['head-ref'];
  if (branch && !BRANCH_RE.test(branch)) {
    problems.push(
      problem(where, 'branch', `the branch "${branch}" must be named <type>/<kebab-case-description>, with <type> one of ${BRANCH_TYPES.join(', ')}`),
    );
  }
  return { problems, note: `"${title.trim()}" against ${options.base}` };
}

function modeHead(options) {
  let base = options.base || 'HEAD^';
  if (/^0+$/.test(base)) base = 'HEAD^'; // GitHub sends all zeros for the first push of a branch
  if (!gitOk('merge-base', '--is-ancestor', base, 'HEAD')) {
    throw new GitError(`${base} is not an ancestor of HEAD; was main force-pushed?`);
  }
  const problems = [];
  const list = commits(`${base}..HEAD`, { firstParent: true });
  for (const commit of list) {
    const where = commit.sha.slice(0, 7);
    const cleaned = cleanMessage(commit.message, { stripComments: false });
    const [subject, ...body] = cleaned.split('\n');
    const message = [subject.replace(PR_NUMBER_RE, ''), ...body].join('\n');
    problems.push(...checkMessage(message, where, { version: 'required' }));
    const [version] = splitVersion(subject);
    if (version && commit.parents.length) {
      problems.push(...checkSuccessor(version, previousVersion(commit.parents[0]), where));
    }
    problems.push(...checkIdentity(commit, where));
  }
  const last = list.at(-1);
  const [version] = last ? splitVersion(firstLine(last.message)) : [null];
  if (version) problems.push(...checkPackageJson(version, rootPackageJson(), last.sha.slice(0, 7)));
  return { problems, note: `${list.length} commit(s) landed since ${base}` };
}

function modeNext(options) {
  const base = options.base || `origin/${MAIN}`;
  const previous = previousVersion(base);
  const kind = options.major ? 'major' : options.minor ? 'minor' : 'patch';
  console.log(formatVersion(successors(previous)[kind]));
  console.error(`check-commits: after ${formatVersion(previous)} on ${base}; run \`git fetch origin\` first if in doubt`);
  return 0;
}

function modeRelease(options) {
  const ref = options.ref || 'HEAD';
  const [version] = splitVersion(git('log', '-1', '--format=%s', ref).trim());
  const isRelease = version && version[2] === 0 && (version[0] > 0 || version[1] > 0);
  if (isRelease) {
    const tag = formatVersion(version);
    if (!gitOk('rev-parse', '-q', '--verify', `refs/tags/${tag}`)) console.log(tag);
  }
  return 0;
}

// --------------------------------------------------------------------------------------------
// Command line
// --------------------------------------------------------------------------------------------

class UsageError extends Error {}

const USAGE = `Usage:
  node scripts/check-commits.mjs msg <file>
  node scripts/check-commits.mjs range <rev-range>
  node scripts/check-commits.mjs pr-title <title> --base <ref> [--fix] [--body-file <file>] [--head-ref <branch>]
  node scripts/check-commits.mjs head [--base <ref>]
  node scripts/check-commits.mjs next [--base <ref>] [--minor | --major]
  node scripts/check-commits.mjs release [--ref <ref>]`;

const OPTIONS = {
  base: { type: 'string' },
  fix: { type: 'boolean' },
  'body-file': { type: 'string' },
  'head-ref': { type: 'string' },
  minor: { type: 'boolean' },
  major: { type: 'boolean' },
  ref: { type: 'string' },
};

function report({ problems, note }, { quiet = false } = {}) {
  for (const { where, rule, detail } of problems) {
    const line = `${where} ${rule}: ${detail}`;
    console.log(`check-commits: ${line}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=check-commits::${line}`);
  }
  if (problems.length) {
    console.log(`check-commits: ${problems.length} problem(s). See ${RULES}.`);
    return 1;
  }
  if (!quiet) console.log(`check-commits: OK (${note})`);
  return 0;
}

export function main(argv) {
  try {
    const { values: options, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
    const [mode, argument, ...extra] = positionals;
    const needsArgument = ['msg', 'range', 'pr-title'].includes(mode);
    if (extra.length || (needsArgument && argument === undefined) || (!needsArgument && argument !== undefined)) {
      throw new UsageError(`wrong arguments for ${mode ?? 'check-commits'}`);
    }
    switch (mode) {
      case 'msg':
        return report(modeMsg(argument), { quiet: true });
      case 'range':
        return report(modeRange(argument));
      case 'pr-title': {
        const result = modePrTitle(argument, options);
        return result ? report(result) : 0;
      }
      case 'head':
        return report(modeHead(options));
      case 'next':
        return modeNext(options);
      case 'release':
        return modeRelease(options);
      default:
        throw new UsageError(mode ? `unknown mode "${mode}"` : 'no mode given');
    }
  } catch (error) {
    if (error instanceof UsageError || error.code?.startsWith('ERR_PARSE_ARGS')) {
      console.error(`check-commits: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    if (error instanceof GitError || error.code === 'ENOENT') {
      console.error(`check-commits: error: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
