import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hasHan,
  LANGUAGES,
  toSimplified,
  wordKey,
  type BoardWord,
  type FieldInfo,
  type Language,
} from '@reviewer2/shared';
import { pinyinOf } from './pinyin';
import { shuffle, type Rng } from './random';

// The word library: one list per academic field, from the JSON files in words/ (see
// words/README.md). CI checks those files with scripts/check-words.mjs, so the server only makes
// sure of the shapes it relies on, skips anything else and says what it skipped. Beside the lists,
// words/dictionary/han-glosses.json gives the English meanings of the Chinese characters that the
// lists use (scripts/build-han-glosses.mjs), for the clue check (BoardWord.glosses).

// The English meanings of each Chinese character, by the character.
export type Glosses = ReadonlyMap<string, readonly string[]>;

// Where the meanings are, under the directory of the lists.
export const GLOSSES_FILE = join('dictionary', 'han-glosses.json');

export interface WordListData {
  id: string;
  name: Record<Language, string>;
  terms: {
    id: string;
    zh?: string;
    en?: string;
    forms?: Partial<Record<Language, string[]>>;
    related?: string[];
  }[];
}

interface Field {
  info: FieldInfo;
  // The words in each language, once each, with the same terms in the other languages.
  words: Record<Language, Entry[]>;
  // The pairs of related terms (words/README.md#related-terms), each as its two terms in each
  // language, in the order of the list.
  pairs: { key: string; words: Record<Language, [BoardWord, BoardWord]> }[];
}

// A pair of related terms of a field, as a game with pairs draws it (GameModule.words): its key,
// which the records know it by (pairKey), and its two words in the room's language, in the order of
// the list, each with its term (BoardWord.term) and, like the words of a pool, its terms in the
// other languages, its forms and its pinyin.
export interface WordPair {
  key: string;
  words: [BoardWord, BoardWord];
}

// The key of a pair: its field and the IDs of its two terms, in the order of the list. The IDs of
// a list never change once merged (words/README.md), so a key stays the same from one version of
// the library to the next.
export const pairKey = (field: string, first: string, second: string): string => `${field}:${first}+${second}`;

// A word as the library keeps it: with its `wordKey` and, for a Chinese word, its pinyin, both
// worked out once, when the library is built, and not again for every pool and every draw.
interface Entry {
  key: string;
  word: string;
  translations: string[];
  // The other forms of the term that the list gives, in all its languages at once.
  forms: string[];
  pinyin: string | null;
  // The English meanings of the characters of a Chinese word.
  glosses: string[];
}

// Hears of everything that the library leaves out, so that the server can log it: a file, or one
// term of a file when `term` names it. A list's file is `<id>.json`, as in words/.
export type Skip = (file: string, reason: string, term?: string) => void;

export class WordLibrary {
  readonly #fields = new Map<string, Field>();
  // What the lists held, as the first 16 hex digits of the SHA-256 of their data, in the order they
  // were read: the record of every game keeps it (docs/architecture.md#game-records), so that the
  // games played with other word lists can be told apart.
  readonly hash: string;
  readonly #glosses: Glosses;

