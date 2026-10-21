import type { KeywordsView } from '@reviewer2/shared/keywords';

// The stretch of time that a game's clock is for (ClockBar.vue): the game's turn and its phase.
export const periodOf = (game: KeywordsView): string => `${game.gameId}:${game.turn}:${game.phase}`;
