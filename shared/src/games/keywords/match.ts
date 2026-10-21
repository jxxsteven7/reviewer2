import { MATCH_GAMES, matchGamesValid, type MatchRules } from '../../match';

// The game's own rules of a match (MatchRules.options, docs/games/keywords.md#matches): whether the
// groups stay the same and how they are made.

// 'fixed': the groups stay the same for the whole match. 'switch': they may change after every
// game.
export const MATCH_TEAMS = ['fixed', 'switch'] as const;
export type MatchTeams = (typeof MATCH_TEAMS)[number];

// How the groups are made: drawn at random by the server, or chosen by the players in the waiting
// room. With fixed groups, this is how the first game's groups are made; with groups that may
// change, how they are made for every game.
export const MATCH_GROUPINGS = ['random', 'choose'] as const;
export type MatchGrouping = (typeof MATCH_GROUPINGS)[number];

export interface KeywordsMatchOptions {
  teams: MatchTeams;
  grouping: MatchGrouping;
}

export interface KeywordsMatchRules extends MatchRules {
  options: KeywordsMatchOptions;
}

// The options as a match takes them, whole, or null when they won't do: the game checks the chair's
// with this on the server (MatchHooks.options), the check of the data those of a room setup, and the
// page the ones it restores.
export function keywordsMatchOptions(value: unknown): KeywordsMatchOptions | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const { teams, grouping, ...rest } = value as Record<string, unknown>;
  const team = MATCH_TEAMS.find((known) => known === teams);
  const group = MATCH_GROUPINGS.find((known) => known === grouping);
  return team && group && Object.keys(rest).length === 0 ? { teams: team, grouping: group } : null;
}

// The rules of a match of the game, whole, or null when they won't do: the page reads with this the
// rules that a room setup kept, or that a match was played by, for the form to start from.
export function keywordsMatchRules(value: unknown): KeywordsMatchRules | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const { games, options } = value as Record<string, unknown>;
  const kept = keywordsMatchOptions(options);
  return matchGamesValid(games) && kept ? { games: games as number, options: kept } : null;
}

// By default a match has three games, and the groups are drawn again for every game.
export const defaultMatchRules = (): KeywordsMatchRules => ({
  games: MATCH_GAMES.default,
  options: { teams: 'switch', grouping: 'random' },
});
