// Checks a clue against the rules: how long it is, and how it stands to the words that are still
// on the board. The client runs it while the captain types, and the server runs it again before
// it accepts the clue. docs/games/keywords.md says which conflicts are always refused, which are
// refused under the strict clue rule only, and which only bring up a warning.

import { HAN, toSimplified } from '../../han';

export type ClueProblem =
  'clue_empty' | 'clue_not_one_word' | 'clue_too_many_words' | 'clue_too_long' | 'clue_on_board';

// How a clue runs into a card:
// - 'same': it repeats the card's word: the word itself, a plain plural of it or a part of it, or
//   a run of Chinese characters that contains one of the word's or lies inside one. Or it is the
//   card's term in another language, or a plain plural of that. Always refused.
// - 'form': it repeats one of the other forms of the term that the word library lists for the
//   card, in any of the ways that 'same' repeats the card's word. Refused under the strict rule.
// - 'character': it has a Chinese character in common with the card's word, which the strict
//   rule refuses, or with the card's term in another language, which only brings a warning.
// - 'similar': it may be another form of the card's word by its ending, such as "modeling" for
//   "model", or a part or such a form of the card's term in another language. A warning.
// - 'inside': it contains the card's word, or a part of it, of four letters or more, such as
//   "datacenter" for "Data". A warning.
export type ClueMatchKind = 'same' | 'form' | 'character' | 'similar' | 'inside';

// A card that the clue runs into, with the text that the clue runs into: the card's word, one
// of its translations or one of its forms.
export interface ClueMatch {
  card: number;
  text: string;
  kind: ClueMatchKind;
}

export interface ClueCheck {
  problem: ClueProblem | null;
  // The card that the clue runs into, when the problem is clue_on_board.
  conflict: ClueMatch | null;
  // Cards that the clue comes close to, at most one match for each. These are allowed, but the
  // captain sees a warning.
  similar: ClueMatch[];
}

// What the check needs to know about a card. The translations are the card's term in the other
// languages of the word library, which a clue must not repeat either, and the forms are the
// other forms of the term that the library lists, in any language.
export interface ClueCard {
  word: string;
  revealed: boolean;
  translations?: readonly string[];
  forms?: readonly string[];
}

// What a room allows (clueOptions() in settings.ts): how many words a clue may have, how many
// Chinese characters, and whether the strict clue rule holds.
export interface ClueOptions {
  words: number;
  han: number;
  strict: boolean;
}

// The longest word of a clue, in the characters that it is made of, and the longest clue with
// Chinese characters in it, in all.
export const MAX_CLUE_LENGTH = 24;
export const MAX_CLUE_HAN = 10;
// The longest text that is looked at at all, in UTF-16 units as it arrives: more than three words
// of 24 characters need. Normalizing is the expensive step, and a text can be built to make it
// slow, so a longer text is refused before it is normalized.
export const MAX_CLUE_INPUT = 128;
// The shortest word or part of a card that brings a warning when a clue contains it.
const INSIDE_LENGTH = 4;

// One word, at most 10 Chinese characters, and the strict rule: what a room has unless its
// settings say otherwise.
export const DEFAULT_CLUE_OPTIONS: ClueOptions = { words: 1, han: MAX_CLUE_HAN, strict: true };

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
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;
// Small words that hold a compound together without being what it is about. "State-of-the-art"
// doesn't repeat "out-of-distribution".
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

const SPACES = /\s+/gu;

// A clue as it is recorded and shown: as the captain typed it, but without invisible characters,
// without the spaces at its ends, and with one plain space between its words.
export const cleanClue = (text: string): string => text.replace(INVISIBLE, '').trim().replace(SPACES, ' ');

// A clue as it is checked: with full-width and compatibility forms folded (NFKC), and in lower
// case.
export const normalizeClue = (text: string): string => cleanClue(text.normalize('NFKC')).toLowerCase();

// A word as it is compared: normalized, without accents, and with traditional Chinese characters
// turned into simplified ones.
const fold = (text: string): string => toSimplified(normalizeClue(text).normalize('NFD').replace(MARKS, ''));

// What makes two texts the same word: their letters and digits, in the form in which words are
// compared. "Co-author", "co author", "Coauthor" and "COAUTHOR" all have the key "coauthor".
export const wordKey = (text: string): string => fold(text).replace(NOT_LETTER_OR_DIGIT, '');

interface Word {
  key: string;
  // The parts that count on their own: every run of Chinese characters, and other runs of two
  // or more letters that aren't small words. One letter alone, such as the "s" of "Master's" or
  // the "u" of "U-Net", is not a word that a clue could repeat.
  parts: string[];
  // Its Chinese characters, in their simplified forms.
  han: Set<string>;
}

