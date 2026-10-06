#!/usr/bin/env node
// Keeps the name of the commercial board game that the first game is based on out of the
// repository. docs/rules/constraints.md forbids the name everywhere: in files and file paths,
// commit messages, pull requests and branch names, in English and in Chinese.
//
// The script holds only SHA-256 hashes of the name's spellings, so the name doesn't appear here
// either, and a report says where a spelling starts without repeating it. A Latin spelling is
// found wherever a word starts, whatever the case, accents or full-width forms, and with
// spaces, hyphens, underscores, dots or slashes between its letters, so "Two Words",
// "two-words", "two_words" and "TwoWords" all count. A Chinese spelling is found in any run of
// Chinese characters; spaces and middle dots don't end a run, but other punctuation does.
//
// It needs only Node and git, so the same file runs as the pre-commit and commit-msg hooks, in
// CI (.github/workflows/conventions.yml) and by hand:
//
//   node scripts/check-names.mjs files
//       every tracked file: its path and its contents
//   node scripts/check-names.mjs staged
//       the files staged for the next commit (the pre-commit hook)
//   node scripts/check-names.mjs msg <file>
//       one commit message (the commit-msg hook)
//   node scripts/check-names.mjs range <rev-range>
//       the message of every commit in a range
//   node scripts/check-names.mjs text [--label <what>] [--file <file>] [-- <text>]
//       any other text, such as a pull request title or body, or a branch name
//   node scripts/check-names.mjs hash <spelling>
//       print the SPELLINGS entry for a new spelling
//
// Exit codes: 0 pass, 1 the name was found, 2 usage or environment error.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { cleanMessage, git, GitError, messageCleanup } from './check-commits.mjs';

// The hash of each normalized spelling (see entryFor): the English name, the Chinese name in
// simplified and in traditional characters, and the pinyin of the Chinese name. To add a
// spelling, print its entry with the hash mode and paste it here.
export const SPELLINGS = [
  { script: 'latin', length: 9, sha256: 'd12478167056f775ec7fb7e071a94db0e8b671349c0c8a0436be234edbd38da2' },
  { script: 'han', length: 4, sha256: 'f57cd49163271cddd465532cc856c80cb6e13f4aea4d79344f483f8ffd0ee039' },
  { script: 'han', length: 4, sha256: '6aa61a0b8b53ea81e57a5578f58cb0b39e3257ee9f1bbf96e074b5db52258562' },
  { script: 'latin', length: 14, sha256: 'd88ca1841b1811493b5e26499abd741e0ffe69b8f72a5ca5042499b59bc9ffec' },
];

const RULES = 'docs/rules/constraints.md';
const BINARY_PROBE = 8000; // like git, a NUL byte in the first 8000 bytes marks a binary file

const LATIN_LETTER = /^[a-z]$/i;
const HAN = /^\p{Script=Han}$/u;
// What may stand between the letters or characters of a spelling without breaking it up.
const SEPARATOR = /^[\s\-_./\\\u00b7\u2027\u30fb]$/u;

// Folds compatibility forms, such as full-width letters, into their plain forms and drops accents.
const fold = (char) => [...char.normalize('NFKD').replace(/\p{M}/gu, '')];
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const isUpper = (char) => char !== char.toLowerCase();
const isLower = (char) => char !== char.toUpperCase();

class UsageError extends Error {}

// The SPELLINGS entry for a spelling: its Chinese characters or else its letters, folded the
// way the scan folds them, with their count and their hash.
export function entryFor(spelling) {
  const chars = [...spelling].flatMap(fold);
  const han = chars.filter((char) => HAN.test(char));
  if (han.length) return { script: 'han', length: han.length, sha256: sha256(han.join('')) };
  const letters = chars.filter((char) => LATIN_LETTER.test(char)).map((char) => char.toLowerCase());
  if (!letters.length) throw new UsageError('a spelling needs letters or Chinese characters');
  return { script: 'latin', length: letters.length, sha256: sha256(letters.join('')) };
}

