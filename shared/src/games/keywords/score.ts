import type { Played } from './titles';
import { openingRecord } from './titles';
import type { CardColor, ClueRecord, Team } from './types';

// How a game of a match is scored, for each player (docs/games/keywords.md#matches). The server
// adds the points up; the client shows them, with this detail of where they came from, and with
// each card as it is revealed (revealPoints() and revealBonus()).
//
// The PI, who gives the clues, plays for higher stakes than the students:
//
// - Every card that a group's own students reveal of its own color gives everyone who played for
//   the group in that game 1 point, the PI included. A card that the other group reveals for it
//   gives nothing.
// - The group that wins gives each student 3 more, and the PI 4.
// - Every irrelevant paper, card of the other group and Reviewer 2 that the group's students
//   reveal costs each student of the group 1, 2 and 3 points, whoever of them revealed it, and the
//   PI 2, 3 and 5.
// - A big clue: the PI who gave a clue with which the students found 4 of the group's cards or
//   more gets 1 point for each from the fourth on.
// - The opening record: a group whose first clue of the game had a number of 4 or more, and whose
//   students found that many of its cards with it before anything else, gives each student 1 more
//   point; the PI has the big clue for it.
// - The heavenly hand: a group that wins in the turn of its first clue gives each student 1 more
//   point, and the PI 3. It outdoes the opening record, which the group then doesn't have.
// - A missed deadline: a PI whose time for the clue runs out loses 5 points each time, and the
//   students nothing.
//
// The bonuses add up: a heavenly hand comes with the win, and usually with a big clue.
export const POINTS = {
  guesser: { found: 1, won: 3, irrelevant: -1, wrong: -2, reviewer2: -3, openingRecord: 1, heavenlyHand: 1 },
  captain: { found: 1, won: 4, irrelevant: -2, wrong: -3, reviewer2: -5, openingRecord: 0, heavenlyHand: 3 },
  bigClue: 1,
  missed: -5,
} as const;

// A clue makes a big clue once the students find this many of the group's cards with it.
export const BIG_CLUE = 4;
// The least number of the first clue that can make the opening record.
export const OPENING_RECORD = 4;

// The cards found with one clue that count for a big clue: those from the fourth on.
export const bigClueCards = (found: number): number => Math.max(0, found - BIG_CLUE + 1);

// Where a player's points in a game came from.
export interface KeywordsScoreDetail {
  // Whether the player was the group's PI, who has seen the key, or one of its students.
  role: 'captain' | 'guesser';
  // The own cards that the group's students found.
  found: number;
  won: boolean;
  // The irrelevant papers, the cards of the other group, and Reviewer 2, that the group's students
  // revealed.
  irrelevant: number;
  wrong: number;
  reviewer2: number;
  // The PI's alone: the cards that their clues found from the fourth on, one point each.
  bigClues: number;
  // The PI's alone: the turns in which their time for the clue ran out, 5 points each.
  missed: number;
  // Whether the group's first clue made the opening record, and whether the group won in its turn.
  openingRecord: boolean;
  heavenlyHand: boolean;
}

// The points of the cards that the group's students revealed, and those that the game adds at its
// end: the win, the big clues, the opening record and the heavenly hand.
export function cardPoints(detail: KeywordsScoreDetail): number {
  const prices = POINTS[detail.role];
  return (
    detail.found * prices.found +
    detail.irrelevant * prices.irrelevant +
    detail.wrong * prices.wrong +
    detail.reviewer2 * prices.reviewer2
  );
}

export function bonusPoints(detail: KeywordsScoreDetail): number {
  const prices = POINTS[detail.role];
  return (
    (detail.won ? prices.won : 0) +
    detail.bigClues * POINTS.bigClue +
    (detail.openingRecord ? prices.openingRecord : 0) +
    (detail.heavenlyHand ? prices.heavenlyHand : 0)
  );
}

// What the PI's missed deadlines cost them.
export const missedPoints = (detail: KeywordsScoreDetail): number =>
  detail.missed > 0 ? detail.missed * POINTS.missed : 0;

export const pointsFor = (detail: KeywordsScoreDetail): number =>
  cardPoints(detail) + bonusPoints(detail) + missedPoints(detail);

// What the end of the game adds to a player's points, as the page shows it when the game ends
// (docs/games/keywords.md#points-as-they-come): the win and the heavenly hand. The big clues and
// the opening record rose with the cards that brought them (revealBonus()).
export function endPoints(detail: KeywordsScoreDetail): number {
  const prices = POINTS[detail.role];
  return (detail.won ? prices.won : 0) + (detail.heavenlyHand ? prices.heavenlyHand : 0);
}

// What one revealed card does to the points of a player who plays for `team` in `role`, when the
// students of the group `by` revealed it: what the card adds to cardPoints() of the player's
// detail. Only the group whose students revealed it gains or loses, so a card that the other group
// reveals is 0, whatever its color.
export function revealPoints(color: CardColor, by: Team, team: Team, role: 'captain' | 'guesser'): number {
  if (by !== team) return 0;
  const prices = POINTS[role];
  if (color === team) return prices.found;
  if (color === 'neutral') return prices.irrelevant;
  if (color === 'reviewer2') return prices.reviewer2;
  return prices.wrong;
}

// The bonus that the card revealed last brings a player who plays for the group `by`, whose
// students revealed it, in `role`, as the game stood before the card and as it stands after: for
// the PI, a point of the big clue with each of the group's cards that the clue finds from the
// fourth on; for a student, the point of the opening record with the card that makes it. A card
// that the other group reveals brings nothing.
export function revealBonus(before: Played, after: Played, by: Team, team: Team, role: 'captain' | 'guesser'): number {
  if (by !== team) return 0;
  const record = after.history.at(-1) as ClueRecord | undefined;
  if (record === undefined || record.team !== by || record.guesses.at(-1)?.color !== by) return 0;
  if (role === 'captain') {
    const found = record.guesses.filter((guess) => guess.color === by).length;
    return found >= BIG_CLUE ? POINTS.bigClue : 0;
  }
  return openingRecord(after, by) && !openingRecord(before, by) ? POINTS.guesser.openingRecord : 0;
}
