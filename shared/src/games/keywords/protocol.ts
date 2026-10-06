import { z } from 'zod';
import { MAX_CHAT_INPUT } from './chat';
import { MAX_CLUE_INPUT } from './clue';
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
    word: z.string().max(MAX_CLUE_INPUT),
    // Any whole number is let through here, so that the rules can answer bad_count.
    count: z.union([z.number().int(), z.literal('unlimited')]),
  }),
  // A guesser chooses a card for the group to see, or takes the choice back with null.
  'keywords:select': z.object({ ...moment, card: z.number().int().nullable() }),
  'keywords:reveal': z.object({ ...moment, card: z.number().int() }),
  'keywords:pass': z.object(moment),
  // A guesser writes one line to their group. It names the game but not the turn: a message is
  // welcome in whatever turn it arrives.
  'keywords:say': z.object({ gameId: moment.gameId, text: z.string().max(MAX_CHAT_INPUT) }),
} as const;

export type KeywordsMessage = keyof typeof KEYWORDS_MESSAGES;
