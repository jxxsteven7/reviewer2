import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGES, type Language } from '@reviewer2/shared';
import { shuffle, type Rng } from './random';

// The word library: one list per academic field, from the JSON files in words/ (see
// words/README.md). CI checks those files with scripts/check-words.mjs, so the server only makes
// sure of the shapes it relies on, and skips anything else.

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
  words: Record<Language, string[]>;
}

// Terms count as the same word whatever their case or width.
const sameWord = (text: string): string => text.normalize('NFKC').trim().toLowerCase();

export class WordLibrary {
  readonly #fields = new Map<string, Field>();

  constructor(lists: readonly WordListData[]) {
    for (const list of lists) {
      const words = Object.fromEntries(LANGUAGES.map((language) => [language, unique(list, language)])) as Record<
        Language,
        string[]
      >;
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

  // Every word of the chosen fields in one language, once each.
  pool(fieldIds: readonly string[], language: Language): string[] {
    const seen = new Set<string>();
    const pool: string[] = [];
    for (const id of fieldIds) {
      for (const word of this.#fields.get(id)?.words[language] ?? []) {
        const key = sameWord(word);
        if (seen.has(key)) continue;
        seen.add(key);
        pool.push(word);
      }
    }
    return pool;
  }
}

function unique(list: WordListData, language: Language): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const term of list.terms) {
    const word = term[language];
    if (!word || seen.has(sameWord(word))) continue;
    seen.add(sameWord(word));
    words.push(word);
  }
  return words;
}

// Draws `count` words from the pool, preferring words this room hasn't used yet. When too few
// unused words are left, it starts over with the whole pool. Returns null when even the whole
// pool is too small.
export function drawWords(
  pool: readonly string[],
  count: number,
  used: ReadonlySet<string>,
  rng: Rng,
): { words: string[]; used: Set<string> } | null {
  if (pool.length < count) return null;
  let fresh = pool.filter((word) => !used.has(sameWord(word)));
  let remembered = new Set(used);
  if (fresh.length < count) {
    fresh = [...pool];
    remembered = new Set();
  }
  const words = shuffle(fresh, rng).slice(0, count);
  for (const word of words) remembered.add(sameWord(word));
  return { words, used: remembered };
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

// Reads every words/*.json. A file or a term that isn't in the expected shape is skipped and
// reported through `skip`, so that one bad file can't stop the server.
export function loadWordLibrary(dir: string, skip: (file: string, reason: string) => void = () => {}): WordLibrary {
  const lists: WordListData[] = [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.json'));
  } catch (error) {
    skip(dir, (error as Error).message);
    return new WordLibrary([]);
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
    const name = list.name;
    lists.push({
      id: list.id,
      name: { zh: isText(name.zh) ? name.zh : list.id, en: isText(name.en) ? name.en : list.id },
      terms: list.terms.flatMap((term) =>
        term && isText(term.id)
          ? [{ id: term.id, ...(isText(term.zh) ? { zh: term.zh } : {}), ...(isText(term.en) ? { en: term.en } : {}) }]
          : [],
      ),
    });
  }
  return new WordLibrary(lists);
}
