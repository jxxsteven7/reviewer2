import { describe, expect, test } from 'vitest';
import { nextRank, RANK_POINTS, RANKS, rankFor } from './ranks';

describe('academic ranks', () => {
  test('go up with the points, from the kindergartner to Reviewer 2', () => {
    const thresholds = RANKS.map((rank) => RANK_POINTS[rank]);
    expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b));
    expect(RANKS).toHaveLength(13);
    expect(RANK_POINTS.kindergarten).toBe(0);
    for (const rank of RANKS) {
      expect(rankFor(RANK_POINTS[rank])).toBe(rank);
      expect(rankFor(RANK_POINTS[rank] + 1)).toBe(rank);
    }
    expect(rankFor(RANK_POINTS.primary - 1)).toBe('kindergarten');
    expect(rankFor(RANK_POINTS.undergraduate - 1)).toBe('high_school');
    expect(rankFor(RANK_POINTS.reviewer2 - 1)).toBe('academician');
    expect(rankFor(10 ** 6)).toBe('reviewer2');
  });

  test('come at the pace the comments promise: a game is worth about 7 points', () => {
    const games = (rank: keyof typeof RANK_POINTS) => Math.ceil(RANK_POINTS[rank] / 7);
    expect(games('primary')).toBe(2);
    expect(games('undergraduate')).toBe(15);
    // Two evenings a week, about 36 games a month.
    const months = (rank: keyof typeof RANK_POINTS) => games(rank) / 36;
    expect(months('professor')).toBeCloseTo(7.2, 0);
    expect(months('academician')).toBeCloseTo(11.9, 0);
    expect(months('reviewer2')).toBeCloseTo(23.8, 0);
  });

  test('make a kindergartner of points below zero', () => {
    expect(rankFor(-9)).toBe('kindergarten');
    expect(nextRank(-9)).toEqual({ rank: 'primary', points: RANK_POINTS.primary + 9 });
  });

  test('say how far the next rank is, and that there is none past the top', () => {
    expect(nextRank(0)).toEqual({ rank: 'primary', points: 10 });
    expect(nextRank(RANK_POINTS.professor)).toEqual({ rank: 'academician', points: 1200 });
    expect(nextRank(RANK_POINTS.academician)).toEqual({ rank: 'reviewer2', points: 3000 });
    expect(nextRank(RANK_POINTS.reviewer2)).toBeNull();
    expect(nextRank(RANK_POINTS.reviewer2 + 500)).toBeNull();
  });
});
