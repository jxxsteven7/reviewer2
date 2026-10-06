#!/usr/bin/env node
// Checks the word lists in words/ against the format that words/README.md describes. It needs
// only Node, so contributors can run it without installing anything, and CI runs it too:
//
//   node scripts/check-words.mjs              every words/*.json
//   node scripts/check-words.mjs <file>...    only these files
//
// Problems fail the check. Warnings point at terms that may not play well, and don't.
//
// Exit codes: 0 pass (perhaps with warnings), 1 problems found, 2 usage or environment error.

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const LANGUAGES = ['zh', 'en'];
// A board needs 25 different words, so a field is playable in a language once it has 25 terms in
// it. This is BOARD_SIZE in shared/src/games/keywords/types.ts, which this script can't import:
// it runs without TypeScript. A test in server/src/core/words.test.ts holds the two together.
export const MIN_TERMS = 25;
// Longer terms don't fit on a card on a 360 px wide phone.
export const MAX_LENGTH = { zh: 5, en: 14 };
export const MAX_DIFFICULTY = 5;

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LIST_KEYS = new Set(['id', 'name', 'contributors', 'terms']);
const TERM_KEYS = new Set(['id', 'zh', 'en', 'difficulty', 'related', 'note']);

// The table of traditional Chinese characters and their simplified forms that the game compares
// words with (shared/src/han.ts). The generated file holds it as one string of \u escapes, each
// traditional character followed by its simplified form, and is read here as text.
const HAN_VARIANTS = join(root, 'shared', 'src', 'han-variants.ts');
let simplified;

function readHanVariants() {
  const source = readFileSync(HAN_VARIANTS, 'utf8');
  const start = source.indexOf('export const HAN_VARIANTS');
  const chars = Array.from(source.slice(Math.max(start, 0)).matchAll(/\\u([0-9a-f]{4})/g), ([, hex]) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  if (start < 0 || chars.length === 0 || chars.length % 2 !== 0) {
    throw new Error(`${HAN_VARIANTS} doesn't hold the table of Chinese characters in the expected form`);
  }
  const forms = new Map();
  for (let i = 0; i < chars.length; i += 2) forms.set(chars[i], chars[i + 1]);
  return forms;
}

function toSimplified(text) {
  simplified ??= readHanVariants();
  return text.replace(/[\u4e00-\u9fff]/g, (char) => simplified.get(char) ?? char);
}

const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
const MARKS = /\p{M}/gu;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;

// What makes two terms the same word: their letters and digits, compared as the game compares
// words. Full-width and compatibility forms are folded (NFKC); invisible characters, case and
// accents are dropped; traditional Chinese characters count as their simplified forms; and
// everything that is not a letter or a digit is left out. "Co-author", "co author" and "COAUTHOR"
// are one word, and so are "C++" and "C#".
//
// This must stay the same as wordKey() in shared/src/games/keywords/clue.ts, with which the server
// builds its word library and deals a board: a list that passes here must be playable there. This
// script can't import that function, so a test in server/src/core/words.test.ts compares the two.
export function wordKey(text) {
  const folded = text.normalize('NFKC').replace(INVISIBLE, '').trim().toLowerCase().normalize('NFD').replace(MARKS, '');
  return toSimplified(folded).replace(NOT_LETTER_OR_DIGIT, '');
}

// What the game itself calls its roles and cards, in both languages. Such terms are allowed, since
// most are everyday academic words, but players may confuse them with the game's own labels.
const GAME_NAMES = [
  '\u5bfc\u5e08',
  '\u5b66\u751f',
  '\u65c1\u542c',
  '\u4e3b\u6301',
  '\u4e8c\u53f7\u5ba1\u7a3f\u4eba',
  '\u65e0\u5173\u8bba\u6587',
  'pi',
  'student',
  'spectator',
  'chair',
  'reviewer 2',
  'irrelevant paper',
];
let gameNames;
const isGameName = (key) => (gameNames ??= new Set(GAME_NAMES.map(wordKey))).has(key);

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const describe = (value) => JSON.stringify(value);

// Problems and warnings for one parsed list. `file` is its file name, such as "ml.json".
export function checkWordList(data, file) {
  const problems = [];
  const warnings = [];
  const counts = Object.fromEntries(LANGUAGES.map((language) => [language, 0]));
  const result = () => ({ problems, warnings, counts });

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    problems.push(`${file}: the file must hold one JSON object`);
    return result();
  }
  for (const key of Object.keys(data)) {
    if (!LIST_KEYS.has(key)) problems.push(`${file}: unknown field ${describe(key)}`);
  }
  const expectedId = basename(file, '.json');
  if (data.id !== expectedId)
    problems.push(`${file}: "id" must be ${describe(expectedId)}, the file name without .json`);
  if (!ID.test(expectedId)) problems.push(`${file}: the file name must be lowercase English words joined by "-"`);
  if (!data.name || typeof data.name !== 'object' || !LANGUAGES.every((language) => isText(data.name[language]))) {
    problems.push(`${file}: "name" needs both "zh" and "en"`);
  }
  if (!Array.isArray(data.contributors) || data.contributors.length === 0 || !data.contributors.every(isText)) {
    problems.push(`${file}: "contributors" must list at least one name`);
  }
  if (!Array.isArray(data.terms)) {
    problems.push(`${file}: "terms" must be a list`);
    return result();
  }

  const ids = new Map();
  const texts = Object.fromEntries(LANGUAGES.map((language) => [language, new Map()]));
  data.terms.forEach((term, index) => {
    const where = `${file}: terms[${index}]${term && isText(term.id) ? ` (${term.id})` : ''}`;
    if (term === null || typeof term !== 'object' || Array.isArray(term)) {
      problems.push(`${where}: a term must be an object`);
      return;
    }
    for (const key of Object.keys(term)) {
      if (!TERM_KEYS.has(key)) problems.push(`${where}: unknown field ${describe(key)}`);
    }
    if (!isText(term.id) || !ID.test(term.id)) {
      problems.push(`${where}: "id" must be lowercase English words joined by "-"`);
    } else if (ids.has(term.id)) {
      problems.push(`${where}: the id is already used by terms[${ids.get(term.id)}]`);
    } else {
      ids.set(term.id, index);
    }

    const present = LANGUAGES.filter((language) => term[language] !== undefined);
    if (present.length === 0) problems.push(`${where}: needs "zh", "en" or both`);
    for (const language of present) {
      const text = term[language];
      if (!isText(text)) {
        problems.push(`${where}: "${language}" must be a non-empty string`);
        continue;
      }
      if (text !== text.trim() || /\s{2}/.test(text)) {
        problems.push(`${where}: "${language}" has spaces at its ends or two spaces in a row`);
      }
      const key = wordKey(text);
      const earlier = texts[language].get(key);
      if (key === '') {
        problems.push(`${where}: "${language}" ${describe(text)} has no letters or digits`);
      } else if (earlier) {
        // Say what the other spelling is, since the two may not look alike.
        const other =
          earlier.text === text ? '' : ` (${describe(earlier.text)}), which has the same letters and digits`;
        problems.push(`${where}: "${language}" ${describe(text)} repeats terms[${earlier.index}]${other}`);
      } else {
        texts[language].set(key, { index, text });
        counts[language] += 1;
      }
      if ([...text].length > MAX_LENGTH[language]) {
        warnings.push(
          `${where}: "${language}" ${describe(text)} is longer than ${MAX_LENGTH[language]} characters and may not fit on a card`,
        );
      }
      if (isGameName(key)) {
        warnings.push(`${where}: "${language}" ${describe(text)} is also the name of a role or card in the game`);
      }
    }

    if (term.difficulty !== undefined) {
      const { difficulty } = term;
      if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > MAX_DIFFICULTY) {
        problems.push(`${where}: "difficulty" must be a whole number from 1 to ${MAX_DIFFICULTY}`);
      }
    }
    if (term.related !== undefined) {
      if (!Array.isArray(term.related) || !term.related.every((id) => typeof id === 'string' && ID.test(id))) {
        problems.push(`${where}: "related" must be a list of term ids`);
      }
    }
    if (term.note !== undefined) {
      const { note } = term;
      const keys = note && typeof note === 'object' && !Array.isArray(note) ? Object.keys(note) : null;
      if (!keys || keys.length === 0 || !keys.every((key) => LANGUAGES.includes(key) && isText(note[key]))) {
        problems.push(`${where}: "note" must have a "zh" text, an "en" text or both`);
      }
    }
  });

  const playable = LANGUAGES.filter((language) => counts[language] >= MIN_TERMS);
  if (playable.length === 0) {
    problems.push(`${file}: needs at least ${MIN_TERMS} different terms in Chinese or in English to be playable`);
  }
  for (const language of LANGUAGES) {
    if (counts[language] > 0 && counts[language] < MIN_TERMS) {
      warnings.push(
        `${file}: only ${counts[language]} terms have "${language}", so players can't pick this field in that language until it has ${MIN_TERMS}`,
      );
    }
  }
  return result();
}

