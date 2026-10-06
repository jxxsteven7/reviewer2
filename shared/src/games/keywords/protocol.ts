import { z } from 'zod';
import { TEAMS } from './types';

// The game's messages (docs/games/keywords.md). Each game action names the game and the turn it
// was meant for, so that a late one can't land in a later turn.
const moment = { gameId: z.string().max(64), turn: z.number().int().min(1).max(10_000) };

export const KEYWORDS_MESSAGES = {
  'keywords:seat': z.object({
    team: z.enum(TEAMS).nullable(),
    role: z.enum(['captain', 'guesser', 'spectator']),
  }),
  'keywords:clue': z.object({
    ...moment,
    word: z.string().max(64),
    // Any whole number is let through here, so that the rules can answer bad_count.
    count: z.union([z.number().int(), z.literal('unlimited')]),
  }),
  'keywords:reveal': z.object({ ...moment, card: z.number().int() }),
  'keywords:pass': z.object(moment),
} as const;

export type KeywordsMessage = keyof typeof KEYWORDS_MESSAGES;
