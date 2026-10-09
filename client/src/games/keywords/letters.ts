import { otherTeam, type GameResult, type Team } from '@reviewer2/shared';

// The decision letters at the end of a game (DecisionLetter.vue), one for each group. The winner
// is accepted, and the more cards the other group still had to find, the better the slot: an oral
// with 4 or more, a spotlight with 2 or 3, a poster with 1. The loser is desk rejected for
// revealing Reviewer 2, and rejected when the other group found all its cards first. A game that
// the chair withdrew is withdrawn for everyone.
export type Verdict = 'oral' | 'spotlight' | 'poster' | 'deskReject' | 'reject' | 'withdrawn';

// How many letters each verdict has to choose from, under game.letter.bodies in the locale files,
// numbered from 1.
export const LETTERS_PER_VERDICT = 3;

export function verdictFor(result: GameResult, remaining: Record<Team, number>, team: Team): Verdict {
  if (result.reason === 'withdrawn' || result.winner === null) return 'withdrawn';
  if (result.winner !== team) return result.reason === 'reviewer2' ? 'deskReject' : 'reject';
  const left = remaining[otherTeam(team)];
  if (left >= 4) return 'oral';
  return left >= 2 ? 'spotlight' : 'poster';
}

// Where a group's letters are, under game.letter.bodies in the locale files. The loser's and a
// withdrawn game's go by the verdict alone. The winner's also go by how the game ended: a group
// that found every keyword is written to about its finish, and a group whose rivals revealed
// Reviewer 2 about its luck, since it may not have found a keyword at all.
export function lettersFor(verdict: Verdict, result: GameResult): string {
  const accepted = verdict === 'oral' || verdict === 'spotlight' || verdict === 'poster';
  return accepted ? `${verdict}.${result.reason}` : verdict;
}

// Which of its verdict's letters a group reads, from 1. It comes from the game's ID, so everyone
// in the group reads the same one, on every page and after every refresh, and the next game draws
// again. `team` is null for the one letter of a withdrawn game. The hash is FNV-1a.
export function letterNumber(gameId: string, team: Team | null, verdict: Verdict): number {
  const key = `${gameId}:${team ?? 'all'}:${verdict}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % LETTERS_PER_VERDICT) + 1;
}
