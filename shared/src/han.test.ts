import { describe, expect, test } from 'vitest';
import { toSimplified } from './han';
import { HAN_VARIANTS } from './han-variants';

// Chinese characters are written as \u escapes, because everything in the repository is in
// English (docs/rules/language.md).

describe('the table of traditional and simplified characters', () => {
  const pairs = Array.from({ length: HAN_VARIANTS.length / 2 }, (_, i) => [
    HAN_VARIANTS.charAt(2 * i),
    HAN_VARIANTS.charAt(2 * i + 1),
  ]);
  const traditional = new Set(pairs.map(([from]) => from));

  test('is made of pairs of different characters from the basic CJK block', () => {
    expect(HAN_VARIANTS.length % 2).toBe(0);
    expect(pairs.length).toBeGreaterThan(2500);
    expect(pairs.every(([from, to]) => from !== to)).toBe(true);
    expect(/^[\u4e00-\u9fff]+$/.test(HAN_VARIANTS)).toBe(true);
  });

  test('names each traditional character once, and no simplified form has a simpler one', () => {
    expect(traditional.size).toBe(pairs.length);
    expect(pairs.filter(([, to]) => traditional.has(to as string))).toEqual([]);
  });
});

describe('toSimplified', () => {
  test('turns the traditional characters of everyday words into simplified ones', () => {
    for (const [from, to] of [
      ['\u5be9\u7a3f\u4eba', '\u5ba1\u7a3f\u4eba'], // "reviewer"
      ['\u6578\u64da\u79d1\u5b78', '\u6570\u636e\u79d1\u5b66'], // "data science"
      ['\u57fa\u7dda', '\u57fa\u7ebf'], // "baseline"
      ['\u8a18\u9304', '\u8bb0\u5f55'], // "record"
      ['\u904a\u6232', '\u6e38\u620f'], // "game"
      ['\u5206\u4f48', '\u5206\u5e03'], // "distribution"
      ['\u9031\u671f', '\u5468\u671f'], // "period"
      ['\u9451\u5225', '\u9274\u522b'], // "discriminate"
      ['\u59d4\u8a17', '\u59d4\u6258'], // "entrust"
      ['\u795e\u7d93\u7db2\u7d61', '\u795e\u7ecf\u7f51\u7edc'], // "neural network"
      ['\u6a5f\u5668\u5b78\u7fd2', '\u673a\u5668\u5b66\u4e60'], // "machine learning"
    ] as const) {
      expect(toSimplified(from)).toBe(to);
      expect(toSimplified(to)).toBe(to);
    }
  });

  test('leaves everything else alone', () => {
    expect(toSimplified('GPU \u52a0\u901f 42')).toBe('GPU \u52a0\u901f 42');
    // Characters that simplified Chinese uses as they are, although they have a simpler relative.
    expect(toSimplified('\u8986\u76d6\u8457\u540d')).toBe('\u8986\u76d6\u8457\u540d');
    expect(toSimplified('')).toBe('');
  });
});
