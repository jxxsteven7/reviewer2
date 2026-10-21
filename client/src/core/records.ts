import {
  emptyGameCounts,
  type BestStreaks,
  type DuoView,
  type GameCounts,
  type RecordCounts,
  type TitleCount,
} from '@reviewer2/shared';

// What the pages show of an account's record (docs/architecture.md#game-records). The records of
// two games are never added up: the record shows one game at a time, as the tab chosen names it
// (GameTabs.vue), with its counts and its latest games. The titles, the streak titles among them,
// and what friends have played together are the first game's alone (TITLES_GAME), since the second
// game brings no titles yet (docs/games/impostor.md#beta).
export const TITLES_GAME = 'keywords';

export const countsOf = (record: RecordCounts, game: string): GameCounts => record[game] ?? emptyGameCounts();

export const shownStreaks = (streaks: Readonly<Record<string, BestStreaks>>): BestStreaks =>
  streaks[TITLES_GAME] ?? { wins: 0, losses: 0 };

export const shownTitles = (titles: readonly TitleCount[]): TitleCount[] =>
  titles.filter(({ game }) => game === TITLES_GAME);

export const shownDuo = (duo: Readonly<Record<string, DuoView>> | null): DuoView | null => duo?.[TITLES_GAME] ?? null;
