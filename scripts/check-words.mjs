#!/usr/bin/env node
// Checks the word lists in words/ against the format that words/README.md describes. It needs
// only Node, so contributors can run it without installing anything, and CI runs it too:
//
//   node scripts/check-words.mjs              every words/*.json
//   node scripts/check-words.mjs <file>...    only these files
//
// Problems fail the check. Warnings point at terms that may not play well, and don't. Information
// lists the terms that the game keeps off the same board, and needs no fixing. A list that passes
// is reported with how many terms it has in each language and how many pairs of related terms.
//
// Exit codes: 0 pass (perhaps with warnings), 1 problems found, 2 usage or environment error.

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const LANGUAGES = ['zh', 'en'];
// A board needs 25 different words, so a field is playable in a language once it has 25 terms in
// it. This is BOARD_SIZE in shared/src/games/keywords/types.ts, which this script can't import:
// it runs without TypeScript. A test in server/src/core/words.test.ts holds the two together.
export const MIN_TERMS = 25;
// Longer terms don't fit on a card on a 360 px wide phone: 5 Chinese characters, or 14 characters
// of a word in another script. The card sizes a word by its script, not by its language, so a
// Chinese term without Chinese characters, such as "GitHub", is measured as an English one.
export const MAX_LENGTH = { zh: 5, en: 14 };
export const MAX_DIFFICULTY = 5;
// "related" pairs close terms. A term may be in this many pairs at most, so that the pairs vary.
export const MAX_PAIRS = 3;

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LIST_KEYS = new Set(['id', 'name', 'contributors', 'terms']);
const TERM_KEYS = new Set(['id', 'zh', 'en', 'forms', 'difficulty', 'related', 'note']);
// Matches a Chinese character, as HAN in shared/src/han.ts does, which the card sizes words by.
// A test holds the two together.
export const HAN = /\p{Script=Han}/u;
const maxLength = (text) => (HAN.test(text) ? MAX_LENGTH.zh : MAX_LENGTH.en);

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
// most are everyday academic words, but players may confuse them with the game's own labels. A
// term is compared with them as words are, by its key, so "Reviewer-2" is one of them, and so is
// a plain plural such as "Students".
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
// A plain plural: -s, or -es after s, x, z, ch or sh, as the clue check takes it.
const isPluralOf = (plural, word) => plural === `${word}s` || (/(?:[sxz]|[cs]h)$/.test(word) && plural === `${word}es`);
// The game takes a word and its plain plural for each other, as sameOrPlural() in
// shared/src/games/keywords/clue.ts does.
const sameOrPlural = (a, b) => a === b || isPluralOf(a, b) || isPluralOf(b, a);
const isGameName = (key) =>
  (gameNames ??= GAME_NAMES.map(wordKey)).some((name) => key === name || isPluralOf(key, name));

