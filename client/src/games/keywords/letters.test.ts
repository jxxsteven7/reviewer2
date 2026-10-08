import type { GameResult } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { letterNumber, LETTERS_PER_VERDICT, verdictFor } from './letters';

const found: GameResult = { winner: 'red', reason: 'found' };
const reviewer2: GameResult = { winner: 'red', reason: 'reviewer2' };
const withdrawn: GameResult = { winner: null, reason: 'withdrawn' };

describe('the verdict', () => {
  test('accepts the winner in a slot that goes by how many cards the other group still had', () => {
    for (const result of [found, reviewer2]) {
      expect(verdictFor(result, { red: 0, blue: 8 }, 'red')).toBe('oral');
      expect(verdictFor(result, { red: 0, blue: 4 }, 'red')).toBe('oral');
      expect(verdictFor(result, { red: 0, blue: 3 }, 'red')).toBe('spotlight');
      expect(verdictFor(result, { red: 2, blue: 2 }, 'red')).toBe('spotlight');
      expect(verdictFor(result, { red: 0, blue: 1 }, 'red')).toBe('poster');
    }
  });

  test('desk rejects the group that revealed Reviewer 2, and rejects the one that was beaten to it', () => {
    expect(verdictFor(reviewer2, { red: 5, blue: 1 }, 'blue')).toBe('deskReject');
    expect(verdictFor(found, { red: 0, blue: 1 }, 'blue')).toBe('reject');
  });

  test('withdraws a game the chair ended, for both groups', () => {
    expect(verdictFor(withdrawn, { red: 3, blue: 1 }, 'red')).toBe('withdrawn');
    expect(verdictFor(withdrawn, { red: 3, blue: 1 }, 'blue')).toBe('withdrawn');
  });
});

describe('the letter', () => {
  test('is the same for a group whenever it is asked for, and one of those there are', () => {
    expect(letterNumber('game-1', 'red', 'oral')).toBe(letterNumber('game-1', 'red', 'oral'));
    const drawn = new Set<number>();
    for (let game = 0; game < 50; game += 1) {
      for (const team of ['red', 'blue', null] as const) drawn.add(letterNumber(`game-${game}`, team, 'reject'));
    }
    expect([...drawn].sort()).toEqual(Array.from({ length: LETTERS_PER_VERDICT }, (_, i) => i + 1));
  });
});
