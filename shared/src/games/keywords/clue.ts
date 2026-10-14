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
//   card's term in another language, or a plain plural of that, or the pinyin of the card's
//   Chinese word. Always refused.
// - 'form': it repeats one of the other forms of the term that the word library lists for the
//   card, in any of the ways that 'same' repeats the card's word. Refused under the strict rule.
// - 'character': it has a character in common with the card's word, which the strict rule
//   refuses, or with the card's term in another language, which only brings a warning. A number
//   counts as a character, written in digits, in Chinese or in English: "6", the Chinese numeral
//   for six and "six" are the same character. So, with the card's word, do the English meanings of
//   its Chinese characters (`glosses`), such as "ball" for the character of a ball, and the pinyin
//   of each of them, of three letters or more, such as "qiu" for the same character.
// - 'similar': it may be another form of the card's word by its ending, such as "modeling" for
//   "model", or a part or such a form of the card's term in another language. A warning.
// - 'inside': it contains the card's word, or a part of it, of four letters or more, such as
//   "datacenter" for "Data", without being another form of it by its ending. Refused under the
//   strict rule in a Chinese room, where a Latin word on the board stands out; a warning in an
//   English room, where "support" would give "Port" away otherwise, and for the card's term in
//   another language.
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
// languages of the word library, which a clue must not repeat either, the forms are the other
// forms of the term that the library lists, in any language, and the pinyin is that of a Chinese
// word, as the server works it out (BoardWord in types.ts), which a clue must not be either. The
// glosses are the English meanings of the Chinese characters of the card's word, from a dictionary,
// which only the captains get.
export interface ClueCard {
  word: string;
  revealed: boolean;
  translations?: readonly string[];
  forms?: readonly string[];
  pinyin?: string;
  glosses?: readonly string[];
}

// What a room allows (clueOptions() in settings.ts): how many words a clue may have, how long it
// may be as clueLength() counts, in a Chinese room, or null in an English room, where the words
// are counted instead, and whether the strict clue rule holds.
export interface ClueOptions {
  words: number;
  length: number | null;
  strict: boolean;
}

// The longest word of a clue, in the characters that it is made of, and, in an English room, the
// longest clue with Chinese characters in it, in all.
export const MAX_CLUE_LENGTH = 24;
export const MAX_CLUE_HAN = 10;
// The longest text that is looked at at all, in UTF-16 units as it arrives: more than three words
// of 24 characters need. Normalizing is the expensive step, and a text can be built to make it
// slow, so a longer text is refused before it is normalized.
export const MAX_CLUE_INPUT = 128;
// The shortest word or part of a card that brings a warning when a clue contains it.
const INSIDE_LENGTH = 4;
// The shortest word of a clue that counts as the English or the pinyin of a character: shorter
// ones, such as "a", "he" or "an", are too often English words of their own.
const CHARACTER_WORD_LENGTH = 3;

// One word, counted as in an English room, and the strict rule: what a room has unless its
// settings say otherwise.
export const DEFAULT_CLUE_OPTIONS: ClueOptions = { words: 1, length: null, strict: true };

const LATIN = /\p{Script=Latin}/u;
const LATIN_ONLY = /^\p{Script=Latin}+$/u;
// A letter or a digit that isn't a Chinese character, for the length of a clue in a Chinese room.
const OTHER_LETTER = /^(?!\p{Script=Han})[\p{L}\p{N}]$/u;
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
// The pieces of a word: its parts and its runs of digits.
const PIECE = /\p{Script=Latin}+|\p{Script=Han}+|\p{N}+|[^\P{L}\p{Script=Latin}\p{Script=Han}]+/gu;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;
// Small words that hold a compound together without being what it is about. "State-of-the-art"
// doesn't repeat "out-of-distribution".
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

const SPACES = /\s+/gu;

