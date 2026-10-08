import { z } from 'zod';
import { CLUE_RULES, GUESS_RULES } from './games/keywords/settings';
import { ROLES, TEAMS } from './games/keywords/types';
import { LANGUAGES } from './language';
import { MAX_NAME_INPUT } from './protocol';

// The schemas that the server checks every message against (docs/architecture.md). Only the
// server imports this module, so that the client's bundle doesn't need zod: a schema is built
// when its module loads, so no bundler can leave it out, and building one probes `new Function`,
// which the page's own Content Security Policy refuses.

// A code as someone typed it, with whatever they put around and between its characters.
const code = z.string().max(32);
// The rules for names (names.ts) say what a name may be. This only keeps out what is too long to
// be looked at, and it is no tighter than they are, so that a name which they would take is never
// refused here as a bad request.
const name = z.string().max(MAX_NAME_INPUT);
const playerId = z.string().max(32);
const gameId = z.string().max(64);
const roomId = z.string().max(64);
const fields = z.array(z.string().max(64)).min(1).max(20);
// Whether a newcomer has come to play rather than to watch. The game seats a player; whoever
// leaves the field out watches, as everyone did before there was a choice.
const play = z.boolean().optional();
const none = z.object({});
// A game's settings, which its module checks (GameModule.configure on the server).
const settings = z.unknown();

export const ROOM_MESSAGES = {
  'sys:ping': none,
  'meta:fields': none,
  // A room starts with its game's default settings when `settings` is left out.
  'room:create': z.object({
    game: z.string().max(32),
    language: z.enum(LANGUAGES),
    fields,
    settings: settings.optional(),
    name,
    play,
  }),
  // Whoever has been in the room names its ID as well, so that a code that has since gone to
  // another room doesn't take them there. A client that has no ID to give may leave the field out
  // or send null.
  'room:join': z.object({ code, name: name.optional(), roomId: roomId.nullish(), play }),
  'room:watch': z.object({ code, roomId: roomId.nullish() }),
  'room:leave': none,
  'room:rename': z.object({ name }),
  // The chair's controls. The settings change the word lists, the game's own settings, or both.
  'room:settings': z.object({ fields: fields.optional(), settings: settings.optional() }),
  // The chair's messages about a game say which game they mean, so that one that comes late or
  // twice can't land in another: a start gives how many games the room has started so far, and a
  // withdrawal and "play again" give the game's ID.
  'room:start': z.object({ round: z.number().int().min(0) }),
  'room:end': z.object({ gameId }),
  'room:again': z.object({ gameId }),
  'room:shuffle': none,
  'room:spectate': z.object({ playerId }),
  'room:remove': z.object({ playerId }),
  'room:chair': z.object({ playerId }),
  'room:dismiss': none,
  'room:close': none,
} as const;

export type RoomMessage = keyof typeof ROOM_MESSAGES;

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
  'keywords:clue': z.object({ ...moment, word: z.string(), count: z.union([z.number(), z.literal('unlimited')]) }),
  // A guesser chooses a card for the group to see, or takes the choice back with null.
  'keywords:select': z.object({ ...moment, card: z.number().int().nullable() }),
  'keywords:reveal': z.object({ ...moment, card: z.number().int() }),
  'keywords:pass': z.object(moment),
  // A guesser writes one line to their group. It names the game but not the turn: a message is
  // welcome in whatever turn it arrives.
  'keywords:say': z.object({ gameId, text: z.string() }),
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
});

// The handshake (`Handshake` in protocol.ts). A field that isn't what it should be counts as
// missing, rather than spoil the others or the connection.
const lenient = <Field extends z.ZodType>(field: Field) => field.optional().catch(undefined);

export const HANDSHAKE = z
  .object({ token: lenient(z.string().max(64)), code: lenient(code), roomId: lenient(roomId), watch: lenient(code) })
  .catch({});
