import { describe, expect, test } from 'vitest';
import { verdictFor } from './letters';
import type { GameResult } from './types';

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
