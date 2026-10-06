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

  // If the colors stayed in the order they are listed in, anyone could read the key from the
  // places of the cards and the starting team, which everyone sees.
  test('puts the colors in random places, whatever the words are', () => {
    const reviewer2At = new Set<number>();
    const reviewer2Word = new Set<string>();
    const startersAt = new Set<number>();
    const layouts = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      const { cards, startingTeam } = deal(WORDS, seededRng(seed));
      const place = cards.findIndex((card) => card.color === 'reviewer2');
      reviewer2At.add(place);
      reviewer2Word.add(cards[place]?.word ?? '');
      cards.forEach((card, index) => card.color === startingTeam && startersAt.add(index));
      layouts.add(cards.map((card) => (card.color === startingTeam ? 's' : card.color[0])).join(''));
    }
    expect(reviewer2At.size).toBeGreaterThan(20);
    expect(reviewer2Word.size).toBeGreaterThan(20);
    expect(startersAt.size).toBe(25);
    expect(layouts.size).toBe(200);
  });

  test('is repeatable with the same seed', () => {
    expect(deal(WORDS, seededRng(3))).toEqual(deal(WORDS, seededRng(3)));
  });

  test('needs exactly 25 different words', () => {
    expect(() => deal(WORDS.slice(1), seededRng(1))).toThrow('got 24, 24 of them different');
    expect(() => deal([...WORDS.slice(1), 'Term1'], seededRng(1))).toThrow('got 25, 24 of them different');
    expect(() => deal([...WORDS, 'Term1'], seededRng(1))).toThrow('got 26, 25 of them different');
  });

  test('takes two spellings of a word for the same word', () => {
    for (const again of ['term1', ' TERM1 ', '\uff34\uff45\uff52\uff4d\uff11', 'Te\u0301rm1']) {
      expect(() => deal([...WORDS.slice(1), again], seededRng(1)), again).toThrow('got 25, 24 of them different');
    }
  });

  test("keeps each word's translations with its card", () => {
    const terms = WORDS.map((word, i) => (i % 2 === 0 ? { word, translations: [`Other${i}`] } : word));
    for (const card of deal(terms, seededRng(2)).cards) {
      const index = Number(card.word.slice(4));
      if (index % 2 === 0) expect(card.translations).toEqual([`Other${index}`]);
      else expect('translations' in card).toBe(false);
    }
  });
});
