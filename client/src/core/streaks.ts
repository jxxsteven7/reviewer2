import type { StreakKind } from '@reviewer2/shared';

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
// next game draws again. The hash is FNV-1a, as the decision letters use it.
export function streakLineNumber(gameId: string, playerId: string, kind: StreakKind, length: number): number {
  const key = `${gameId}:${playerId}:${kind}:${length}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % LINES_PER_TIER) + 1;
}

// The key of the line in the locale files.
export const streakLineKey = (gameId: string, playerId: string, kind: StreakKind, length: number): string =>
  `streaks.lines.${kind}.${streakTier(length)}.${streakLineNumber(gameId, playerId, kind, length)}`;
