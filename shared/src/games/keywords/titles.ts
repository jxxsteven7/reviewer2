import { OPENING_RECORD } from './score';
import type { ClueRecord, GameResult, Team } from './types';

// The titles that a group earns together in a game (docs/games/keywords.md#titles), judged from the
// record of the clues and the guesses: the server judges them at the end of a game, and again from
// the log of a kept game when the rules change (server/src/games/keywords/results.ts), and the page
// as each card comes, to call them out to the room (client/src/games/keywords/useGroupCalls.ts).
// Two pairs: the heavenly hand outdoes the opening record, and the instant desk reject the fall at
// the first hurdle, so a group gets one of each pair at most.

// What the titles are judged from: the record so far, and the result once the game is over.
export interface Played {
  history: readonly ClueRecord[];
  result: GameResult | null;
}

// A group's first clue of the game: its first turn with a clue, since a turn whose time ran out
// before the clue had none. Null before the group has given one.
export const firstClue = (game: Played, team: Team): ClueRecord | null =>
  game.history.find((record) => record.team === team && record.word !== null) ?? null;

// Whether a group won in the turn of its first clue, which is then the last turn of the game.
export function heavenlyHand(game: Played, team: Team): boolean {
  const { result } = game;
  return result?.winner === team && result.reason === 'found' && game.history.at(-1) === firstClue(game, team);
}

// Whether a group's first clue made the opening record: its number was OPENING_RECORD or more, and
// the students found that many of the group's cards with it before they revealed anything else. A
// clue of 0 or "unlimited" names no number. A group with the heavenly hand has outdone it, and has
// no opening record.
export function openingRecord(game: Played, team: Team): boolean {
  const first = firstClue(game, team);
  if (!first || typeof first.count !== 'number' || first.count < OPENING_RECORD) return false;
  const opening = first.guesses.slice(0, first.count);
  return opening.length === first.count && opening.every((guess) => guess.color === team) && !heavenlyHand(game, team);
}

// Whether the first card that a group's students revealed in the game was Reviewer 2: an instant
// desk reject. The first card comes in the turn of the group's first clue.
export function instantReject(game: Played, team: Team): boolean {
  return firstClue(game, team)?.guesses[0]?.color === 'reviewer2';
}

// Whether a group's students revealed Reviewer 2 in the turn of the group's first clue, but not as
// the first card: the group fell at the first hurdle.
export function firstTurnReject(game: Played, team: Team): boolean {
  const first = firstClue(game, team);
  return first !== null && first.guesses.findIndex((guess) => guess.color === 'reviewer2') > 0;
}
