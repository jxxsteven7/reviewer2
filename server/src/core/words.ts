import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGES, wordKey, type BoardWord, type Language } from '@reviewer2/shared';
import { shuffle, type Rng } from './random';

// The word library: one list per academic field, from the JSON files in words/ (see
// words/README.md). CI checks those files with scripts/check-words.mjs, so the server only makes
// sure of the shapes it relies on, skips anything else and says what it skipped.

export interface WordListData {
  id: string;
  name: Record<Language, string>;
  terms: { id: string; zh?: string; en?: string }[];
}

// What players see of a field when they set up a room.
export interface FieldInfo {
  id: string;
  name: Record<Language, string>;
  counts: Record<Language, number>;
}

interface Field {
  info: FieldInfo;
  // The words in each language, once each, with the same terms in the other languages.
  words: Record<Language, BoardWord[]>;
}

// Hears of everything that the library leaves out, so that the server can log it: a file, or one
// term of a file when `term` names it. A list's file is `<id>.json`, as in words/.
export type Skip = (file: string, reason: string, term?: string) => void;

export class WordLibrary {
  readonly #fields = new Map<string, Field>();

  constructor(lists: readonly WordListData[], skip: Skip = () => {}) {
    for (const list of lists) {
      // Rooms name their fields by id, so a second list with the same id would replace the first.
      if (this.#fields.has(list.id)) throw new Error(`two word lists have the id "${list.id}"`);
      const words = unique(list, skip);
      const counts = Object.fromEntries(LANGUAGES.map((language) => [language, words[language].length])) as Record<
        Language,
        number
      >;
      this.#fields.set(list.id, { info: { id: list.id, name: { ...list.name }, counts }, words });
    }
  }

  // The fields, in a stable order, with how many words each has in each language.
  fields(): FieldInfo[] {
    return [...this.#fields.values()]
      .map(({ info }) => ({ ...info, name: { ...info.name }, counts: { ...info.counts } }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  has(id: string): boolean {
    return this.#fields.has(id);
  }

  // Every word of the chosen fields in one language, once each, with the same term in the other
  // languages. The game refuses those translations as clues. A word that two fields share brings
  // the translations of both.
  pool(fieldIds: readonly string[], language: Language): BoardWord[] {
    const pool: Collected = new Map();
    for (const id of fieldIds) {
      for (const { word, translations = [] } of this.#fields.get(id)?.words[language] ?? []) {
        collect(pool, wordKey(word), word, translations);
      }
    }
    return boardWords(pool);
  }
}

// Words on their way into a field or a pool, each under its `wordKey`.
type Collected = Map<string, { word: string; translations: string[] }>;

// Adds a word to those collected so far. A word that is there already keeps its spelling and
// gains the translations that it doesn't have yet.
function collect(words: Collected, key: string, word: string, translations: readonly string[]): void {
  const entry = words.get(key) ?? { word, translations: [] };
  words.set(key, entry);
  for (const translation of translations) {
    if (!entry.translations.includes(translation)) entry.translations.push(translation);
  }
}

const boardWords = (words: Collected): BoardWord[] =>
  [...words.values()].map(({ word, translations }) => (translations.length ? { word, translations } : { word }));

// The terms of a list in each language, once each. Terms are the same word when their letters and
// digits are, as the game compares them (`wordKey`), so "Co-author" and "coauthor" are one word.
// It is spelled as its first term spells it and brings the translations of them all, because a
// clue must not repeat any of them.
//
// CI refuses a list in which a term has no letters or digits, or is the same word as another, so
// either means that the list wasn't checked. `skip` hears of both.
function unique(list: WordListData, skip: Skip): Record<Language, BoardWord[]> {
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
    for (const { language, word, key } of texts) {
      const same = words[language].get(key);
      if (same) skip(file, `"${language}" ${quote(word)} is the same word as ${quote(same.word)}`, term.id);
      const translations = texts.filter((other) => other.language !== language).map((other) => other.word);
      collect(words[language], key, word, translations);
    }
  }
  return Object.fromEntries(LANGUAGES.map((language) => [language, boardWords(words[language])])) as Record<
    Language,
    BoardWord[]
  >;
}

// Draws `count` words from the pool, preferring words this room hasn't used yet. `used` holds the
// `wordKey` of every word drawn so far. When fewer than `count` unused words are left, all of
// them are drawn and the rest come from the used ones; the room then starts over, remembering
// only the words of this draw. Returns null when even the whole pool is too small.
export function drawWords(
  pool: readonly BoardWord[],
  count: number,
  used: ReadonlySet<string>,
  rng: Rng,
): { words: BoardWord[]; used: Set<string> } | null {
  if (pool.length < count) return null;
  const keys = (words: readonly BoardWord[]) => words.map(({ word }) => wordKey(word));
  const isUsed = ({ word }: BoardWord) => used.has(wordKey(word));
  const fresh = pool.filter((word) => !isUsed(word));
  if (fresh.length >= count) {
    const words = shuffle(fresh, rng).slice(0, count);
    return { words, used: new Set([...used, ...keys(words)]) };
  }
  const again = shuffle(pool.filter(isUsed), rng).slice(0, count - fresh.length);
  // Shuffled once more, so that the order doesn't tell the new words from the repeated ones.
  const words = shuffle([...fresh, ...again], rng);
  return { words, used: new Set(keys(words)) };
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

// Reads every words/*.json. The directory must be there: without it the server would run with no
// words at all, which is a mistake in how it was set up, so this throws, as a bad PORT does. A
// file or a term that isn't in the expected shape is skipped and reported through `skip`, so that
// one bad file can't stop the server.
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
        readTerm(term, index, (reason, name) => skip(file, reason, name)),
      ),
    });
  }
  return new WordLibrary(lists, skip);
}

// One term as it comes out of a file: the term with the texts that the library can use, or
// nothing. Whatever it leaves out, it reports with the term's id, or with the term's place in the
// list when it has no id.
function readTerm(value: unknown, index: number, skip: (reason: string, term: string) => void): WordListData['terms'] {
  const term = value as Partial<Record<'id' | Language, unknown>> | null;
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
  return Object.keys(texts).length > 0 ? [{ id: term.id, ...texts }] : [];
}
