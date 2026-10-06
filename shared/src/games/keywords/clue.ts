// Checks a clue against the standard rules: one word, and neither a word that is still on the
// board nor a form of one. The client runs it while the captain types, and the server runs it
// again before it accepts the clue. docs/games/keywords.md says which conflicts are refused and
// which only bring up a warning.

import { toSimplified } from '../../han';

export type ClueProblem = 'clue_empty' | 'clue_not_one_word' | 'clue_too_long' | 'clue_on_board';

export interface ClueCheck {
  problem: ClueProblem | null;
  // The card that the clue repeats, when the problem is clue_on_board.
  conflict: number | null;
  // Cards that the clue may be a form of, such as "modeling" for "model". These are allowed,
  // but the captain sees a warning.
  similar: number[];
}

// What the check needs to know about a card. The translations are the card's term in the other
// languages of the word library, which a clue must not repeat either.
export interface ClueCard {
  word: string;
  revealed: boolean;
  translations?: readonly string[];
}

export const MAX_CLUE_LENGTH = 24;
export const MAX_CLUE_HAN = 10;
// The longest text that is looked at at all, in UTF-16 units as it arrives: far more than a clue
// of 24 characters needs. Normalizing is the expensive step, and a text can be built to make it
// slow, so a longer text is refused before it is normalized.
export const MAX_CLUE_INPUT = 64;

