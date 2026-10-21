import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LANGUAGES, wordKey, type BoardWord, type Language } from '@reviewer2/shared';
import { BOARD_SIZE, cardsClash } from '@reviewer2/shared/keywords';
import { afterAll, describe, expect, test } from 'vitest';
import { seededRng } from './random';
import {
  drawWords,
  FALLBACK_WORDS,
  GLOSSES_FILE,
  loadWordLibrary,
  WordLibrary,
  type Clash,
  type WordListData,
} from './words';

// Chinese test words are written as \u escapes (docs/rules/language.md).
const zh = (i: number) => `\u8bcd${i}`;
// A Chinese word of a pool comes with its pinyin, as the library works it out.
const py = (i: number) => `ci ${i}`;
const REVIEWER = '\u5ba1\u7a3f\u4eba';
const REVIEWER_TRADITIONAL = '\u5be9\u7a3f\u4eba';

const list = (id: string, count: number, from = 0): WordListData => ({
  id,
  name: { zh: `\u9886\u57df ${id}`, en: `Field ${id}` },
  terms: Array.from({ length: count }, (_, i) => ({ id: `t${from + i}`, zh: zh(from + i), en: `Term ${from + i}` })),
});

describe('the word library', () => {
  test('counts the words of each field in each language', () => {
    const library = new WordLibrary([
      list('ml', 30),
      { id: 'en-only', name: { zh: 'E', en: 'E' }, terms: [{ id: 'a', en: 'Alpha' }] },
    ]);
    expect(library.fields()).toEqual([
      { id: 'en-only', name: { zh: 'E', en: 'E' }, counts: { zh: 0, en: 1 } },
      { id: 'ml', name: { zh: '\u9886\u57df ml', en: 'Field ml' }, counts: { zh: 30, en: 30 } },
    ]);
    expect(library.has('ml')).toBe(true);
    expect(library.has('nope')).toBe(false);
  });

  test('lists the fields in the order of their ids as plain strings', () => {
    // A Czech locale sorts "ch" after "h", and a Danish one "aa" after "z".
    const ids = ['hci', 'ml-ops', 'cs', 'z', 'ml', 'chemistry', 'ab', 'mlops', 'aa', 'ml2'];
    const library = new WordLibrary(ids.map((id) => list(id, 1)));
    expect(library.fields().map((field) => field.id)).toEqual([
      'aa',
      'ab',
      'chemistry',
      'cs',
      'hci',
      'ml',
      'ml-ops',
      'ml2',
      'mlops',
      'z',
    ]);
  });

  test('refuses two lists with the same id', () => {
    const lists = [list('ml', 3), list('nlp', 3), list('ml', 5)];
    expect(() => new WordLibrary(lists)).toThrow('two word lists have the id "ml"');
  });

  test('pools the words of several fields once each, with their terms in the other language', () => {
    const library = new WordLibrary([
      list('a', 3),
      {
        id: 'b',
        name: { zh: 'B', en: 'B' },
        terms: [
          { id: 'x', en: 'TERM 1' },
          { id: 'y', en: 'Other' },
        ],
      },
    ]);
    expect(library.pool(['a', 'b'], 'en')).toEqual([
      { word: 'Term 0', translations: [zh(0)] },
      { word: 'Term 1', translations: [zh(1)] },
      { word: 'Term 2', translations: [zh(2)] },
      { word: 'Other' },
    ]);
    expect(library.pool(['a'], 'zh')).toEqual([
      { word: zh(0), translations: ['Term 0'], pinyin: py(0) },
      { word: zh(1), translations: ['Term 1'], pinyin: py(1) },
      { word: zh(2), translations: ['Term 2'], pinyin: py(2) },
    ]);
    expect(library.pool([], 'zh')).toEqual([]);
  });

  test("refuses to pool a field that it doesn't have", () => {
    const library = new WordLibrary([list('a', 3)]);
    expect(() => library.pool(['a', 'missing'], 'zh')).toThrow('no word list has the id "missing"');
  });

  test('takes words to be the same when their letters and digits are', () => {
    const library = new WordLibrary([
      {
        id: 'a',
        name: { zh: 'A', en: 'A' },
        terms: [
          { id: 'x', en: 'Co-author' },
          { id: 'y', en: 'coauthor' },
          { id: 'z', en: 'CO AUTHOR' },
        ],
      },
    ]);
    expect(library.pool(['a'], 'en')).toEqual([{ word: 'Co-author' }]);
    expect(library.fields()[0]?.counts.en).toBe(1);
  });

  test('gives a word the translations of every term that spells it', () => {
    const library = new WordLibrary([
      {
        id: 'a',
        name: { zh: 'A', en: 'A' },
        terms: [
          { id: 'x', en: 'Co-author', zh: zh(1) },
          { id: 'y', en: 'coauthor', zh: zh(2) },
          { id: 'z', en: 'CO AUTHOR', zh: zh(1) },
        ],
      },
    ]);
    expect(library.pool(['a'], 'en')).toEqual([{ word: 'Co-author', translations: [zh(1), zh(2)] }]);
    expect(library.pool(['a'], 'zh')).toEqual([
      { word: zh(1), translations: ['Co-author', 'CO AUTHOR'], pinyin: py(1) },
      { word: zh(2), translations: ['coauthor'], pinyin: py(2) },
    ]);
    expect(library.fields()[0]?.counts).toEqual({ zh: 2, en: 1 });
  });

  test('reports the terms that are no word of their own', () => {
    const skipped: unknown[][] = [];
    const library = new WordLibrary(
      [
        {
          id: 'a',
          name: { zh: 'A', en: 'A' },
          terms: [
            { id: 'co-author', en: 'Co-author', zh: zh(1) },
            { id: 'coauthor', en: 'coauthor', zh: zh(2) },
            { id: 'plus', en: '+++', zh: zh(3) },
          ],
        },
      ],
      (...report) => skipped.push(report),
    );
    expect(skipped).toEqual([
      ['a.json', '"en" "coauthor" is the same word as "Co-author"', 'coauthor'],
      ['a.json', '"en" "+++" has no letters or digits', 'plus'],
    ]);
    // What has no letters or digits is no card and no translation either.
    expect(library.pool(['a'], 'en')).toEqual([{ word: 'Co-author', translations: [zh(1), zh(2)] }]);
    expect(library.pool(['a'], 'zh')).toEqual([
      { word: zh(1), translations: ['Co-author'], pinyin: py(1) },
      { word: zh(2), translations: ['coauthor'], pinyin: py(2) },
      { word: zh(3), pinyin: py(3) },
    ]);
  });

  test('gives a word that two fields share the translations of both', () => {
    const field = (id: string, translation: string): WordListData => ({
      id,
      name: { zh: id, en: id },
      terms: [{ id: 'model', zh: translation, en: 'Model' }],
    });
    const library = new WordLibrary([field('a', zh(1)), field('b', zh(2)), field('c', zh(1))]);
    expect(library.pool(['a', 'b', 'c'], 'en')).toEqual([{ word: 'Model', translations: [zh(1), zh(2)] }]);
  });

  test('gives a word the forms of its term in every language, once each, in either language', () => {
    const library = new WordLibrary([
      {
        id: 'a',
        name: { zh: 'a', en: 'a' },
        terms: [
          { id: 'data', zh: zh(1), en: 'Data', forms: { zh: [zh(9)], en: ['dataset', 'Data-set', 'database'] } },
          { id: 'plain', zh: zh(2), en: 'Plain' },
        ],
      },
    ]);
    expect(library.pool(['a'], 'en')).toEqual([
      { word: 'Data', translations: [zh(1)], forms: [zh(9), 'dataset', 'database'] },
      { word: 'Plain', translations: [zh(2)] },
    ]);
    expect(library.pool(['a'], 'zh')[0]).toEqual({
      word: zh(1),
      translations: ['Data'],
      forms: [zh(9), 'dataset', 'database'],
      pinyin: py(1),
    });
  });

  test('gives a word that two fields share the forms of both', () => {
    const field = (id: string, forms: string[]): WordListData => ({
      id,
      name: { zh: id, en: id },
      terms: [{ id: 'model', en: 'Model', forms: { en: forms } }],
    });
    const library = new WordLibrary([field('a', ['modeling']), field('b', ['Modeling', 'modelled'])]);
    expect(library.pool(['a', 'b'], 'en')).toEqual([{ word: 'Model', forms: ['modeling', 'modelled'] }]);
  });
});

