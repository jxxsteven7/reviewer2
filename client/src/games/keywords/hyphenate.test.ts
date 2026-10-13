import { describe, expect, test } from 'vitest';
import { hyphenate } from './hyphenate';

const SOFT_HYPHEN = '­';
const breaks = (word: string) => hyphenate(word).replaceAll(SOFT_HYPHEN, '-');

describe('hyphenate', () => {
  test('breaks the English terms of the word library with soft hyphens', () => {
    expect(breaks('Peer review')).toBe('Peer re-view');
    expect(breaks('Significance')).toBe('Sig-nif-i-cance');
  });

  test('leaves short words and Chinese words as they are', () => {
    expect(hyphenate('Model')).toBe('Model');
    expect(hyphenate('Prior')).toBe('Prior');
    expect(hyphenate('同行评审')).toBe('同行评审');
  });

  test('lets a word the patterns leave whole, or one outside the library, break anywhere but near its ends', () => {
    // Liang's en-us patterns find no break in these two terms of the library.
    expect(breaks('Wikipedia')).toBe('Wik-i-p-e-dia');
    expect(breaks('Premise')).toBe('Pre-m-ise');
    // A word of the chair's own.
    expect(breaks('Serendipitous')).toBe('Ser-e-n-d-i-p-i-t-ous');
    expect(breaks('Signal')).toBe('Sig-nal');
    // Each word of a term on its own; letters with accents are letters.
    expect(breaks('Schrödinger cat')).toBe('Sch-r-ö-d-i-n-ger cat');
  });

  test('never breaks a word before its last letter or two', () => {
    for (const word of ['Wikipedia', 'Premise', 'Serendipitous', 'Signal']) {
      const pieces = hyphenate(word).split(SOFT_HYPHEN);
      expect(pieces[0]?.length).toBeGreaterThanOrEqual(3);
      expect(pieces.at(-1)?.length).toBeGreaterThanOrEqual(3);
      expect(pieces.join('')).toBe(word);
    }
  });
});
