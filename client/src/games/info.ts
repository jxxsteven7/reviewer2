import type { FieldInfo, GameCounts, Language } from '@reviewer2/shared';
import { mayBePublic as impostorMayBePublic, type ImpostorSettings } from '@reviewer2/shared/impostor';
import { BOARD_SIZE, KEYWORDS_TITLES } from '@reviewer2/shared/keywords';
import type { StatBlock } from '../core/components/StatBlocks.vue';
import { recordStats as impostorStats } from './impostor/stats';
import { recordStats as keywordsStats } from './keywords/stats';

// What the pages around the games know of each of them, without their screens (index.ts), so that
// the site's own modules, such as the titles, can read it without loading a game: the games in the
// order the home page shows them, whether a game is still in beta (docs/games/impostor.md#beta),
// the titles that its games bring, the roles that its records name, which the locale files name
// under games.<id>, how a word list serves it, the roles a practice room offers, whether a room may
// be listed, and its record as counts on blocks (RecordStats.vue), laid out as the first game's six
// or three to a line. The words of each game are under games.<id> in the locale files.
type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string;

export interface GameInfo {
  id: string;
  beta: boolean;
  titles: readonly string[];
  roles: readonly string[];
  // Whether its sides are groups, which its records tint (the first game's red and blue), rather
  // than its roles.
  groups: boolean;
  // A game draws a board of terms from the word lists, or a pair of related terms; a list serves it
  // if it has enough of them in the room's language.
  pairs: boolean;
  usable(field: FieldInfo, language: Language): boolean;
  // Whether the game draws its words from the word lists with these settings, rather than from a
  // setter, say.
  drawsWords(settings: object | undefined): boolean;
  // Whether a room with these settings may be listed for anyone to join.
  mayBePublic(settings: object | undefined): boolean;
  // The roles that a practice room offers its creator, or one role for a game where everyone plays
  // the same part.
  practiceRoles: readonly string[];
  // How many AI players a practice room of one has besides its creator.
  practiceAgents: number;
  recordStats(t: Translate, counts: GameCounts, locale: string): StatBlock[];
  statsLayout: 'roles' | 'thirds';
}

const keywords: GameInfo = {
  id: 'keywords',
  beta: false,
  titles: KEYWORDS_TITLES,
  roles: ['captain', 'guesser'],
  groups: true,
  pairs: false,
  usable: (field, language) => field.counts[language] >= BOARD_SIZE,
  drawsWords: () => true,
  mayBePublic: () => true,
  practiceRoles: ['captain', 'guesser'],
  practiceAgents: 3,
  recordStats: keywordsStats,
  statsLayout: 'roles',
};

const impostor: GameInfo = {
  id: 'impostor',
  beta: true,
  titles: [],
  roles: ['student', 'reviewer2', 'pi'],
  groups: false,
  pairs: true,
  usable: (field) => field.pairs > 0,
  drawsWords: (settings) => !(settings as ImpostorSettings | undefined)?.setter,
  mayBePublic: (settings) => settings === undefined || impostorMayBePublic(settings as ImpostorSettings),
  practiceRoles: ['player'],
  practiceAgents: 5,
  recordStats: impostorStats,
  statsLayout: 'thirds',
};

export const GAME_INFO: readonly GameInfo[] = [keywords, impostor];

export const gameInfo = (id: string): GameInfo | undefined => GAME_INFO.find((game) => game.id === id);

// The game whose title it is, or undefined for a title that every game may bring, as a match's.
export const gameOfTitle = (title: string): string | undefined =>
  GAME_INFO.find((game) => game.titles.includes(title))?.id;
