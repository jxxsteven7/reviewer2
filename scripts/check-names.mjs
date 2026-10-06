#!/usr/bin/env node
// Keeps the name of the commercial board game that the first game is based on out of the
// repository. docs/rules/constraints.md forbids the name everywhere: in files and file paths,
// commit messages, pull requests and branch names, in English and in Chinese.
//
// The script holds only SHA-256 hashes of the name's spellings, so the name doesn't appear here
// either, and a report says where a spelling starts without repeating it. A Latin spelling is
// found wherever a word starts, whatever the case, accents or full-width forms, and with
// spaces, hyphens, dashes, underscores, dots, slashes or a line break between its letters, so
// "Two Words", "two-words", "two_words" and "TwoWords" all count, and so does a name that wraps
// onto the next line. It is also found glued to other letters, as in "mytwowords". A Chinese
// spelling is found in any run of Chinese characters; spaces, middle dots and line breaks don't
// end a run, but other punctuation does.
//
// This script checks files and file paths. Commit messages, pull request titles and bodies, and
// branch names are checked by scripts/check-commits.mjs, which imports findSpellings from here
// and applies it along with its other rules.
//
// It needs only Node and git, so the same file runs as the pre-commit hook, in CI
// (.github/workflows/conventions.yml) and by hand:
//
//   node scripts/check-names.mjs files
//       every tracked file: its path and, unless the file is binary, its contents
//   node scripts/check-names.mjs staged
//       the files staged for the next commit (the pre-commit hook)
//   node scripts/check-names.mjs text [--label <what>] [--file <file>] [-- <text>]
//       any other text, such as the draft of a pull request description
//   node scripts/check-names.mjs hash <spelling>
//       print the SPELLINGS entry for a new spelling
//
// Exit codes: 0 pass, 1 the name was found, 2 usage or environment error.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

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
const GITLINK = '160000'; // the file mode of a submodule
// The byte order marks that open UTF-16 text, which is full of NUL bytes without being binary.
const UTF16 = [
  ['utf-16le', Buffer.from([0xff, 0xfe])],
  ['utf-16be', Buffer.from([0xfe, 0xff])],
];