// What a term must not hold. Any space but the plain one, such as a tab, a line break, a no-break
// space or a full-width space, shows wrongly on a card. A character that shows nothing at all,
// such as a zero-width space or a soft hyphen, makes a word look like another one.
const HIDDEN = /[^\S ]|\p{Cc}|\p{Default_Ignorable_Code_Point}/gu;
const codePoint = (char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const describe = (value) => JSON.stringify(value);

// What is wrong with the characters of a term or a form, if anything. JSON shows a tab or a line
// break as an escape, but an invisible character as it is, so each one is named by its code point.
function spacing(text) {
  const hidden = [...new Set(text.match(HIDDEN))].map(codePoint);
  if (hidden.length > 0) return `holds ${hidden.join(', ')}: use plain spaces only, and no invisible characters`;
  if (text !== text.trim() || / {2}/.test(text)) return 'has spaces at its ends or two spaces in a row';
  return null;
}

// Terms that must not share a board, because one of them lies inside the other: "Gene" and "Gene
// editing", or "Unit" and "GPU" with the form "graphics processing unit". The server deals no two
// such terms together, and a list must still have 25 terms of which no two clash, or the server
// would have to.
//
// This must stay the same as cardsClash() in shared/src/games/keywords/clue.ts, with which the
// server draws the words for a board. This script can't import it, so a test in
// server/src/core/words.test.ts compares the two on every list. A term lies inside another when
// it is that term or a plain plural of it, when each of its pieces is a piece of that term or of
// one of its forms, or when it is that term's translation. The pieces are the parts that the
// strict clue rule counts, and also each letter that stands alone and each run of digits, so that
// "t-test" and "Turing test" don't clash. Two terms that only share a part, or a Chinese character,
// don't clash either.

const CLUE_SPACES = /\s+/gu;
// The pieces of a word: runs of Latin letters, runs of Chinese characters, runs of digits and runs
// of other letters, as PIECE in clue.ts.
const PIECE = /\p{Script=Latin}+|\p{Script=Han}+|\p{N}+|[^\P{L}\p{Script=Latin}\p{Script=Han}]+/gu;
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

// A text as a clue is checked: normalizeClue() in clue.ts.
const normalizeClue = (text) =>
  text.normalize('NFKC').replace(INVISIBLE, '').trim().replace(CLUE_SPACES, ' ').toLowerCase();

// wordOf() in clue.ts, as far as the clash check needs it: the key of a text and its pieces, which
// are every run of letters or digits but the small words, such as "of" and "to". A letter alone
// counts, even an "a".
function wordOf(text) {
  const folded = toSimplified(normalizeClue(text).normalize('NFD').replace(MARKS, ''));
  return {
    key: folded.replace(NOT_LETTER_OR_DIGIT, ''),
    pieces: (folded.match(PIECE) ?? []).filter((piece) => piece.length === 1 || !SMALL_WORDS.has(piece)),
  };
}

// liesInside() in clue.ts: the first word is the second or a plain plural of it, or each of its
// pieces is a piece of the second, the same or a plain plural, or, for a run of Chinese
// characters, lies inside one of the second's runs.
function liesInside(inner, outer) {
  if (sameOrPlural(inner.key, outer.key)) return true;
  return (
    inner.pieces.length > 0 &&
    inner.pieces.every((piece) =>
      outer.pieces.some((other) =>
        HAN.test(piece) && HAN.test(other) ? other.includes(piece) : sameOrPlural(piece, other),
      ),
    )
  );
}

// A term as the clash check sees it: its word with its pieces, the keys of its translations and
// its forms. `forms` holds the forms of both languages.
export function clashEntry(word, translations = [], forms = []) {
  return {
    word: wordOf(word),
    translations: translations.map(wordKey).filter((key) => key !== ''),
    forms: forms.map(wordOf).filter((form) => form.key !== ''),
  };
}

const givesAway = (word, card) =>
  liesInside(word.word, card.word) ||
  card.translations.some((key) => sameOrPlural(word.word.key, key)) ||
  card.forms.some((form) => liesInside(word.word, form));

export const clash = (a, b) => givesAway(a, b) || givesAway(b, a);

// How many of the entries can share a board, up to `enough`: the entries are taken one at a time,
// each time one that clashes with none of those taken, and of those the one that clashes with the
// fewest of the others still open, which shuts out the fewest. This may find fewer than the most
// there are, but on a list in which it does, a board would be hard to deal anyway.
export function compatible(entries, clashes, enough) {
  const neighbors = entries.map(() => new Set());
  for (const [a, b] of clashes) {
    neighbors[a].add(b);
    neighbors[b].add(a);
  }
  const open = new Set(entries.keys());
  const close = (index) => {
    open.delete(index);
    for (const other of neighbors[index]) neighbors[other].delete(index);
  };
  let taken = 0;
  while (taken < enough && open.size > 0) {
    const next = [...open].reduce((best, index) => (neighbors[index].size < neighbors[best].size ? index : best));
    for (const other of [...neighbors[next]]) close(other);
    close(next);
    taken += 1;
  }
  return taken;
}

// A term of a list as the clash check sees it in one language: its word in that language, with its
// translation and its forms.
function termEntry(term, language) {
  const other = LANGUAGES.find((each) => each !== language);
  const forms =
    term.forms && typeof term.forms === 'object' && !Array.isArray(term.forms)
      ? LANGUAGES.flatMap((each) => (Array.isArray(term.forms[each]) ? term.forms[each].filter(isText) : []))
      : [];
  return clashEntry(term[language], isText(term[other]) ? [term[other]] : [], forms);
}

// The pairs of terms of a list that clash, in one language, as indexes into `entries`, and the
// entries: each term that is a word in that language, once, with its translation and its forms.
// `texts` maps each key to the first term that has it, as checkWordList() finds them.
function clashesIn(terms, language, texts) {
  const entries = [...texts.values()].map(({ index, text }) => ({
    index,
    text,
    entry: termEntry(terms[index], language),
  }));
  const pairs = [];
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      if (clash(entries[a].entry, entries[b].entry)) pairs.push([a, b]);
    }
  }
  return { entries, pairs };
}

