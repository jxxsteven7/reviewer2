import type { ClueRecord, GameResult, Team } from './types';

// The titles that a group earns together in a game (docs/games/keywords.md#titles), judged from the
// record of the clues and the guesses: the server judges them at the end of a game, and again from
// the log of a kept game when the rules change (server/src/games/keywords/results.ts), and the page
// as each card comes, to call them out to the room (client/src/games/keywords/useGroupCalls.ts).
// Two pairs: the heavenly hand outdoes the opening record, and the instant desk reject the fall at
// the first hurdle, so a group gets one of each pair at most.

// The game's titles (docs/architecture.md#titles), which a game brings the players with accounts
// whose game goes on the record, each time they earn one: a PI who gives no clue in time misses the
// deadline, one whose last-second clue the students follow to the letter, and a student who finds
// one of the group's cards in the last seconds of the guesses, is a deadline hero; a group's first
// clue may make the opening record, or win the game outright for the heavenly hand, and a group
// whose first card is Reviewer 2 is desk rejected on the spot, or falls at the first hurdle when
// Reviewer 2 comes later in the turn of its first clue.
export const KEYWORDS_TITLES = [
  'missed_deadline',
  'deadline_hero',
  'opening_record',
  'heavenly_hand',
  'instant_reject',
  'first_turn_reject',
] as const;

// The least number of the first clue that can make the opening record.
export const OPENING_RECORD = 4;

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

// The turn in which a group's students revealed their first card of the game: that of the group's
// first clue, unless their time ran out before they revealed one in it. Null before they have.
export const firstCardTurn = (game: Played, team: Team): ClueRecord | null =>
  game.history.find((record) => record.team === team && record.guesses.length > 0) ?? null;

// Whether the first card that a group's students revealed in the game was Reviewer 2: an instant
// desk reject.
export function instantReject(game: Played, team: Team): boolean {
  return firstCardTurn(game, team)?.guesses[0]?.color === 'reviewer2';
}

// Whether a group's students revealed Reviewer 2 in the turn of the group's first clue, but not as
// the first card: the group fell at the first hurdle.
export function firstTurnReject(game: Played, team: Team): boolean {
  const first = firstClue(game, team);
  return first !== null && first.guesses.findIndex((guess) => guess.color === 'reviewer2') > 0;
}
