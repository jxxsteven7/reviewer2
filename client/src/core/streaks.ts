import {
  numberWords,
  STREAK_KINDS,
  STREAK_MIN,
  type BestStreaks,
  type Language,
  type StreakKind,
} from '@reviewer2/shared';
import { fnv1a } from './hash';

// The streaks as the pages show them (docs/architecture.md#streaks): the account page as titles,
// and the end of a game as a notice to the player, with a line for the occasion under
// streaks.lines in the locale files, and as a cheer to the whole room for a winning streak
// (StreakNotices.vue). The title's number is in words (shared/src/numbers.ts).

// The lines come in three tiers, by how long the streak is: three or four games, five to nine, and
// ten and up.
export const STREAK_TIERS = ['low', 'mid', 'high'] as const;
export type StreakTier = (typeof STREAK_TIERS)[number];

// How many lines each tier has, under streaks.lines.<kind>.<tier> in the locale files, numbered
// from 1.
export const LINES_PER_TIER = 3;

export function streakTier(length: number): StreakTier {
  if (length >= 10) return 'high';
  return length >= 5 ? 'mid' : 'low';
}

// Which of its tier's lines a streak gets, from 1. It comes from the game, the player and the
// streak, so that the player reads the same line on every page and after every refresh, and the
// next game draws again, as the decision letters do.
export function streakLineNumber(gameId: string, playerId: string, kind: StreakKind, length: number): number {
  return (fnv1a(`${gameId}:${playerId}:${kind}:${length}`) % LINES_PER_TIER) + 1;
}

// A component's translator, as far as the title needs it.
type Translate = (key: string, named: Record<string, string>) => string;

// The title of a streak, with its number in the words of the language: "Three Submissions, Three
// Acceptances". The account page and the notices at the end of a game both name streaks with it.
export const streakTitle = (t: Translate, kind: StreakKind, length: number, language: Language): string =>
  t(`streaks.names.${kind}`, { n: numberWords(length, language) });

// The titles that an account's longest streaks earn, from STREAK_MIN games on, as the account
// page and the public profile show them (TitlePills.vue): the winning streak first, then the
// losing one, each with its kind for the color of its pill.
export const streakTitles = (
  t: Translate,
  streaks: BestStreaks,
  language: Language,
): { kind: StreakKind; title: string }[] =>
  STREAK_KINDS.flatMap((kind) => {
    const length = streaks[kind];
    return length >= STREAK_MIN ? [{ kind, title: streakTitle(t, kind, length, language) }] : [];
  });

// The key of the line in the locale files.
export const streakLineKey = (gameId: string, playerId: string, kind: StreakKind, length: number): string =>
  `streaks.lines.${kind}.${streakTier(length)}.${streakLineNumber(gameId, playerId, kind, length)}`;
