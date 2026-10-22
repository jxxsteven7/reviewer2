import { z } from 'zod';
import { MAX_AGENT_REASON } from '../../agent';
import { LANGUAGES } from '../../language';
import { AGENT_ASKED, AGENT_NOTE_FIELDS, gameId, term } from '../../schemaParts';
import { MAX_REHEARSALS } from './agent';
import { CLUE_RULES, GUESS_RULES } from './settings';
import { BOARD_SIZE, MARKS, MAX_CLUE_NUMBER, ROLES, TEAMS } from './types';

// The schemas of the team word guessing game's own messages, which the server checks every one of
// them against, and of what the server and the agent say to each other in its games
// (../../schemas.ts). Only the server and the agent import this module, so that the client's
// bundle doesn't need zod.

// The messages of the team word guessing game (docs/games/keywords.md). Each game action names the
// game and the turn it was meant for, so that a late one can't land in a later turn.
//
// The content of an action is for the rules to judge: a clue or a chat message that is too long,
// or a count that isn't one, gets the game's own answer from them, such as clue_too_long or
// bad_count, and not bad_request from here. The rules refuse a long text before looking at it,
// and the server takes no message of more than 16 KB at all (server.ts).
const moment = { gameId, turn: z.number().int().min(1).max(10_000) };

export const KEYWORDS_MESSAGES = {
  'keywords:seat': z.object({ team: z.enum(TEAMS).nullable(), role: z.enum(ROLES) }),
  // The cards the captain marks as the ones the clue is meant for, which the rules check, are up
  // to the captain; a list longer than the board is no list of its cards.
  'keywords:clue': z.object({
    ...moment,
    word: z.string(),
    count: z.union([z.number(), z.literal('unlimited')]),
    targets: z.array(z.number()).max(BOARD_SIZE).optional(),
  }),
  // A guesser chooses a card for the group to see, or takes the choice back with null.
  'keywords:select': z.object({ ...moment, card: z.number().int().nullable() }),
  // A guesser marks a card for their group, or clears its mark with null. It names the game but
  // not the turn: a group may mark cards in either group's turn.
  'keywords:mark': z.object({ gameId, card: z.number().int(), mark: z.enum(MARKS).nullable() }),
  'keywords:reveal': z.object({ ...moment, card: z.number().int() }),
  'keywords:pass': z.object(moment),
  // A guesser writes one line to their group. It names the game but not the turn: a message is
  // welcome in whatever turn it arrives.
  'keywords:say': z.object({ gameId, text: z.string() }),
  // The chair pauses the game and resumes it, in whatever turn.
  'keywords:pause': z.object({ gameId }),
  'keywords:resume': z.object({ gameId }),
  // A group asks for its extension of the phase it is in.
  'keywords:extend': z.object(moment),
} as const;

export type KeywordsMessage = keyof typeof KEYWORDS_MESSAGES;

// The settings of a room of the game (settings.ts). The schema only takes their shape: whether
// the numbers are whole and in range is for settingsProblems() to say, which the room setup runs
// too.
export const KEYWORDS_SETTINGS = z.object({
  guessRule: z.enum(GUESS_RULES),
  clueRule: z.enum(CLUE_RULES),
  clueLength: z.number(),
  firstClueTime: z.number(),
  clueTime: z.number(),
  guessTime: z.number(),
  extensions: z.boolean(),
});

// What the game server and the agent say to each other in a game of the team word guessing game
// (agent.ts), which ../../schemas.ts puts together with every other game's: the server takes only
// a clue or cards that it can check.
const cardIndex = z
  .number()
  .int()
  .min(0)
  .max(BOARD_SIZE - 1);
const count = z.union([z.number().int().min(0).max(MAX_CLUE_NUMBER), z.literal('unlimited')]);
const color = z.enum([...TEAMS, 'neutral', 'reviewer2']);
const terms = z.array(term).max(50);
const agentGame = {
  game: z.literal('keywords'),
  language: z.enum(LANGUAGES),
  settings: KEYWORDS_SETTINGS.strict(),
  team: z.enum(TEAMS),
  cards: z
    .array(
      z.strictObject({
        word: term,
        revealed: z.boolean(),
        color: color.optional(),
        translations: terms.optional(),
        forms: terms.optional(),
        pinyin: term.optional(),
        // The English meanings of up to five characters (BoardWord.glosses), a few each.
        glosses: z.array(term).max(200).optional(),
      }),
    )
    .length(BOARD_SIZE),
  clues: z.array(z.strictObject({ team: z.enum(TEAMS), word: term, count })).max(200),
};

export const KEYWORDS_AGENT_REQUESTS = [
  z.strictObject({ ...AGENT_ASKED, kind: z.literal('clue'), ...agentGame }),
  z.strictObject({
    ...AGENT_ASKED,
    kind: z.literal('guess'),
    ...agentGame,
    clue: z.strictObject({ word: term, count }),
    guessesLeft: z.number().int().min(0).max(BOARD_SIZE).nullable(),
  }),
] as const;

export const KEYWORDS_NOTE = z.strictObject({
  ...AGENT_NOTE_FIELDS,
  candidates: z
    .array(
      z.strictObject({
        word: term,
        count: z.number().int().min(0).max(BOARD_SIZE),
        targets: z.array(cardIndex).max(BOARD_SIZE),
        problem: z.string().max(64).nullable(),
        rehearsals: z
          .array(
            z.strictObject({
              picks: z.array(cardIndex).max(BOARD_SIZE),
              found: z.number().int().min(0).max(BOARD_SIZE),
              stop: color.nullable(),
            }),
          )
          .max(MAX_REHEARSALS)
          .optional(),
      }),
    )
    .max(10)
    .optional(),
});

export const KEYWORDS_AGENT_REPLIES = [
  z.strictObject({
    ok: z.literal(true),
    kind: z.literal('clue'),
    word: term,
    count: z.number().int().min(1).max(BOARD_SIZE),
    targets: z.array(cardIndex).max(BOARD_SIZE),
    note: KEYWORDS_NOTE,
  }),
  z.strictObject({
    ok: z.literal(true),
    kind: z.literal('guess'),
    picks: z.array(cardIndex).max(BOARD_SIZE),
    reason: z.string().max(MAX_AGENT_REASON),
    note: KEYWORDS_NOTE,
  }),
] as const;
