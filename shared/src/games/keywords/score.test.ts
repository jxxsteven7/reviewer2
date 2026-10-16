import { describe, expect, test } from 'vitest';
import {
  bigClueCards,
  bonusPoints,
  cardPoints,
  endPoints,
  missedPoints,
  POINTS,
  pointsFor,
  revealBonus,
  revealPoints,
  type KeywordsScoreDetail,
} from './score';
import type { ClueRecord } from './types';

// The points of a game (docs/games/keywords.md#matches): what a group's own cards and a win give
// everyone in the group, what a wrong card costs every student and, more, the PI, and the bonuses.

const NOTHING = {
  found: 0,
  won: false,
  irrelevant: 0,
  wrong: 0,
  reviewer2: 0,
  bigClues: 0,
  missed: 0,
  openingRecord: false,
  heavenlyHand: false,
};
const student = (detail: Partial<KeywordsScoreDetail>) => pointsFor({ ...NOTHING, role: 'guesser', ...detail });
const pi = (detail: Partial<KeywordsScoreDetail>) => pointsFor({ ...NOTHING, role: 'captain', ...detail });

describe('the points of a game', () => {
  test('give 1 for each own card found, and 3 to a student and 4 to the PI for winning', () => {
    expect(student({ found: 4, won: true })).toBe(7);
    expect(pi({ found: 4, won: true })).toBe(8);
    expect(student({})).toBe(0);
    expect(pi({})).toBe(0);
  });

  test("cost a student 1, 2 and 3, and the PI 2, 3 and 5, for an irrelevant paper, the other group's card and Reviewer 2", () => {
    expect(POINTS.guesser).toMatchObject({ found: 1, won: 3, irrelevant: -1, wrong: -2, reviewer2: -3 });
    expect(POINTS.captain).toMatchObject({ found: 1, won: 4, irrelevant: -2, wrong: -3, reviewer2: -5 });
    expect(student({ found: 2, irrelevant: 1 })).toBe(1);
    expect(student({ found: 2, wrong: 1 })).toBe(0);
    expect(student({ found: 2, reviewer2: 1 })).toBe(-1);
    expect(student({ irrelevant: 2, wrong: 1, reviewer2: 1 })).toBe(-7);
    expect(pi({ found: 2, irrelevant: 1 })).toBe(0);
    expect(pi({ found: 2, wrong: 1 })).toBe(-1);
    expect(pi({ found: 2, reviewer2: 1 })).toBe(-3);
    expect(pi({ irrelevant: 2, wrong: 1, reviewer2: 1 })).toBe(-12);
  });

  test('count a big clue from its fourth card on', () => {
    expect([0, 3, 4, 5, 9].map(bigClueCards)).toEqual([0, 0, 1, 2, 6]);
    expect(pi({ found: 5, bigClues: 2 })).toBe(7);
  });

  test('give a student 1 for the opening record and the PI nothing, and a student 1 and the PI 3 for the heavenly hand', () => {
    expect(student({ found: 4, openingRecord: true })).toBe(5);
    expect(pi({ found: 4, openingRecord: true, bigClues: 1 })).toBe(5);
    expect(student({ found: 9, won: true, heavenlyHand: true })).toBe(9 + 3 + 1);
    expect(pi({ found: 9, won: true, bigClues: 6, heavenlyHand: true })).toBe(9 + 4 + 6 + 3);
  });

  test('cost the PI 5 for each missed deadline, and the students nothing', () => {
    expect(POINTS.missed).toBe(-5);
    expect(pi({ missed: 1 })).toBe(-5);
    expect(pi({ found: 9, won: true, missed: 2 })).toBe(9 + 4 - 10);
    expect(student({ found: 9, won: true })).toBe(9 + 3);
  });
});