const LATIN_LETTER = /^[a-z]$/i;
const HAN = /^\p{Script=Han}$/u;
// What may stand between the letters or characters of a spelling without breaking it up: white
// space, hyphens and dashes, a few other marks that join words, and invisible format characters
// such as the soft hyphen and the zero-width space.
const SEPARATOR = /^[\s\p{Pd}\p{Cf}_./\\\u00b7\u2027\u30fb]$/u;
// What may open a line before its text: the marker of a comment, a quotation or a list item.
const LINE_MARKER = /^[#*>]$/;

// Folds compatibility forms, such as full-width letters, into their plain forms and drops accents.
const fold = (char) => [...char.normalize('NFKD').replace(/\p{M}/gu, '')];
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const isUpper = (char) => char !== char.toLowerCase();
const isLower = (char) => char !== char.toUpperCase();

class GitError extends Error {}
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

// Every place in the text where one of the spellings is found, as { line, column, from, to }:
// the 1-based line and column where it starts, and the offsets in the text of its first and its
// last character. All of them are counted in code points.
export function findSpellings(text, spellings = SPELLINGS) {
  const wanted = { latin: new Map(), han: new Map() }; // length -> hashes of that length
  for (const { script, length, sha256: hash } of spellings) {
    if (!wanted[script].has(length)) wanted[script].set(length, new Set());
    wanted[script].get(length).add(hash);
  }
  const found = [];

  // The current runs of Latin letters and of Chinese characters. A run goes on across
  // separators and line breaks and ends at anything else. It holds the folded letters or
  // characters, the place of each one and, for letters, whether a separator stands before it.
  const newRun = () => ({ chars: [], places: [], gaps: [] });
  let latin = newRun();
  let han = newRun();
  const endLatin = () => {
    matchLatin(latin, wanted.latin, found);
    latin = newRun();
  };
  const endHan = () => {
    match(han, wanted.han, found);
    han = newRun();
  };

  let offset = -1;
  let line = 1;
  let column = 0;
  let afterReturn = false; // the previous character was a carriage return
  let lineStart = true; // nothing but white space and line markers so far on this line
  let gap = true; // the next letter is the first of its run or follows a separator
  for (const char of text) {
    offset += 1;
    if (char === '\n' || char === '\r') {
      // A line break, where "\r\n" is a single one. It separates like other white space, so a
      // spelling that wraps onto the next line of a paragraph or a comment is found too.
      if (char === '\r' || !afterReturn) {
        line += 1;
        column = 0;
      }
      afterReturn = char === '\r';
      lineStart = true;
      gap = true;
      continue;
    }
    afterReturn = false;
    column += 1;
    const folded = fold(char);
    if (!folded.length) continue; // a combining mark on its own, which belongs to the letter before it
    const place = { offset, line, column };
    if (folded.every((letter) => LATIN_LETTER.test(letter))) {
      endHan();
      for (const letter of folded) {
        latin.chars.push(letter);
        latin.places.push(place);
        latin.gaps.push(gap);
        gap = false;
      }
      lineStart = false;
    } else if (folded.length === 1 && HAN.test(folded[0])) {
      endLatin();
      han.chars.push(folded[0]);
      han.places.push(place);
      gap = true;
      lineStart = false;
    } else if (folded.every((part) => SEPARATOR.test(part)) || (lineStart && LINE_MARKER.test(char))) {
      gap = true;
    } else {
      endLatin();
      endHan();
      gap = true;
      lineStart = false;
    }
  }
  endLatin();
  endHan();
  return found;
}

// Looks for the wanted spellings in a run. `mayStart(index, length)` says whether a spelling of
// that length may start at that position. Chinese has no spaces between words, so there a
// spelling may start at any character.
function match({ chars, places }, byLength, found, mayStart = () => true) {
  for (let index = 0; index < chars.length; index += 1) {
    for (const [length, hashes] of byLength) {
      if (index + length > chars.length || !mayStart(index, length)) continue;
      if (hashes.has(sha256(chars.slice(index, index + length).join('')))) {
        const { offset, line, column } = places[index];
        found.push({ line, column, from: offset, to: places[index + length - 1].offset });
      }
    }
  }
}

// In a run of Latin letters, a spelling that starts where a word starts may have separators
// and capitals inside it. A word starts after a separator, at a capital after a lowercase
// letter, as in camelCase, and at the last capital of an acronym, like the S in "HTTPServer".
// Anywhere else a spelling must be in one piece, with no separator and no new capitalized word
// inside it. That finds it glued to other letters, as in "mytwowords" or "MYTWOWORDS", but not
// in "untwoWords", which reads "untwo words".
function matchLatin({ chars, places, gaps }, byLength, found) {
  // Whether a letter starts a new word within the run. The first letter always has a gap.
  const capitalized = (index) => !gaps[index] && isUpper(chars[index]) && isLower(chars[index - 1]);
  // How many letters from each position on are in one piece.
  const solid = new Array(chars.length);
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const joined = index + 1 < chars.length && !gaps[index + 1] && !capitalized(index + 1);
    solid[index] = joined ? solid[index + 1] + 1 : 1;
  }
  const startsWord = (index) =>
    gaps[index] || capitalized(index) || (isUpper(chars[index]) && solid[index] > 1 && isLower(chars[index + 1]));
  const lowercase = chars.map((letter) => letter.toLowerCase());
  match({ chars: lowercase, places }, byLength, found, (index, length) => startsWord(index) || solid[index] >= length);
}

