import { type GamePoints } from '@reviewer2/shared';
import {
  endPoints,
  openingRecord,
  POINTS,
  revealBonus,
  revealPoints,
  type CardColor,
  type CardView,
  type KeywordsRoomData,
  type KeywordsScoreDetail,
  type KeywordsView,
  type Team,
} from '@reviewer2/shared/keywords';
import type { Float } from '../../core/components/ScoreFloat.vue';

// The points that rise from the board as a game goes (docs/games/keywords.md#points-as-they-come):
// what a revealed card does to each player's points, the bonus it brings included, and what the end
// of the game adds to them. The numbers come from what everyone sees, the card's color, the group
// whose students revealed it, each player's role and the record of the clues, priced as the server
// prices them (revealPoints() and revealBonus() in the shared rules), and from the points that the
// server sends with the end of the game.

// The one card that a board has face up and the board before it didn't: null when there is none,
// when there are several, as on the board that catches a page up, and when the boards aren't the
// same. The card that turns over (useTurnedCard.ts) and the points that rise from it are found by
// the same rule.
export function turnedBetween(before: readonly CardView[], after: readonly CardView[]): number | null {
  if (before.length !== after.length) return null;
  const turned = after.flatMap((card, index) => (card.revealed && !before[index]?.revealed ? [index] : []));
  return turned.length === 1 ? (turned[0] as number) : null;
}

// A card that has just been revealed, between two snapshots of a game in a row: the one card that
// the later has face up and the earlier didn't, its color, and the group whose students revealed it.
// Null when there is none, when there are several, and across a pause, which hides the board, or
// another game.
export function revealedBetween(
  before: KeywordsView,
  after: KeywordsView,
): { card: number; color: CardColor; by: Team } | null {
  if (before.gameId !== after.gameId || before.paused || after.paused) return null;
  const card = turnedBetween(before.cards, after.cards);
  if (card === null) return null;
  const color = after.cards[card]?.color;
  const by = after.history.find((record) => record.guesses.some((guess) => guess.card === card))?.team;
  return color && by ? { card, color, by } : null;
}

// Whether a snapshot ends the game: the one before it had no result and this one has one, with a
// group that won. A game that the chair withdrew brings no points, and nothing rises.
export const endsBetween = (before: KeywordsView, after: KeywordsView): boolean =>
  before.gameId === after.gameId && before.result === null && (after.result?.winner ?? null) !== null;

// A number as it rises: with its sign. The minus is the hyphen-minus, which the hand that sets the
// numbers has (fonts.ts); the true minus sign it lacks would come in another font.
export const signed = (points: number): string => (points > 0 ? `+${points}` : `-${Math.abs(points)}`);

// Where a player plays as the scores count them: the group of the seat they are in, and their role
// in it, which is the PI's for whoever has seen the key in this game (match.ts on the server).
function placeOf(data: KeywordsRoomData, playerId: string): { team: Team; role: 'captain' | 'guesser' } | null {
  const team = data.seats[playerId]?.team ?? null;
  if (team === null) return null;
  return { team, role: data.keyViewers.includes(playerId) ? 'captain' : 'guesser' };
}

// What a revealed card does to the viewer's points, by the group they play for in this game and
// their role, and to the points of each player in a group's seat, by player ID, the card's price and
// the bonus it brings as one number: only what changes something, and nothing for anyone in a game
// that brings no points. `before` and `after` are the game as it stood on either side of the card.
export function revealFloats(
  data: KeywordsRoomData,
  me: string | null,
  reveal: { color: CardColor; by: Team },
  before: KeywordsView,
  after: KeywordsView,
): { mine: Float | null; players: Map<string, Float> } {
  const pointsFor = (id: string, team: Team, role: 'captain' | 'guesser') =>
    revealPoints(reveal.color, reveal.by, team, role) + revealBonus(before, after, reveal.by, team, role, id);
  const players = new Map<string, Float>();
  for (const id of Object.keys(data.seats)) {
    const place = placeOf(data, id);
    const points = place ? pointsFor(id, place.team, place.role) : 0;
    if (place && points !== 0) players.set(id, { text: signed(points), tint: place.team });
  }
  let mine: Float | null = null;
  if (me !== null && data.side !== null) {
    const points = pointsFor(me, data.side, data.keyViewers.includes(me) ? 'captain' : 'guesser');
    if (points !== 0) mine = { text: signed(points), tint: data.side };
  }
  return { mine, players };
}

// What the end of the game adds to the points of the viewer and of each player in a group's seat:
// the win and the heavenly hand (endPoints()), as the server scored them, for those who have any;
// the big clues and the opening record rose with their cards. `risen` names the groups whose
// opening record rose with its card in front of the viewer: for a student of such a group that has
// the heavenly hand instead by the end, which outdoes it, the end's number is that point less, so
// that what rose adds up to the record, which has no point for the opening record.
export function endFloats(
  data: KeywordsRoomData,
  me: string | null,
  points: readonly GamePoints[],
  risen: ReadonlySet<Team> = new Set(),
): { mine: Float | null; players: Map<string, Float> } {
  const players = new Map<string, Float>();
  let mine: Float | null = null;
  for (const { playerId, detail } of points) {
    if (detail === undefined) continue;
    const scored = detail as KeywordsScoreDetail;
    const team = data.seats[playerId]?.team ?? null;
    const side = playerId === me && data.side !== null ? data.side : team;
    const outdone = side !== null && risen.has(side) && scored.role === 'guesser' && scored.heavenlyHand;
    const bonus = endPoints(scored) - (outdone ? POINTS.guesser.openingRecord : 0);
    if (bonus <= 0) continue;
    if (team !== null) players.set(playerId, { text: signed(bonus), tint: team });
    if (playerId === me && data.side !== null) mine = { text: signed(bonus), tint: data.side };
  }
  return { mine, players };
}

// Whether the card revealed last made a group's opening record, between two snapshots of a game in
// a row: the one card that brings the point of it (revealBonus()), which the heavenly hand may
// outdo by the end (endFloats()).
export const openingRose = (before: KeywordsView, after: KeywordsView, by: Team): boolean =>
  openingRecord(after, by) && !openingRecord(before, by);
