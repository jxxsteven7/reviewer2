import { describe, expect, test } from 'vitest';
import { POINTS, pointsFor } from './score';

// The points of a game (docs/games/keywords.md#matches): what a group's own cards and a win give
// everyone in the group, and what a wrong card costs the one who revealed it.

describe('the points of a game', () => {
  test('give 1 for each own card found and 3 for winning', () => {
    expect(pointsFor({ found: 4, won: true, irrelevant: 0, wrong: 0, reviewer2: 0 })).toBe(7);
    expect(pointsFor({ found: 0, won: false, irrelevant: 0, wrong: 0, reviewer2: 0 })).toBe(0);
  });

  test("cost 1 for an irrelevant paper, 2 for the other group's card and 3 for Reviewer 2", () => {
    expect(POINTS).toEqual({ found: 1, won: 3, irrelevant: -1, wrong: -2, reviewer2: -3 });
    expect(pointsFor({ found: 2, won: false, irrelevant: 1, wrong: 0, reviewer2: 0 })).toBe(1);
    expect(pointsFor({ found: 2, won: false, irrelevant: 0, wrong: 1, reviewer2: 0 })).toBe(0);
    expect(pointsFor({ found: 2, won: false, irrelevant: 0, wrong: 0, reviewer2: 1 })).toBe(-1);
    expect(pointsFor({ found: 0, won: false, irrelevant: 2, wrong: 1, reviewer2: 1 })).toBe(-7);
  });
});