// The text with each spelling in it blotted out, so that a report never repeats one. Line
// breaks inside a spelling stay as they are.
export function masked(text, spellings = SPELLINGS) {
  const chars = [...text];
  for (const { from, to } of findSpellings(text, spellings)) {
    for (let offset = from; offset <= to; offset += 1) {
      if (chars[offset] !== '\n' && chars[offset] !== '\r') chars[offset] = '\u2022';
    }
  }
  return chars.join('');
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

const utf16 = (buffer) => UTF16.find(([, mark]) => buffer.subarray(0, mark.length).equals(mark))?.[0];

// Whether the bytes, or the start of them, belong to a binary file, whose contents aren't checked.
export const isBinary = (buffer) => !utf16(buffer) && buffer.subarray(0, BINARY_PROBE).includes(0);

// The text of a file that isn't binary.
export function decoded(buffer) {
  const encoding = utf16(buffer);
  return encoding ? new TextDecoder(encoding).decode(buffer) : buffer.toString('utf8');
}

// The text of the file at a path, or null for a binary file. Only the start of a binary file is
// read, so a large image or font costs next to nothing.
function readText(path) {
  const file = openSync(path, 'r');
  try {
    const probe = Buffer.alloc(BINARY_PROBE);
    const start = probe.subarray(0, readSync(file, probe, 0, BINARY_PROBE, 0));
    if (isBinary(start)) return null;
    return decoded(start.length < BINARY_PROBE ? start : readFileSync(file));
  } finally {
    closeSync(file);
  }
}

// --------------------------------------------------------------------------------------------
// Modes
// --------------------------------------------------------------------------------------------

// Runs git and returns its output as a buffer, because the contents of a file may not be text.
function git(...args) {
  const result = spawnSync('git', args, { maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw new GitError(`could not run git: ${result.error.message}`);
  if (result.status !== 0) throw new GitError(`git ${args.join(' ')}: ${result.stderr.toString().trim()}`);
  return result.stdout;
}

const repoRoot = () => git('rev-parse', '--show-toplevel').toString().trim();
const nulSeparated = (output) => output.toString().split('\0').filter(Boolean);

function modeFiles() {
  const root = repoRoot();
  const paths = nulSeparated(git('-C', root, 'ls-files', '-z'));
  const problems = [];
  for (const path of paths) {
    problems.push(...checkPath(path));
    let text;
    try {
      text = readText(join(root, path));
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') continue; // deleted, or a submodule
      throw error;
    }
    if (text !== null) problems.push(...checkText(text, path));
  }
  return { problems, note: `${paths.length} tracked file(s)` };
}

// What is staged for the next commit, as { path, mode, blob }. --raw prints, for each file, a
// record ":<old mode> <new mode> <old blob> <new blob> <status>" and then its path. Without
// rename detection, a renamed file is listed as an added one.
function stagedFiles(root) {
  const fields = nulSeparated(
    git('-C', root, 'diff', '--cached', '--raw', '-z', '--no-abbrev', '--no-renames', '--diff-filter=ACMT'),
  );
  const files = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [, mode, , blob] = fields[index].split(' ');
    files.push({ path: fields[index + 1], mode, blob });
  }
  return files;
}

function modeStaged() {
  const root = repoRoot();
  const files = stagedFiles(root);
  const problems = [];
  for (const { path, mode, blob } of files) {
    problems.push(...checkPath(path));
    if (mode === GITLINK) continue; // the commit a submodule points to lives in another repository
    const buffer = git('-C', root, 'cat-file', 'blob', blob);
    if (!isBinary(buffer)) problems.push(...checkText(decoded(buffer), path));
  }
  return { problems, note: `${files.length} staged file(s)` };
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
  node scripts/check-names.mjs text [--label <what>] [--file <file>] [-- <text>]
  node scripts/check-names.mjs hash <spelling>`;

const OPTIONS = {
  label: { type: 'string' },
  file: { type: 'string' },
};

// How many positional arguments each mode takes; text takes any number.
const ARGUMENTS = { files: 0, staged: 0, hash: 1 };

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
      case 'text':
        return report(modeText(rest, options));
      case 'hash':
        return modeHash(rest[0]);
      default:
        throw new UsageError(mode ? `unknown mode "${mode}"` : 'no mode given');
    }
  } catch (error) {
    // An error message may quote a path or an argument, so it is masked like the rest of a report.
    if (error instanceof UsageError || error.code?.startsWith('ERR_PARSE_ARGS')) {
      console.error(`check-names: ${masked(error.message)}\n\n${USAGE}`);
      return 2;
    }
    // Node sets `syscall` on the errors of the file system, such as a file it may not read.
    if (error instanceof GitError || error.syscall) {
      console.error(`check-names: error: ${masked(error.message)}`);
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
