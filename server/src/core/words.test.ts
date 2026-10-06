import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BOARD_SIZE, wordKey, type Language } from '@reviewer2/shared';
import { afterAll, describe, expect, test } from 'vitest';
import { seededRng } from './random';
import { drawWords, loadWordLibrary, WordLibrary, type WordListData } from './words';

// Chinese test words are written as \u escapes (docs/rules/language.md).
const zh = (i: number) => `\u8bcd${i}`;
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
      { word: zh(0), translations: ['Term 0'] },
      { word: zh(1), translations: ['Term 1'] },
      { word: zh(2), translations: ['Term 2'] },
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
      { word: zh(1), translations: ['Co-author', 'CO AUTHOR'] },
      { word: zh(2), translations: ['coauthor'] },
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
      { word: zh(1), translations: ['Co-author'] },
      { word: zh(2), translations: ['coauthor'] },
      { word: zh(3) },
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

  test('gives up when the pool is too small', () => {
    expect(drawWords(pool.slice(0, 24), 25, new Set(), seededRng(1))).toBeNull();
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

  test("refuses a directory that isn't there or isn't one", () => {
    expect(() => loadWordLibrary(join(dir, 'missing'))).toThrow(/^cannot read the word lists: ENOENT.*missing/);
    expect(() => loadWordLibrary(join(dir, 'notes.txt'))).toThrow(/^cannot read the word lists: ENOTDIR.*notes\.txt/);
  });

  test('loads nothing from a directory without word lists', () => {
    const empty = mkdtempSync(join(tmpdir(), 'reviewer2-no-words-'));
    try {
      writeFileSync(join(empty, 'README.md'), '# Word library');
      expect(loadWordLibrary(empty).fields()).toEqual([]);
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
});
