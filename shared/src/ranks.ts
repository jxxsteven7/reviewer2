// Academic ranks (docs/architecture.md#academic-ranks): a title that each account holds by the
// points of every game it has finished in a seat, shown beside the name in rooms and on the account
// page, and nowhere else. The points are those of a match's scoring (games/keywords/score.ts), so a
// game counts the same in a match and outside one, once; a withdrawn game counts for nothing. Ranks
// change nothing in the game, and points buy nothing. The points of every game an account plays
// add up, whichever game they come from: a new game calibrates what a game gives to about what the
// first one gives.

export const RANKS = [
  'kindergarten',
  'primary',
  'middle_school',
  'high_school',
  'undergraduate',
  'master',
  'phd',
  'postdoc',
  'lecturer',
  'associate_professor',
  'professor',
  'academician',
  'reviewer2',
] as const;
export type Rank = (typeof RANKS)[number];

// The points from which each rank is held. A game gives about 7 points to a regular player, who
// wins about half of their games. The first ranks come fast, to welcome a newcomer: primary school
// in the second game, and an undergraduate after some 15. The later ones take the long way, for two
// evenings a week: a professor after about seven months, an academician after about a year, and
// Reviewer 2, the top, after about two years.
export const RANK_POINTS: Record<Rank, number> = {
  kindergarten: 0,
  primary: 10,
  middle_school: 30,
  high_school: 60,
  undergraduate: 100,
  master: 180,
  phd: 300,
  postdoc: 500,
  lecturer: 800,
  associate_professor: 1200,
  professor: 1800,
  academician: 3000,
  reviewer2: 6000,
};

// The rank that these points hold. Points below zero, which revealing Reviewer 2 can bring, still
// make a kindergartner.
export function rankFor(points: number): Rank {
  let rank: Rank = 'kindergarten';
  for (const candidate of RANKS) if (points >= RANK_POINTS[candidate]) rank = candidate;
  return rank;
}

// The rank after the one these points hold, and how many more points it takes, or null at the top.
export function nextRank(points: number): { rank: Rank; points: number } | null {
  const next = RANKS[RANKS.indexOf(rankFor(points)) + 1];
  return next === undefined ? null : { rank: next, points: RANK_POINTS[next] - points };
}
