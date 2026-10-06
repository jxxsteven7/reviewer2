import { describe, expect, test } from 'vitest';
import { seededRng } from '../../core/random';
import { deal } from './deal';
import { remaining } from './state';

const WORDS = Array.from({ length: 25 }, (_, i) => `Term${i}`);

describe('dealing', () => {
  test('gives the starting team 9 cards, the other 8, papers 7 and Reviewer 2 one', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const { cards, startingTeam } = deal(WORDS, seededRng(seed));
      const count = (color: string) => cards.filter((card) => card.color === color).length;
      expect(remaining(cards, startingTeam)).toBe(9);
      expect(remaining(cards, startingTeam === 'red' ? 'blue' : 'red')).toBe(8);
      expect(count('neutral')).toBe(7);
      expect(count('reviewer2')).toBe(1);
      expect(cards.every((card) => !card.revealed)).toBe(true);
    }
  });

  test('uses every word once, in random places, and lets either team start', () => {
    const starters = new Set<string>();
    const firstWords = new Set<string>();
    for (let seed = 0; seed < 50; seed += 1) {
      const { cards, startingTeam } = deal(WORDS, seededRng(seed));
      expect(cards.map((card) => card.word).sort()).toEqual([...WORDS].sort());
      starters.add(startingTeam);
      firstWords.add(cards[0]?.word ?? '');
    }
    expect(starters).toEqual(new Set(['red', 'blue']));
    expect(firstWords.size).toBeGreaterThan(10);
  });

  test('is repeatable with the same seed', () => {
    expect(deal(WORDS, seededRng(3))).toEqual(deal(WORDS, seededRng(3)));
  });

  test('needs exactly 25 different words', () => {
    expect(() => deal(WORDS.slice(1), seededRng(1))).toThrow(/25 different words/);
    expect(() => deal([...WORDS.slice(1), 'Term1'], seededRng(1))).toThrow(/25 different words/);
  });
});
