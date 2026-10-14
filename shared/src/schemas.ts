import { z } from 'zod';
import { HANDLE, MAX_EMAIL_LENGTH } from './accounts';
import { AGENT_ERRORS, AGENT_PERSONAS, MAX_AGENT_REASON, MAX_AGENT_WAIT_MS } from './agent';
import { FEEDBACK_KINDS, FEEDBACK_PAGES } from './feedback';
import { MAX_CUSTOM_INPUT } from './games/keywords/custom';
import { CLUE_RULES, GUESS_RULES } from './games/keywords/settings';
import { BOARD_SIZE, MARKS, MAX_CLUE_NUMBER, ROLES, TEAMS } from './games/keywords/types';
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
// A room may have no word list at all when the chair's own words are enough for a game
// (docs/games/keywords.md#custom-words); the room says no_words when they aren't. The chair may
// choose every list in the library at once, so the limit stays well above the number of lists in
// words/; the room refuses an unknown one with bad_fields.
const fields = z.array(z.string().max(64)).max(100);
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
  'meta:seats': none,
  'meta:agents': none,
  // Feedback for the author. Its text, contact and credit are for the rules in feedback.ts to
  // judge, which refuse a long text before looking at it, so that it gets feedback_too_long and
  // not bad_request. The server takes no message of more than 16 KB at all (server.ts). What older
  // pages sent besides, a link for the name and whether the player agreed to a public issue, is
  // dropped here, as anything else the schema doesn't name.
  'meta:feedback': z.object({
    kind: z.enum(FEEDBACK_KINDS),
    text: z.string(),
    contact: z.string().optional(),
    credit: z.string().optional(),
    linkProfile: z.boolean().optional(),
    version: z.string().max(64),
    language: z.enum(LANGUAGES),
    page: z.enum(FEEDBACK_PAGES),
  }),
  // A room starts with its game's default settings when `settings` is left out. A creator who is
  // logged in has their username as the name, and needs to give none. With `match`, the room plays
  // a match by those rules; with `public`, it is listed for anyone with an account to join. With
  // `practice`, it is a practice room (docs/architecture.md#practice-rooms): the creator plays the
  // role they name, as the game calls it, AI players take the other seats, and the game starts.
  'room:create': z.object({
    game: z.string().max(32),
    language: z.enum(LANGUAGES),
    fields,
    settings: settings.optional(),
    name: name.optional(),
    play,
    match: match.optional(),
    public: z.boolean().optional(),
    practice: z.object({ role: z.string().max(32) }).optional(),
  }),
  // Whoever has been in the room names its ID as well, so that a code that has since gone to
  // another room doesn't take them there. A client that has no ID to give may leave the field out
  // or send null. A friend who was invited gives the invitation in place of the code (friends.ts);
  // one of the two must be there.
  'room:join': z.object({
    code: code.optional(),
    name: name.optional(),
    roomId: roomId.nullish(),
    play,
    invitation: z.string().max(64).optional(),
  }),
  'room:watch': z.object({ code, roomId: roomId.nullish() }),
  'room:leave': none,
  'room:rename': z.object({ name }),
  'room:emote': z.object({ emote: z.enum(EMOTES) }),
  // A member reports another to the operator, with a note that the rules in feedback.ts judge.
  'room:report': z.object({ playerId, text: z.string().optional() }),
  // The chair's controls. The settings change the word lists, the game's own settings, the
  // chair's own words, as the text they were pasted as (parseCustomWords in custom.ts), or any
  // of them.
  'room:settings': z.object({
    fields: fields.optional(),
    settings: settings.optional(),
    words: z.string().max(MAX_CUSTOM_INPUT).optional(),
  }),
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
  // The chair invites an AI player to a seat, which the game reads (GameModule.seatAgent).
  'room:addAgent': z.object({ persona: z.enum(AGENT_PERSONAS), seat: z.unknown() }),
  'room:remove': z.object({ playerId }),
  'room:chair': z.object({ playerId }),
  'room:dismiss': none,
  'room:close': none,
  // Friends and invitations (friends.ts), for accounts. A request names the other account by its
  // username, or by the player's ID in the room that the connection is in; the rest name a friend,
  // or the other side of a request, by username, and an invitation by its ID.
  'friends:list': none,
  'friends:request': z.object({
    username: name.optional(),
    playerId: playerId.optional(),
    // A line for the other side, which the rules in friends.ts judge.
    note: z.string().optional(),
  }),
  // The name the account gives a friend, which the rules in friends.ts judge; an empty one is none.
  'friends:alias': z.object({ username: name, alias: z.string() }),
  'friends:accept': z.object({ username: name }),
  'friends:decline': z.object({ username: name }),
  'friends:remove': z.object({ username: name }),
  'friends:invite': z.object({ username: name }),
  'friends:ignore': z.object({ id: z.string().max(64) }),
  'friends:rooms': none,
  'friends:ask': z.object({ username: name }),
  'friends:dismiss': z.object({ id: z.string().max(64) }),
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
  replay: z.object({ gameId }),
  // The link and the bio are for the rules in feedback.ts and accounts.ts to judge, which refuse a
  // long text before looking at it, so that it gets its own answer and not bad_request. The body
  // of a request is at most 4 KB in any case (server/src/accounts/http.ts).
  profile: z.object({ link: z.string(), bio: z.string(), showRecord: z.boolean(), showThanks: z.boolean() }),
  like: z.object({ handle: z.string().regex(HANDLE) }),
  unlike: z.object({ handle: z.string().regex(HANDLE) }),
} as const;