// Problems with a pair of related terms, which `where` writes. In the game that uses them, most
// players get one term and one or two get the other, in the room's language, so in neither
// language may they give each other away. That both terms have both languages is checked per term.
function checkPair(term, other, where) {
  const problems = [];
  for (const language of LANGUAGES) {
    if (!isText(term[language]) || !isText(other[language])) continue;
    if (clash(termEntry(term, language), termEntry(other, language))) {
      problems.push(
        `${where}: "related" pairs it with ${describe(other.id)}, but "${language}" ${describe(term[language])} and ${describe(other[language])} give each other away`,
      );
    }
  }
  return problems;
}

// Problems and warnings for one parsed list. `file` is its file name, such as "ml.json".
export function checkWordList(data, file) {
  const problems = [];
  const warnings = [];
  // What players might like to know and doesn't need fixing: the terms that can't share a board.
  const infos = [];
  const counts = Object.fromEntries(LANGUAGES.map((language) => [language, 0]));
  // How many pairs of related terms the list has, and how many each term is in.
  let pairs = 0;
  const inPairs = new Map();
  const result = () => ({ problems, warnings, infos, counts, pairs });

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
  const links = [];
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
      const wrong = spacing(text);
      if (wrong) problems.push(`${where}: "${language}" ${describe(text)} ${wrong}`);
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
      if ([...text].length > maxLength(text)) {
        warnings.push(
          `${where}: "${language}" ${describe(text)} is longer than ${maxLength(text)} characters and may not fit on a card`,
        );
      }
      if (isGameName(key)) {
        warnings.push(`${where}: "${language}" ${describe(text)} is also the name of a role or card in the game`);
      }
    }

    if (term.forms !== undefined) problems.push(...checkForms(term, where));

    if (term.difficulty !== undefined) {
      const { difficulty } = term;
      if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > MAX_DIFFICULTY) {
        problems.push(`${where}: "difficulty" must be a whole number from 1 to ${MAX_DIFFICULTY}`);
      }
    }
    if (term.related !== undefined) {
      if (!Array.isArray(term.related) || !term.related.every((id) => typeof id === 'string' && ID.test(id))) {
        problems.push(`${where}: "related" must be a list of term ids`);
      } else if (ids.get(term.id) === index) {
        // A term without a valid id of its own can't make a pair.
        links.push({ where, index, id: term.id, related: term.related });
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

  // "related" names other terms of this file, further down the list, so this waits until every id
  // is known. Each id that it names makes a pair, written once, on the term that comes first; so a
  // term that names an earlier one is wrong, whether or not that one names it too.
  for (const { where, index, id, related } of links) {
    const named = new Set();
    for (const other of related) {
      if (named.has(other)) {
        problems.push(`${where}: "related" names ${describe(other)} twice`);
        continue;
      }
      named.add(other);
      if (other === id) {
        problems.push(`${where}: "related" names the term itself`);
      } else if (!ids.has(other)) {
        problems.push(`${where}: "related" names ${describe(other)}, which is not the id of a term in this file`);
      } else if (ids.get(other) < index) {
        problems.push(
          `${where}: "related" names ${describe(other)}, which comes before it: write a pair once, on the term that comes first`,
        );
      } else {
        pairs += 1;
        for (const each of [id, other]) inPairs.set(each, (inPairs.get(each) ?? 0) + 1);
        problems.push(...checkPair(data.terms[index], data.terms[ids.get(other)], where));
      }
    }
  }
  // Each term that is in a pair, in the order of the file: it needs both languages, since the
  // game deals the pair in the room's language, and it is in MAX_PAIRS pairs at most.
  for (const [id, count] of [...inPairs].sort(([a], [b]) => ids.get(a) - ids.get(b))) {
    const index = ids.get(id);
    const where = `${file}: terms[${index}] (${id})`;
    const missing = LANGUAGES.filter((language) => !isText(data.terms[index][language]));
    if (missing.length > 0) {
      problems.push(
        `${where}: is in a pair of related terms but has no ${missing.map(describe).join(' or ')}: both terms of a pair need "zh" and "en"`,
      );
    }
    if (count > MAX_PAIRS) {
      problems.push(`${where}: is in ${count} pairs of related terms, but a term may be in ${MAX_PAIRS} at most`);
    }
  }

  const playable = LANGUAGES.filter((language) => counts[language] >= MIN_TERMS);
  if (playable.length === 0) {
    problems.push(`${file}: needs at least ${MIN_TERMS} different terms in Chinese or in English to be playable`);
  }
  for (const language of LANGUAGES) {
    if (counts[language] === 0) continue;
    const { entries, pairs } = clashesIn(data.terms, language, texts[language]);
    // Each pair once, under the term that comes first.
    const later = new Map();
    for (const [a, b] of pairs) later.set(a, [...(later.get(a) ?? []), describe(entries[b].text)]);
    for (const [at, others] of later) {
      const { index, text } = entries[at];
      const { id } = data.terms[index];
      infos.push(
        `${file}: terms[${index}]${isText(id) ? ` (${id})` : ''}: "${language}" ${describe(text)} can't share a board with ${others.join(', ')}`,
      );
    }
    if (counts[language] < MIN_TERMS) continue;
    const found = compatible(entries, pairs, MIN_TERMS);
    if (found < MIN_TERMS) {
      problems.push(
        `${file}: no ${MIN_TERMS} of its "${language}" terms could be found of which none repeats another, only ${found}, so a board would have to hold terms that give each other away`,
      );
    }
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

// Problems with the forms of a term: the other forms of it, in Chinese and in English, that a
// clue must not be either, such as "modeling" for "Model" or "CV" for "Computer vision". The game
// takes a word and its plain plural for each other, so a form must not be the term itself or its
// plain plural, or a word that the term is the plain plural of, such as "acoustic" for
// "Acoustics", which the game refuses anyway. The game puts the forms of both languages together,
// so a form must not repeat any other form of the term, or be its plain plural, either.
function checkForms(term, where) {
  const { forms } = term;
  const languages = forms && typeof forms === 'object' && !Array.isArray(forms) ? Object.keys(forms) : [];
  const lists = languages.every(
    (language) => LANGUAGES.includes(language) && Array.isArray(forms[language]) && forms[language].length > 0,
  );
  if (languages.length === 0 || !lists) {
    return [`${where}: "forms" must have a "zh" list, an "en" list or both, each with at least one form`];
  }
  const problems = [];
  const own = LANGUAGES.filter((language) => isText(term[language])).map((language) => wordKey(term[language]));
  const seen = new Map();
  for (const language of languages) {
    for (const form of forms[language]) {
      const label = `"forms.${language}"`;
      if (!isText(form)) {
        problems.push(`${where}: ${label} must hold only non-empty strings`);
        continue;
      }
      const wrong = spacing(form);
      if (wrong) problems.push(`${where}: ${label} ${describe(form)} ${wrong}`);
      const key = wordKey(form);
      const earlier = [...seen].find(([other]) => sameOrPlural(key, other))?.[1];
      if (key === '') {
        problems.push(`${where}: ${label} ${describe(form)} has no letters or digits`);
      } else if (own.some((word) => sameOrPlural(key, word))) {
        problems.push(
          `${where}: ${label} ${describe(form)} is the term itself, its plain plural or its singular, so it needs no listing`,
        );
      } else if (earlier !== undefined) {
        const other =
          earlier === form
            ? ''
            : wordKey(earlier) === key
              ? ` (${describe(earlier)}), which has the same letters and digits`
              : ` (${describe(earlier)}), which the game takes for the same word`;
        problems.push(`${where}: ${label} ${describe(form)} repeats another form${other}`);
      } else {
        seen.set(key, form);
      }
    }
  }
  return problems;
}

// Problems with words that more than one list holds, given every list that was read as
// { file, data }, in order: one list of problems for each. When a room plays with several fields,
// the server makes one card of a word that they share, and the card carries the translations from
// all of them. So a word needs the same translation, spelled the same way, in every list. Each
// later list that translates it differently gets the problem. Words that one list holds twice are
// that list's own problem, which checkWordList() reports.
export function checkAcrossLists(lists) {
  const first = Object.fromEntries(LANGUAGES.map((language) => [language, new Map()]));
  return lists.map(({ file, data }) => {
    const problems = [];
    const own = Object.fromEntries(LANGUAGES.map((language) => [language, new Set()]));
    const terms = data && typeof data === 'object' && Array.isArray(data.terms) ? data.terms : [];
    terms.forEach((term, index) => {
      // Only a term in both languages has a translation that could differ.
      if (!term || typeof term !== 'object' || !LANGUAGES.every((language) => isText(term[language]))) return;
      for (const language of LANGUAGES) {
        const key = wordKey(term[language]);
        if (key === '' || own[language].has(key)) continue;
        own[language].add(key);
        const translation = term[LANGUAGES.find((other) => other !== language)];
        const before = first[language].get(key);
        if (!before) {
          first[language].set(key, { file, translation });
        } else if (before.translation !== translation) {
          const where = `${file}: terms[${index}]${isText(term.id) ? ` (${term.id})` : ''}`;
          problems.push(
            `${where}: "${language}" ${describe(term[language])} is translated ${describe(translation)} here but ${describe(before.translation)} in ${before.file}: the game makes one card of it, so it needs the same translation in both`,
          );
        }
      }
    });
    return problems;
  });
}

// The line of the file on which each term of a list starts. JSON.parse() keeps no positions, so
// this reads the text again: it follows strings and brackets, and notes where each value of the
// "terms" array at the top level begins. The text must be valid JSON.
export function termLines(text) {
  let lines = [];
  let line = 1;
  let depth = 0;
  let key = null; // the last string at the top level, which is the key when a value follows
  let inTerms = false;
  let next = false; // the next value starts a term
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\n') line += 1;
    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') continue;
    if (inTerms && depth === 2 && next && char !== ']') {
      lines.push(line);
      next = false;
    }
    if (char === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      if (depth === 1) key = JSON.parse(text.slice(i, end + 1));
      i = end;
    } else if (char === '{' || char === '[') {
      depth += 1;
      // A second "terms" replaces the first, as it does for JSON.parse().
      if (depth === 2 && char === '[' && key === 'terms') [inTerms, next, lines] = [true, true, []];
    } else if (char === '}' || char === ']') {
      if (depth === 2) inTerms = false;
      depth -= 1;
    } else if (char === ',' && inTerms && depth === 2) {
      next = true;
    }
  }
  return lines;
}

// The line that a problem or a warning is about, if any: the line on which the term that it names
// starts, or the line on which the JSON broke. Lines about the whole list have none.
export function lineOf(message, lines = []) {
  const term = message.match(/: terms\[(\d+)\]/);
  if (term) return lines[Number(term[1])];
  const broken = message.match(/\(line (\d+) column \d+\)$/);
  return broken ? Number(broken[1]) : undefined;
}

// Problems and warnings for the list in one file, with the parsed list and the line of each of
// its terms. A file that can't be read is not a problem with a word list, so this throws, and
// main() reports an error.
export function checkFile(path) {
  const file = basename(path);
  const text = readFileSync(path, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { problems: [`${file}: not valid JSON: ${error.message}`], warnings: [], counts: {} };
  }
  return { ...checkWordList(data, file), data, lines: termLines(text) };
}

// A problem or a warning as a GitHub Actions workflow command. The log shows it as an error or a
// warning, and GitHub attaches it to the file in the pull request, at `line` when it is given,
// which needs the file's path from the root of the repository. A file outside the repository gets
// no path and no line.
export function annotation(kind, message, path, line) {
  const data = (text) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  const property = (text) => data(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
  const fromRoot = relative(root, resolve(path));
  const inside = fromRoot !== '' && !fromRoot.startsWith('..') && !isAbsolute(fromRoot);
  const file = inside ? `file=${property(fromRoot.split(sep).join('/'))},${line ? `line=${line},` : ''}` : '';
  return `::${kind} ${file}title=check-words::${data(message)}`;
}

// `wordsDir` is where the lists are when no file is named. The tests pass their own.
export function main(argv, wordsDir = join(root, 'words')) {
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

  // Every list is read before any is reported, because the lists are also checked against each
  // other.
  const checked = [];
  let unreadable = 0;
  for (const path of paths) {
    try {
      checked.push({ path, result: checkFile(path) });
    } catch (error) {
      // A mistyped path, a directory, or a file that this user may not read.
      console.error(`check-words: error: ${error.message}`);
      unreadable += 1;
    }
  }
  const parsed = checked.filter(({ result }) => result.data !== undefined);
  checkAcrossLists(parsed.map(({ path, result }) => ({ file: basename(path), data: result.data }))).forEach(
    (problems, index) => parsed[index].result.problems.push(...problems),
  );

  // The information comes first, so that the problems and warnings end the output. It is no
  // annotation: there is a lot of it, and none of it needs fixing.
  for (const { result } of checked) {
    for (const message of result.infos ?? []) console.log(`check-words: info: ${message}`);
  }

  let problems = 0;
  // On GitHub Actions the workflow command is the line in the log, so each is printed once.
  const actions = Boolean(process.env.GITHUB_ACTIONS);
  for (const { path, result } of checked) {
    const print = (kind, message) =>
      console.log(
        actions
          ? annotation(kind, message, path, lineOf(message, result.lines))
          : `check-words: ${kind === 'warning' ? 'warning: ' : ''}${message}`,
      );
    for (const message of result.problems) print('error', message);
    for (const message of result.warnings) print('warning', message);
    if (result.problems.length === 0) {
      const counts = LANGUAGES.map((language) => `${result.counts[language]} ${language}`).join(', ');
      const pairs = `${result.pairs} related ${result.pairs === 1 ? 'pair' : 'pairs'}`;
      console.log(`check-words: OK ${basename(path)} (${counts}, ${pairs})`);
    }
    problems += result.problems.length;
  }
  if (paths.length === 0) console.log('check-words: no word lists in words/ yet');
  if (problems) console.log(`check-words: ${problems} problem(s). See words/README.md.`);
  // A file that wasn't checked counts for more than what the others have: the run is not complete.
  if (unreadable) return 2;
  return problems ? 1 : 0;
}

// Run as a script, not when imported by the tests. Node resolves import.meta.url to the real
// path, so the path on the command line must be resolved too in case it goes through a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
