import { describe, expect, test } from 'vitest';
import { englishNumber, hanNumber, numberWords } from './numbers';

describe('numbers in Chinese characters', () => {
  test('are read as they are said, with the ten alone and one zero between digits', () => {
    const cases: [number, string][] = [
      [0, '零'],
      [1, '一'],
      [3, '三'],
      [9, '九'],
      [10, '十'],
      [11, '十一'],
      [19, '十九'],
      [20, '二十'],
      [21, '二十一'],
      [99, '九十九'],
      [100, '一百'],
      [101, '一百零一'],
      [110, '一百一十'],
      [111, '一百一十一'],
      [200, '二百'],
      [999, '九百九十九'],
      [1000, '一千'],
      [1001, '一千零一'],
      [1010, '一千零一十'],
      [1100, '一千一百'],
      [1101, '一千一百零一'],
      [2024, '二千零二十四'],
      [9999, '九千九百九十九'],
    ];
    for (const [n, words] of cases) expect(hanNumber(n), String(n)).toBe(words);
  });

  test('count in ten thousands, with a zero before a low part under a thousand', () => {
    const cases: [number, string][] = [
      [10_000, '一万'],
      [10_001, '一万零一'],
      [10_010, '一万零一十'],
      [10_100, '一万零一百'],
      [11_000, '一万一千'],
      [12_345, '一万二千三百四十五'],
      [100_000, '十万'],
      [100_010, '十万零一十'],
      [110_000, '十一万'],
      [1_000_001, '一百万零一'],
      [99_999_999, '九千九百九十九万九千九百九十九'],
    ];
    for (const [n, words] of cases) expect(hanNumber(n), String(n)).toBe(words);
  });
});

describe('numbers in English words', () => {
  test('are in title case, with "and" before the tens and hyphens in the twenties and up', () => {
    const cases: [number, string][] = [
      [0, 'Zero'],
      [1, 'One'],
      [3, 'Three'],
      [10, 'Ten'],
      [11, 'Eleven'],
      [15, 'Fifteen'],
      [20, 'Twenty'],
      [21, 'Twenty-One'],
      [99, 'Ninety-Nine'],
      [100, 'One Hundred'],
      [101, 'One Hundred and One'],
      [110, 'One Hundred and Ten'],
      [121, 'One Hundred and Twenty-One'],
      [200, 'Two Hundred'],
      [1000, 'One Thousand'],
      [1001, 'One Thousand and One'],
      [1010, 'One Thousand and Ten'],
      [1100, 'One Thousand One Hundred'],
      [1101, 'One Thousand One Hundred and One'],
      [9999, 'Nine Thousand Nine Hundred and Ninety-Nine'],
      [12_345, 'Twelve Thousand Three Hundred and Forty-Five'],
      [100_000, 'One Hundred Thousand'],
      [1_000_000, 'One Million'],
      [2_000_010, 'Two Million and Ten'],
      [99_999_999, 'Ninety-Nine Million Nine Hundred and Ninety-Nine Thousand Nine Hundred and Ninety-Nine'],
    ];
    for (const [n, words] of cases) expect(englishNumber(n), String(n)).toBe(words);
  });
});

describe('numberWords', () => {
  test('picks the language, and refuses what is no number of games', () => {
    expect(numberWords(3, 'zh')).toBe('三');
    expect(numberWords(3, 'en')).toBe('Three');
    for (const bad of [-1, 1.5, 100_000_000, Number.NaN]) {
      expect(() => hanNumber(bad), String(bad)).toThrow(RangeError);
      expect(() => englishNumber(bad), String(bad)).toThrow(RangeError);
    }
  });
});
