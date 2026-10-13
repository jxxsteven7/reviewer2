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

// The points from which each rank is held. A regular player, who plays about four evenings a
// week and wins about half of their games, makes about 90 points a week. The first ranks come
// fast, to welcome a newcomer: primary school in the first day or two, and an undergraduate after
// about three weeks. The later ones take the long way: a postdoc after about three months, a
// professor after about ten, an academician after about a year and a half, and Reviewer 2, the
// top, after about two years.
export const RANK_POINTS: Record<Rank, number> = {
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