describe('the English of the characters', () => {
  const WORD = '\u8bcd'; // the character of zh(), "word"

  test('gives a Chinese word the meanings of its characters, once each, and an English word none', () => {
    const glosses = new Map([
      [WORD, ['word', 'term']],
      ['\u8bed', ['language', 'word']],
    ]);
    const library = new WordLibrary([list('ml', 2)], () => {}, glosses);
    expect(library.pool(['ml'], 'zh')[0]).toMatchObject({ word: zh(0), glosses: ['word', 'term'] });
    expect(library.pool(['ml'], 'en')[0]).not.toHaveProperty('glosses');
    expect(library.glossesOf(`${WORD}\u8bed`)).toEqual(['word', 'term', 'language']);
    // A chair's word in traditional characters has the meanings of their simplified forms.
    expect(library.glossesOf('\u8a5e\u8a9e')).toEqual(['word', 'term', 'language']);
    expect(library.glossesOf('Word')).toEqual([]);
    expect(library.glossed).toBe(2);
  });

  test('reads them from beside the lists, and goes without them when they are missing or broken', () => {
    const lists = mkdtempSync(join(tmpdir(), 'reviewer2-glosses-'));
    try {
      writeFileSync(join(lists, 'ml.json'), JSON.stringify(list('ml', 26)));
      expect(loadWordLibrary(lists).glossed).toBe(0);
      mkdirSync(join(lists, 'dictionary'));
      writeFileSync(join(lists, GLOSSES_FILE), JSON.stringify({ glosses: { [WORD]: ['Word'], x: 'none' } }));
      const skipped: unknown[][] = [];
      const library = loadWordLibrary(lists, (...report) => skipped.push(report));
      expect(library.glossesOf(zh(1))).toEqual(['word']);
      expect(skipped).toEqual([[GLOSSES_FILE, 'meanings that are not a list of text', 'x']]);
      writeFileSync(join(lists, GLOSSES_FILE), '{ nope');
      const broken: string[] = [];
      expect(loadWordLibrary(lists, (file) => broken.push(file)).glossed).toBe(0);
      expect(broken).toEqual([GLOSSES_FILE]);
    } finally {
      rmSync(lists, { recursive: true, force: true });
    }
  });

  test('knows the characters that players gave away in English at the table', () => {
    const library = loadWordLibrary(join(import.meta.dirname, '..', '..', '..', 'words'));
    // The ball of the Chinese word for "rebound", and the net of the one for "road network".
    expect(library.glossesOf('\u7bee\u677f\u7403')).toContain('ball');
    expect(library.glossesOf('\u8def\u7f51')).toEqual(expect.arrayContaining(['net', 'web']));
  });
});

