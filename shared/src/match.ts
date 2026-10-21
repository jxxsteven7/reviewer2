import type { MatchTitle } from './accounts';

// Matches (docs/architecture.md#matches): a room that plays a number of games in a row, scores
// every player in each, and ranks them by their totals at the end. The first win the Best Paper
// Award, and the last are the game's black hole. The server keeps the scores; clients only show
// them.

// How many games a match has, which the chair chooses when creating it.
export const MATCH_GAMES = { min: 1, max: 10, default: 3 } as const;

// The rules of a match: how many games it has, which are the room's, and the game's own options,
// such as how its players are grouped from one game to the next (for the team word guessing game,
// KeywordsMatchOptions), which the game checks (MatchHooks.options on the server); a game with no
// options of its own has none.
export interface MatchRules {
  games: number;
  options?: unknown;
}

// Whether the number of games will do: a whole number in range. The room setup checks it with
// this, and the server's schema (schemas.ts) by MATCH_GAMES.
export const matchGamesValid = (games: unknown): boolean =>
  Number.isInteger(games) && (games as number) >= MATCH_GAMES.min && (games as number) <= MATCH_GAMES.max;

// 'on' while games are left to play, 'over' once the last has been scored, and 'stopped' when the
// chair ended it early, which awards no titles.
export type MatchStatus = 'on' | 'over' | 'stopped';

// One line of the match's table. Everyone who has played in it is listed, also after leaving the
// room; those who are in a group for the game being played are listed from its start.
export interface StandingView {
  // The player's ID in the room, or null for someone who has left it.
  playerId: string | null;
  name: string;
  // A guest's number in the room, by which the client names them (PlayerView.guest).
  guest?: number;
  avatar?: string;
  total: number;
  // The points of the game in focus: the one being played, as they stand; the one that has just
  // ended; or, in the waiting room, the last one scored. Null for someone who had no part in it.
  delta: number | null;
  // How the delta came about, in the game's own terms (for the team word guessing game,
  // `KeywordsScoreDetail`).
  detail?: unknown;
  // How many scored games the player took part in.
  games: number;
  // The place in the ranking, shared by those with the same total; null for someone who has left
  // the room or hasn't played a scored game yet.
  rank: number | null;
  left: boolean;
  // Only once the match is over.
  title?: MatchTitle;
}

export interface MatchView {
  id: string;
  rules: MatchRules;
  // How many games have been scored. A game that the chair withdrew isn't.
  played: number;
  status: MatchStatus;
  // The game in focus, counted from 1: the one being played, the one that has just ended, or the
  // next one in the waiting room. Never more than rules.games.
  game: number;
  // Best first; ties keep the order in which the players entered the match.
  standings: StandingView[];
}
