// Academic ranks (docs/architecture.md#academic-ranks): a title that each account holds by the
// points of every game it has finished in a seat, shown beside the name in rooms and on the account
// page, and nowhere else. The points are those of a match's scoring (games/keywords/score.ts), so a
// game counts the same in a match and outside one, once; a withdrawn game counts for nothing. Ranks
// change nothing in the game, and points buy nothing.

export const RANKS = [
  'undergraduate',
  'master',
  'phd',
  'postdoc',
  'lecturer',
  'associate_professor',
  'professor',
  'academician',
] as const;
export type Rank = (typeof RANKS)[number];

// The points from which each rank is held. A game gives about 7 points to a regular player, who
// wins about half of their games: some 250 a month for two evenings a week, and a professor after
// about four months.
export const RANK_POINTS: Record<Rank, number> = {
  undergraduate: 0,
  master: 30,
  phd: 100,
  postdoc: 250,
  lecturer: 450,
  associate_professor: 700,
  professor: 1000,
  academician: 2000,
};

// The rank that these points hold. Points below zero, which revealing Reviewer 2 can bring, still
// make an undergraduate.
export function rankFor(points: number): Rank {
  let rank: Rank = 'undergraduate';
  for (const candidate of RANKS) if (points >= RANK_POINTS[candidate]) rank = candidate;
  return rank;
}

// The rank after the one these points hold, and how many more points it takes, or null at the top.
export function nextRank(points: number): { rank: Rank; points: number } | null {
  const next = RANKS[RANKS.indexOf(rankFor(points)) + 1];
  return next === undefined ? null : { rank: next, points: RANK_POINTS[next] - points };
}