// Every place in the text where one of the spellings starts, as { line, column, end }: 1-based
// numbers counted in code points, with `end` the column where the spelling ends.
export function findSpellings(text, spellings = SPELLINGS) {
  const wanted = { latin: new Map(), han: new Map() }; // length -> hashes of that length
  for (const { script, length, sha256: hash } of spellings) {
    if (!wanted[script].has(length)) wanted[script].set(length, new Set());
    wanted[script].get(length).add(hash);
  }
  const found = [];
  text.split(/\r\n|\r|\n/).forEach((line, index) => scanLine(line, index + 1, wanted, found));
  return found;
}

function scanLine(line, lineNumber, wanted, found) {
  // The current runs of Latin letters and of Chinese characters, folded and lowercased, with
  // the column of each one and the positions where a spelling may start.
  const newRun = () => ({ chars: [], columns: [], starts: [] });
  let latin = newRun();
  let han = newRun();
  let previous = null; // the previous letter as written, while the word goes on
  const endLatin = () => {
    match(latin, wanted.latin, lineNumber, found);
    latin = newRun();
  };
  const endHan = () => {
    match(han, wanted.han, lineNumber, found);
    han = newRun();
  };

  let column = 0;
  for (const char of line) {
    column += 1;
    const folded = fold(char);
    if (folded.length && folded.every((letter) => LATIN_LETTER.test(letter))) {
      for (const letter of folded) {
        // A word starts after anything that isn't a letter, and where a capital letter follows
        // a lowercase one, as in camelCase.
        if (previous === null || (isUpper(letter) && isLower(previous))) latin.starts.push(latin.chars.length);
        latin.chars.push(letter.toLowerCase());
        latin.columns.push(column);
        previous = letter;
      }
      endHan();
    } else if (folded.length === 1 && HAN.test(folded[0])) {
      // Chinese has no spaces between words, so a spelling may start at any character.
      han.starts.push(han.chars.length);
      han.chars.push(folded[0]);
      han.columns.push(column);
      previous = null;
      endLatin();
    } else {
      previous = null;
      if (!SEPARATOR.test(char)) {
        endLatin();
        endHan();
      }
    }
  }
  endLatin();
  endHan();
}

function match(run, byLength, line, found) {
  for (const start of run.starts) {
    for (const [length, hashes] of byLength) {
      if (start + length > run.chars.length) continue;
      if (hashes.has(sha256(run.chars.slice(start, start + length).join('')))) {
        found.push({ line, column: run.columns[start], end: run.columns[start + length - 1] });
      }
    }
  }
}

// The text with each spelling in it blotted out, so that a report never repeats one.
export function masked(text, spellings = SPELLINGS) {
  const lines = text.split(/\r\n|\r|\n/).map((line) => [...line]);
  for (const { line, column, end } of findSpellings(text, spellings)) {
    lines[line - 1].fill('\u2022', column - 1, end);
  }
  return lines.map((chars) => chars.join('')).join('\n');
}

// --------------------------------------------------------------------------------------------
// Rules
// --------------------------------------------------------------------------------------------

const problem = (where, detail) => ({ where, detail });

// One problem for each spelling in the text, which `where` describes: a path, a commit, ...
export function checkText(text, where, spellings = SPELLINGS) {
  return findSpellings(text, spellings).map(({ line, column }) =>
    problem(`${masked(where, spellings)}:${line}:${column}`, 'contains the name of the board game'),
  );
}

export function checkPath(path, spellings = SPELLINGS) {
  return findSpellings(path, spellings).length
    ? [problem(masked(path, spellings), 'the file path contains the name of the board game')]
    : [];
}

const isBinary = (buffer) => buffer.subarray(0, BINARY_PROBE).includes(0);

function checkFile(path, buffer) {
  return [...checkPath(path), ...(isBinary(buffer) ? [] : checkText(buffer.toString('utf8'), path))];
}

// --------------------------------------------------------------------------------------------
// Modes
// --------------------------------------------------------------------------------------------

const repoRoot = () => git('rev-parse', '--show-toplevel').trim();
const nulSeparated = (output) => output.split('\0').filter(Boolean);

