import { describe, expect, test } from 'vitest';
import { CODE_ALPHABET, formatCode, parseCode } from './codes';

describe('a room code', () => {
  test('has 32 characters to choose from, without I, L, O or U', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(CODE_ALPHABET).not.toMatch(/[ILOU]/);
  });

  test('is shown as a manuscript number, which is read back as the code', () => {
    expect(formatCode('K7QX')).toBe('R2-K7QX');
    expect(parseCode(formatCode('K7QX'))).toBe('K7QX');
  });

  test('is read however it is typed', () => {
    expect(parseCode('K7QX')).toBe('K7QX');
    expect(parseCode(' k7qx ')).toBe('K7QX');
    expect(parseCode('k7 qx')).toBe('K7QX');
    expect(parseCode('lo1O')).toBe('1010');
    expect(parseCode('\uff2b\uff17\uff31\uff38')).toBe('K7QX');
  });

  test('is read with the prefix it is shown with, whatever stands between the two', () => {
    // A hyphen, nothing, spaces, an en dash, a minus sign, an underscore, full-width forms.
    for (const typed of [
      'R2-K7QX',
      'r2-k7 qx',
      'R2K7QX',
      'R2 K7QX',
      'R2 - K7QX',
      'R2- K7QX',
      'R2\u2013K7QX',
      'R2\u2212K7QX',
      'r2_k7qx',
      '\uff32\uff12\uff0d\uff2b\uff17\uff31\uff38',
    ]) {
      expect(parseCode(typed), JSON.stringify(typed)).toBe('K7QX');
    }
  });

  test('is read through the characters that a pasted code brings along', () => {
    // A zero-width space, a soft hyphen, a byte order mark and a word joiner.
    for (const hidden of ['\u200b', '\u00ad', '\ufeff', '\u2060']) {
      expect(parseCode(`K7${hidden}QX`), JSON.stringify(hidden)).toBe('K7QX');
      expect(parseCode(`${hidden}R2-K7QX${hidden}`), JSON.stringify(hidden)).toBe('K7QX');
    }
  });

  test('may begin with R2 itself', () => {
    // About one code in a thousand does. Only a whole code after "R2" makes it the prefix.
    expect(parseCode('R2AB')).toBe('R2AB');
    expect(parseCode('r2ab')).toBe('R2AB');
    expect(parseCode('R2-R2AB')).toBe('R2AB');
    expect(parseCode('R2R2AB')).toBe('R2AB');
  });

  test('is nothing else', () => {
    for (const typed of ['', 'K7Q', 'K7QXY', 'KUQX', 'K?QX', 'R2-', 'R2', 'R2-K7Q', 'R2-K7QXY', 'X2-K7QX', 'K7QX!']) {
      expect(parseCode(typed), JSON.stringify(typed)).toBeNull();
    }
  });
});
