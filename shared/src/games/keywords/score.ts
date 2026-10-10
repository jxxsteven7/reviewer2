// How a game of a match is scored, for each player (docs/games/keywords.md#matches). The server
// adds the points up; the client shows them, with this detail of where they came from.
//
// - Every card that a group's own students reveal of its own color gives everyone who played for
//   the group in that game 1 point, the PI included. A card that the other group reveals for it
//   gives nothing.
// - The group that wins gives each of them 3 more.
// - Whoever reveals a card of the other group loses 1 point, and whoever reveals Reviewer 2 loses 3.
//   An irrelevant paper costs nothing.
export const POINTS = { found: 1, won: 3, wrong: -1, reviewer2: -3 } as const;

export interface KeywordsScoreDetail {
  // The own cards that the player's group found.
  found: number;
  won: boolean;
  // The cards of the other group, and Reviewer 2, that the player revealed.
  wrong: number;
  reviewer2: number;
}

export const pointsFor = (detail: KeywordsScoreDetail): number =>
  detail.found * POINTS.found +
  (detail.won ? POINTS.won : 0) +
  detail.wrong * POINTS.wrong +
  detail.reviewer2 * POINTS.reviewer2;
