import type { GameResult } from '@reviewer2/shared/keywords';
import { describe, expect, test } from 'vitest';
import { letterNumber, LETTERS_PER_VERDICT, lettersFor } from './letters';

const found: GameResult = { winner: 'red', reason: 'found' };
const reviewer2: GameResult = { winner: 'red', reason: 'reviewer2' };
const withdrawn: GameResult = { winner: null, reason: 'withdrawn' };

describe('the letter', () => {
  test("is written to the winner about its finish, or about the other group's Reviewer 2", () => {
    for (const verdict of ['oral', 'spotlight', 'poster'] as const) {
      expect(lettersFor(verdict, found)).toBe(`${verdict}.found`);
      expect(lettersFor(verdict, reviewer2)).toBe(`${verdict}.reviewer2`);
    }
    expect(lettersFor('reject', found)).toBe('reject');
    expect(lettersFor('deskReject', reviewer2)).toBe('deskReject');
    expect(lettersFor('withdrawn', withdrawn)).toBe('withdrawn');
  });

  test('is the same for a group whenever it is asked for, and one of those there are', () => {
    expect(letterNumber('game-1', 'red', 'oral')).toBe(letterNumber('game-1', 'red', 'oral'));
    const drawn = new Set<number>();
    for (let game = 0; game < 50; game += 1) {
      for (const team of ['red', 'blue', null] as const) drawn.add(letterNumber(`game-${game}`, team, 'reject'));
    }
    expect([...drawn].sort()).toEqual(Array.from({ length: LETTERS_PER_VERDICT }, (_, i) => i + 1));
  });
});