describe('drawing words', () => {
  const pool = Array.from({ length: 60 }, (_, i) => ({ word: `Word ${i}`, translations: [zh(i)] }));
  const words = (draw: ReturnType<typeof drawWords>) => draw?.words.map(({ word }) => word) ?? [];

  test('draws different words with their translations, preferring those not used yet', () => {
    const rng = seededRng(4);
    const first = drawWords(pool, 25, new Set(), rng);
    expect(first?.words).toHaveLength(25);
    expect(new Set(words(first)).size).toBe(25);
    expect(first?.words.every(({ word, translations }) => translations?.[0] === zh(Number(word.slice(5))))).toBe(true);
    const second = drawWords(pool, 25, first?.used ?? new Set(), rng);
    expect(words(second).some((word) => words(first).includes(word))).toBe(false);
    expect(second?.used.size).toBe(50);
  });

  test('draws every unused word before it repeats any, then starts over', () => {
    const keys = (from: number, to: number) => pool.slice(from, to).map(({ word }) => wordKey(word));
    for (let seed = 1; seed <= 20; seed += 1) {
      const draw = drawWords(pool, 25, new Set(keys(0, 50)), seededRng(seed));
      const drawn = words(draw);
      expect(new Set(drawn).size).toBe(25);
      // All ten words that the room hasn't seen, and fifteen that it has.
      expect(pool.slice(50).every(({ word }) => drawn.includes(word))).toBe(true);
      // The room remembers this board only, so the next one avoids its words first.
      expect(draw?.used).toEqual(new Set(drawn.map(wordKey)));
      const next = words(drawWords(pool, 25, draw?.used ?? new Set(), seededRng(seed)));
      expect(next.some((word) => drawn.includes(word))).toBe(false);
    }
  });

  test("doesn't put the unused words first when it repeats some", () => {
    const used = new Set(pool.slice(0, 50).map(({ word }) => wordKey(word)));
    const unusedFirst = (seed: number) =>
      words(drawWords(pool, 25, used, seededRng(seed)))
        .slice(0, 10)
        .every((word) => Number(word.slice(5)) >= 50);
    expect(Array.from({ length: 20 }, (_, seed) => unusedFirst(seed)).every(Boolean)).toBe(false);
  });

  test('repeats the words of the last board only when no other word is left', () => {
    // A pool of twice a board: the two halves take turns, so no word comes back right away.
    const half = pool.slice(0, 50);
    let used: ReadonlySet<string> = new Set();
    let last: string[] = [];
    for (let game = 0; game < 10; game += 1) {
      const draw = drawWords(half, 25, used, seededRng(game));
      expect(new Set(words(draw)).size).toBe(25);
      expect(words(draw).some((word) => last.includes(word))).toBe(false);
      last = words(draw);
      used = draw?.used ?? new Set();
    }
    // With 60 words, the third board takes the 10 unused ones and 15 of the first board, and none
    // of the second. Every word has been drawn then, so the room starts over.
    const first = drawWords(pool, 25, new Set(), seededRng(1));
    const second = drawWords(pool, 25, first?.used ?? new Set(), seededRng(2));
    const third = drawWords(pool, 25, second?.used ?? new Set(), seededRng(3));
    expect(words(third).filter((word) => words(first).includes(word))).toHaveLength(15);
    expect(words(third).some((word) => words(second).includes(word))).toBe(false);
    expect(third?.used).toEqual(new Set(words(third).map(wordKey)));
  });

  test('draws from the whole pool once the room has used all of it', () => {
    const used = new Set(pool.map(({ word }) => wordKey(word)));
    const draw = drawWords(pool, 25, used, seededRng(1));
    expect(new Set(words(draw)).size).toBe(25);
    expect(draw?.used.size).toBe(25);
  });

  test('forgets no word that the room used while enough unused ones are left', () => {
    const elsewhere = new Set(['fromanotherfield']);
    expect(drawWords(pool, 25, elsewhere, seededRng(1))?.used.size).toBe(26);
  });

  test("knows a pool's words by the keys that the library worked out, and any other word by its own", () => {
    const library = new WordLibrary([list('a', 30), list('b', 30, 20)]);
    const fromLibrary = library.pool(['a', 'b'], 'en');
    expect(fromLibrary).toHaveLength(50);
    const copies = fromLibrary.map((word) => ({ ...word }));
    for (const pool of [fromLibrary, copies]) {
      const first = drawWords(pool, 25, new Set(), seededRng(3));
      expect(first?.used).toEqual(new Set(words(first).map(wordKey)));
      const second = drawWords(pool, 25, first?.used ?? new Set(), seededRng(3));
      expect(words(second).some((word) => words(first).includes(word))).toBe(false);
    }
  });

  test('gives up when the pool is too small', () => {
    expect(drawWords(pool.slice(0, 24), 25, new Set(), seededRng(1))).toBeNull();
    expect(drawWords(pool.slice(0, 24), 25, new Set(), seededRng(1), () => false)).toBeNull();
  });
});