const HAN = /\p{Script=Han}/u;
const LATIN = /\p{Script=Latin}/u;
const LATIN_ONLY = /^\p{Script=Latin}+$/u;
// Characters that show nothing: zero-width spaces and joiners, variation selectors, soft hyphens
// and blank fillers. Inside a word they would make it look like another word.
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
const MARKS = /\p{M}/gu;
// One word is made of letters and digits, each with at most two combining marks, and of hyphens
// and apostrophes: "self-attention" is one word. It has at least one letter or digit.
const ONE_WORD = /^(?:[\p{L}\p{N}]\p{M}{0,2}|['\u2019-])+$/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
// The parts of a word: runs of Latin letters, runs of Chinese characters and runs of other
// letters. Spaces, hyphens, apostrophes, digits and anything else come between them.
const PART = /\p{Script=Latin}+|\p{Script=Han}+|[^\P{L}\p{Script=Latin}\p{Script=Han}]+/gu;
const SEPARATORS = /[\s'\u2019-]+/g;

// A clue as it is recorded and shown: as the captain typed it, but without invisible characters
// and without the spaces at its ends.
export const cleanClue = (text: string): string => text.replace(INVISIBLE, '').trim();

// A clue as it is checked: with full-width and compatibility forms folded (NFKC), and in lower
// case.
export const normalizeClue = (text: string): string => cleanClue(text.normalize('NFKC')).toLowerCase();

// The form in which words are compared: normalized, without accents, and with traditional
// Chinese characters turned into simplified ones. Two texts with the same key are the same word.
export const wordKey = (text: string): string => toSimplified(normalizeClue(text).normalize('NFD').replace(MARKS, ''));

interface Word {
  // The word without its separators: "co-author", "co author" and "coauthor" are all "coauthor".
  joined: string;
  // The parts that count on their own: every run of Chinese characters, and runs of two or more
  // other letters. One letter alone, such as the "s" of "Master's" or the "u" of "U-Net", is
  // not a word that a clue could repeat.
  parts: string[];
}

function wordOf(text: string): Word {
  const key = wordKey(text);
  return {
    joined: key.replace(SEPARATORS, ''),
    parts: (key.match(PART) ?? []).filter((part) => HAN.test(part) || part.length > 1),
  };
}

// A plain plural: -s, or -es after s, x, z, ch or sh. "Grades" is not a plural of "grad".
const isPluralOf = (plural: string, word: string) =>
  plural === `${word}s` || (/(?:[sxz]|[cs]h)$/.test(word) && plural === `${word}es`);
const sameOrPlural = (a: string, b: string) => a === b || isPluralOf(a, b) || isPluralOf(b, a);

// Common endings, each with what it may stand in place of: nothing ("models"), the -e or -y
// that it replaced ("making", "studies", "simulation" from "simulate"), or the ending of a Latin
// or Greek singular ("hypotheses", "appendices", "spectra", "stimuli", "formulae").
const ENDINGS: readonly (readonly [ending: string, ...replaced: string[]])[] = [
  ['ations', '', 'e'],
  ['ation', '', 'e'],
  ['ions', '', 'e'],
  ['ion', '', 'e'],
  ['ings', '', 'e'],
  ['ing', '', 'e'],
  ['ers', '', 'e'],
  ['er', '', 'e'],
  ['ors', '', 'e'],
  ['or', '', 'e'],
  ['ies', '', 'y'],
  ['ied', '', 'y'],
  ['ices', 'ix', 'ex'],
  ['es', '', 'e', 'is'],
  ['ed', '', 'e'],
  ['ly', '', 'e'],
  ['ae', 'a'],
  ['s', '', 'e'],
  ['a', 'um', 'on'],
  ['i', 'us'],
];
const IRREGULAR = new Map([
  ['mice', 'mouse'],
  ['men', 'man'],
  ['women', 'woman'],
  ['children', 'child'],
  ['people', 'person'],
  ['feet', 'foot'],
  ['teeth', 'tooth'],
]);

// The word itself and what it may be a form of: the word without a common ending, also with a
// doubled final consonant undone ("modelling"), and with what the ending replaced. Two words
// with a stem in common may be forms of each other.
function stems(word: string): Set<string> {
  const found = new Set([word]);
  const irregular = IRREGULAR.get(word);
  if (irregular) found.add(irregular);
  for (const [ending, ...replaced] of ENDINGS) {
    if (!word.endsWith(ending)) continue;
    const base = word.slice(0, -ending.length);
    if (base.length < 3) continue;
    for (const letters of replaced) found.add(base + letters);
    if (replaced.includes('') && /([b-df-hj-np-tv-z])\1$/.test(base)) found.add(base.slice(0, -1));
  }
  return found;
}

const shareStem = (a: string, b: string) => [...stems(a)].some((stem) => stems(b).has(stem));

// The clue is the word, a plain plural of it, or the same for one of its parts. Chinese parts
// also count when one contains the other. Latin parts are never searched inside other words.
function repeats(clue: Word, word: Word): boolean {
  if (sameOrPlural(clue.joined, word.joined)) return true;
  return clue.parts.some((part) =>
    word.parts.some((other) =>
      HAN.test(part) && HAN.test(other) ? part.includes(other) || other.includes(part) : sameOrPlural(part, other),
    ),
  );
}

// The clue may be another form of the word, or of one of its parts.
function resembles(clue: Word, word: Word): boolean {
  if (LATIN_ONLY.test(clue.joined) && LATIN_ONLY.test(word.joined) && shareStem(clue.joined, word.joined)) return true;
  const latin = word.parts.filter((part) => LATIN.test(part));
  return clue.parts.some((part) => LATIN.test(part) && latin.some((other) => shareStem(part, other)));
}

export function checkClue(clue: string, board: readonly ClueCard[]): ClueCheck {
  const verdict = (problem: ClueProblem | null, conflict: number | null = null, similar: number[] = []): ClueCheck => ({
    problem,
    conflict,
    similar,
  });
  if (clue.length > MAX_CLUE_INPUT) return verdict('clue_too_long');
  const text = normalizeClue(clue);
  if (!text) return verdict('clue_empty');
  if (!ONE_WORD.test(text) || !LETTER_OR_DIGIT.test(text)) return verdict('clue_not_one_word');
  const length = [...text].length;
  if (length > MAX_CLUE_LENGTH || (HAN.test(text) && length > MAX_CLUE_HAN)) return verdict('clue_too_long');

  const given = wordOf(text);
  const similar: number[] = [];
  for (const [index, card] of board.entries()) {
    if (card.revealed) continue; // a covered word may be said again
    const word = wordOf(card.word);
    if (repeats(given, word)) return verdict('clue_on_board', index);
    let close = resembles(given, word);
    for (const translation of card.translations ?? []) {
      const other = wordOf(translation);
      // The translation itself is refused like the word. A part or a form of it only brings a
      // warning, because the room plays in the other language.
      if (sameOrPlural(given.joined, other.joined)) return verdict('clue_on_board', index);
      close ||= repeats(given, other) || resembles(given, other);
    }
    if (close) similar.push(index);
  }
  return verdict(null, null, similar);
}