function wordOf(text: string): Word {
  const folded = fold(text);
  return {
    key: folded.replace(NOT_LETTER_OR_DIGIT, ''),
    parts: (folded.match(PART) ?? []).filter((part) => HAN.test(part) || (part.length > 1 && !SMALL_WORDS.has(part))),
    han: new Set([...folded].filter((char) => HAN.test(char))),
  };
}

// A plain plural: -s, or -es after s, x, z, ch or sh. "Grades" is not a plural of "grad".
const isPluralOf = (plural: string, word: string) =>
  plural === `${word}s` || (/(?:[sxz]|[cs]h)$/.test(word) && plural === `${word}es`);
const sameOrPlural = (a: string, b: string) => a === b || isPluralOf(a, b) || isPluralOf(b, a);

// Common endings, each with what it may stand in place of: nothing ("models"), the -e or -y
// that it replaced ("making", "studies", "simulation" from "simulate"), or the ending of the
// singular ("hypotheses", "appendices", "spectra", "corpora", "stimuli", "formulae", "leaves").
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
  ['ves', 'f', 'fe'],
  ['es', '', 'e', 'is'],
  ['ed', '', 'e'],
  ['ly', '', 'e'],
  ['ae', 'a'],
  ['ata', 'a'],
  ['ora', 'us'],
  ['era', 'us'],
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
    if (base.length < 2) continue;
    for (const letters of replaced) found.add(base + letters);
    if (replaced.includes('') && /([b-df-hj-np-tv-z])\1$/.test(base)) found.add(base.slice(0, -1));
  }
  return found;
}

const shareStem = (a: string, b: string) => [...stems(a)].some((stem) => stems(b).has(stem));

// The clue is the word, a plain plural of it, or the same for one of its parts. Chinese parts
// also count when one contains the other. Latin parts are never searched inside other words.
function repeats(clue: Word, word: Word): boolean {
  if (sameOrPlural(clue.key, word.key)) return true;
  return clue.parts.some((part) =>
    word.parts.some((other) =>
      HAN.test(part) && HAN.test(other) ? part.includes(other) || other.includes(part) : sameOrPlural(part, other),
    ),
  );
}

// The clue may be another form of the word, or of one of its parts.
function resembles(clue: Word, word: Word): boolean {
  if (LATIN_ONLY.test(clue.key) && LATIN_ONLY.test(word.key) && shareStem(clue.key, word.key)) return true;
  const latin = word.parts.filter((part) => LATIN.test(part));
  return clue.parts.some((part) => LATIN.test(part) && latin.some((other) => shareStem(part, other)));
}

const sharesHan = (clue: Word, word: Word) => [...clue.han].some((char) => word.han.has(char));

// The clue contains the word, or a part of it, of four Latin letters or more: "datacenter" for
// "Data", "metadata" for "Big data". A clue of several words contains what runs across its words
// as well: "big data center" contains "Datacenter". A clue that is the word or the part itself
// repeats it.
function contains(clue: Word, word: Word): boolean {
  const inner = [word.key, ...word.parts].filter((text) => text.length >= INSIDE_LENGTH && LATIN_ONLY.test(text));
  return inner.some((text) => clue.key !== text && clue.key.includes(text));
}

// What the clue does to one card that is still on the board: what refuses it in any case, what
// refuses it under the strict rule, and what only brings a warning, each the first that applies.
// `clues` holds the whole clue and, when it has several words, each of them, so that a word of a
// clue counts as the clue would.
interface Verdict {
  refused: ClueMatch | null;
  strict: ClueMatch | null;
  warned: ClueMatch | null;
}

function judge(clues: readonly Word[], card: ClueCard, index: number): Verdict {
  type Test = (clue: Word, other: Word) => boolean;
  const word = wordOf(card.word);
  const translations = (card.translations ?? []).map((text) => ({ text, word: wordOf(text) }));
  // The card's word, or the first of its translations, that some clue meets the test against.
  const ofWord = (test: Test, kind: ClueMatchKind): ClueMatch | null =>
    clues.some((clue) => test(clue, word)) ? { card: index, text: card.word, kind } : null;
  const ofTranslation = (test: Test, kind: ClueMatchKind): ClueMatch | null => {
    const found = translations.find((other) => clues.some((clue) => test(clue, other.word)));
    return found ? { card: index, text: found.text, kind } : null;
  };

  // The translation itself is refused like the word. A part or a form of it only brings a
  // warning, because the room plays in the other language.
  const refused = ofWord(repeats, 'same') ?? ofTranslation((clue, other) => sameOrPlural(clue.key, other.key), 'same');
  if (refused) return { refused, strict: null, warned: null };

  // What the word library lists as a form of the term counts as the term under the strict rule:
  // the library knows. A clue repeats a form as it would repeat the word on the board: a form of
  // several words gives the term away word by word, and a room's clue length may never let it
  // through whole. The endings that the warnings go by are only a guess.
  const form = (card.forms ?? []).find((text) => {
    const other = wordOf(text);
    return other.key !== '' && clues.some((clue) => repeats(clue, other));
  });
  const strict =
    form === undefined ? ofWord(sharesHan, 'character') : { card: index, text: form, kind: 'form' as const };
  const warned =
    ofWord(resembles, 'similar') ??
    ofTranslation((clue, other) => repeats(clue, other) || resembles(clue, other), 'similar') ??
    ofTranslation(sharesHan, 'character') ??
    ofWord(contains, 'inside') ??
    ofTranslation(contains, 'inside');
  return { refused: null, strict, warned };
}

