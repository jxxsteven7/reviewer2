import { describe, expect, test } from 'vitest';
import { nextRank, RANK_POINTS, RANKS, rankFor } from './ranks';

describe('academic ranks', () => {
  test('go up with the points, from the undergraduate to the academician', () => {
    const thresholds = RANKS.map((rank) => RANK_POINTS[rank]);
    expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b));
    expect(RANK_POINTS.undergraduate).toBe(0);
    for (const rank of RANKS) {
      expect(rankFor(RANK_POINTS[rank])).toBe(rank);
      expect(rankFor(RANK_POINTS[rank] + 1)).toBe(rank);
    }
    expect(rankFor(RANK_POINTS.master - 1)).toBe('undergraduate');
    expect(rankFor(10 ** 6)).toBe('academician');
  });

  test('make an undergraduate of points below zero', () => {
    expect(rankFor(-9)).toBe('undergraduate');
    expect(nextRank(-9)).toEqual({ rank: 'master', points: RANK_POINTS.master + 9 });
  });

  test('say how far the next rank is, and that there is none past the top', () => {
    expect(nextRank(0)).toEqual({ rank: 'master', points: 30 });
    expect(nextRank(RANK_POINTS.professor)).toEqual({ rank: 'academician', points: 1000 });
    expect(nextRank(RANK_POINTS.academician)).toBeNull();
    expect(nextRank(RANK_POINTS.academician + 500)).toBeNull();
  });
});
