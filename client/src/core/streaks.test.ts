import { describe, expect, test } from 'vitest';
import { LINES_PER_TIER, streakLineKey, streakLineNumber, streakTier, streakTitle } from './streaks';

describe('the lines for a streak', () => {
  test('come in tiers: three or four games, five to nine, ten and up', () => {
    expect([3, 4, 5, 9, 10, 25].map(streakTier)).toEqual(['low', 'low', 'mid', 'mid', 'high', 'high']);
  });

  test('are the same for the same game, player and streak, and vary from one game to the next', () => {
    expect(streakLineNumber('g1', 'ann', 'wins', 3)).toBe(streakLineNumber('g1', 'ann', 'wins', 3));
    const numbers = new Set<number>();
    for (let game = 0; game < 30; game += 1) {
      const number = streakLineNumber(`g${game}`, 'ann', 'losses', 4);
      expect(number).toBeGreaterThanOrEqual(1);
      expect(number).toBeLessThanOrEqual(LINES_PER_TIER);
      numbers.add(number);
    }
    expect(numbers.size).toBe(LINES_PER_TIER);
    expect(streakLineKey('g1', 'ann', 'wins', 12)).toMatch(/^streaks\.lines\.wins\.high\.[123]$/);
  });
});

describe('the title of a streak', () => {
  test('is its name with the number in the words of the language', () => {
    const t = (key: string, named: Record<string, string>) => `${key}[${named.n}]`;
    expect(streakTitle(t, 'wins', 21, 'en')).toBe('streaks.names.wins[Twenty-One]');
    expect(streakTitle(t, 'losses', 3, 'zh')).toBe('streaks.names.losses[\u4e09]');
  });
});
