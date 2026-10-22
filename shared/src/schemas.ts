import { z } from 'zod';
import { HANDLE, MAX_EMAIL_LENGTH } from './accounts';
import { AGENT_ERRORS, AGENT_PERSONAS } from './agent';
import { MAX_CUSTOM_INPUT } from './custom';
import { FEEDBACK_KINDS, FEEDBACK_PAGES } from './feedback';
import { IMPOSTOR_AGENT_REPLIES, IMPOSTOR_AGENT_REQUESTS, IMPOSTOR_NOTE } from './games/impostor/schemas';
import { KEYWORDS_AGENT_REPLIES, KEYWORDS_AGENT_REQUESTS, KEYWORDS_NOTE } from './games/keywords/schemas';
import { LANGUAGES } from './language';
import { MATCH_GAMES } from './match';
import { EMOTES, MAX_NAME_INPUT } from './protocol';
import { AGENT_NOTE, code, gameId, playerId, roomId } from './schemaParts';

// The schemas that the server checks every message against (docs/architecture.md). Only the
// server imports this module, so that the client's bundle doesn't need zod: a schema is built
// when its module loads, so no bundler can leave it out, and building one probes `new Function`,
// which the page's own Content Security Policy refuses. Each game's own messages are in its folder
// (for the team word guessing game, games/keywords/schemas.ts), which only the server and the
// agent import too.

// The rules for names (names.ts) say what a name may be. This only keeps out what is too long to
// be looked at, and it is no tighter than they are, so that a name which they would take is never
// refused here as a bad request.
const name = z.string().max(MAX_NAME_INPUT);
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
// The rules of a match (match.ts): the number of games, which is the room's and is checked here,
// and the game's own options, which its module checks (MatchHooks.options on the server).
const match = z.object({
  games: z.number().int().min(MATCH_GAMES.min).max(MATCH_GAMES.max),
  options: z.unknown().optional(),
});
const matchId = z.string().max(64);
// Who plays in a practice room (docs/architecture.md#practice-rooms): its creator alone, in the
// role they name, as the game calls it, or the creator with friends.
const practice = z.discriminatedUnion('who', [
  z.object({ who: z.literal('me'), role: z.string().max(32) }),
  z.object({ who: z.literal('friends') }),
]);
export type PracticeRequest = z.infer<typeof practice>;

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
    gameId: gameId.optional(),
  }),
  // A room starts with its game's default settings when `settings` is left out. Nobody gives a
  // name: a creator who is logged in has their username, and a guest a number in the room
  // (docs/architecture.md#players-and-identity). With `match`, the room plays a match by those
  // rules; with `public`, it is listed for anyone with an account to join. With `practice`, it is a
  // practice room (docs/architecture.md#practice-rooms): for the creator alone, they play the role
  // they name, AI players take the other seats, and the game starts; for the creator with friends,
  // it is a waiting room, where the creator sits and invites AI players to the seats nobody takes.
  // With `randomFields`, every game draws its word lists anew (drawFields in protocol.ts), and
  // `fields` may be empty; a practice room takes none.
  'room:create': z.object({
    game: z.string().max(32),
    language: z.enum(LANGUAGES),
    fields,
    randomFields: z.boolean().optional(),
    settings: settings.optional(),
    play,
    match: match.optional(),
    public: z.boolean().optional(),
    practice: practice.optional(),
  }),
  // Whoever has been in the room names its ID as well, so that a code that has since gone to
  // another room doesn't take them there. A client that has no ID to give may leave the field out
  // or send null. A friend who was invited gives the invitation in place of the code (friends.ts);
  // one of the two must be there.
  'room:join': z.object({
    code: code.optional(),
    roomId: roomId.nullish(),
    play,
    invitation: z.string().max(64).optional(),
  }),
  'room:watch': z.object({ code, roomId: roomId.nullish() }),
  'room:leave': none,
  'room:emote': z.object({ emote: z.enum(EMOTES) }),
  // A player's rating of the game that has just ended, one of the game's, which the room checks, or
  // null to dismiss the question; and their guess of who its AI players were, in the game's shape,
  // which the game checks, or null to skip it (docs/architecture.md#ratings). Each names the game.
  'room:rate': z.object({ gameId, rating: z.string().max(32).nullable() }),
  'room:guessAgents': z.object({ gameId, guess: z.unknown() }),
  // A member reports another to the operator, with a note that the rules in feedback.ts judge.
  'room:report': z.object({ playerId, text: z.string().optional() }),
  // The chair's controls. The settings change the word lists, whether every game draws them anew,
  // the game's own settings, the chair's own words, as the text they were pasted as
  // (parseCustomWords in custom.ts), or any of them.
  'room:settings': z.object({
    fields: fields.optional(),
    randomFields: z.boolean().optional(),
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
  // The chair removes a player, named by their player ID or by their seat in the game, as the game
  // reads it, where the room doesn't name who sits there (GameModule.playerAt).
  'room:remove': z.union([z.object({ playerId }), z.object({ seat: z.unknown() })]),
  'room:chair': z.object({ playerId }),
  'room:dismiss': none,
  'room:close': none,
  // Friends and invitations (friends.ts), for accounts. The search finds an account by its whole
  // username. A request names the other account by its username, or by the player's ID in the room
  // that the connection is in; the rest name a friend, or the other side of a request, by username,
  // and an invitation by its ID.
  'friends:list': none,
  'friends:find': z.object({ username: name }),
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
  // `consent` is the version of the notice on how games are recorded that the player agreed to
  // (RECORDS_NOTICE_VERSION in accounts.ts); the rules answer a missing or an older one.
  register: z.object({ username: z.string(), password, consent: z.number().int().optional() }),
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

// What the game server and the agent say to each other (agent.ts): a ping, or one of a game's own
// requests (for the team word guessing game, games/keywords/schemas.ts, and for the hidden word
// game, games/impostor/schemas.ts), whose kinds are each of one game. Each side reads the other's lines with these, and takes nothing that has a field more
// or less than it should: the agent plays only with what a seat may see, and the server takes only
// an answer that it can check.
export const AGENT_REQUEST = z.discriminatedUnion('kind', [
  z.strictObject({ v: z.literal(1), kind: z.literal('ping') }),
  ...KEYWORDS_AGENT_REQUESTS,
  ...IMPOSTOR_AGENT_REQUESTS,
]);

// How the agent came to an answer, in any game's shape (AgentNote), as the AI's log of a game keeps
// it (server/src/core/agentLog.ts).
export const ANY_AGENT_NOTE = z.union([KEYWORDS_NOTE, IMPOSTOR_NOTE, AGENT_NOTE]);

export const AGENT_REPLY = z.union([
  z.strictObject({ ok: z.literal(true), kind: z.literal('ping'), model: z.string().max(200) }),
  ...KEYWORDS_AGENT_REPLIES,
  ...IMPOSTOR_AGENT_REPLIES,
  z.strictObject({ ok: z.literal(false), error: z.enum(AGENT_ERRORS), note: ANY_AGENT_NOTE.optional() }),
]);
