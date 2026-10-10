import { z } from 'zod';
import { MAX_EMAIL_LENGTH } from './accounts';
import { FEEDBACK_KINDS, FEEDBACK_PAGES } from './feedback';
import { CLUE_RULES, GUESS_RULES } from './games/keywords/settings';
import { ROLES, TEAMS } from './games/keywords/types';
import { LANGUAGES } from './language';
import { MATCH_GAMES, MATCH_GROUPINGS, MATCH_TEAMS } from './match';
import { EMOTES, MAX_NAME_INPUT } from './protocol';

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
// The rules of a match (match.ts), which are the room's and not a game's, so they are checked here
// in full.
const match = z.object({
  games: z.number().int().min(MATCH_GAMES.min).max(MATCH_GAMES.max),
  teams: z.enum(MATCH_TEAMS),
  grouping: z.enum(MATCH_GROUPINGS),
});
const matchId = z.string().max(64);

export const ROOM_MESSAGES = {
  'sys:ping': none,
  'meta:fields': none,
  'meta:rooms': none,
  // Feedback for the author. Its text, contact, credit and link are for the rules in feedback.ts
  // to judge, which refuse a long text before looking at it, so that it gets feedback_too_long and
  // not bad_request. The server takes no message of more than 16 KB at all (server.ts).
  'meta:feedback': z.object({
    kind: z.enum(FEEDBACK_KINDS),
    text: z.string(),
    contact: z.string().optional(),
    credit: z.string().optional(),
    link: z.string().optional(),
    publicIssue: z.boolean().optional(),
    version: z.string().max(64),
    language: z.enum(LANGUAGES),
    page: z.enum(FEEDBACK_PAGES),
  }),
  // A room starts with its game's default settings when `settings` is left out. A creator who is
  // logged in has their username as the name, and needs to give none. With `match`, the room plays
  // a match by those rules; with `public`, it is listed for anyone with an account to join.
  'room:create': z.object({
    game: z.string().max(32),
    language: z.enum(LANGUAGES),
    fields,
    settings: settings.optional(),
    name: name.optional(),
    play,
    match: match.optional(),
    public: z.boolean().optional(),
  }),
  // Whoever has been in the room names its ID as well, so that a code that has since gone to
  // another room doesn't take them there. A client that has no ID to give may leave the field out
  // or send null.
  'room:join': z.object({ code, name: name.optional(), roomId: roomId.nullish(), play }),
  'room:watch': z.object({ code, roomId: roomId.nullish() }),
  'room:leave': none,
  'room:rename': z.object({ name }),
  'room:emote': z.object({ emote: z.enum(EMOTES) }),
  // A member reports another to the operator, with a note that the rules in feedback.ts judge.
  'room:report': z.object({ playerId, text: z.string().optional() }),
  // The chair's controls. The settings change the word lists, the game's own settings, or both.
  'room:settings': z.object({ fields: fields.optional(), settings: settings.optional() }),
  'room:public': z.object({ public: z.boolean() }),
  // The chair's messages about a game say which game they mean, so that one that comes late or
  // twice can't land in another: a start gives how many games the room has started so far, and a
  // withdrawal and "play again" give the game's ID.
  'room:start': z.object({ round: z.number().int().min(0) }),
  'room:end': z.object({ gameId }),
  'room:again': z.object({ gameId }),
  // A match's messages name it, as those about a game name the game: the chair ends one early, and,
  // once it is over, starts another, by `match`, or makes the room an ordinary one again, by null.
  'room:matchEnd': z.object({ matchId }),
  'room:matchNext': z.object({ matchId, match: match.nullable() }),
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

// The bodies of the requests to the account API (shared/src/accounts.ts), which are JSON. As with
// the messages, the rules judge what is in a name or a password, so that a long one gets its own
// answer, such as password_long, and not bad_request; the server reads no body of more than 4 KB.
const password = z.string();
const email = z.string().max(4 * MAX_EMAIL_LENGTH);
// The secret of a link in a mail. One that isn't one finds nothing.
const linkToken = z.string().max(64);

export const ACCOUNT_REQUESTS = {
  register: z.object({ username: z.string(), password }),
  login: z.object({ username: z.string(), password }),
  logout: none,
  username: z.object({ username: z.string() }),
  avatarRemove: none,
  password: z.object({ current: password, password }),
  email: z.object({ email, password, language: z.enum(LANGUAGES) }),
  emailRemove: z.object({ password }),
  emailConfirm: z.object({ token: linkToken }),
  forgot: z.object({ email, language: z.enum(LANGUAGES) }),
  reset: z.object({ token: linkToken, password }),
  remove: z.object({ password }),
} as const;
