import { fnv1a } from '../../core/hash';

// The lines with which the room cheers a deadline hero (useDeadlineHeroes.ts), under
// game.hero.lines in the locale files, numbered from 1.
export const HERO_LINES = 5;

// Which line the room reads, the same for everyone: it comes from the game, the turn and the hero.
export const heroLine = (gameId: string, turn: number, player: string): number =>
  (fnv1a(`${gameId}:${turn}:${player}:hero`) % HERO_LINES) + 1;