describe('drawing words that clash', () => {
  const numbered = (count: number) => Array.from({ length: count }, (_, i) => ({ word: `Word ${i}` }));
  const number = ({ word }: BoardWord) => Number(word.slice(5));
  // The pairs of the words that clash, as `clash` sees them.
  const pairs = (words: readonly BoardWord[], clash: Clash) =>
    words.flatMap((a, i) => words.slice(i + 1).filter((b) => clash(a, b))).length;

  test('draws no two words that clash', () => {
    const pool = numbered(60);
    // Each word clashes with the one 30 further on, and with its neighbor in its pair: 0 and 1,
    // 2 and 3, and so on. Then each four words, such as 0, 1, 30 and 31, make a ring.
    const clash = (a: BoardWord, b: BoardWord) => {
      const apart = Math.abs(number(a) - number(b));
      return apart === 30 || (apart === 1 && Math.min(number(a), number(b)) % 2 === 0);
    };
    let used: ReadonlySet<string> = new Set();
    for (let seed = 0; seed < 100; seed += 1) {
      const draw = drawWords(pool, 25, used, seededRng(seed), clash);
      expect(draw?.words).toHaveLength(25);
      expect(new Set(draw?.words).size).toBe(25);
      expect(pairs(draw?.words ?? [], clash)).toBe(0);
      expect(draw?.clashes).toBe(0);
      used = draw?.used ?? new Set();
    }
  });

  test('still prefers the words not used yet, and remembers the used ones while unused ones are left', () => {
    const pool = numbered(60);
    const keys = (words: readonly BoardWord[]) => words.map(({ word }) => wordKey(word));
    // The unused words are 30 to 59, but every odd one clashes with the even one before it.
    const used = new Set(keys(pool.slice(0, 30)));
    const clash = (a: BoardWord, b: BoardWord) =>
      Math.min(number(a), number(b)) >= 30 && Math.floor(number(a) / 2) === Math.floor(number(b) / 2);
    for (let seed = 0; seed < 20; seed += 1) {
      const draw = drawWords(pool, 25, used, seededRng(seed), clash);
      const drawn = draw?.words ?? [];
      // One of each of the 15 pairs of unused words, and 10 used words.
      const unused = drawn.filter((word) => number(word) >= 30);
      expect(unused).toHaveLength(15);
      expect(pairs(drawn, clash)).toBe(0);
      // The other 15 unused words were left out by clashes only, so the room doesn't start over.
      expect(draw?.used).toEqual(new Set([...used, ...keys(unused)]));
      // The next board takes those 15, and once every word has been drawn, the room starts over.
      const next = drawWords(pool, 25, draw?.used ?? new Set(), seededRng(seed), clash);
      const left = pool.slice(30).filter((word) => !unused.includes(word));
      expect(left.every((word) => next?.words.includes(word))).toBe(true);
      expect(next?.used).toEqual(new Set(keys(next?.words ?? [])));
    }
    // Without clashes it takes 25 unused words and remembers them with the others.
    const plain = drawWords(pool, 25, used, seededRng(1), () => false);
    expect(plain?.words.every((word) => number(word) >= 30)).toBe(true);
    expect(plain?.used.size).toBe(55);
  });

  test('starts over once fewer unused words than a board needs were left, whatever clashes left out', () => {
    const pool = numbered(60);
    const keys = (words: readonly BoardWord[]) => words.map(({ word }) => wordKey(word));
    // Only 20 words are unused, fewer than a board needs, and each of 40 to 44 clashes with the
    // word 5 further on.
    const used = new Set(keys(pool.slice(0, 40)));
    const clash = (a: BoardWord, b: BoardWord) => {
      const low = Math.min(number(a), number(b));
      return low >= 40 && low < 45 && Math.max(number(a), number(b)) === low + 5;
    };
    for (let seed = 0; seed < 20; seed += 1) {
      const draw = drawWords(pool, 25, used, seededRng(seed), clash);
      const drawn = draw?.words ?? [];
      const unused = drawn.filter((word) => number(word) >= 40);
      expect(unused).toHaveLength(15);
      expect(pairs(drawn, clash)).toBe(0);
      // The room starts over, remembering this board only: the five words left out are unused
      // again, like all the others, rather than played one at a time on boards of used words.
      expect(draw?.used).toEqual(new Set(keys(drawn)));
      const next = drawWords(pool, 25, draw?.used ?? new Set(), seededRng(seed), clash);
      expect(next?.words.some((word) => drawn.includes(word))).toBe(false);
      expect(next?.used.size).toBe(50);
    }
  });

  test('plays at most one board of mostly used words at the end of a cycle', () => {
    // Words 0 to 2 clash with each other, as a chain of words does, and the rest with none. When
    // two of them are among the last unused words, a board can take only one of them, and the
    // room must not go on to a board of used words and the other, but start over. So over many
    // cycles, no two boards in a row hold fewer unused words than a board needs.
    const pool = numbered(52);
    const clash = (a: BoardWord, b: BoardWord) => number(a) <= 2 && number(b) <= 2;
    let used: ReadonlySet<string> = new Set();
    let mixed = false;
    for (let game = 0; game < 200; game += 1) {
      const before = used;
      const draw = drawWords(pool, 25, used, seededRng(game), clash);
      expect(draw?.clashes).toBe(0);
      const fresh = (draw?.words ?? []).filter(({ word }) => !before.has(wordKey(word))).length;
      if (fresh < 25) expect(mixed, `games ${game - 1} and ${game}`).toBe(false);
      mixed = fresh < 25;
      used = draw?.used ?? new Set();
    }
  });

  test('looks at a limited number of words when the pass comes out short', () => {
    // Every word clashes with every other, so the pass keeps one.
    let calls = 0;
    const always = () => {
      calls += 1;
      return true;
    };
    const draw = drawWords(numbered(FALLBACK_WORDS * 4), 25, new Set(), seededRng(1), always);
    expect(draw?.words).toHaveLength(25);
    expect(calls).toBeLessThan(FALLBACK_WORDS * 4 + (FALLBACK_WORDS * (FALLBACK_WORDS - 1)) / 2 + 1);
  });

  test('fills the board from a small pool with many clashes whenever it can', () => {
    // Word 0 clashes with words 1 and 2: a board needs both of them, and must leave word 0 out,
    // which a pass in a random order often wouldn't.
    const pool = numbered(26);
    const clash = (a: BoardWord, b: BoardWord) =>
      Math.min(number(a), number(b)) === 0 && Math.max(number(a), number(b)) <= 2;
    for (let seed = 0; seed < 100; seed += 1) {
      const draw = drawWords(pool, 25, new Set(), seededRng(seed), clash);
      expect(draw?.clashes).toBe(0);
      expect(draw?.words.map(number).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    }
  });

  test('lets as few words clash as it must when the pool leaves no other way, and says how many', () => {
    // Words 0, 1 and 2 all clash with each other, and a board needs two of them.
    const triangle = (a: BoardWord, b: BoardWord) => number(a) <= 2 && number(b) <= 2;
    for (let seed = 0; seed < 50; seed += 1) {
      const draw = drawWords(numbered(26), 25, new Set(), seededRng(seed), triangle);
      expect(draw?.words).toHaveLength(25);
      expect(new Set(draw?.words).size).toBe(25);
      expect(draw?.clashes).toBe(1);
      expect(pairs(draw?.words ?? [], triangle)).toBe(1);
    }
  });

  test('ends even when every word clashes with every other', () => {
    let calls = 0;
    const always = () => {
      calls += 1;
      return true;
    };
    const draw = drawWords(numbered(40), 25, new Set(), seededRng(1), always);
    expect(draw?.words).toHaveLength(25);
    expect(new Set(draw?.words).size).toBe(25);
    expect(draw?.clashes).toBe((25 * 24) / 2);
    // One pass, then every pair once.
    expect(calls).toBeLessThanOrEqual(40 + (40 * 39) / 2);
  });
});

describe('loading word lists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reviewer2-words-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('reads every JSON file and skips the broken ones', () => {
    writeFileSync(join(dir, 'ml.json'), JSON.stringify(list('ml', 26)));
    writeFileSync(join(dir, 'broken.json'), '{ nope');
    writeFileSync(join(dir, 'odd.json'), JSON.stringify({ hello: 'world' }));
    writeFileSync(join(dir, 'notes.txt'), 'not a list');
    const skipped: string[] = [];
    const library = loadWordLibrary(dir, (file) => skipped.push(file));
    expect(library.fields().map((field) => field.id)).toEqual(['ml']);
    expect(skipped.sort()).toEqual(['broken.json', 'odd.json']);
  });

  test('skips a list whose id is not its file name', () => {
    const lists = mkdtempSync(join(tmpdir(), 'reviewer2-ids-'));
    try {
      writeFileSync(join(lists, 'ml.json'), JSON.stringify(list('ml', 30)));
      // An old copy that someone left beside the list must not take its place.
      writeFileSync(join(lists, 'ml-old.json'), JSON.stringify(list('ml', 2)));
      const skipped: unknown[][] = [];
      const library = loadWordLibrary(lists, (...report) => skipped.push(report));
      expect(library.fields().map(({ id, counts }) => [id, counts.en])).toEqual([['ml', 30]]);
      expect(skipped).toEqual([['ml-old.json', 'its "id" is "ml", which is not the file name without .json']]);
    } finally {
      rmSync(lists, { recursive: true, force: true });
    }
  });

  test("skips the terms that it can't use and says which", () => {
    const terms = [
      { id: 'fine', zh: zh(1), en: 'Fine' },
      'not a term',
      null,
      { en: 'No id' },
      { id: 7, en: 'Bad id' },
      { id: 'number', en: 3, zh: zh(2) },
      { id: 'blank', en: '  ' },
      { id: 'empty' },
      { id: 'symbols', en: '?!' },
      { id: 'again', en: 'FINE', zh: zh(3) },
    ];
    const lists = mkdtempSync(join(tmpdir(), 'reviewer2-terms-'));
    try {
      writeFileSync(join(lists, 'odd.json'), JSON.stringify({ ...list('odd', 0), terms }));
      const skipped: unknown[][] = [];
      const library = loadWordLibrary(lists, (...report) => skipped.push(report));
      expect(skipped).toEqual([
        ['odd.json', 'not a term with an "id"', 'terms[1]'],
        ['odd.json', 'not a term with an "id"', 'terms[2]'],
        ['odd.json', 'not a term with an "id"', 'terms[3]'],
        ['odd.json', 'not a term with an "id"', 'terms[4]'],
        ['odd.json', '"en" is not text', 'number'],
        ['odd.json', '"en" is not text', 'blank'],
        ['odd.json', 'has neither "zh" nor "en"', 'empty'],
        ['odd.json', '"en" "?!" has no letters or digits', 'symbols'],
        ['odd.json', '"en" "FINE" is the same word as "Fine"', 'again'],
      ]);
      expect(library.pool(['odd'], 'en')).toEqual([{ word: 'Fine', translations: [zh(1), zh(3)] }]);
      expect(library.fields()[0]?.counts).toEqual({ zh: 3, en: 1 });
    } finally {
      rmSync(lists, { recursive: true, force: true });
    }
  });

  test("reads the forms of a term, and skips the ones that it can't use", () => {
    const terms = [
      { id: 'fine', en: 'Fine', forms: { en: ['finest'], zh: [zh(1)], fr: ['fin'] } },
      { id: 'listless', en: 'Listless', forms: ['listlessly'] },
      { id: 'odd', en: 'Odd', forms: { en: 'oddly', zh: [zh(2), 3, '  '] } },
      { id: 'marks', en: 'Marks', forms: { en: ['?!', 'marked'] } },
      { id: 'nothing', en: 'Nothing', forms: null },
    ];
    const lists = mkdtempSync(join(tmpdir(), 'reviewer2-forms-'));
    try {
      writeFileSync(join(lists, 'forms.json'), JSON.stringify({ ...list('forms', 0), terms }));
      const skipped: unknown[][] = [];
      const library = loadWordLibrary(lists, (...report) => skipped.push(report));
      expect(skipped).toEqual([
        ['forms.json', '"forms" is not an object', 'listless'],
        ['forms.json', '"forms.zh[1]" is not text', 'odd'],
        ['forms.json', '"forms.zh[2]" is not text', 'odd'],
        ['forms.json', '"forms.en" is not a list', 'odd'],
        ['forms.json', '"forms" is not an object', 'nothing'],
        ['forms.json', 'the "en" form "?!" has no letters or digits', 'marks'],
      ]);
      // The words stay, with the forms that are fine.
      expect(library.pool(['forms'], 'en')).toEqual([
        { word: 'Fine', forms: [zh(1), 'finest'] },
        { word: 'Listless' },
        { word: 'Odd', forms: [zh(2)] },
        { word: 'Marks', forms: ['marked'] },
        { word: 'Nothing' },
      ]);
    } finally {
      rmSync(lists, { recursive: true, force: true });
    }
  });

  test("refuses a directory that isn't there or isn't one", () => {
    expect(() => loadWordLibrary(join(dir, 'missing'))).toThrow(/^cannot read the word lists: ENOENT.*missing/);
    expect(() => loadWordLibrary(join(dir, 'notes.txt'))).toThrow(/^cannot read the word lists: ENOTDIR.*notes\.txt/);
  });

  test('refuses a directory without word lists, or with none that can be read', () => {
    const empty = mkdtempSync(join(tmpdir(), 'reviewer2-no-words-'));
    try {
      expect(() => loadWordLibrary(empty)).toThrow(`there are no word lists in ${empty}`);
      writeFileSync(join(empty, 'README.md'), '# Word library');
      expect(() => loadWordLibrary(empty)).toThrow(`there are no word lists in ${empty}`);
      const skipped: string[] = [];
      writeFileSync(join(empty, 'broken.json'), '{ nope');
      expect(() => loadWordLibrary(empty, (file) => skipped.push(file))).toThrow(/^there are no word lists/);
      // What was skipped is still reported, so that the log says why there are none.
      expect(skipped).toEqual(['broken.json']);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test('refuses word lists that have no term that can be read, since a room needs words', () => {
    const empty = mkdtempSync(join(tmpdir(), 'reviewer2-no-terms-'));
    try {
      const list = (id: string, terms: unknown[]) =>
        writeFileSync(join(empty, `${id}.json`), JSON.stringify({ id, name: { zh: id, en: id }, terms }));
      list('ml', []);
      expect(() => loadWordLibrary(empty)).toThrow(`there are no words in the word lists in ${empty}`);
      const skipped: string[] = [];
      list('hci', [{ nope: 1 }, { id: 'x' }]);
      expect(() => loadWordLibrary(empty, (_file, _reason, term) => skipped.push(term ?? ''))).toThrow(
        /^there are no words in the word lists/,
      );
      expect(skipped).toEqual(['terms[0]', 'x']);
      // One term in one list is enough.
      list('hci', [{ id: 'x', en: 'X' }]);
      expect(
        loadWordLibrary(empty)
          .fields()
          .map(({ id, counts }) => [id, counts.en]),
      ).toEqual([
        ['hci', 1],
        ['ml', 0],
      ]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

// scripts/check-words.mjs runs without TypeScript, so it can't import wordKey() or the size of a
// board and has its own copies. These tests hold the copies to the originals: a list that the
// check calls playable must be playable on the server.
describe('the word list check', async () => {
  interface CheckWords {
    MIN_TERMS: number;
    wordKey(text: string): string;
    checkWordList(data: unknown, file: string): { problems: string[]; counts: Record<Language, number> };
    clashEntry(word: string, translations?: string[], forms?: string[]): unknown;
    clash(a: unknown, b: unknown): boolean;
  }
  const script = join(import.meta.dirname, '..', '..', '..', 'scripts', 'check-words.mjs');
  const check = (await import(/* @vite-ignore */ pathToFileURL(script).href)) as CheckWords;

  test('tells words apart as the game does', () => {
    const spellings = [
      'Co-author',
      'co author',
      'COAUTHOR',
      'C++',
      'C#',
      'COVID-19',
      "Master's",
      'Na\u00efve',
      'Cafe\u0301',
      '\uff21\uff22\uff23 \uff11',
      '\u2460',
      'atten\u200btion',
      'soft\u00adware',
      `GPU ${zh(1)}`,
      REVIEWER,
      REVIEWER_TRADITIONAL,
      '\u00df',
      '\u0130',
      '+++',
      '   ',
      '',
    ];
    for (const spelling of spellings) expect(check.wordKey(spelling), spelling).toBe(wordKey(spelling));
  });

  test('takes the same traditional Chinese characters for simplified ones', () => {
    // Every character of the block that the table of variants covers.
    const different: string[] = [];
    for (let code = 0x4e00; code <= 0x9fff; code += 1) {
      const char = String.fromCharCode(code);
      if (check.wordKey(char) !== wordKey(char)) different.push(`U+${code.toString(16)}`);
    }
    expect(different).toEqual([]);
    expect(check.wordKey(REVIEWER_TRADITIONAL)).toBe(REVIEWER);
  });

  test('counts the words of a list as the library does', () => {
    const tricky = {
      id: 'tricky',
      name: { zh: 'T', en: 'T' },
      contributors: ['Ann'],
      terms: [
        { id: 'a', en: 'Co-author', zh: REVIEWER },
        { id: 'b', en: 'coauthor', zh: REVIEWER_TRADITIONAL },
        { id: 'c', en: 'C++' },
        { id: 'd', en: 'C#' },
        { id: 'e', en: 'Na\u00efve' },
        { id: 'f', en: 'naive' },
        { id: 'g', en: 'atten\u200btion' },
        { id: 'h', en: 'Attention', zh: zh(1) },
        { id: 'i', en: 'Model', zh: 'Model' },
        { id: 'j', en: '+++', zh: '\u3002' },
      ],
    };
    const { counts } = check.checkWordList(tricky, 'tricky.json');
    expect(counts).toEqual({ zh: 3, en: 5 });
    expect(new WordLibrary([tricky]).fields()[0]?.counts).toEqual(counts);
  });

  test('asks for as many terms as a board has cards', () => {
    expect(check.MIN_TERMS).toBe(BOARD_SIZE);
  });

  test('finds the words that clash as the game does', () => {
    const texts: (string | BoardWord)[] = [
      'Gene',
      'Gene editing',
      'Genes',
      'Editing',
      'Mixture models',
      'Model',
      'Modeling',
      'Data',
      'Datacenter',
      { word: 'Data', forms: ['dataset', 'database'] },
      'Dataset',
      { word: 'GPU', forms: ['graphics processing unit', '\u56fe\u5f62\u5904\u7406\u5668'] },
      'Unit',
      'Graphics',
      '\u5904\u7406\u5668',
      '\u57fa\u56e0',
      '\u57fa\u56e0\u7f16\u8f91',
      '\u6570\u5b66',
      '\u5316\u5b66',
      `GPU ${zh(1)}`,
      zh(12),
      REVIEWER,
      `${REVIEWER_TRADITIONAL} 2`,
      { word: '\u53d8\u6362\u5668', translations: ['Transformer'] },
      'Transformers',
      'State of the art',
      'Out of distribution',
      "Master's",
      "Occam's razor",
      'Co-author',
      'coauthor',
      'Self\u2011attention',
      'ATTENTION',
      'Atte\u0301ntion  span',
      '\uff21\uff29',
      'AI',
      'Email',
      'Test',
      't-test',
      'Turing test',
      'A/B test',
      'Series A',
      'Time series',
      'GPT-3',
      'GPT-4',
      '3D',
      '3D printing',
      "Master's degree",
      'R\u5e73\u65b9',
      '\u5e73\u65b9\u6839',
    ];
    const words = texts.map((text) => (typeof text === 'string' ? { word: text } : text));
    const entries = words.map(({ word, translations, forms }) =>
      check.clashEntry(word, [...(translations ?? [])], [...(forms ?? [])]),
    );
    let clashes = 0;
    words.forEach((a, i) =>
      words.forEach((b, j) => {
        if (i === j) return;
        const game = cardsClash(a, b);
        expect(check.clash(entries[i], entries[j]), `${a.word} and ${b.word}`).toBe(game);
        if (game) clashes += 1;
      }),
    );
    // Enough of them clash, and enough don't, for the comparison to mean something.
    expect(clashes).toBeGreaterThan(30);
    expect(clashes).toBeLessThan(words.length * (words.length - 1) - 200);
  });

  // One test for each list of the library, since comparing every pair of terms takes a while,
  // and a test for the whole library would take longer with every list that it gains.
  const dir = join(import.meta.dirname, '..', '..', '..', 'words');
  const files = readdirSync(dir).filter((file) => file.endsWith('.json'));
  let library: WordLibrary | undefined;

  test('finds the lists of the library', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files)('finds the same words that clash as the game in %s', (file) => {
    library ??= loadWordLibrary(dir);
    const pairKey = (a: string, b: string) => [wordKey(a), wordKey(b)].sort().join(' | ');
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as WordListData;
    for (const language of LANGUAGES) {
      const other = LANGUAGES.find((each) => each !== language) as Language;
      const terms = data.terms.filter((term) => term[language]);
      const entries = terms.map((term) =>
        check.clashEntry(
          term[language] as string,
          term[other] ? [term[other]] : [],
          LANGUAGES.flatMap((each) => term.forms?.[each] ?? []),
        ),
      );
      const script = new Set<string>();
      entries.forEach((a, i) =>
        entries.forEach((b, j) => {
          if (i < j && check.clash(a, b)) script.add(pairKey(terms[i]?.[language] ?? '', terms[j]?.[language] ?? ''));
        }),
      );
      const pool = library.pool([data.id], language);
      const game = new Set<string>();
      pool.forEach((a, i) =>
        pool.forEach((b, j) => {
          if (i < j && cardsClash(a, b)) game.add(pairKey(a.word, b.word));
        }),
      );
      expect(script, `${file} in ${language}`).toEqual(game);
    }
  });
});
