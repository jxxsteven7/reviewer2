import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGES, wordKey, type BoardWord, type FieldInfo, type Language } from '@reviewer2/shared';
import { shuffle, type Rng } from './random';

// The word library: one list per academic field, from the JSON files in words/ (see
// words/README.md). CI checks those files with scripts/check-words.mjs, so the server only makes
// sure of the shapes it relies on, skips anything else and says what it skipped.

export interface WordListData {
  id: string;
  name: Record<Language, string>;
  terms: { id: string; zh?: string; en?: string; forms?: Partial<Record<Language, string[]>> }[];
}

interface Field {
  info: FieldInfo;
  // The words in each language, once each, with the same terms in the other languages.
  words: Record<Language, Entry[]>;
}

// A word as the library keeps it: with its `wordKey`, which is worked out once, when the library
// is built, and not again for every pool and every draw.
interface Entry {
  key: string;
  word: string;
  translations: string[];
  // The other forms of the term that the list gives, in all its languages at once.
  forms: string[];
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
    return [...pool.values()].map(({ key, word, translations, forms }) => {
      const boardWord: BoardWord = {
        word,
        ...(translations.length ? { translations } : {}),
        ...(forms.length ? { forms } : {}),
      };
      keys.set(boardWord, key);
      return boardWord;
    });
  }
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
function collect(words: Collected, { key, word, translations, forms }: Entry): void {
  const entry = words.get(key) ?? { key, word, translations: [], forms: [] };
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
function unique(list: WordListData, skip: Skip): Record<Language, Entry[]> {
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
      collect(words[language], { key, word, translations, forms });
    }
  }
  return Object.fromEntries(LANGUAGES.map((language) => [language, [...words[language].values()]])) as Record<
    Language,
    Entry[]
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
  const isUsed = (word: BoardWord) => used.has(keyOf(word));
  const fresh = pool.filter((word) => !isUsed(word));
  if (fresh.length >= count) {
    const words = shuffle(fresh, rng).slice(0, count);
    return { words, used: new Set([...used, ...words.map(keyOf)]) };
  }
  const again = shuffle(pool.filter(isUsed), rng).slice(0, count - fresh.length);
  // Shuffled once more, so that the order doesn't tell the new words from the repeated ones.
  const words = shuffle([...fresh, ...again], rng);
  return { words, used: new Set(words.map(keyOf)) };
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
        readTerm(term, index, (reason, which) => skip(file, reason, which)),
      ),
    });
  }
  return new WordLibrary(lists, skip);
}

// One term as it comes out of a file: the term with the texts that the library can use, or
// nothing. Whatever it leaves out, it reports with the term's id, or with the term's place in the
// list when it has no id.
function readTerm(value: unknown, index: number, skip: (reason: string, term: string) => void): WordListData['terms'] {
  const term = value as Partial<Record<'id' | 'forms' | Language, unknown>> | null;
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
  return [{ id, ...texts, ...(forms ? { forms } : {}) }];
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
