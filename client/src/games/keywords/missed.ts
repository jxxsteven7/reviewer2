import { fnv1a } from '../../core/hash';

// The lines with which the room teases a PI who missed the deadline for a clue
// (useMissedDeadlines.ts), under game.missed.lines in the locale files, numbered from 1.
export const MISSED_LINES = 5;

// Which line the room reads. It comes from the game and the turn, so that everyone reads the same
// one, and the next miss draws again.
export const missedLine = (gameId: string, turn: number): number =>
  (fnv1a(`${gameId}:${turn}:missed`) % MISSED_LINES) + 1;