// Numbers, which count as characters (docs/games/keywords.md#the-clue): a digit, a Chinese numeral
// and an English number word that stand for the same number are the same character. The capital
// numerals that cheques use are left out, since they are other words as well, as in the Chinese
// word for "land". A run of digits counts digit by digit, and as a whole too when it is a number
// that a Chinese numeral or an English word of its own names: "10" is "1", "0" and "10".
const HAN_NUMBERS = new Map([
  ['\u3007', '0'],
  ['\u96f6', '0'],
  ['\u4e00', '1'],
  ['\u4e8c', '2'],
  ['\u4e09', '3'],
  ['\u56db', '4'],
  ['\u4e94', '5'],
  ['\u516d', '6'],
  ['\u4e03', '7'],
  ['\u516b', '8'],
  ['\u4e5d', '9'],
  ['\u5341', '10'],
  ['\u767e', '100'],
  ['\u5343', '1000'],
  ['\u4e07', '10000'],
]);
const NUMBER_WORDS = new Map([
  ['zero', '0'],
  ['one', '1'],
  ['two', '2'],
  ['three', '3'],
  ['four', '4'],
  ['five', '5'],
  ['six', '6'],
  ['seven', '7'],
  ['eight', '8'],
  ['nine', '9'],
  ['ten', '10'],
  ['hundred', '100'],
  ['thousand', '1000'],
]);
const NAMED_NUMBERS = new Set(HAN_NUMBERS.values());
const DIGITS = /[0-9]+/g;

// The numbers in a folded text, as the strings of their digits.
function numbersIn(folded: string, parts: readonly string[]): Set<string> {
  const numbers = new Set<string>();
  for (const char of folded) {
    const number = HAN_NUMBERS.get(char);
    if (number !== undefined) numbers.add(number);
  }
  for (const run of folded.match(DIGITS) ?? []) {
    for (const digit of run) numbers.add(digit);
    if (NAMED_NUMBERS.has(run)) numbers.add(run);
  }
  for (const part of parts) {
    const number = NUMBER_WORDS.get(part);
    if (number !== undefined) numbers.add(number);
  }
  return numbers;
}

// A clue as it is recorded and shown: as the captain typed it, but without invisible characters,
// without the spaces at its ends, and with one plain space between its words.
export const cleanClue = (text: string): string => text.replace(INVISIBLE, '').trim().replace(SPACES, ' ');

// A clue as it is checked: with full-width and compatibility forms folded (NFKC), and in lower
// case.
export const normalizeClue = (text: string): string => cleanClue(text.normalize('NFKC')).toLowerCase();

// How long a clue is in a Chinese room: its Chinese characters, and its other letters and digits
// two to one, rounded up, as Weibo counts. "GPU" is 2, "Python" 3, "GPU" followed by two Chinese
// characters 4. Hyphens, apostrophes and marks count for nothing.
export function clueLength(text: string): number {
  let han = 0;
  let other = 0;
  for (const char of text.normalize('NFKC')) {
    if (HAN.test(char)) han += 1;
    else if (OTHER_LETTER.test(char)) other += 1;
  }
  return han + Math.ceil(other / 2);
}

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
  // Everything that tells the word from another: its parts, and also each letter that stands
  // alone and each run of digits, which no clue could repeat but which tell "t-test" from "Turing
  // test", "Series A" from "Time series" and "GPT-3" from "GPT-4". Only the small words are left
  // out. Where one word lies inside another is decided by these (liesInside()).
  pieces: string[];
  // Its Chinese characters, in their simplified forms, and the numbers in it (numbersIn()).
  han: Set<string>;
  numbers: Set<string>;
  // Its Latin parts of CHARACTER_WORD_LENGTH letters or more, which may be the English or the
  // pinyin of a character.
  latin: string[];
}

