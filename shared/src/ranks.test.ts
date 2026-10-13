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
    expect(RANK_POINTS).toEqual({
      kindergarten: 0,
      primary: 30,
      middle_school: 80,
      high_school: 150,
      undergraduate: 300,
      master: 500,
      phd: 800,
      postdoc: 1200,
      lecturer: 1800,
      associate_professor: 2500,
      professor: 4000,
      academician: 6000,
      reviewer2: 10000,
    });
    for (const [below, rank] of RANKS.map((rank, i) => [RANKS[i - 1], rank] as const)) {
      if (below !== undefined) expect(rankFor(RANK_POINTS[rank] - 1), rank).toBe(below);
    }
    expect(rankFor(29)).toBe('kindergarten');
    expect(rankFor(299)).toBe('high_school');
    expect(rankFor(9999)).toBe('academician');
    expect(rankFor(10000)).toBe('reviewer2');
    expect(rankFor(10 ** 6)).toBe('reviewer2');
  });

  test('come at the pace the comments describe, for a player who made about 90 points a week', () => {
    const weeks = (rank: keyof typeof RANK_POINTS) => RANK_POINTS[rank] / 90;
    expect(weeks('primary') * 7).toBeCloseTo(2.3, 0);
    expect(weeks('undergraduate')).toBeCloseTo(3.3, 0);
    const months = (rank: keyof typeof RANK_POINTS) => (weeks(rank) * 12) / 52;
    expect(months('postdoc')).toBeCloseTo(3.1, 0);
    expect(months('professor')).toBeCloseTo(10.3, 0);
    expect(months('academician')).toBeCloseTo(15.4, 0);
    expect(months('reviewer2')).toBeCloseTo(25.6, 0);
  });

  test('make a kindergartner of points below zero', () => {
    expect(rankFor(-9)).toBe('kindergarten');
    expect(nextRank(-9)).toEqual({ rank: 'primary', points: RANK_POINTS.primary + 9 });
  });

  test('say how far the next rank is, and that there is none past the top', () => {
    expect(nextRank(0)).toEqual({ rank: 'primary', points: 30 });
    expect(nextRank(RANK_POINTS.professor)).toEqual({ rank: 'academician', points: 2000 });
    expect(nextRank(RANK_POINTS.academician)).toEqual({ rank: 'reviewer2', points: 4000 });
    expect(nextRank(RANK_POINTS.reviewer2)).toBeNull();
    expect(nextRank(RANK_POINTS.reviewer2 + 500)).toBeNull();
  });
});
