#!/usr/bin/env node
// Builds words/dictionary/han-glosses.json: the English meanings of each Chinese character that the
// word lists use, for the clue check, which takes a clue word that is the English of a character on
// the board for that character (shared/src/games/keywords/clue.ts): "ball" for the character of a
// ball in the Chinese word for "rebound".
//
// The meanings come from CC-CEDICT, the community's Chinese-English dictionary, which is under the
// Creative Commons Attribution-ShareAlike 4.0 International License, as the word lists are
// (words/LICENSE). Only the dictionary's entries of one character are read, and only those of the
// characters in the Chinese terms and forms of words/*.json. Each meaning is cleaned to plain
// English words:
//
// - Entries of proper names (their pinyin starts with a capital letter, as for a surname) are left
//   out, and so are the meanings that only point elsewhere ("variant of", "see", "used in",
//   "abbr. for", measure words), the dialectal, literary, archaic and slang ones, and the numerals
//   that cheques use, whose number the clue check counts by itself.
// - Notes in brackets go, and so do "to", "a", "an" and "the" at the start. A meaning of more than
//   one word is an explanation or a phrase rather than a translation, and goes too, as does a word
//   with a hyphen, a part of a word such as "-ology", and a word of fewer than three letters.
//
// EXTRA adds the meanings that the dictionary doesn't give in a single word but players do.
//
// Usage:
//   node scripts/build-han-glosses.mjs path/to/cedict_ts.u8 <version>
//
// cedict_ts.u8 is CC-CEDICT as https://www.mdbg.net/chinese/dictionary?page=cc-cedict publishes
// it, unpacked, and <version> is the date in its header (#! date=...), such as 2026-10-13. Run this
// again for a newer dictionary or changed word lists, and commit the file it writes.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORDS = join(root, 'words');
const OUTPUT = join(WORDS, 'dictionary', 'han-glosses.json');

const HAN = /\p{Script=Han}/u;
const ENTRY = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/$/;
// The shortest word that is kept, as the clue check counts it.
const SHORTEST = 3;
// The most words that a meaning may have to be kept: one, a translation; more, an explanation.
const MOST_WORDS = 1;

// Meanings that only point elsewhere, or say how the character is used rather than what it means.
const POINTERS =
  /^(?:surname|(?:old |archaic |japanese |erhua )?variant|see\b|used\b|abbr\b|cl\b|classifier|kangxi|radical|also\b|pr\b|taiwan\b|onom|loanword|phonetic|component|particle|prefix|suffix|interjection|exclamation|noun suffix)/i;
// The labels of meanings that players won't know as the character's.
const LABELS =
  /\((?:[^)]*\b)?(?:dialect|literary|archaic|old|classical|cantonese|tw|taiwan|slang|obsolete|loanword|onom)\b[^)]*\)/i;
// The numerals that cheques use.
const BANKERS = /anti-fraud|banker/i;
const SMALL = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'onto',
  'upon',
  'out',
  'off',
  'over',
  'about',
  'its',
  'his',
  'her',
  'him',
  'one',
  'oneself',
  'sth',
  'someone',
  'something',
  'somebody',
  'etc',
  'esp',
  'bound',
  'form',
  'used',
  'also',
  'very',
  'are',
  'was',
  'were',
  'been',
  'being',
  'has',
  'have',
  'had',
  'not',
  'but',
  'nor',
  'per',
  'who',
  'what',
  'which',
  'that',
  'this',
  'than',
  'such',
]);

// Meanings that the dictionary doesn't give as a word of its own, by character: what the
// characters of "review", "to change into" and "text" mean in a word, which players would use.
const EXTRA = {
  '\u5ba1': ['review'],
  '\u5316': ['change'],
  '\u6587': ['text'],
};

