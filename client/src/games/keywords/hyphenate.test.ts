import { describe, expect, test } from 'vitest';
import { hyphenate } from './hyphenate';

const SOFT_HYPHEN = '\u00ad';
const breaks = (word: string) => hyphenate(word).replaceAll(SOFT_HYPHEN, '-');

describe('hyphenate', () => {
  test('breaks the English terms of the word library with soft hyphens', () => {
    expect(breaks('Peer review')).toBe('Peer re-view');
    expect(breaks('Significance')).toBe('Sig-nif-i-cance');
  });

  test('leaves short words and Chinese words as they are', () => {
    expect(hyphenate('Model')).toBe('Model');
    expect(hyphenate('Prior')).toBe('Prior');
    expect(hyphenate('\u540c\u884c\u8bc4\u5ba1')).toBe('\u540c\u884c\u8bc4\u5ba1');
  });

  test('lets a word the patterns leave whole, or one outside the library, break anywhere but near its ends', () => {
    // Liang's en-us patterns find no break in these two terms of the library.
    expect(breaks('Wikipedia')).toBe('Wik-i-p-e-dia');
    expect(breaks('Premise')).toBe('Pre-m-ise');
    // A word of the chair's own.
    expect(breaks('Serendipitous')).toBe('Ser-e-n-d-i-p-i-t-ous');
    expect(breaks('Signal')).toBe('Sig-nal');
    // Each word of a term on its own; letters with accents are letters.
    expect(breaks('Schr\u00f6dinger cat')).toBe('Sch-r-\u00f6-d-i-n-ger cat');
  });

  test('gives the fallback to a word the patterns leave whole in a term where they break another', () => {
    // The patterns break "effect" and "equinox", but neither "Doppler" nor "Vernal".
    expect(breaks('Doppler effect')).toBe('Dop-p-ler ef-fect');
    expect(breaks('Vernal equinox')).toBe('Ver-nal equ-i-nox');
    expect(breaks('Zombie process')).toBe('Zom-bie pro-c-ess');
  });

  test('never breaks a word before its last letter or two', () => {
    for (const word of ['Wikipedia', 'Premise', 'Serendipitous', 'Signal']) {
      const pieces = hyphenate(word).split(SOFT_HYPHEN);
      expect(pieces[0]?.length).toBeGreaterThanOrEqual(3);
      expect(pieces.at(-1)?.length).toBeGreaterThanOrEqual(3);
      expect(pieces.join('')).toBe(word);
    }
  });

  test("shows a word of the chair's that is also a property of every object as it is", () => {
    expect(breaks('constructor')).toBe('con-s-t-r-u-c-tor');
    expect(breaks('toString')).toBe('toS-t-r-ing');
    expect(hyphenate('valueOf')).not.toContain('native code');
  });
});
