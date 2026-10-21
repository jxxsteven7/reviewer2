import type { Fate, ImpostorRole } from './types';

// How a player's game of the hidden word game went, as their record keeps it (PlayerResult.detail
// on the server) and their points are counted from (docs/games/impostor.md#points): the round they
// went out in, or null when they lasted to the end; how many rounds they began in the game; their
// votes for someone, how many of those were for a Reviewer 2 or the PI (`hits`), and how many
// voted out a student (`wrong`); their abstentions, and the votes and descriptions whose time ran
// out on them; how many times others reported them; the reports they made, and how many of those
// failed; and their guess of the students' word after they were voted out, if any.
export interface ImpostorDetail {
  out: number | null;
  rounds: number;
  votes: number;
  hits: number;
  wrong: number;
  abstained: number;
  missedVotes: number;
  missedLines: number;
  reported: number;
  reports: number;
  failedReports: number;
  comeback: 'right' | 'wrong' | null;
}

export const DETAIL_COUNTS = [
  'rounds',
  'votes',
  'hits',
  'wrong',
  'abstained',
  'missedVotes',
  'missedLines',
  'reported',
  'reports',
  'failedReports',
] as const;

export const emptyDetail = (): ImpostorDetail => ({
  out: null,
  rounds: 0,
  votes: 0,
  hits: 0,
  wrong: 0,
  abstained: 0,
  missedVotes: 0,
  missedLines: 0,
  reported: 0,
  reports: 0,
  failedReports: 0,
  comeback: null,
});

// The points of a win, by role, and of the rest, as the maintainers set them for the beta.
export const WIN_POINTS: Readonly<Record<ImpostorRole, number>> = { student: 3, reviewer2: 5, pi: 6 };
export const POINTS = {
  // Winning while still in the game, a vote for a Reviewer 2 or the PI, and the students' word
  // guessed after being voted out.
  lasted: 1,
  hit: 1,
  comeback: 2,
  // A vote that put a student out, a student voted out, a Reviewer 2 or a PI out in the first round,
  // a vote or a description whose time ran out, a wrong guess, going out for breaking the rules,
  // and a report that failed.
  wrong: -1,
  studentOut: -1,
  firstRound: -2,
  missedVote: -1,
  missedLine: -3,
  wrongGuess: -1,
  violation: -3,
  failedReport: -1,
} as const;

// A player's points for a game: what winning brings their role, and the rest, from how their game
// went.
export function pointsOf(role: ImpostorRole, won: boolean, fate: Fate, detail: ImpostorDetail): number {
  let points = 0;
  if (won) points += WIN_POINTS[role] + (fate === 'alive' ? POINTS.lasted : 0);
  points += detail.hits * POINTS.hit + detail.wrong * POINTS.wrong;
  if (detail.comeback === 'right') points += POINTS.comeback;
  if (detail.comeback === 'wrong') points += POINTS.wrongGuess;
  if (role === 'student' && fate === 'voted_out') points += POINTS.studentOut;
  if (role !== 'student' && detail.out === 1 && (fate === 'voted_out' || fate === 'violation')) {
    points += POINTS.firstRound;
  }
  if (fate === 'violation') points += POINTS.violation;
  points += detail.missedVotes * POINTS.missedVote + detail.missedLines * POINTS.missedLine;
  points += detail.failedReports * POINTS.failedReport;
  return points;
}