// The Chinese characters of the word lists' Chinese terms and forms.
function charactersOfLists() {
  const characters = new Set();
  for (const file of readdirSync(WORDS).filter((name) => name.endsWith('.json'))) {
    const list = JSON.parse(readFileSync(join(WORDS, file), 'utf8'));
    for (const term of list.terms ?? []) {
      for (const text of [term.zh, ...(term.forms?.zh ?? [])]) {
        for (const char of text ?? '') if (HAN.test(char)) characters.add(char);
      }
    }
  }
  return characters;
}

// The words that one meaning gives, or none.
function wordsOf(meaning) {
  if (LABELS.test(meaning) || BANKERS.test(meaning)) return [];
  let text = meaning
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\p{Script=Han}|\|/gu, ' ')
    .trim()
    .toLowerCase();
  if (POINTERS.test(text) || /[:\d.]/.test(text)) return [];
  text = text.replace(/^(?:to|a|an|the) /, '').trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MOST_WORDS) return [];
  return words.filter((word) => /^[a-z]+$/.test(word) && word.length >= SHORTEST && !SMALL.has(word));
}

function glossesFrom(text, characters) {
  const glosses = new Map();
  for (const line of text.split('\n')) {
    const entry = ENTRY.exec(line.trim());
    if (!entry) continue;
    const [, , simplified, pinyin, meanings] = entry;
    if (!characters.has(simplified) || /^[A-Z]/.test(pinyin)) continue;
    const found = glosses.get(simplified) ?? new Set();
    for (const meaning of meanings.split('/')) {
      for (const part of meaning.split(';')) for (const word of wordsOf(part)) found.add(word);
    }
    glosses.set(simplified, found);
  }
  for (const [char, words] of Object.entries(EXTRA)) {
    const found = glosses.get(char) ?? new Set();
    for (const word of words) found.add(word);
    glosses.set(char, found);
  }
  return glosses;
}

function main() {
  const [input, version] = process.argv.slice(2);
  if (!input || !version) {
    console.error('Usage: node scripts/build-han-glosses.mjs path/to/cedict_ts.u8 <version>');
    process.exit(2);
  }
  const text = readFileSync(input, 'utf8');
  if (!text.includes('CC-CEDICT')) {
    console.error(`${input} doesn't look like CC-CEDICT.`);
    process.exit(1);
  }
  const characters = charactersOfLists();
  const glosses = glossesFrom(text, characters);
  const sorted = [...glosses]
    .filter(([, words]) => words.size > 0)
    .sort(([a], [b]) => a.codePointAt(0) - b.codePointAt(0))
    .map(([char, words]) => [char, [...words].sort()]);
  const data = {
    source: 'CC-CEDICT, https://www.mdbg.net/chinese/dictionary?page=cc-cedict',
    version,
    license: 'CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/',
    note: 'Generated by scripts/build-han-glosses.mjs from CC-CEDICT, changed: only the characters of the word lists, with their meanings cleaned to single English words, and a few added. Run the script again rather than edit this file.',
    glosses: Object.fromEntries(sorted),
  };
  // As Prettier writes it, so that the check of the formatting passes: a character and its
  // meanings on one line, unless the line would be longer than 120 columns, a Chinese character
  // taking two.
  const entry = ([char, words]) => {
    const line = `    ${JSON.stringify(char)}: ${JSON.stringify(words).replace(/","/g, '", "')},`;
    if (line.length + 1 <= 120) return line.slice(0, -1);
    return `    ${JSON.stringify(char)}: [\n${words.map((word) => `      ${JSON.stringify(word)}`).join(',\n')}\n    ]`;
  };
  const lines = Object.entries(data).map(([key, value]) =>
    key === 'glosses'
      ? `  "glosses": {\n${sorted.map(entry).join(',\n')}\n  }`
      : `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
  );
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `{\n${lines.join(',\n')}\n}\n`);
  const missing = [...characters].filter((char) => !glosses.get(char)?.size);
  console.log(`${sorted.length} characters with meanings, ${missing.length} of the word lists' without.`);
}

main();