export function checkClue(
  clue: string,
  board: readonly ClueCard[],
  options: ClueOptions = DEFAULT_CLUE_OPTIONS,
): ClueCheck {
  const verdict = (
    problem: ClueProblem | null,
    conflict: ClueMatch | null = null,
    similar: ClueMatch[] = [],
  ): ClueCheck => ({ problem, conflict, similar });
  // The types promise a string, but the clue comes from a player.
  if (typeof clue !== 'string') return verdict('clue_empty');
  if (clue.length > MAX_CLUE_INPUT) return verdict('clue_too_long');
  const text = normalizeClue(clue);
  if (!text) return verdict('clue_empty');
  const words = text.split(' ');
  if (!words.every((word) => ONE_WORD.test(word) && LETTER_OR_DIGIT.test(word))) return verdict('clue_not_one_word');
  if (words.length > options.words) return verdict(options.words === 1 ? 'clue_not_one_word' : 'clue_too_many_words');
  const characters = words.flatMap((word) => [...word]);
  const han = characters.filter((char) => HAN.test(char)).length;
  const tooLong =
    words.some((word) => [...word].length > MAX_CLUE_LENGTH) ||
    (han > 0 && characters.length > MAX_CLUE_HAN) ||
    han > options.han;
  if (tooLong) return verdict('clue_too_long');

  const whole = wordOf(text);
  const clues = words.length > 1 ? [whole, ...words.map(wordOf)] : [whole];
  // A covered word may be said again.
  const verdicts = board.map((card, index) => (card.revealed ? null : judge(clues, card, index)));
  const refused = verdicts.find((found) => found?.refused)?.refused;
  if (refused) return verdict('clue_on_board', refused);
  const strict = options.strict ? verdicts.find((found) => found?.strict)?.strict : undefined;
  if (strict) return verdict('clue_on_board', strict);
  // Under the loose rule, what the strict rule would refuse is the strongest warning.
  return verdict(
    null,
    null,
    verdicts.flatMap((found) => (found ? (found.strict ?? found.warned ?? []) : [])),
  );
}

// What keeping two cards off one board needs of a card, worked out once for each card: the card's
// word as a clue would be checked, whole and word by word, and as a card on the board, with the
// keys of its translations and its forms.
interface Dealt {
  clues: Word[];
  word: Word;
  translations: string[];
  forms: Word[];
}

const dealt = new WeakMap<object, Dealt>();

function dealtOf(card: BoardText): Dealt {
  let found = dealt.get(card);
  if (!found) {
    const text = normalizeClue(card.word);
    const word = wordOf(text);
    const words = text.split(' ');
    found = {
      clues: words.length > 1 ? [word, ...words.map(wordOf)] : [word],
      word,
      translations: (card.translations ?? []).map(wordKey).filter((key) => key !== ''),
      forms: (card.forms ?? []).map(wordOf).filter((form) => form.key !== ''),
    };
    dealt.set(card, found);
  }
  return found;
}

// The card's word, given as a clue while the other card is on the board, would be refused under
// the strict rule for repeating it: its word, its term in another language or one of its forms.
// A Chinese character in common is left out, and so is everything that only brings a warning.
const givesAway = (clue: Dealt, card: Dealt): boolean =>
  clue.clues.some(
    (word) =>
      repeats(word, card.word) ||
      card.translations.some((key) => sameOrPlural(word.key, key)) ||
      card.forms.some((form) => repeats(word, form)),
  );

// The words of a card, as the word library gives them: what cardsClash() compares.
export type BoardText = Pick<ClueCard, 'word' | 'translations' | 'forms'>;

// Whether two words must not share a board, because one of them repeats the other: "Gene" and
// "Gene editing", the Chinese words for "fossil" and "living fossil", or "Unit" and "GPU" with the
// form "graphics processing unit". Hinting at one would hint at the other, and guessers couldn't
// tell which was meant. It holds each word, as a clue, against the other as a card, as the strict
// clue rule would, in both directions. Only a Chinese character in common doesn't count, since so
// many terms share one. What it works out about a card is kept with the card object, so pass the
// same objects again. scripts/check-words.mjs has a copy of this, which a test holds to it.
export function cardsClash(a: BoardText, b: BoardText): boolean {
  const first = dealtOf(a);
  const second = dealtOf(b);
  return givesAway(first, second) || givesAway(second, first);
}