export function checkFile(path) {
  const file = basename(path);
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { problems: [`${file}: not valid JSON: ${error.message}`], warnings: [], counts: {} };
  }
  return checkWordList(data, file);
}

export function main(argv) {
  const wordsDir = join(root, 'words');
  let paths = argv;
  try {
    // Terms are compared with this table, so make sure of it before any list is read.
    simplified ??= readHanVariants();
    if (paths.length === 0) {
      paths = readdirSync(wordsDir)
        .filter((name) => name.endsWith('.json'))
        .sort()
        .map((name) => join(wordsDir, name));
    }
  } catch (error) {
    console.error(`check-words: error: ${error.message}`);
    return 2;
  }

  let problems = 0;
  for (const path of paths) {
    const result = checkFile(path);
    for (const line of result.problems) {
      console.log(`check-words: ${line}`);
      if (process.env.GITHUB_ACTIONS) console.log(`::error title=check-words::${line}`);
    }
    for (const line of result.warnings) {
      console.log(`check-words: warning: ${line}`);
      if (process.env.GITHUB_ACTIONS) console.log(`::warning title=check-words::${line}`);
    }
    if (result.problems.length === 0) {
      const counts = LANGUAGES.map((language) => `${result.counts[language]} ${language}`).join(', ');
      console.log(`check-words: OK ${basename(path)} (${counts})`);
    }
    problems += result.problems.length;
  }
  if (paths.length === 0) console.log('check-words: no word lists in words/ yet');
  if (problems) {
    console.log(`check-words: ${problems} problem(s). See words/README.md.`);
    return 1;
  }
  return 0;
}

// Run as a script, not when imported by the tests. Node resolves import.meta.url to the real
// path, so the path on the command line must be resolved too in case it goes through a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
