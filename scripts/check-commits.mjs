#!/usr/bin/env node
// The commit and versioning convention as code. docs/rules/git.md and docs/rules/versioning.md
// state the rules in prose and this script enforces them. When the two disagree, change one of
// them so that they match again.
//
// It also keeps the name of the board game the first game is based on out of commit messages,
// pull request titles and bodies, and branch names (docs/rules/constraints.md). The spellings of
// the name and the search for them live in scripts/check-names.mjs, which checks the files.
//
// It needs only Node and git, so the same file runs as the commit-msg hook, in CI
// (.github/workflows/conventions.yml) and by hand:
//
//   node scripts/check-commits.mjs msg <file>
//       one commit message (the commit-msg hook)
//   node scripts/check-commits.mjs range <rev-range>
//       every commit in a pull request
//   node scripts/check-commits.mjs pr-title --base <ref> [--head <ref>] [--fix [--patch]] [--body-file <file>] [--head-ref <branch>] -- <title>
//       the pull request title, which becomes the squash commit, and the PR body;
//       with --fix, print the title with the right version instead of checking it, and with
//       --fix --patch, print it with the next patch version even if it asks for a minor or
//       major one. --head <ref> names the PR's head commit: if the PR changes only docs for
//       people, its title takes no version, and --fix takes any version out
//   node scripts/check-commits.mjs head [--base <ref>]
//       the commits that landed on main since <ref> (default HEAD^)
//   node scripts/check-commits.mjs next [--base <ref>] [--minor | --major]
//       print the next version (default: the next patch version on origin/main)
//   node scripts/check-commits.mjs release [--ref <ref>]
//       print "<tag>\t<sha>" for every minor or major version on <ref> (default HEAD) that has
//       no tag yet, oldest first
//
// Versions: the previous version on a ref is the highest "vX.Y.Z " subject prefix on its
// first-parent history or the highest vX.Y.Z tag merged into it, whichever is greater, and
// v0.0.0 when there is neither. After it, only the next patch (Z+1), minor (Y+1, Z=0) or
// major (X+1, Y=Z=0) version is legal. A pull request that changes only docs for people
// (UNVERSIONED_RE) takes no version, nor does its squash commit on main.
//
// Exit codes: 0 pass, 1 convention violated, 2 usage or environment error.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { findSpellings, masked } from './check-names.mjs';

export const MAIN = 'main';
export const TYPES = ['feat', 'fix', 'words', 'docs', 'refactor', 'test', 'chore', 'ci', 'perf', 'revert'];
export const BRANCH_TYPES = TYPES.filter((type) => type !== 'revert');
export const SUBJECT_MAX = 72;
const RULES = 'docs/rules/git.md and docs/rules/versioning.md';
const NAME_RULES = 'docs/rules/constraints.md';

const TYPE_RE = new RegExp(`^(${TYPES.join('|')}): `);
const BRANCH_RE = new RegExp(`^(${BRANCH_TYPES.join('|')})/[a-z0-9]+(-[a-z0-9]+)*$`);
const VERSION_PREFIX_RE = /^v(\d+)\.(\d+)\.(\d+) (?=\S)/;
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
// The docs written for people to read: ACKNOWLEDGMENTS.md, SPONSORS.md, the READMEs,
// CONTRIBUTING.md and docs/ apart from docs/rules/. A pull request that changes nothing else lands
// without a version. The rules, the licenses and everything else take one.
const UNVERSIONED_RE =
  /^(?:ACKNOWLEDGMENTS\.md|SPONSORS\.md|README\.md|README\.zh-CN\.md|CONTRIBUTING\.md|docs\/(?!rules\/).+)$/;