// What the game server and the agent say to each other (agent.ts). Each side reads the other's
// lines with these, and takes nothing that has a field more or less than it should: the agent
// plays only with what a seat may see, and the server takes only a clue or cards that it can check.
const cardIndex = z
  .number()
  .int()
  .min(0)
  .max(BOARD_SIZE - 1);
const count = z.union([z.number().int().min(0).max(MAX_CLUE_NUMBER), z.literal('unlimited')]);
const term = z.string().max(200);
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
const asked = {
  v: z.literal(1),
  persona: z.enum(AGENT_PERSONAS),
  waitMs: z.number().int().min(1).max(MAX_AGENT_WAIT_MS),
};

export const AGENT_REQUEST = z.discriminatedUnion('kind', [
  z.strictObject({ v: z.literal(1), kind: z.literal('ping') }),
  z.strictObject({ ...asked, kind: z.literal('clue'), ...agentGame }),
  z.strictObject({
    ...asked,
    kind: z.literal('guess'),
    ...agentGame,
    clue: z.strictObject({ word: term, count }),
    guessesLeft: z.number().int().min(0).max(BOARD_SIZE).nullable(),
  }),
]);

const note = z.strictObject({
  model: z.string().max(200),
  prompt: z.string().max(64),
  ms: z.number().min(0),
  candidates: z
    .array(
      z.strictObject({
        word: term,
        count: z.number().int().min(0).max(BOARD_SIZE),
        targets: z.array(cardIndex).max(BOARD_SIZE),
        problem: z.string().max(64).nullable(),
        rehearsal: z
          .strictObject({
            picks: z.array(cardIndex).max(BOARD_SIZE),
            found: z.number().int().min(0).max(BOARD_SIZE),
            stop: color.nullable(),
          })
          .optional(),
      }),
    )
    .max(10)
    .optional(),
  reason: z.string().max(MAX_AGENT_REASON).optional(),
});

export const AGENT_REPLY = z.union([
  z.strictObject({ ok: z.literal(true), kind: z.literal('ping'), model: z.string().max(200) }),
  z.strictObject({
    ok: z.literal(true),
    kind: z.literal('clue'),
    word: term,
    count: z.number().int().min(1).max(BOARD_SIZE),
    targets: z.array(cardIndex).max(BOARD_SIZE),
    note,
  }),
  z.strictObject({
    ok: z.literal(true),
    kind: z.literal('guess'),
    picks: z.array(cardIndex).max(BOARD_SIZE),
    reason: z.string().max(MAX_AGENT_REASON),
    note,
  }),
  z.strictObject({ ok: z.literal(false), error: z.enum(AGENT_ERRORS), note: note.optional() }),
]);