function wordOf(text: string): Word {
  const folded = fold(text);
  const parts = (folded.match(PART) ?? []).filter(
    (part) => HAN.test(part) || (part.length > 1 && !SMALL_WORDS.has(part)),
  );
  return {
    key: folded.replace(NOT_LETTER_OR_DIGIT, ''),
    parts,
    pieces: (folded.match(PIECE) ?? []).filter((piece) => piece.length === 1 || !SMALL_WORDS.has(piece)),
    han: new Set([...folded].filter((char) => HAN.test(char))),
    numbers: numbersIn(folded, parts),
    latin: parts.filter((part) => part.length >= CHARACTER_WORD_LENGTH && LATIN_ONLY.test(part)),
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

// A character in common: a Chinese character, or a number however it is written.
const sharesCharacter = (clue: Word, word: Word) =>
  [...clue.han].some((char) => word.han.has(char)) || [...clue.numbers].some((number) => word.numbers.has(number));

// A word of the clue is the English of a Chinese character of the card's word, as the dictionary
// gives it, or its plain plural, or the pinyin of one of its characters, without tones: "ball" or
// "qiu" for the character of a ball. Only the pinyin of whole syllables counts, and only words of
// CHARACTER_WORD_LENGTH letters or more.
function namesCharacter(clue: Word, glosses: readonly string[], syllables: ReadonlySet<string>): boolean {
  return clue.latin.some((part) => syllables.has(part) || glosses.some((gloss) => sameOrPlural(part, gloss)));
}

// The syllables of a card's pinyin, written with "u" and with "v" for the umlaut, as keyboards have
// it.
function syllablesOf(pinyin: string | undefined): Set<string> {
  if (pinyin === undefined) return new Set();
  const syllables = pinyin
    .split(' ')
    .flatMap((syllable) => [wordKey(syllable), wordKey(syllable.replace(/\u00fc/g, 'v'))]);
  return new Set(syllables.filter((syllable) => syllable.length >= CHARACTER_WORD_LENGTH && LATIN_ONLY.test(syllable)));
}

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
// clue counts as the clue would. `insideRefused` says whether the strict rule refuses a clue with
// the card's word inside it, as it does in a Chinese room.
interface Verdict {
  refused: ClueMatch | null;
  strict: ClueMatch | null;
  warned: ClueMatch | null;
}

function judge(clues: readonly Word[], card: ClueCard, index: number, insideRefused: boolean): Verdict {
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

  // The translation itself is refused like the word, and so is the pinyin of a Chinese word,
  // written solid, with spaces or with hyphens, and with "v" for the umlaut as keyboards have
  // it. A part or a form of the translation only brings a warning, because the room plays in the
  // other language.
  const pinyin = card.pinyin === undefined ? [] : [wordKey(card.pinyin), wordKey(card.pinyin.replace(/\u00fc/g, 'v'))];
  const refused =
    ofWord(repeats, 'same') ??
    ofTranslation((clue, other) => sameOrPlural(clue.key, other.key), 'same') ??
    (clues.some((clue) => pinyin.includes(clue.key))
      ? { card: index, text: card.pinyin as string, kind: 'same' as const }
      : null);
  if (refused) return { refused, strict: null, warned: null };

  // What the word library lists as a form of the term counts as the term under the strict rule:
  // the library knows. A clue repeats a form as it would repeat the word on the board: a form of
  // several words gives the term away word by word, and a room's clue length may never let it
  // through whole. The endings that the warnings go by are only a guess, so what they suggest
  // stays a warning; a clue that contains the word without being such a form, as "dockerfile"
  // contains "Docker", is refused under the strict rule where the room refuses that.
  const form = (card.forms ?? []).find((text) => {
    const other = wordOf(text);
    return other.key !== '' && clues.some((clue) => repeats(clue, other));
  });
  const similar = ofWord(resembles, 'similar');
  const glosses = (card.glosses ?? []).map((gloss) => gloss.toLowerCase());
  const syllables = syllablesOf(card.pinyin);
  const character =
    ofWord(sharesCharacter, 'character') ??
    (clues.some((clue) => namesCharacter(clue, glosses, syllables))
      ? { card: index, text: card.word, kind: 'character' as const }
      : null);
  const strict =
    form === undefined
      ? (character ?? (insideRefused && !similar ? ofWord(contains, 'inside') : null))
      : { card: index, text: form, kind: 'form' as const };
  const warned =
    similar ??
    ofTranslation((clue, other) => repeats(clue, other) || resembles(clue, other), 'similar') ??
    ofTranslation(sharesCharacter, 'character') ??
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
  // A Chinese room counts the clue's Chinese characters, and its letters and digits two to one
  // (clueLength()); an English room counts its words, each up to MAX_CLUE_LENGTH characters, and
  // takes a clue with Chinese characters in it of up to MAX_CLUE_HAN characters in all.
  const characters = words.flatMap((word) => [...word]);
  const han = characters.filter((char) => HAN.test(char)).length;
  const tooLong =
    words.some((word) => [...word].length > MAX_CLUE_LENGTH) ||
    (options.length === null ? han > 0 && characters.length > MAX_CLUE_HAN : clueLength(text) > options.length);
  if (tooLong) return verdict('clue_too_long');

  const whole = wordOf(text);
  const clues = words.length > 1 ? [whole, ...words.map(wordOf)] : [whole];
  // In a Chinese room the board is Chinese, so a Latin word on it, such as "Docker", stands out,
  // and the strict rule refuses a clue that contains one. In an English room every card is Latin,
  // and that rule would refuse "support" beside "Port", so the clue only gets a warning there.
  const insideRefused = options.length !== null;
  // A covered word may be said again.
  const verdicts = board.map((card, index) => (card.revealed ? null : judge(clues, card, index, insideRefused)));
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

// What keeping two cards off one board needs of a card, worked out once for each card: its word,
// with its pieces, the keys of its translations, and its forms.
interface Dealt {
  word: Word;
  translations: string[];
  forms: Word[];
}

const dealt = new WeakMap<object, Dealt>();

function dealtOf(card: BoardText): Dealt {
  let found = dealt.get(card);
  if (!found) {
    found = {
      word: wordOf(card.word),
      translations: (card.translations ?? []).map(wordKey).filter((key) => key !== ''),
      forms: (card.forms ?? []).map(wordOf).filter((form) => form.key !== ''),
    };
    dealt.set(card, found);
  }
  return found;
}

// The first word lies inside the second: it is the second or a plain plural of it, or each of
// its pieces is a piece of the second, the same or a plain plural, or, for a run of Chinese
// characters, lies inside one of the second's runs. The pieces are the parts that a clue could
// repeat and also the letters that stand alone and the digits (wordOf()): "Test" lies inside
// "t-test", but "t-test" doesn't lie inside "Turing test", and "R squared" in Chinese, "R" and the
// characters for "square", doesn't lie inside "square root".
function liesInside(inner: Word, outer: Word): boolean {
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

// The card's word gives the other card away: it lies inside the other's word or inside one of
// the other's forms, or it is the other's term in another language, or a plain plural of that.
const givesAway = (word: Dealt, card: Dealt): boolean =>
  liesInside(word.word, card.word) ||
  card.translations.some((key) => sameOrPlural(word.word.key, key)) ||
  card.forms.some((form) => liesInside(word.word, form));

// The words of a card, as the word library gives them: what cardsClash() compares.
export type BoardText = Pick<ClueCard, 'word' | 'translations' | 'forms'>;

// Whether two words must not share a board, because one of them lies inside the other: "Gene" and
// "Gene editing", the Chinese words for "fossil" and "living fossil", or "Unit" and "GPU" with the
// form "graphics processing unit". Hinting at one would hint at the other, and guessers couldn't
// tell which was meant. A word lies inside another when it is that word or a plain plural of it,
// when each of its pieces is a piece of that word or of one of its forms (liesInside()), or when
// it is that word's term in another language. The pieces are the parts that the strict clue rule
// counts, and also each letter that stands alone and each run of digits, so that "t-test" and
// "Turing test" or "GPT-3" and "GPT-4" can share a board. So can two words that only share a part,
// such as "Data science" and "Data cleaning", or a Chinese character, and two words whose forms
// share a part. What it works out about a card is kept with the card object, so pass the same
// objects again. scripts/check-words.mjs has a copy of this, which a test holds to it.
export function cardsClash(a: BoardText, b: BoardText): boolean {
  const first = dealtOf(a);
  const second = dealtOf(b);
  return givesAway(first, second) || givesAway(second, first);
}