// A fixup of a fixup commit stacks the prefixes: "fixup! fixup! <subject>".
const FIXUP_RE = /^((fixup|squash|amend)! )+/;
const PRINTABLE_ASCII_RE = /^[\x20-\x7e]+$/;
// CJK punctuation and ideographs (U+3000 to U+9FFF) and fullwidth forms (U+FF00 to U+FF7F).
const CHINESE_RE = /[\u3000-\u9fff\uff00-\uff7f]/;
const REVERTS_RE = /^this reverts commit [0-9a-f]{7,40}\b/im;
const SCISSORS_RE = /^ -+ >8 -+$/; // after the comment string, on the line `git commit --verbose` adds
const PR_NUMBER_RE = / \(#\d+\)$/; // GitHub appends this to the subject of a squash merge

// AI coding assistants, by the product names under which they sign commits. A name is an agent
// when it is one of these on its own or followed by a model, version or role, as in "Claude
// Opus 5.5", "GitHub Copilot" or "Cursor Agent". A person who shares a first name with one,
// such as "Claude Dupont", is not.
const AGENTS = 'claude|codex|chatgpt|copilot|cursor|gemini|jules|devin|aider|windsurf';
const AGENT_NAME =
  `(?:(?:anthropic|openai|github|google|cursor) )?(?:${AGENTS})` +
  '(?: (?:code|cli|agent|ai|assistant|bot|opus|sonnet|haiku|fable|\\d[\\w.-]*))*';
const AGENT_NAME_RE = new RegExp(`^${AGENT_NAME}$`, 'i');
// GitHub Apps commit as "<app>[bot]". Only the apps of AI agents count, not dependabot and co.
const AGENT_BOT_RE = new RegExp(`\\b(?:${AGENTS})\\b.*\\[bot\\]$`, 'i');
const AGENT_EMAIL_RE = /noreply@(anthropic|openai)\.com/i;
const TRAILER_RE = /^\s*(?:co-authored-by|signed-off-by|assisted-by|generated-by|helped-by):\s*(.*?)\s*$/i;
// The footer that an assistant appends: a line that is nothing but "Generated with <agent>",
// with the agent possibly linked. A sentence that goes on, such as the AI disclosure the pull
// request template asks for, is not a footer.
const GENERATED_RE = new RegExp(
  `^[^\\p{L}\\p{N}]*generated (?:with|by) \\[?${AGENT_NAME}\\]?(?:\\([^)]*\\))?[^\\p{L}\\p{N}]*$`,
  'iu',
);

// Parses "Name <email>" or a bare name.
function parseIdentity(text) {
  const match = text.match(/^(.*?)\s*<([^>]*)>$/);
  return match ? { name: match[1].trim(), email: match[2].trim() } : { name: text.trim(), email: '' };
}

export function isAgent({ name, email }) {
  return AGENT_NAME_RE.test(name) || AGENT_BOT_RE.test(name) || AGENT_EMAIL_RE.test(email);
}

function isAgentTrailer(line) {
  const match = line.match(TRAILER_RE);
  return Boolean(match) && isAgent(parseIdentity(match[1]));
}

// Each test runs against every line, ignoring case. Trailers and footers must open the line, so
// prose that merely names an assistant, as the rules themselves do, is not attribution. Agent
// email addresses and links to AI sessions count anywhere.
export const ATTRIBUTION = [
  [isAgentTrailer, 'an AI co-author or sign-off trailer'],
  [(line) => GENERATED_RE.test(line), 'a "Generated with" footer'],
  [(line) => /^\s*claude-session:/i.test(line), 'a Claude-Session trailer'],
  [(line) => AGENT_EMAIL_RE.test(line), 'an AI agent email address'],
  [(line) => /claude\.ai\/code\/session|chatgpt\.com\/codex/i.test(line), 'a link to an AI session'],
];
const LOG_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x1e';

export class GitError extends Error {}

const problem = (where, rule, detail) => ({ where, rule, detail });
const firstLine = (message) => message.split('\n', 1)[0];

// --------------------------------------------------------------------------------------------
// Pure rules
// --------------------------------------------------------------------------------------------

// Normalizes a message the way `git commit --cleanup=<mode>` does before storing it. 'strip'
// drops the lines that start with the comment string, then does what 'whitespace' does: trims
// trailing whitespace (which also normalizes line endings), collapses runs of blank lines and
// drops leading and trailing blank lines. Both cut everything from the scissors line that
// `git commit --verbose` adds. 'verbatim' only drops the final newline; it is for messages that
// git has already stored.
export function cleanMessage(raw, { mode = 'strip', comment = '#' } = {}) {
  const text = raw.replace(/^\ufeff/, '');
  if (mode === 'verbatim') return text.replace(/\n+$/, '');
  let lines = text.split('\n').map((line) => line.trimEnd());
  const cut = lines.findIndex((line) => line.startsWith(comment) && SCISSORS_RE.test(line.slice(comment.length)));
  if (cut !== -1) lines = lines.slice(0, cut);
  if (mode !== 'whitespace') lines = lines.filter((line) => !line.startsWith(comment));
  const kept = [];
  for (const line of lines) {
    if (line || (kept.length && kept.at(-1))) kept.push(line);
  }
  while (kept.length && !kept.at(-1)) kept.pop();
  return kept.join('\n');
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

// Whether a change to these files lands without a version: only docs for people, and at least one.
export const isUnversioned = (files) => files.length > 0 && files.every((file) => UNVERSIONED_RE.test(file));

// Subject rules. `version` is 'required', 'forbidden', 'optional' or 'none': 'forbidden' for a
// branch commit, and 'none' for a pull request, or its squash commit, that changes only docs
// for people.
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
  if (versionRule === 'none' && version) {
    add('version', 'a change to the docs for people alone carries no version');
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
    const hit = ATTRIBUTION.find(([test]) => test(line));
    if (hit) {
      problems.push(problem(where, 'attribution', `${hit[1]} on line ${index + 1}: "${line.trim()}"`));
    }
  });
  return problems;
}

