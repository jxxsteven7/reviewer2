import { otherTeam, type GameResult, type Team } from './types';

// The verdict of the decision letter that a group gets at the end of a game (docs/rules/display.md). The
// winner is accepted, and the more cards the other group still had to find, the better the slot:
// an oral with 4 or more, a spotlight with 2 or 3, a poster with 1. The loser is desk rejected
// for revealing Reviewer 2, and rejected when the other group found all its cards first. A game
// that the chair withdrew is withdrawn for everyone. The client writes the letters; the server
// keeps the verdict on the record of each player with an account.
export const VERDICTS = ['oral', 'spotlight', 'poster', 'deskReject', 'reject', 'withdrawn'] as const;
export type Verdict = (typeof VERDICTS)[number];

export function verdictFor(result: GameResult, remaining: Record<Team, number>, team: Team): Verdict {
  if (result.reason === 'withdrawn' || result.winner === null) return 'withdrawn';
  if (result.winner !== team) return result.reason === 'reviewer2' ? 'deskReject' : 'reject';
  const left = remaining[otherTeam(team)];
  if (left >= 4) return 'oral';
  return left >= 2 ? 'spotlight' : 'poster';
}
