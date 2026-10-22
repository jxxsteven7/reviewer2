import { join } from 'node:path';
import { LANGUAGES } from '@reviewer2/shared';
import { BOARD_SIZE, cardsClash, otherTeam, TEAMS, type CardColor } from '@reviewer2/shared/keywords';
import { describe, expect, test } from 'vitest';
import { pick, seededRng, shuffle } from '../../core/random';
import { drawWords, loadWordLibrary } from '../../core/words';
import { keywordsGame } from '.';
import { deal, fullLine } from './deal';
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
    for (const again of ['term1', ' TERM1 ', '\uff34\uff45\uff52\uff4d\uff11', 'Te\u0301rm1', 'Term-1', 'term 1']) {
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

// A row or a column all of one group's cards would make the board too easy, so the deal shuffles
// it away; the rules don't say so.
describe('a row or a column of one group', () => {
  const board = (colored: Record<number, CardColor>) =>
    Array.from({ length: 25 }, (_, index): CardColor => colored[index] ?? 'neutral');
  const cells = (indexes: number[], color: CardColor) => Object.fromEntries(indexes.map((index) => [index, color]));

  test('is a whole row or a whole column of red or blue cards, but no diagonal', () => {
    expect(fullLine(board(cells([5, 6, 7, 8, 9], 'red')))).toBe(true);
    expect(fullLine(board(cells([2, 7, 12, 17, 22], 'blue')))).toBe(true);
    expect(fullLine(board(cells([0, 6, 12, 18, 24], 'red')))).toBe(false);
    expect(fullLine(board(cells([4, 8, 12, 16, 20], 'blue')))).toBe(false);
    expect(fullLine(board({ ...cells([5, 6, 7, 8], 'red'), 9: 'blue' }))).toBe(false);
    expect(fullLine(board(cells([0, 1, 2, 3], 'red')))).toBe(false);
    expect(fullLine(board({}))).toBe(false);
  });

  test('never comes in a deal, which shuffles the colors again and leaves the words where they were', () => {
    let shuffledAgain = 0;
    for (let seed = 0; seed < 1000; seed += 1) {
      const { cards, startingTeam } = deal(WORDS, seededRng(seed));
      const colors = cards.map((card) => card.color);
      expect(fullLine(colors), `seed ${seed}`).toBe(false);
      // The deal as it goes until the colors are shuffled for the first time.
      const rng = seededRng(seed);
      pick(TEAMS, rng);
      const places = shuffle(WORDS, rng);
      const first = shuffle(
        [
          ...Array<CardColor>(9).fill(startingTeam),
          ...Array<CardColor>(8).fill(otherTeam(startingTeam)),
          ...Array<CardColor>(7).fill('neutral'),
          'reviewer2' as const,
        ],
        rng,
      );
      expect(cards.map((card) => card.word)).toEqual(places);
      if (fullLine(first)) shuffledAgain += 1;
    }
    // About one board in 30.
    expect(shuffledAgain).toBeGreaterThan(15);
    expect(shuffledAgain).toBeLessThan(60);
  });
});

// The room draws the words (drawWords() in core/words.ts), with the game's own rule for words that
// can't share a board.
describe('dealing from the word library', () => {
  const library = loadWordLibrary(join(import.meta.dirname, '..', '..', '..', '..', 'words'));
  const fields = library.fields().map(({ id }) => id);

  test('lets the room keep apart the words that give each other away', () => {
    expect(keywordsGame.words).toEqual({ board: 25, clash: cardsClash });
  });

  test('puts no two words on a board of which one repeats the other, for every list and some mixes', () => {
    const mixes = [
      ...fields.map((id) => [id]),
      fields,
      ['biology', 'medicine', 'chemistry'],
      ['ml', 'cs', 'math'],
      ['physics', 'general'],
    ];
    for (const language of LANGUAGES) {
      for (const mix of mixes) {
        const pool = library.pool(mix, language);
        let used: ReadonlySet<string> = new Set();
        // Enough games for a room to go through the whole pool of a list more than once.
        for (let seed = 0; seed < 30; seed += 1) {
          const draw = drawWords(pool, BOARD_SIZE, used, seededRng(seed), cardsClash);
          expect(draw?.clashes, `${mix.join('+')} in ${language}`).toBe(0);
          const { cards } = deal(draw?.words ?? [], seededRng(seed));
          const clashing = cards.flatMap((a, i) =>
            cards.slice(i + 1).flatMap((b) => (cardsClash(a, b) ? [`${a.word} and ${b.word}`] : [])),
          );
          expect(clashing, `${mix.join('+')} in ${language}, game ${seed}`).toEqual([]);
          used = draw?.used ?? new Set();
        }
      }
    }
  });
});
