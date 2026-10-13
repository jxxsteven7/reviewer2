import type { GameResult, Team, Verdict } from '@reviewer2/shared';
import { fnv1a } from '../../core/hash';

// The decision letters at the end of a game (DecisionLetter.vue), one for each group. Which
// verdict a group gets is shared with the server, which keeps it on each player's record
// (shared/src/games/keywords/letters.ts); which letter of that verdict the group reads is the
// client's alone.
export { verdictFor, type Verdict } from '@reviewer2/shared';

// How many letters each verdict has to choose from, under game.letter.bodies in the locale files,
// numbered from 1.
export const LETTERS_PER_VERDICT = 3;

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
// again. `team` is null for the one letter of a withdrawn game.
export function letterNumber(gameId: string, team: Team | null, verdict: Verdict): number {
  return (fnv1a(`${gameId}:${team ?? 'all'}:${verdict}`) % LETTERS_PER_VERDICT) + 1;
}
