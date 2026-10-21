import type { BestStreaks, DuoView, GameCounts, RecordCounts, TitleCount } from '@reviewer2/shared';

// What the pages show of an account's record (docs/architecture.md#game-records). The records of two
// games are never added up, and the pages show the first game's alone until each game has a tab of
// its own: its counts, its streaks, its titles and what friends have played together in it.
export const RECORDS_GAME = 'keywords';

// The counts of a game that an account has finished none of.
export const noCounts = (): GameCounts => ({
  ordinary: { games: 0, wins: 0 },
  inMatches: { games: 0, wins: 0 },
  roles: {},
  matches: { played: 0, won: 0 },
});

export const shownCounts = (record: RecordCounts): GameCounts => record[RECORDS_GAME] ?? noCounts();

export const shownStreaks = (streaks: Readonly<Record<string, BestStreaks>>): BestStreaks =>
  streaks[RECORDS_GAME] ?? { wins: 0, losses: 0 };

export const shownTitles = (titles: readonly TitleCount[]): TitleCount[] =>
  titles.filter(({ game }) => game === RECORDS_GAME);

export const shownDuo = (duo: Readonly<Record<string, DuoView>> | null): DuoView | null => duo?.[RECORDS_GAME] ?? null;