// The name of the board game the first game is based on must not appear in any text that ends
// up on GitHub. The problem says where a spelling starts without repeating it.
export function checkName(text, where, spellings) {
  return findSpellings(text, spellings).map(({ line, column }) =>
    problem(where, 'name', `line ${line}, column ${column} contains the name of the board game; see ${NAME_RULES}`),
  );
}

// The rules for the messages that have a format of their own, such as those of merge commits.
const checkForeignMessage = (message, where) => [...checkAttribution(message, where), ...checkName(message, where)];

// The subject is covered by the printable-ASCII rule, so this looks at the body only.
function checkBodyEnglish(lines, where) {
  return lines
    .slice(1)
    .flatMap((line, index) =>
      CHINESE_RE.test(line)
        ? [problem(where, 'english', `line ${index + 2} contains Chinese text: "${line.trim()}"`)]
        : [],
    );
}

// Subject, structure, language, attribution and name rules for one cleaned message. A message
// whose version is 'required' or 'none' is a squash commit on main, which carries only the pull
// request title, so the body rules for branch commits do not apply to it.
export function checkMessage(message, where, { version, allowFixup = false, spellings }) {
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
  // A squash merge ('required' or 'none') has no body to keep the line in.
  const squashed = version === 'required' || version === 'none';
  if (!squashed && rest.startsWith('revert: ') && !REVERTS_RE.test(message)) {
    problems.push(problem(where, 'revert', 'a revert keeps the "This reverts commit <sha>." line that git writes'));
  }
  problems.push(
    ...checkBodyEnglish(lines, where),
    ...checkAttribution(message, where),
    ...checkName(message, where, spellings),
  );
  return problems;
}