  constructor(lists: readonly WordListData[], skip: Skip = () => {}, glosses: Glosses = new Map()) {
    this.hash = createHash('sha256').update(JSON.stringify(lists)).digest('hex').slice(0, 16);
    this.#glosses = glosses;
    for (const list of lists) {
      // Rooms name their fields by id, so a second list with the same id would replace the first.
      if (this.#fields.has(list.id)) throw new Error(`two word lists have the id "${list.id}"`);
      const words = unique(list, skip, (word) => this.glossesOf(word));
      const counts = Object.fromEntries(LANGUAGES.map((language) => [language, words[language].length])) as Record<
        Language,
        number
      >;
      const pairs = pairsOf(list, skip, (word) => this.glossesOf(word));
      this.#fields.set(list.id, {
        info: { id: list.id, name: { ...list.name }, counts, pairs: pairs.length },
        words,
        pairs,
      });
    }
  }

  // The fields, in a stable order, with how many words each has in each language. The ids are
  // compared as plain strings, and no two are the same. localeCompare() would order them by the
  // locale of the machine: a Czech one puts "chemistry" after "hci".
  fields(): FieldInfo[] {
    return [...this.#fields.values()]
      .map(({ info }) => ({ ...info, name: { ...info.name }, counts: { ...info.counts } }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  has(id: string): boolean {
    return this.#fields.has(id);
  }

  // How many characters the library knows the English meanings of.
  get glossed(): number {
    return this.#glosses.size;
  }

  // The English meanings of the Chinese characters of a word, each once, in the order of the
  // characters: for the cards of the lists, and for the chair's own words. The dictionary has the
  // simplified characters, so a word in traditional ones is read as the clue check reads it.
  glossesOf(word: string): string[] {
    if (!hasHan(word)) return [];
    const found = new Set<string>();
    for (const char of toSimplified(word)) for (const gloss of this.#glosses.get(char) ?? []) found.add(gloss);
    return [...found];
  }

  // Every word of the chosen fields in one language, once each, with the same term in the other
  // languages and the other forms of the term. The game holds a clue against both. A word that two
  // fields share brings the translations and the forms of both.
  //
  // Throws for a field that the library doesn't have, rather than hand back a smaller pool that
  // nothing explains: check what a player chose with has() first.
  pool(fieldIds: readonly string[], language: Language): BoardWord[] {
    const pool: Collected = new Map();
    for (const id of fieldIds) {
      const field = this.#fields.get(id);
      if (!field) throw new Error(`no word list has the id "${id}"`);
      for (const entry of field.words[language]) collect(pool, entry);
    }
    return [...pool.values()].map(({ key, word, translations, forms, pinyin, glosses }) => {
      const boardWord: BoardWord = {
        word,
        ...(translations.length ? { translations } : {}),
        ...(forms.length ? { forms } : {}),
        ...(pinyin === null ? {} : { pinyin }),
        ...(glosses.length ? { glosses } : {}),
      };
      keys.set(boardWord, key);
      return boardWord;
    });
  }

  // Every pair of related terms of the chosen fields, in one language. Throws for a field that the
  // library doesn't have, as pool() does.
  pairs(fieldIds: readonly string[], language: Language): WordPair[] {
    return fieldIds.flatMap((id) => {
      const field = this.#fields.get(id);
      if (!field) throw new Error(`no word list has the id "${id}"`);
      return field.pairs.map(({ key, words }) => ({ key, words: words[language] }));
    });
  }
}

// The pairs of related terms of a list: each id in a term's `related` that names a later term of
// the list with words in every language, as scripts/check-words.mjs makes sure each does; a pair
// that isn't one is skipped and reported. Each word comes with its translation, the forms of the
// term in every language, and, for a Chinese one, its pinyin and the English meanings of its
// characters, as a word of a pool does.
function pairsOf(
  list: WordListData,
  skip: Skip,
  glossesOf: (word: string) => string[],
): { key: string; words: Record<Language, [BoardWord, BoardWord]> }[] {
  const file = `${list.id}.json`;
  const index = new Map(list.terms.map((term, at) => [term.id, at]));
  const wordsOf = (term: WordListData['terms'][number]): Record<Language, BoardWord> | null => {
    if (!LANGUAGES.every((language) => term[language] !== undefined && wordKey(term[language] ?? '') !== '')) {
      return null;
    }
    const forms = LANGUAGES.flatMap((language) => term.forms?.[language] ?? []).filter((form) => wordKey(form));
    return Object.fromEntries(
      LANGUAGES.map((language) => {
        const word = term[language] as string;
        const translations = LANGUAGES.filter((other) => other !== language).map((other) => term[other] as string);
        const pinyin = pinyinOf(word);
        const glosses = glossesOf(word);
        const boardWord: BoardWord = {
          word,
          translations,
          ...(forms.length ? { forms } : {}),
          ...(pinyin === null ? {} : { pinyin }),
          ...(glosses.length ? { glosses } : {}),
          term: { id: term.id, field: list.id },
        };
        return [language, boardWord];
      }),
    ) as Record<Language, BoardWord>;
  };
  const pairs: { key: string; words: Record<Language, [BoardWord, BoardWord]> }[] = [];
  const keys = new Set<string>();
  list.terms.forEach((term, at) => {
    for (const other of term.related ?? []) {
      const later = index.get(other);
      const second = later === undefined ? undefined : list.terms[later];
      const first = wordsOf(term);
      const next = second && wordsOf(second);
      if (later === undefined || later <= at || !first || !next) {
        skip(
          file,
          `"related" names ${JSON.stringify(other)}, which is no later term with words in every language`,
          term.id,
        );
        continue;
      }
      const key = pairKey(list.id, term.id, other);
      if (keys.has(key)) continue;
      keys.add(key);
      pairs.push({
        key,
        words: Object.fromEntries(LANGUAGES.map((language) => [language, [first[language], next[language]]])) as Record<
          Language,
          [BoardWord, BoardWord]
        >,
      });
    }
  });
  return pairs;
}

// What the records say of a pair (WordPair.key), for a room about to draw one: how many times the
// players with accounts who are in the room have had it, all of them together, whether two or more
// of them had it in one game together, and how many players have rated a game with it as good and
// as having a problem (docs/architecture.md#ratings).
export interface PairRecord {
  seen: number;
  together: boolean;
  good: number;
  problems: number;
}

// How many players rate a pair as having a problem before the draws leave it out.
export const PAIR_PROBLEMS = 2;

// Draws a pair for a game (docs/games/impostor.md#the-words), from those of the fields that fewer
// than PAIR_PROBLEMS players found a problem with. It prefers, in turn, a pair that the room hasn't
// played (`used`, by key) and that no two of its players have had in one game together; then one
// the room hasn't played; then any. Of those, it takes one that the players have had the fewest
// times, more likely the more players rated it good. Null when the fields have no pair to draw.
export function drawPair(
  pairs: readonly WordPair[],
  records: ReadonlyMap<string, PairRecord>,
  used: ReadonlySet<string>,
  rng: Rng,
): WordPair | null {
  const record = (pair: WordPair): PairRecord =>
    records.get(pair.key) ?? { seen: 0, together: false, good: 0, problems: 0 };
  const usable = pairs.filter((pair) => record(pair).problems < PAIR_PROBLEMS);
  const fresh = usable.filter((pair) => !used.has(pair.key));
  const tier = [fresh.filter((pair) => !record(pair).together), fresh, usable].find((some) => some.length > 0);
  if (!tier) return null;
  const fewest = Math.min(...tier.map((pair) => record(pair).seen));
  const least = tier.filter((pair) => record(pair).seen === fewest);
  const weights = least.map((pair) => 1 + record(pair).good);
  let at = rng.int(weights.reduce((sum, weight) => sum + weight, 0));
  for (const [index, weight] of weights.entries()) {
    if (at < weight) return least[index] as WordPair;
    at -= weight;
  }
  return least[least.length - 1] as WordPair;
}

// The key of each word that a pool holds. It is kept beside the word and not in it, because the
// word goes on to the game as it is. A word that didn't come out of a pool has its key worked out.
const keys = new WeakMap<BoardWord, string>();
const keyOf = (word: BoardWord): string => keys.get(word) ?? wordKey(word.word);

// Words on their way into a field or a pool, each under its key.
type Collected = Map<string, Entry>;

// Adds a word to those collected so far. A word that is there already keeps its spelling and
// gains the translations and the forms that it doesn't have yet. Two forms are the same when their
// `wordKey` is.
function collect(words: Collected, { key, word, translations, forms, pinyin, glosses }: Entry): void {
  const entry = words.get(key) ?? { key, word, translations: [], forms: [], pinyin, glosses };
  words.set(key, entry);
  for (const translation of translations) {
    if (!entry.translations.includes(translation)) entry.translations.push(translation);
  }
  const known = new Set(entry.forms.map(wordKey));
  for (const form of forms) {
    const formKey = wordKey(form);
    if (known.has(formKey)) continue;
    known.add(formKey);
    entry.forms.push(form);
  }
}

// The terms of a list in each language, once each. Terms are the same word when their letters and
// digits are, as the game compares them (`wordKey`), so "Co-author" and "coauthor" are one word.
// It is spelled as its first term spells it and brings the translations of them all, because a
// clue must not repeat any of them.
//
// CI refuses a list in which a term has no letters or digits, or is the same word as another, so
// either means that the list wasn't checked. `skip` hears of both.
function unique(list: WordListData, skip: Skip, glossesOf: (word: string) => string[]): Record<Language, Entry[]> {
  const file = `${list.id}.json`;
  const quote = (text: string) => JSON.stringify(text);
  const words = Object.fromEntries(LANGUAGES.map((language) => [language, new Map()])) as Record<Language, Collected>;
  for (const term of list.terms) {
    // The term in each language in which it is a word. Without a letter or a digit it has no key,
    // so nothing could tell it from another word: it is no card and no translation.
    const texts = LANGUAGES.flatMap((language) => {
      const word = term[language];
      if (!word) return [];
      const key = wordKey(word);
      if (key) return [{ language, word, key }];
      skip(file, `"${language}" ${quote(word)} has no letters or digits`, term.id);
      return [];
    });
    // The forms of both languages go with the term in each: a clue in either language may be one.
    // A form without a letter or a digit could never match a clue.
    const forms = LANGUAGES.flatMap((language) =>
      (term.forms?.[language] ?? []).filter((form) => {
        if (wordKey(form)) return true;
        skip(file, `the "${language}" form ${quote(form)} has no letters or digits`, term.id);
        return false;
      }),
    );
    for (const { language, word, key } of texts) {
      const same = words[language].get(key);
      if (same) skip(file, `"${language}" ${quote(word)} is the same word as ${quote(same.word)}`, term.id);
      const translations = texts.filter((other) => other.language !== language).map((other) => other.word);
      collect(words[language], { key, word, translations, forms, pinyin: pinyinOf(word), glosses: glossesOf(word) });
    }
  }
  return Object.fromEntries(LANGUAGES.map((language) => [language, [...words[language].values()]])) as Record<
    Language,
    Entry[]
  >;
}

// Whether two words must not share a game, as a game module says (GameModule.words).
export type Clash = (a: BoardWord, b: BoardWord) => boolean;

// How many words the fallback of drawWords() looks at, at most: it compares every two of them, and
// 500 words make 124,750 pairs, which take a small fraction of a second.
export const FALLBACK_WORDS = 500;

// Draws `count` words from the pool, preferring words this room hasn't used yet. `used` holds the
// `wordKey` of every word drawn since the room last started over, in the order of their last
// draw, so that its last `count` keys are the words of the last game. When fewer than `count`
// unused words are left, all of them that fit are drawn, and the rest come from the used ones, at
// random, but from the last game only when no other used word is left; the room then starts over,
// remembering only the words of this draw. Returns null when even the whole pool is too small.
//
// With `clash`, the draw keeps apart the words that clash, as far as it can. The words are taken
// in a random order, unused ones first, and each is kept unless it clashes with one kept already.
// That is one pass over the pool, so it always ends. A word that clashes with none is always
// kept, so the pass fills the draw whenever the pool has `count` such words; in every list of the
// library, at least two thirds of the words clash with none. A word that clashes with at most d
// others keeps at most d of them out, so the pass also fills the draw whenever the pool has at
// least `count` * (d + 1) words, which the whole library does. Should the pass still come out
// short, the draw is made again word by word from the first FALLBACK_WORDS words of that order,
// each time with the word that clashes least with those taken (fewestClashes()). Then a few
// clashes may remain, and `clashes` says how many pairs of the words drawn clash; it is 0
// otherwise. When clashes leave out some unused words, the draw takes used ones in their place.
// While `count` or more unused words were left, the words left out stay unused and come first
// next time; otherwise the room starts over as usual, and they are unused again like the rest.
export function drawWords(
  pool: readonly BoardWord[],
  count: number,
  used: ReadonlySet<string>,
  rng: Rng,
  clash?: Clash,
): { words: BoardWord[]; used: Set<string>; clashes: number } | null {
  if (pool.length < count) return null;
  const isUsed = (word: BoardWord) => used.has(keyOf(word));
  // The words of the last game, which `used` holds last: they come after every other used word.
  const recent = new Set([...used].slice(-count));
  const isRecent = (word: BoardWord) => recent.has(keyOf(word));
  const fresh = pool.filter((word) => !isUsed(word));
  const older = pool.filter((word) => isUsed(word) && !isRecent(word));
  const order = [...shuffle(fresh, rng), ...shuffle(older, rng), ...shuffle(pool.filter(isRecent), rng)];
  let picked: BoardWord[] = [];
  let clashes = 0;
  if (!clash) {
    picked = order.slice(0, count);
  } else {
    for (const word of order) {
      if (picked.length === count) break;
      if (!picked.some((other) => clash(word, other))) picked.push(word);
    }
    if (picked.length < count) {
      ({ words: picked, clashes } = fewestClashes(order.slice(0, Math.max(count, FALLBACK_WORDS)), count, clash));
    }
  }
  // Shuffled once more, so that the order doesn't tell the new words from the repeated ones.
  const words = shuffle(picked, rng);
  const keys = new Set(words.map(keyOf));
  // Fewer unused words than the draw needs were left: the room starts over. It doesn't when the
  // draw took used words only because clashes left unused ones out, which then come first next
  // time; the room would otherwise play board after board of mostly used words when the last
  // unused ones clash with each other.
  const startOver = fresh.length < count;
  const before = startOver ? [] : [...used].filter((key) => !keys.has(key));
  return { words, used: new Set([...before, ...keys]), clashes };
}

// Draws `count` of the words, one at a time: each time the word that clashes with the fewest
// words drawn so far, then the one that clashes with the fewest of the words that are still open,
// which clash with none drawn, so that it shuts out the fewest of them, and then the one that
// comes first. It compares every two words once, so it is given only a limited number of them.
function fewestClashes(
  words: readonly BoardWord[],
  count: number,
  clash: Clash,
): { words: BoardWord[]; clashes: number } {
  const clashing: number[][] = words.map(() => []);
  for (let i = 0; i < words.length; i += 1) {
    for (let j = i + 1; j < words.length; j += 1) {
      if (clash(words[i] as BoardWord, words[j] as BoardWord)) {
        clashing[i]?.push(j);
        clashing[j]?.push(i);
      }
    }
  }
  // For each word: whether it is drawn, how many of the words drawn it clashes with, and how many
  // open words it clashes with, which are the words not drawn that clash with none drawn.
  const drawn: boolean[] = words.map(() => false);
  const withDrawn: number[] = words.map(() => 0);
  const withOpen: number[] = clashing.map((others) => others.length);
  const close = (index: number) => {
    for (const other of clashing[index] ?? []) withOpen[other] = (withOpen[other] ?? 0) - 1;
  };
  const compare = (a: number, b: number) =>
    (withDrawn[a] ?? 0) - (withDrawn[b] ?? 0) || (withOpen[a] ?? 0) - (withOpen[b] ?? 0);
  const picked: BoardWord[] = [];
  let clashes = 0;
  while (picked.length < count) {
    let best = -1;
    for (let index = 0; index < words.length; index += 1) {
      if (!drawn[index] && (best < 0 || compare(index, best) < 0)) best = index;
    }
    clashes += withDrawn[best] ?? 0;
    if (withDrawn[best] === 0) close(best);
    drawn[best] = true;
    picked.push(words[best] as BoardWord);
    for (const other of clashing[best] ?? []) {
      if (drawn[other]) continue;
      if (withDrawn[other] === 0) close(other);
      withDrawn[other] = (withDrawn[other] ?? 0) + 1;
    }
  }
  return { words: picked, clashes };
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

// Reads every words/*.json. The directory must be there and hold at least one word list that can
// be read, with at least one term in it that can: without one the server would run with no words
// at all, which is a mistake in how it was set up, so this throws, as a bad PORT does. A file or
// a term that isn't in the expected shape is skipped and reported through `skip`, so that one bad
// file can't stop the server.
export function loadWordLibrary(dir: string, skip: Skip = () => {}): WordLibrary {
  const lists: WordListData[] = [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.json'));
  } catch (error) {
    // The system's message names the directory.
    throw new Error(`cannot read the word lists: ${(error as Error).message}`, { cause: error });
  }
  for (const file of files.sort()) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (error) {
      skip(file, (error as Error).message);
      continue;
    }
    const list = data as Partial<WordListData> | null;
    if (!list || !isText(list.id) || !list.name || !Array.isArray(list.terms)) {
      skip(file, 'not a word list');
      continue;
    }
    // The id is the file name, so no two files can give the same field.
    if (`${list.id}.json` !== file) {
      skip(file, `its "id" is "${list.id}", which is not the file name without .json`);
      continue;
    }
    const name = list.name;
    lists.push({
      id: list.id,
      name: { zh: isText(name.zh) ? name.zh : list.id, en: isText(name.en) ? name.en : list.id },
      terms: list.terms.flatMap((term: unknown, index) =>
        readTerm(term, index, (reason, which) => skip(file, reason, which)),
      ),
    });
  }
  if (lists.length === 0) throw new Error(`there are no word lists in ${dir}`);
  if (lists.every((list) => list.terms.length === 0)) throw new Error(`there are no words in the word lists in ${dir}`);
  return new WordLibrary(lists, skip, loadGlosses(dir, skip));
}

// Reads the English meanings of the characters, if the directory has them: without them, the
// library has none, and the clue check takes no English word for a character. A file that can't be
// read, or a character with meanings that aren't a list of text, is skipped and reported.
function loadGlosses(dir: string, skip: Skip): Glosses {
  const glosses = new Map<string, string[]>();
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(join(dir, GLOSSES_FILE), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') skip(GLOSSES_FILE, (error as Error).message);
    return glosses;
  }
  const found = (data as { glosses?: unknown } | null)?.glosses;
  if (!found || typeof found !== 'object' || Array.isArray(found)) {
    skip(GLOSSES_FILE, 'not a dictionary of meanings');
    return glosses;
  }
  for (const [char, words] of Object.entries(found)) {
    if (Array.isArray(words) && words.every(isText))
      glosses.set(
        char,
        words.map((word: string) => word.toLowerCase()),
      );
    else skip(GLOSSES_FILE, 'meanings that are not a list of text', char);
  }
  return glosses;
}

// One term as it comes out of a file: the term with the texts that the library can use, or
// nothing. Whatever it leaves out, it reports with the term's id, or with the term's place in the
// list when it has no id.
function readTerm(value: unknown, index: number, skip: (reason: string, term: string) => void): WordListData['terms'] {
  const term = value as Partial<Record<'id' | 'forms' | 'related' | Language, unknown>> | null;
  if (!term || typeof term !== 'object' || !isText(term.id)) {
    skip('not a term with an "id"', `terms[${index}]`);
    return [];
  }
  const texts: Partial<Record<Language, string>> = {};
  const given = LANGUAGES.filter((language) => term[language] !== undefined);
  for (const language of given) {
    const text = term[language];
    if (isText(text)) texts[language] = text;
    else skip(`"${language}" is not text`, term.id);
  }
  if (given.length === 0) skip('has neither "zh" nor "en"', term.id);
  if (Object.keys(texts).length === 0) return [];
  const { id } = term;
  const forms = term.forms === undefined ? undefined : readForms(term.forms, (reason) => skip(reason, id));
  const related = term.related === undefined ? undefined : readRelated(term.related, (reason) => skip(reason, id));
  return [{ id, ...texts, ...(forms ? { forms } : {}), ...(related ? { related } : {}) }];
}

// The forms of a term, `{ "zh": [...], "en": [...] }`, with what isn't text left out and
// reported. A term whose forms aren't in that shape at all keeps its words, without forms.
function readForms(value: unknown, skip: (reason: string) => void): Partial<Record<Language, string[]>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    skip('"forms" is not an object');
    return undefined;
  }
  const forms: Partial<Record<Language, string[]>> = {};
  for (const language of LANGUAGES) {
    const list = (value as Partial<Record<Language, unknown>>)[language];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      skip(`"forms.${language}" is not a list`);
      continue;
    }
    forms[language] = list.filter((form: unknown, index) => {
      if (isText(form)) return true;
      skip(`"forms.${language}[${index}]" is not text`);
      return false;
    });
  }
  return forms;
}

// The IDs of the related terms of a term, with what isn't text left out and reported.
function readRelated(value: unknown, skip: (reason: string) => void): string[] | undefined {
  if (!Array.isArray(value)) {
    skip('"related" is not a list');
    return undefined;
  }
  return value.filter((id: unknown, index) => {
    if (isText(id)) return true;
    skip(`"related[${index}]" is not text`);
    return false;
  });
}
