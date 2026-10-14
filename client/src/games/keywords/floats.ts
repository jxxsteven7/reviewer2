import {
  bonusPoints,
  revealPoints,
  type CardColor,
  type GamePoints,
  type KeywordsRoomData,
  type KeywordsScoreDetail,
  type KeywordsView,
  type Team,
} from '@reviewer2/shared';
import type { Float } from '../../core/components/ScoreFloat.vue';

// The points that rise from the board as a game goes (docs/games/keywords.md#points-as-they-come):
// what a revealed card does to each player's points, and what the end of the game adds to them. The
// numbers come from what everyone sees, the card's color, the group whose students revealed it and
// each player's role, priced as the server prices them (revealPoints() in the shared rules), and
// from the points that the server sends with the end of the game.

// A card that has just been revealed, between two snapshots of a game in a row: the one card that
// the later has face up and the earlier didn't, its color, and the group whose students revealed it.
// Null when there is none, when there are several, as in the snapshot that catches a page up, and
// across a pause, which hides the board, or another game.
export function revealedBetween(
  before: KeywordsView,
  after: KeywordsView,
): { card: number; color: CardColor; by: Team } | null {
  if (before.gameId !== after.gameId || before.paused || after.paused) return null;
  if (before.cards.length !== after.cards.length) return null;
  const turned = after.cards.flatMap((card, index) => (card.revealed && !before.cards[index]?.revealed ? [index] : []));
  if (turned.length !== 1) return null;
  const card = turned[0] as number;
  const color = after.cards[card]?.color;
  const by = after.history.find((record) => record.guesses.some((guess) => guess.card === card))?.team;
  return color && by ? { card, color, by } : null;
}

// Whether a snapshot ends the game: the one before it had no result and this one has one, with a
// group that won. A game that the chair withdrew brings no points, and nothing rises.
export const endsBetween = (before: KeywordsView, after: KeywordsView): boolean =>
  before.gameId === after.gameId && before.result === null && (after.result?.winner ?? null) !== null;

// A number as it rises: with its sign, and a true minus.
export const signed = (points: number): string => (points > 0 ? `+${points}` : `\u2212${Math.abs(points)}`);

// Where a player plays as the scores count them: the group of the seat they are in, and their role
// in it, which is the PI's for whoever has seen the key in this game (match.ts on the server).
function placeOf(data: KeywordsRoomData, playerId: string): { team: Team; role: 'captain' | 'guesser' } | null {
  const team = data.seats[playerId]?.team ?? null;
  if (team === null) return null;
  return { team, role: data.keyViewers.includes(playerId) ? 'captain' : 'guesser' };
}

// What a revealed card does to the viewer's points, by the group they play for in this game and
// their role, and to the points of each player in a group's seat, by player ID: only what changes
// something, and nothing for anyone in a game that brings no points.
export function revealFloats(
  data: KeywordsRoomData,
  me: string | null,
  reveal: { color: CardColor; by: Team },
): { mine: Float | null; players: Map<string, Float> } {
  const players = new Map<string, Float>();
  for (const id of Object.keys(data.seats)) {
    const place = placeOf(data, id);
    const points = place ? revealPoints(reveal.color, reveal.by, place.team, place.role) : 0;
    if (place && points !== 0) players.set(id, { text: signed(points), team: place.team });
  }
  let mine: Float | null = null;
  if (me !== null && data.side !== null) {
    const role = data.keyViewers.includes(me) ? 'captain' : 'guesser';
    const points = revealPoints(reveal.color, reveal.by, data.side, role);
    if (points !== 0) mine = { text: signed(points), team: data.side };
  }
  return { mine, players };
}

// What the end of the game adds to the points of the viewer and of each player in a group's seat:
// the win and the bonuses (bonusPoints()), as the server scored them, for those who have any.
export function endFloats(
  data: KeywordsRoomData,
  me: string | null,
  points: readonly GamePoints[],
): { mine: Float | null; players: Map<string, Float> } {
  const players = new Map<string, Float>();
  let mine: Float | null = null;
  for (const { playerId, detail } of points) {
    const bonus = detail === undefined ? 0 : bonusPoints(detail as KeywordsScoreDetail);
    if (bonus <= 0) continue;
    const team = data.seats[playerId]?.team ?? null;
    if (team !== null) players.set(playerId, { text: signed(bonus), team });
    if (playerId === me && data.side !== null) mine = { text: signed(bonus), team: data.side };
  }
  return { mine, players };
}
