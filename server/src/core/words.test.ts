import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wordKey } from '@reviewer2/shared';
import { afterAll, describe, expect, test } from 'vitest';
import { seededRng } from './random';
import { drawWords, loadWordLibrary, WordLibrary, type WordListData } from './words';

// Chinese test words are written as \u escapes (docs/rules/language.md).
const zh = (i: number) => `\u8bcd${i}`;

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
    expect(library.pool(['a', 'missing'], 'zh')).toEqual([
      { word: zh(0), translations: ['Term 0'] },
      { word: zh(1), translations: ['Term 1'] },
      { word: zh(2), translations: ['Term 2'] },
    ]);
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

  test('starts over when too few unused words are left', () => {
    const used = new Set(pool.slice(0, 50).map(({ word }) => wordKey(word)));
    const draw = drawWords(pool, 25, used, seededRng(1));
    expect(draw?.words).toHaveLength(25);
    expect(draw?.used.size).toBe(25);
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

  test('copes with a missing directory', () => {
    const skipped: string[] = [];
    expect(loadWordLibrary(join(dir, 'missing'), (file) => skipped.push(file)).fields()).toEqual([]);
    expect(skipped).toHaveLength(1);
  });
});