describe('a revealed card', () => {
  test("gives the group whose students revealed it the price of its color, by each player's role", () => {
    expect(revealPoints('red', 'red', 'red', 'guesser')).toBe(1);
    expect(revealPoints('red', 'red', 'red', 'captain')).toBe(1);
    expect(revealPoints('neutral', 'red', 'red', 'guesser')).toBe(-1);
    expect(revealPoints('neutral', 'red', 'red', 'captain')).toBe(-2);
    expect(revealPoints('blue', 'red', 'red', 'guesser')).toBe(-2);
    expect(revealPoints('blue', 'red', 'red', 'captain')).toBe(-3);
    expect(revealPoints('reviewer2', 'red', 'red', 'guesser')).toBe(-3);
    expect(revealPoints('reviewer2', 'red', 'red', 'captain')).toBe(-5);
  });

  test('gives the other group nothing, its own card included', () => {
    for (const color of ['red', 'blue', 'neutral', 'reviewer2'] as const) {
      expect(revealPoints(color, 'red', 'blue', 'guesser')).toBe(0);
      expect(revealPoints(color, 'red', 'blue', 'captain')).toBe(0);
    }
  });

  // Red's first clue names 5 cards; its students reveal them one by one, then a blue card.
  const guess = (color: ClueRecord['guesses'][number]['color'], card: number) => ({
    card,
    color,
    player: 'bob',
    at: 0,
  });
  const after = (guesses: ClueRecord['guesses']) => ({
    history: [{ turn: 1, team: 'red' as const, at: 0, word: 'Hint', count: 5, guesses }],
    result: null,
  });
  const own = Array.from({ length: 5 }, (_, i) => guess('red', i));
  const steps = Array.from({ length: 6 }, (_, i) => after(own.slice(0, i)));
  const bonus = (step: number, role: 'captain' | 'guesser') =>
    revealBonus(steps[step - 1] as (typeof steps)[number], steps[step] as (typeof steps)[number], 'red', 'red', role);

  test('brings the PI a point of the big clue with each own card from the fourth on', () => {
    expect([1, 2, 3, 4, 5].map((step) => bonus(step, 'captain'))).toEqual([0, 0, 0, 1, 1]);
  });

  test('brings the students the point of the opening record with the card that makes it', () => {
    expect([1, 2, 3, 4, 5].map((step) => bonus(step, 'guesser'))).toEqual([0, 0, 0, 0, 1]);
    // A wrong card brings nobody a bonus, and neither does a card that the other group reveals.
    const wrong = after([...own.slice(0, 4), guess('blue', 9)]);
    expect(revealBonus(steps[4] as (typeof steps)[number], wrong, 'red', 'red', 'captain')).toBe(0);
    expect(
      revealBonus(steps[4] as (typeof steps)[number], steps[5] as (typeof steps)[number], 'red', 'blue', 'guesser'),
    ).toBe(0);
  });
});

describe('the points of a game split up', () => {
  test('are the cards, the bonuses of the end and the missed deadlines, which add up to the whole', () => {
    const detail: KeywordsScoreDetail = {
      role: 'captain',
      found: 6,
      won: true,
      irrelevant: 1,
      wrong: 1,
      reviewer2: 0,
      bigClues: 2,
      openingRecord: true,
      heavenlyHand: false,
      missed: 1,
    };
    expect(cardPoints(detail)).toBe(6 - 2 - 3);
    expect(bonusPoints(detail)).toBe(4 + 2 + 0);
    expect(missedPoints(detail)).toBe(-5);
    expect(cardPoints(detail) + bonusPoints(detail) + missedPoints(detail)).toBe(pointsFor(detail));
    expect(missedPoints({ ...NOTHING, role: 'captain', found: 3 })).toBe(0);
    expect(bonusPoints({ ...NOTHING, role: 'guesser', won: true })).toBe(3);
    expect(bonusPoints({ ...NOTHING, role: 'guesser', found: 3 })).toBe(0);
  });

  test('end with the win and the heavenly hand alone, the big clues and the opening record having risen with their cards', () => {
    expect(endPoints({ ...NOTHING, role: 'captain', won: true, bigClues: 2, openingRecord: true })).toBe(4);
    expect(endPoints({ ...NOTHING, role: 'guesser', won: true, openingRecord: true })).toBe(3);
    expect(endPoints({ ...NOTHING, role: 'captain', won: true, heavenlyHand: true, bigClues: 6 })).toBe(7);
    expect(endPoints({ ...NOTHING, role: 'guesser', won: true, heavenlyHand: true })).toBe(4);
    expect(endPoints({ ...NOTHING, role: 'guesser', found: 5 })).toBe(0);
  });
});