export function checkIdentity(commit, where) {
  return [
    ['author', commit.authorName, commit.authorEmail],
    ['committer', commit.committerName, commit.committerEmail],
  ].flatMap(([role, name, email]) =>
    isAgent({ name, email })
      ? [problem(where, 'identity', `the ${role}, ${name} <${email}>, is an AI agent; commit as yourself`)]
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
// With `patchOnly`, for a title that someone other than a maintainer set, a minor or major
// version is not honored and the title gets the next patch version as well. With `unversioned`,
// for a pull request that changes only docs for people, the title loses any version.
export function fixedTitle(title, previous, { patchOnly = false, unversioned = false } = {}) {
  const [version, rest] = splitVersion(title.trim());
  if (unversioned) return rest;
  const next = successors(previous);
  if (version && !patchOnly) {
    if (isSuccessor(version, previous)) return title.trim();
    if (version[2] === 0 && version[1] > 0) return `${formatVersion(next.minor)} ${rest}`;
    if (version[2] === 0 && version[1] === 0 && version[0] > 0) return `${formatVersion(next.major)} ${rest}`;
  }
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

// One config value, or null when it is not set.
function gitConfig(key) {
  const result = runGit(['config', '--get', key]);
  return result.status === 0 ? result.stdout.trim() : null;
}

// How git will clean the message up after the commit-msg hook has seen it: the mode from
// commit.cleanup when set, otherwise comments are stripped only when an editor was used. Git
// runs the commit hooks with GIT_EDITOR=: when it will not open one, as with `git commit -m`.
function messageCleanup() {
  const configured = gitConfig('commit.cleanup');
  const mode =
    configured && configured !== 'default' ? configured : process.env.GIT_EDITOR === ':' ? 'whitespace' : 'strip';
  const comment = gitConfig('core.commentString') ?? gitConfig('core.commentChar') ?? '#';
  return {
    mode: mode === 'scissors' ? 'whitespace' : mode,
    comment: comment === 'auto' ? '#' : comment, // with 'auto', git uses '#' unless the message itself needs another
  };
}

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

// The files that `git diff` with these arguments changes: between two commits, in a range, or
// with --cached, in the index. A moved file counts at both of its paths.
function changedFiles(...args) {
  return git('diff', '--no-renames', '--name-only', ...args)
    .split('\n')
    .filter(Boolean);
}

function rootPackageJson() {
  const path = join(git('rev-parse', '--show-toplevel').trim(), 'package.json');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

// --------------------------------------------------------------------------------------------
// Modes
// --------------------------------------------------------------------------------------------

function modeMsg(file) {
  const message = cleanMessage(readFileSync(file, 'utf8'), messageCleanup());
  const where = 'message';
  if (gitOk('rev-parse', '-q', '--verify', 'MERGE_HEAD')) {
    return { problems: checkForeignMessage(message, where), note: 'merge commit: attribution and name rules only' };
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
  // squash merge, it carries the next version, or none if it changes only docs for people.
  const unversioned = isUnversioned(changedFiles('--cached'));
  const problems = checkMessage(message, where, { version: unversioned ? 'none' : 'required' });
  const [version] = splitVersion(firstLine(message));
  if (version && !unversioned && gitOk('rev-parse', '-q', '--verify', 'HEAD')) {
    const [headVersion] = splitVersion(git('log', '-1', '--format=%s', 'HEAD').trim());
    if (!sameVersion(version, headVersion)) {
      // An equal version means `git commit --amend`.
      problems.push(...checkSuccessor(version, previousVersion('HEAD'), where));
    }
    problems.push(...checkPackageJson(version, rootPackageJson(), where));
  }
  const note = unversioned
    ? 'main: a change to the docs for people alone carries no version'
    : 'main: the subject must carry the next version';
  return { problems, note };
}

function modeRange(revRange) {
  const problems = [];
  const list = commits(revRange);
  for (const commit of list) {
    const where = commit.sha.slice(0, 7);
    const message = cleanMessage(commit.message, { mode: 'verbatim' });
    // Merge commits and the commits of automation such as dependabot have messages of their
    // own. The identity check still rejects commits that an AI agent made in its own name.
    if (commit.parents.length > 1 || commit.authorName.endsWith('[bot]')) {
      problems.push(...checkForeignMessage(message, where));
    } else {
      problems.push(...checkMessage(message, where, { version: 'forbidden', allowFixup: true }));
    }
    problems.push(...checkIdentity(commit, where));
  }
  return { problems, note: `${list.length} commit(s) in ${revRange}` };
}

function modePrTitle(title, options) {
  if (!options.base) throw new UsageError('pr-title needs --base <ref>');
  if (options.patch && !options.fix) throw new UsageError('--patch goes with --fix');
  const previous = previousVersion(options.base);
  // With --head, the PR's changes since it left the base decide whether it takes a version.
  const unversioned = options.head ? isUnversioned(changedFiles(`${options.base}...${options.head}`)) : false;
  if (options.fix) {
    console.log(fixedTitle(title, previous, { patchOnly: options.patch, unversioned }));
    return null;
  }
  const where = 'pr-title';
  const problems = [
    ...checkSubject(title.trim(), where, { version: unversioned ? 'none' : 'required' }),
    ...checkAttribution(title, where),
    ...checkName(title, where),
  ];
  const [version] = splitVersion(title.trim());
  if (version && !unversioned) {
    problems.push(...checkSuccessor(version, previous, where));
    problems.push(...checkPackageJson(version, rootPackageJson(), where));
  }
  if (options['body-file']) {
    // The body is Markdown, where a leading "#" is a heading, not a comment.
    const body = cleanMessage(readFileSync(options['body-file'], 'utf8'), { mode: 'whitespace' });
    problems.push(...checkForeignMessage(body, 'pr-body'));
  }
  const branch = options['head-ref'];
  if (branch) problems.push(...checkName(branch, 'branch'));
  if (branch && !BRANCH_RE.test(branch)) {
    problems.push(
      problem(
        where,
        'branch',
        `the branch "${branch}" must be named <type>/<kebab-case-description>, with <type> one of ${BRANCH_TYPES.join(', ')}`,
      ),
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
    const cleaned = cleanMessage(commit.message, { mode: 'verbatim' });
    const [subject, ...body] = cleaned.split('\n');
    const message = [subject.replace(PR_NUMBER_RE, ''), ...body].join('\n');
    const unversioned = commit.parents.length > 0 && isUnversioned(changedFiles(commit.parents[0], commit.sha));
    problems.push(...checkMessage(message, where, { version: unversioned ? 'none' : 'required' }));
    const [version] = splitVersion(subject);
    if (version && !unversioned && commit.parents.length) {
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
  console.error(
    `check-commits: after ${formatVersion(previous)} on ${base}; run \`git fetch origin\` first if in doubt`,
  );
  return 0;
}

// Every minor or major version on the first-parent history of the ref that has no tag yet,
// oldest first. Looking at the whole history rather than only the last commit means that a
// release which an earlier run missed, because it failed or was cancelled, is tagged by the
// next run on main.
function modeRelease(options) {
  const ref = options.ref || 'HEAD';
  const tagged = new Set(
    git('tag', '--list', 'v[0-9]*')
      .split('\n')
      .map((tag) => tag.trim()),
  );
  for (const line of git('log', '--first-parent', '--reverse', '--format=%H %s', ref).split('\n')) {
    const [sha, ...subject] = line.split(' ');
    const [version] = splitVersion(subject.join(' '));
    const isRelease = version && version[2] === 0 && (version[0] > 0 || version[1] > 0);
    if (isRelease && !tagged.has(formatVersion(version))) console.log(`${formatVersion(version)}\t${sha}`);
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
  node scripts/check-commits.mjs pr-title --base <ref> [--head <ref>] [--fix [--patch]] [--body-file <file>] [--head-ref <branch>] -- <title>
  node scripts/check-commits.mjs head [--base <ref>]
  node scripts/check-commits.mjs next [--base <ref>] [--minor | --major]
  node scripts/check-commits.mjs release [--ref <ref>]`;

const OPTIONS = {
  base: { type: 'string' },
  fix: { type: 'boolean' },
  patch: { type: 'boolean' },
  'body-file': { type: 'string' },
  'head-ref': { type: 'string' },
  head: { type: 'string' },
  minor: { type: 'boolean' },
  major: { type: 'boolean' },
  ref: { type: 'string' },
};

function report({ problems, note }, { quiet = false } = {}) {
  for (const { where, rule, detail } of problems) {
    // Other rules quote the text they object to, so the name is blotted out of every line.
    const line = masked(`${where} ${rule}: ${detail}`);
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

// Run as a script, not when imported by the tests. Node resolves import.meta.url to the real
// path, so the path on the command line must be resolved too in case it goes through a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
