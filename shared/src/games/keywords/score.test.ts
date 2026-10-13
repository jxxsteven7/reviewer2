import { describe, expect, test } from 'vitest';
import { bigClueCards, POINTS, pointsFor, type KeywordsScoreDetail } from './score';

// The points of a game (docs/games/keywords.md#matches): what a group's own cards and a win give
// everyone in the group, what a wrong card costs every student and, more, the PI, and the bonuses.

const NOTHING = { found: 0, won: false, irrelevant: 0, wrong: 0, reviewer2: 0 };
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

  test('give everyone 1 for the opening record, and a student 1 and the PI 3 for the heavenly hand', () => {
    expect(student({ found: 3, openingRecord: true })).toBe(4);
    expect(pi({ found: 3, openingRecord: true })).toBe(4);
    expect(student({ found: 9, won: true, openingRecord: true, heavenlyHand: true })).toBe(9 + 3 + 1 + 1);
    expect(pi({ found: 9, won: true, bigClues: 6, openingRecord: true, heavenlyHand: true })).toBe(9 + 4 + 6 + 1 + 3);
  });

  test("read a detail from before the PI's stakes as a student's, without bonuses", () => {
    expect(pointsFor({ found: 4, won: true, irrelevant: 1, wrong: 0, reviewer2: 1 })).toBe(4 + 3 - 1 - 3);
  });
});