function modeFiles() {
  const root = repoRoot();
  const paths = nulSeparated(git('-C', root, 'ls-files', '-z'));
  const problems = [];
  for (const path of paths) {
    let buffer;
    try {
      buffer = readFileSync(join(root, path));
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') continue; // deleted, or a submodule
      throw error;
    }
    problems.push(...checkFile(path, buffer));
  }
  return { problems, note: `${paths.length} tracked file(s)` };
}

function modeStaged() {
  const root = repoRoot();
  const paths = nulSeparated(git('-C', root, 'diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'));
  const problems = [];
  for (const path of paths) {
    const result = spawnSync('git', ['-C', root, 'show', `:${path}`], { maxBuffer: 256 * 1024 * 1024 });
    if (result.error || result.status !== 0) {
      throw new GitError(`git show :${masked(path)}: ${result.error?.message ?? result.stderr.toString().trim()}`);
    }
    problems.push(...checkFile(path, result.stdout));
  }
  return { problems, note: `${paths.length} staged file(s)` };
}

function modeMsg(file) {
  const message = cleanMessage(readFileSync(file, 'utf8'), messageCleanup());
  return { problems: checkText(message, 'commit message'), note: 'commit message' };
}

function modeRange(revRange) {
  const records = git('log', '--format=%H%x00%B%x1e', revRange)
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean);
  const problems = [];
  for (const record of records) {
    const [sha, message] = record.split('\x00');
    problems.push(...checkText(message, `commit ${sha.slice(0, 7)}`));
  }
  return { problems, note: `${records.length} commit(s) in ${revRange}` };
}

function modeText(texts, options) {
  if (options.file) texts.push(readFileSync(options.file, 'utf8'));
  if (!texts.length) throw new UsageError('text needs --file <file> or -- <text>');
  const label = options.label ?? 'text';
  return { problems: texts.flatMap((text) => checkText(text, label)), note: label };
}

function modeHash(spelling) {
  const { script, length, sha256: hash } = entryFor(spelling);
  console.log(`  { script: '${script}', length: ${length}, sha256: '${hash}' },`);
  return 0;
}

// --------------------------------------------------------------------------------------------
// Command line
// --------------------------------------------------------------------------------------------

const USAGE = `Usage:
  node scripts/check-names.mjs files
  node scripts/check-names.mjs staged
  node scripts/check-names.mjs msg <file>
  node scripts/check-names.mjs range <rev-range>
  node scripts/check-names.mjs text [--label <what>] [--file <file>] [-- <text>]
  node scripts/check-names.mjs hash <spelling>`;

const OPTIONS = {
  label: { type: 'string' },
  file: { type: 'string' },
};

// How many positional arguments each mode takes; text takes any number.
const ARGUMENTS = { files: 0, staged: 0, msg: 1, range: 1, hash: 1 };

function report({ problems, note }, { quiet = false } = {}) {
  for (const { where, detail } of problems) {
    const line = `${where}: ${detail}`;
    console.log(`check-names: ${line}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=check-names::${line}`);
  }
  if (problems.length) {
    console.log(`check-names: ${problems.length} problem(s). The name must not appear anywhere; see ${RULES}.`);
    return 1;
  }
  if (!quiet) console.log(`check-names: OK (${note})`);
  return 0;
}

export function main(argv) {
  try {
    const { values: options, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
    const [mode, ...rest] = positionals;
    if (Object.hasOwn(ARGUMENTS, mode) && rest.length !== ARGUMENTS[mode]) {
      throw new UsageError(`wrong arguments for ${mode}`);
    }
    switch (mode) {
      case 'files':
        return report(modeFiles());
      case 'staged':
        return report(modeStaged(), { quiet: true });
      case 'msg':
        return report(modeMsg(rest[0]), { quiet: true });
      case 'range':
        return report(modeRange(rest[0]));
      case 'text':
        return report(modeText(rest, options));
      case 'hash':
        return modeHash(rest[0]);
      default:
        throw new UsageError(mode ? `unknown mode "${mode}"` : 'no mode given');
    }
  } catch (error) {
    if (error instanceof UsageError || error.code?.startsWith('ERR_PARSE_ARGS')) {
      console.error(`check-names: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    if (error instanceof GitError || error.code === 'ENOENT') {
      console.error(`check-names: error: ${error.message}`);
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
