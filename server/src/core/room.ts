import {
  cleanName,
  drawFields,
  EMOTE_COOLDOWN_MS,
  MAX_PLAYERS,
  MAX_SCREENS,
  nextChair,
  parseCustomWords,
  sameName,
  STREAK_MIN,
  wordKey,
  type Ack,
  type AgentPersona,
  type BoardWord,
  type DuoNotice,
  type GamePoints,
  type Language,
  type MatchRules,
  type PublicRoom,
  type Rank,
  type RoomPhase,
  type RoomView,
  type Streak,
  type StreakNotice,
  type Title,
} from '@reviewer2/shared';
import { AgentLog, type AgentLogData, type AgentStep } from './agentLog';
import { done, fail, refusalOf } from './answers';
import type { AgentFeats, GameContext, GameModule, GameOutcome, PlayerResult, Viewer } from './game';
import { GameLog, type GameEnding, type GameLogData, type GameLogEntry, type GameLogEvent } from './gameLog';
import { newPlayerId } from './identity';
import { Match, type Present } from './match';
import { pinyinOf } from './pinyin';
import { randomId, type Rng } from './random';
import { drawWords, type WordLibrary } from './words';

// One room: who is in it, who chairs it, which connections belong to whom, and the game's data.
// The socket layer (socket.ts) calls these methods and then sends everyone the new state.
// Every change bumps `rev`, so clients can tell old snapshots from new ones.
//
// A method asks the game module first and changes the room afterwards. A module that throws
// then leaves the room exactly as it was, instead of half changed.

// A member who is logged in to an account: which account, the handle of its public profile
// (docs/architecture.md#public-profiles), the address of its avatar, or null for the default one,
// which the client draws from the name, its academic rank, which everyone in the room sees beside
// the name (docs/architecture.md#academic-ranks), and whether the operator has let it have AI
// players in the rooms it chairs (docs/architecture.md#ai-players).
export interface MemberAccount {
  id: number;
  handle: string;
  avatar: string | null;
  rank: Rank;
  agents: boolean;
}

export interface Member {
  id: string;
  key: string;
  name: string;
  // The account, for a member who is logged in, whose name is then the username.
  account: MemberAccount | null;
  sockets: Set<string>;
  // The keys that the member's browsers have as guests, the last MAX_BROWSERS of them, whether or
  // not they are connected now: whoever the chair removes stays out by these too (remove()).
  browsers: Set<string>;
  offlineSince: number | null;
  // The persona of an AI player (docs/architecture.md#ai-players), which never has a connection, a
  // browser or an account, or null for a person.
  agent: AgentPersona | null;
  // Whether an AI plays for this person, who has been offline long enough in their turn, until they
  // come back. The driver of the AI players (agents.ts) says when.
  takenOver: boolean;
}

// Whether the server's agent answers now (docs/architecture.md#ai-players), as the driver of the AI
// players finds out (agents.ts). A server without an agent has none, and no AI players.
export interface AgentState {
  readonly up: boolean;
}

// How many browsers a member is remembered from. A player plays from a phone and a laptop, not
// from dozens of browsers; a limit keeps a member who comes with a new token every time from
// growing the room, and from filling the removals with keys.
export const MAX_BROWSERS = 10;

// Someone the chair removes from a private room must wait this long before they may come back;
// from a public room, whose code anyone can read off the list, they stay out for as long as the
// room lasts. Either way, nobody else may take their name for this long, so that they don't seem
// to have come straight back.
export const REMOVED_FOR_MS = 2 * 60_000;
// How many removals a room remembers. Only the chair adds to them, so the limit is for a chair who
// removes newcomer after newcomer, which would otherwise grow the room for as long as it lasts;
// past it, the earliest removal is forgotten.
export const MAX_REMOVED = 200;

// One removal: the name the member had, until when they must wait and their name is held, whether
// they stay out for good, as from a room that was public when they were removed, and every key
// they stay out by.
interface Removal {
  name: string;
  until: number;
  forGood: boolean;
  keys: string[];
}

export interface RoomOptions {
  code: string;
  game: GameModule;
  language: Language;
  // As chooseFields() returned them.
  fields: string[];
  // Whether every game draws its lists anew (RoomView.randomFields).
  randomFields?: boolean;
  // Listed on the home page for anyone with an account to join (docs/architecture.md#public-rooms).
  public?: boolean;
  // Made from the home page to play with AI players (docs/architecture.md#practice-rooms).
  practice?: boolean;
  words: WordLibrary;
  rng: Rng;
  now: () => number;
  // How many times an account has won a title, where accounts are on (GameContext.titleCount).
  titleCount?: ((accountId: number, title: Title) => number) | null;
  agents?: AgentState | null;
}

// The fields that a room is to play with, once each, or why it can't play with them: one of them
// isn't in the library, or together with the chair's own words they have too few words in the
// room's language. Rooms are created and their fields changed only through this check, so a room
// that exists can always deal a game. A room that draws its fields anew for every game (`random`)
// keeps the ones chosen for when it stops, and only needs a field to draw from.
export function chooseFields(
  words: WordLibrary,
  fields: readonly string[],
  language: Language,
  needed: number,
  custom: readonly BoardWord[] = [],
  random = false,
): Ack<{ fields: string[] }> {
  const chosen = [...new Set(fields)];
  if (!chosen.every((id) => words.has(id))) return fail('bad_fields');
  if (random) return usableFields(words, language, needed).length > 0 ? { ok: true, fields: chosen } : fail('no_words');
  if (poolOf(words, chosen, language, custom).length < needed) return fail('no_words');
  return { ok: true, fields: chosen };
}

// The fields with enough words in a language for a game of their own, which a random draw draws
// from (drawFields in shared/src/protocol.ts).
export function usableFields(words: WordLibrary, language: Language, needed: number): string[] {
  return words
    .fields()
    .filter((field) => field.counts[language] >= needed)
    .map((field) => field.id);
}

// Every word that a room's games draw from: the words of its fields and the chair's own words,
// once each. A word of the chair's that is the same word as one of the fields' is left out.
function poolOf(words: WordLibrary, fields: readonly string[], language: Language, custom: readonly BoardWord[]) {
  const pool = words.pool(fields, language);
  const keys = new Set(pool.map((word) => wordKey(word.word)));
  return [...pool, ...custom.filter((word) => !keys.has(wordKey(word.word)))];
}

// The same fields in another order are no change.
const sameFields = (a: readonly string[], b: readonly string[]) => [...a].sort().join() === [...b].sort().join();

// What an AI did in a game that finished, for its page (docs/architecture.md#ai-players): as an AI
// player, in its seat, with what the game counts of it (GameModule.agentFeats); or for a person who
// was offline, by their player ID, with their account, if any.
export interface AgentPlay {
  playerId: string;
  persona: AgentPersona;
  takeover: boolean;
  accountId: number | null;
  side: string | null;
  role: string | null;
  won: boolean | null;
  feats: AgentFeats | null;
}

// What the record keeps of a game that has come to an end (Room.record()).
export interface GameRecordData {
  ending: GameEnding;
  outcome: GameOutcome | null;
  durationMs: number;
  setup: unknown;
  log: GameLogData | null;
  overflowed: boolean;
  agentLog: AgentLogData | null;
  accounts: { playerId: string; accountId: number }[];
  counts: { accounts: number; guests: number; agents: number };
  takeover: boolean;
  agentPlays: AgentPlay[];
  match: boolean;
  practice: boolean;
  language: string;
  fields: string[];
  rules: number | null;
  words: string;
}

export class Room {
  readonly id = randomId();
  readonly code: string;
  readonly game: GameModule;
  readonly language: Language;
  readonly createdAt: number;
  fields: string[];
  // Whether every game draws its fields anew, at random, which it then plays with alone
  // (RoomView.randomFields).
  randomFields: boolean;
  // The fields that the game being played, or just ended, drew its words from.
  #gameFields: string[] = [];
  // The chair's own words, which the games draw from along with the fields, each with its
  // pinyin when it is Chinese (docs/games/keywords.md#custom-words). A private room's alone.
  customWords: BoardWord[] = [];
  public: boolean;
  // A practice room (docs/architecture.md#practice-rooms), made to play with AI players. It stays
  // one whoever chairs it, and may have AI players whatever the chair's account.
  readonly practice: boolean;
  phase: RoomPhase = 'lobby';
  rev = 0;
  chairId: string | null = null;
  data: unknown;
  // The game being played or just ended, until the room goes back to the waiting room.
  gameId: string | null = null;
  // How many games have been started here.
  round = 0;
  // The match that the room is playing, or null for a room that isn't a match.
  match: Match | null = null;
  lastActivity: number;
  // When a connection last came to the room or went. The sweep keeps this at the present while
  // anyone is connected, so it tells for how long nobody has been.
  lastSeen: number;
  // By player ID, in the order in which they joined. Whatever goes by "who joined first", such as
  // the next chair, reads this order, and so does the list that players see.
  readonly members = new Map<string, Member>();
  // By connection, the key of the connection that put the screen up.
  readonly screens = new Map<string, string>();
  // The keys of the screens that were up when the room was listed. They stay, as the guests who
  // were there do, when a screen in a public room takes an account with a seat (socket.ts).
  readonly #keptScreens = new Set<string>();
  // The chair's removals, the earliest first, up to MAX_REMOVED, and the same by every key the
  // removed stay out by. A key removed again goes to the later removal.
  readonly #removals = new Set<Removal>();
  readonly #removed = new Map<string, Removal>();
  // Who has reported whom here: by the member key of the one reported, the keys of those who
  // reported them. Each pair is kept once per room.
  readonly #reported = new Map<string, Set<string>>();
  // When each member last sent a quick reaction, by member key, so that neither another tab nor
  // leaving and coming back starts the wait again.
  readonly #emoted = new Map<string, number>();
  // Those who left during the current game, by player ID, with the member key, the name and the
  // account they had, so that the game can still tell whose was a move they made before they left,
  // as a match's score, a replay and the record of the game need to, and the persona of an AI
  // player among them.
  readonly #gone = new Map<
    string,
    { key: string; name: string; accountId: number | null; agent: AgentPersona | null }
  >();
  // The log of the game being played or just ended (docs/architecture.md#game-records), from its
  // start until the room goes back to the waiting room, and the AI's own log beside it.
  #log: GameLog | null = null;
  #agentLog: AgentLog | null = null;
  // How the game began, as the game describes it (GameModule.setup), for its record.
  #setup: unknown = null;
  // How the current game came to an end, for its record, once it has: by itself, withdrawn by the
  // chair, or cut short when the room closed (cut()). Null while it is on.
  #ending: GameEnding | null = null;
  // How many entries the log had when the game ended, or when what the groups said after the end
  // was last handed to the record (review()): those after it are still to be kept. Null while the
  // game is on.
  #reviewed: number | null = null;
  // Whether an AI has played in the current game, as an AI player or for someone who was offline:
  // such a game brings nobody points, a streak or a friend title (docs/architecture.md#ai-players).
  #agentsPlayed = false;
  // Those an AI has played for while they were offline in the current game, by player ID, with the
  // persona it played as.
  readonly #tookOverFor = new Map<string, AgentPersona>();
  readonly #agents: AgentState | null;
  // The streaks that the game which has just ended brought the members with accounts to, by player
  // ID, from STREAK_MIN games on (noteStreak), until the room leaves the ended game behind.
  readonly #streaks = new Map<string, Streak>();
  // The titles that the game which has just ended brought each member's friends who played in it,
  // by the member's player ID (noteDuos), until the room leaves the ended game behind.
  readonly #duos = new Map<string, DuoNotice[]>();
  // Since when the room has been in the waiting room this time.
  #lobbySince: number;
  readonly #words: WordLibrary;
  // The words of the games so far, which the next game avoids for as long as it can.
  #usedWords: ReadonlySet<string> = new Set();
  readonly #rng: Rng;
  readonly #now: () => number;
  readonly #titleCount: ((accountId: number, title: Title) => number) | null;

  constructor(options: RoomOptions) {
    this.code = options.code;
    this.game = options.game;
    this.language = options.language;
    this.fields = [...options.fields];
    this.randomFields = options.randomFields ?? false;
    this.public = options.public ?? false;
    this.practice = options.practice ?? false;
    this.#words = options.words;
    this.#rng = options.rng;
    this.#now = options.now;
    this.#titleCount = options.titleCount ?? null;
    this.#agents = options.agents ?? null;
    this.createdAt = options.now();
    this.lastActivity = this.createdAt;
    this.lastSeen = this.createdAt;
    this.#lobbySince = this.createdAt;
    this.data = options.game.create(options.language);
  }

  get context(): GameContext {
    return {
      phase: this.phase,
      language: this.language,
      rng: this.#rng,
      chairId: this.chairId,
      now: this.#now,
      keyOf: (id) => this.members.get(id)?.key ?? this.#gone.get(id)?.key ?? id,
      nameOf: (id) => this.members.get(id)?.name ?? this.#gone.get(id)?.name ?? '',
      isOnline: (id) => this.isOnline(id),
      agentOf: (id) => this.members.get(id)?.agent ?? this.#gone.get(id)?.agent ?? null,
      playerIds: () => [...this.members.keys()],
      titleCount: (id, title) => this.#titleCountOf(id, title),
      awardsTitles: (id) => this.#accountIdOf(id) !== null && this.#titleCount !== null && !this.#agentsPlayed,
    };
  }

  // The account of a member, or of one who has left during the game, or null for a guest.
  #accountIdOf(id: string): number | null {
    const member = this.members.get(id);
    return member ? (member.account?.id ?? null) : (this.#gone.get(id)?.accountId ?? null);
  }

  // How many times the account of a member, or of one who has left during the game, has won a
  // title. A record that can't be read leaves the count out, as for a guest, and so does a game
  // that an AI has played in, which awards no title (docs/architecture.md#ai-players): the game
  // goes on.
  #titleCountOf(id: string, title: Title): number | null {
    const accountId = this.#accountIdOf(id);
    if (accountId === null || !this.#titleCount || this.#agentsPlayed) return null;
    try {
      return this.#titleCount(accountId, title);
    } catch {
      return null;
    }
  }

  // Marks a change: everyone gets a new snapshot.
  changed(): void {
    this.rev += 1;
    this.lastActivity = this.#now();
  }

  // A person is online with a connection; an AI player while the server's agent answers.
  isOnline(id: string): boolean {
    const member = this.members.get(id);
    if (member?.agent) return this.#agents?.up ?? false;
    return (member?.sockets.size ?? 0) > 0;
  }

  // Whether the chair may invite AI players now, and a player who is offline in their turn is played
  // for (docs/architecture.md#ai-players): the server has an agent, the room is private and plays no
  // match, and it is a practice room or the operator has let the chair's account have AI players.
  // AI players who are in the room already stay when this stops being so, as when the chair passes
  // to someone else.
  agentsAllowed(): boolean {
    const chair = this.chairId === null ? undefined : this.members.get(this.chairId);
    return (
      this.#agents !== null && !this.public && this.match === null && (this.practice || chair?.account?.agents === true)
    );
  }

  // Whether any AI players are in the room.
  hasAgents(): boolean {
    for (const member of this.members.values()) if (member.agent) return true;
    return false;
  }

  memberByKey(key: string): Member | undefined {
    for (const member of this.members.values()) if (member.key === key) return member;
    return undefined;
  }

  memberBySocket(socketId: string): Member | undefined {
    for (const member of this.members.values()) if (member.sockets.has(socketId)) return member;
    return undefined;
  }

  onlineCount(): number {
    let count = 0;
    for (const member of this.members.values()) if (member.sockets.size > 0) count += 1;
    return count;
  }

  // Why nobody new can come in with this key for now, whatever they call themselves: the chair
  // removed them, or the room is full.
  refusal(key: string): 'removed' | 'removed_recently' | 'room_full' | null {
    return this.removal(key) ?? (this.full() ? 'room_full' : null);
  }

  // Whether the chair removed whoever has any of these keys: `removed` for good, from a room that
  // was public at the time, `removed_recently` while the wait after a removal from a private room
  // lasts, or null. A browser has a key as a guest and, logged in, its account's, and whoever was
  // removed by either stays out (socket.ts).
  removal(...keys: string[]): 'removed' | 'removed_recently' | null {
    const found = keys.map((key) => this.#removed.get(key));
    if (found.some((removal) => removal?.forGood)) return 'removed';
    return found.some((removal) => removal && removal.until > this.#now()) ? 'removed_recently' : null;
  }

  // A new member, who has come to play or only to watch. The first one chairs the room. A member
  // with an account comes with its username as the name.
  join(key: string, rawName: string, play = false, account: MemberAccount | null = null): Ack<{ member: Member }> {
    const refusal = this.refusal(key);
    if (refusal) return fail(refusal);
    const name = cleanName(rawName);
    if (name === null) return fail('name_invalid');
    if (this.#nameTaken(name)) return fail('name_taken');

    const member: Member = {
      id: newPlayerId(),
      key,
      name,
      account: account && { ...account },
      sockets: new Set(),
      browsers: new Set(),
      offlineSince: null,
      agent: null,
      takenOver: false,
    };
    // The newcomer becomes a member only once the module has taken them, so the context learns
    // their key here.
    const context = this.context;
    const keyOf = (id: string) => (id === member.id ? key : context.keyOf(id));
    const data = this.game.join(this.data, { ...context, keyOf }, member.id, play);
    this.members.set(member.id, member);
    this.chairId ??= member.id;
    this.data = data;
    // During a game, the log also says where the game has put the newcomer, such as the group it
    // seated them in.
    const seat = this.game.seated?.(data, member.id);
    this.#note(member.id, 'join', { play, ...(seat === undefined ? {} : { seat }) });
    this.changed();
    return { ok: true, member };
  }

  // The chair invites an AI player as `persona` to a seat, which the game reads (GameModule.seatAgent),
  // in the waiting room of a room that may have them (agentsAllowed). An AI player has no
  // connection, browser or account, and is known by its persona alone, so it goes by no name that a
  // person could take.
  addAgent(persona: AgentPersona, seat: unknown): Ack<{ member: Member }> {
    if (!this.agentsAllowed() || !this.game.seatAgent) return fail('agents_not_allowed');
    if (this.phase !== 'lobby') return fail('wrong_phase');
    if (this.full()) return fail('room_full');
    const member: Member = {
      id: newPlayerId(),
      key: `agent:${randomId()}`,
      name: persona,
      account: null,
      sockets: new Set(),
      browsers: new Set(),
      offlineSince: null,
      agent: persona,
      takenOver: false,
    };
    const context = this.context;
    const seated = this.game.seatAgent(
      this.data,
      {
        ...context,
        keyOf: (id) => (id === member.id ? member.key : context.keyOf(id)),
        agentOf: (id) => (id === member.id ? persona : context.agentOf(id)),
      },
      member.id,
      seat,
    );
    if (!seated.ok) return refusalOf(seated);
    this.members.set(member.id, member);
    this.data = seated.data;
    this.changed();
    return { ok: true, member };
  }

  // An AI plays for a person who has been offline in their turn, or stops when they are back
  // (docs/architecture.md#ai-players). Everyone sees whom it plays for. Returns whether that changed.
  takeOver(id: string, on: boolean): boolean {
    const member = this.members.get(id);
    if (!member || member.agent || member.takenOver === on) return false;
    member.takenOver = on;
    this.#note(null, 'takeover', { player: id, on });
    this.changed();
    return true;
  }

  // A member's connection, from a browser whose key as a guest is `browserKey`. Returns whether
  // the room looks any different with it, which it does only when it is the member's first: they
  // come online. Another tab of someone who is online is news to nobody.
  attach(member: Member, socketId: string, browserKey = member.key): boolean {
    const first = member.sockets.size === 0;
    member.sockets.add(socketId);
    member.browsers.delete(browserKey);
    member.browsers.add(browserKey);
    if (member.browsers.size > MAX_BROWSERS) member.browsers.delete(member.browsers.values().next().value as string);
    member.offlineSince = null;
    this.lastSeen = this.#now();
    if (first) this.changed();
    return first;
  }

  // Forgets a connection, whether it was a member's or a screen's. Returns whether the room looks
  // any different without it: a screen fewer, or a member who has gone offline with their last
  // connection.
  detach(socketId: string): boolean {
    this.lastSeen = this.#now();
    if (this.screens.delete(socketId)) {
      this.changed();
      return true;
    }
    const member = this.memberBySocket(socketId);
    if (!member) return false;
    member.sockets.delete(socketId);
    if (member.sockets.size > 0) return false;
    member.offlineSince = this.#now();
    this.changed();
    return true;
  }

  full(): boolean {
    return this.members.size >= MAX_PLAYERS;
  }

  // Whether a new screen with this key finds no room. In a public room a key has one screen at
  // most, so that nobody fills all five: a new one takes the place of those the key had.
  screensFull(key: string): boolean {
    return this.screens.size - this.#replacedBy(key).length >= MAX_SCREENS;
  }

  #replacedBy(key: string): string[] {
    return this.public ? this.screensOf(key) : [];
  }

  // The connections of the screens that a key has up.
  screensOf(key: string): string[] {
    return [...this.screens].filter(([, by]) => by === key).map(([id]) => id);
  }

  // Whether a screen with this key may be in the room although it is public, as the screens that
  // were up when it was listed may.
  screenKept(key: string): boolean {
    return this.#keptScreens.has(key);
  }

  // A screen, by the key of the connection that puts it up, in place of those it replaces (see
  // screensFull()), which are returned for the socket layer to close. That is also how a screen
  // that comes back before its old connection was found to be gone takes its own place.
  addScreen(socketId: string, key: string): string[] {
    const replaced = this.#replacedBy(key);
    for (const id of replaced) this.screens.delete(id);
    this.screens.set(socketId, key);
    this.lastSeen = this.#now();
    this.changed();
    return replaced;
  }

  // The chair sends every screen away. Returns their connections.
  dismissScreens(): string[] {
    const screens = [...this.screens.keys()];
    this.screens.clear();
    if (screens.length > 0) this.changed();
    return screens;
  }

  // A member goes for good: they left, the chair removed them, or they were offline too long in
  // the waiting room. Returns the connections they still had. The AI players go with the last
  // person, so that a room that nobody is in any more closes as an empty one.
  drop(id: string): string[] {
    const member = this.members.get(id);
    if (!member) return [];
    const data = this.game.leave(this.data, id);
    const over = this.#endsWith(data);
    if (this.phase !== 'lobby') {
      this.#gone.set(id, {
        key: member.key,
        name: member.name,
        accountId: member.account?.id ?? null,
        agent: member.agent,
      });
    }
    this.#note(id, 'leave');
    this.members.delete(id);
    this.#take(data, over);
    if (this.chairId === id) this.#passChair(this.#nextChair());
    this.changed();
    if (!member.agent && ![...this.members.values()].some((other) => !other.agent)) {
      for (const other of [...this.members.keys()]) this.drop(other);
    }
    return [...member.sockets];
  }

  // A member's quick reaction, at most one every EMOTE_COOLDOWN_MS. It changes nothing in the room:
  // the socket layer passes it on, and neither a snapshot nor the log of the game carries it. One
  // that comes too soon is refused with how long is left, so that the tab it came from, which may
  // not be the one that sent the last, counts down the right wait. A clock that was set back counts
  // as a wait that is over, rather than one that lasts until the clock has caught up.
  // One that the game holds back for now (GameModule.mayEmote) is refused with emote_not_now, and
  // starts no wait.
  emote(id: string): Ack {
    const member = this.members.get(id);
    if (!member) return fail('not_member');
    if (this.game.mayEmote && !this.game.mayEmote(this.data, id, this.context)) return fail('emote_not_now');
    const now = this.#now();
    const since = now - (this.#emoted.get(member.key) ?? -Infinity);
    if (since >= 0 && since < EMOTE_COOLDOWN_MS)
      return { ...fail('emote_cooldown'), waitMs: EMOTE_COOLDOWN_MS - since };
    this.#emoted.set(member.key, now);
    return done;
  }

  // Every connection in the room: the members' and the screens'.
  connections(): string[] {
    return [...this.screens.keys(), ...[...this.members.values()].flatMap((member) => [...member.sockets])];
  }

  // A member with an account is called by its username, which changes on the account's page.
  rename(id: string, rawName: string): Ack {
    const name = cleanName(rawName);
    if (name === null) return fail('name_invalid');
    const member = this.members.get(id);
    if (!member) return fail('not_member');
    if (member.account) return fail('account_name');
    if (member.name === name) return done;
    if (this.#nameTaken(name, id)) return fail('name_taken');
    member.name = name;
    this.changed();
    return done;
  }

  // A member's account has a new username, a new avatar, a new rank, or AI players allowed or not.
  // The name changes too, unless someone else in the room has it, as a guest may have since before
  // the account was renamed: then the member keeps the name they had here. Returns whether the room
  // looks any different.
  updateAccount(id: string, username: string, avatar: string | null, rank: Rank, agents: boolean): boolean {
    const member = this.members.get(id);
    if (!member?.account) return false;
    const renamed = this.#takeUsername(member, username);
    const { account } = member;
    if (!renamed && account.avatar === avatar && account.rank === rank && account.agents === agents) return false;
    account.avatar = avatar;
    account.rank = rank;
    account.agents = agents;
    this.changed();
    return true;
  }

  // A guest's seat becomes an account's: the member logged in or registered while they were in the
  // room, and is found by the account's key from now on. The name becomes the username, as for
  // updateAccount(). False when the member isn't a guest here.
  adopt(id: string, key: string, username: string, account: MemberAccount): boolean {
    const member = this.members.get(id);
    if (!member || member.account) return false;
    if (this.game.rekey) this.data = this.game.rekey(this.data, id, member.key, key);
    this.match?.rekey(member.key, key);
    // Whoever reported the guest has reported the same player, whom they don't report anew.
    const reporters = this.#reported.get(member.key);
    this.#reported.delete(member.key);
    if (reporters) this.#reported.set(key, new Set([...(this.#reported.get(key) ?? []), ...reporters]));
    member.key = key;
    member.account = { ...account };
    this.#takeUsername(member, username);
    this.changed();
    return true;
  }

  // Gives a member their username as the name in the room, unless someone else here has it, and
  // says whether the name changed.
  #takeUsername(member: Member, username: string): boolean {
    const name = cleanName(username);
    if (name === null || name === member.name || this.#nameTaken(name, member.id)) return false;
    member.name = name;
    return true;
  }

  // Whether a member's report of another has been kept here already. The room only keeps who has
  // reported whom (docs/architecture.md#public-rooms), so that the same report isn't kept twice.
  reported(reporterKey: string, reportedKey: string): boolean {
    return this.#reported.get(reportedKey)?.has(reporterKey) ?? false;
  }

  // A member's report of another was kept.
  report(reporterKey: string, reportedKey: string): void {
    const by = this.#reported.get(reportedKey) ?? new Set<string>();
    this.#reported.set(reportedKey, by.add(reporterKey));
  }

  // --- the chair's controls ---------------------------------------------------------------

  // The chair lists the room on the home page, or takes it off, in the waiting room. A room with
  // words of the chair's own stays private: they are for a room of people who know each other.
  setPublic(value: boolean): Ack {
    if (this.phase !== 'lobby') return fail('wrong_phase');
    if (value && this.customWords.length > 0) return fail('custom_words_private');
    // A public room has no AI players (docs/architecture.md#ai-players).
    if (value && this.hasAgents()) return fail('agents_in_room');
    if (value) this.#list();
    else this.unlist();
    return done;
  }

  // Lists the room. The screens that are up stay, as the guests who are there do, now that a
  // screen takes an account with a seat (socket.ts).
  #list(): void {
    if (this.public) return;
    this.public = true;
    for (const key of this.screens.values()) this.#keptScreens.add(key);
    this.changed();
  }

  // The room goes off the list whatever the phase, as when the operator has barred the chair from
  // public rooms (socket.ts). Returns whether it was listed.
  unlist(): boolean {
    if (!this.public) return false;
    this.public = false;
    this.changed();
    return true;
  }

  // The chair changes the fields, whether every game draws them anew, the game's own settings, their
  // own words, or any of them, in the waiting room. All change together or none does: one that
  // won't do refuses the others with it.
  // The chair's words come as the text they were pasted as, and are checked as the editor checks
  // them (parseCustomWords); a public room takes none, since they are for a private one.
  setSettings(changes: {
    fields?: readonly string[];
    randomFields?: boolean;
    settings?: unknown;
    words?: string;
  }): Ack {
    if (this.phase !== 'lobby') return fail('wrong_phase');
    // A match plays all its games by the same settings, once one of them has counted.
    if (this.match?.status === 'on' && this.match.played > 0) return fail('match_locked');
    let custom = this.customWords;
    if (changes.words !== undefined) {
      const parsed = parseCustomWords(changes.words);
      if (parsed.tooMany || parsed.tooLong.length > 0) return fail('bad_words');
      if (this.public && parsed.words.length > 0) return fail('custom_words_private');
      custom = parsed.words.map((word) => {
        const pinyin = pinyinOf(word);
        const glosses = this.#words.glossesOf(word);
        return { word, ...(pinyin === null ? {} : { pinyin }), ...(glosses.length > 0 ? { glosses } : {}) };
      });
    }
    const random = changes.randomFields ?? this.randomFields;
    let fields = this.fields;
    if (changes.fields !== undefined || custom !== this.customWords || random !== this.randomFields) {
      const chosen = chooseFields(
        this.#words,
        changes.fields ?? this.fields,
        this.language,
        this.game.wordsNeeded,
        custom,
        random,
      );
      if (!chosen.ok) return chosen;
      fields = chosen.fields;
    }
    let data = this.data;
    if (changes.settings !== undefined) {
      const configured = this.game.configure(this.data, this.context, changes.settings);
      if (!configured.ok) return refusalOf(configured);
      data = configured.data;
    }
    const sameWords = custom.map(({ word }) => word).join('\n') === this.customWords.map(({ word }) => word).join('\n');
    if (data === this.data && sameFields(fields, this.fields) && sameWords && random === this.randomFields) return done;
    this.fields = fields;
    this.randomFields = random;
    this.customWords = custom;
    this.data = data;
    this.changed();
    return done;
  }

  // A start is for the waiting room that its sender saw: `round` is how many games the room had
  // started then. One that arrives after another start, such as from a second tab whose
  // connection had stalled, is stale, even when the room is back in the waiting room by now.
  //
  // The room draws the words itself, preferring those that it hasn't played with yet, and keeping
  // apart those that clash with each other, as far as it can. A room that draws its fields anew
  // draws them first, and tells nobody which they were but the game's record. `clashes` says how many pairs of
  // the words drawn clash all the same: it is 0 unless the draw found no way to keep them apart.
  start(round: number): Ack<{ clashes: number }> {
    if (round !== this.round) return fail('stale');
    if (this.phase !== 'lobby') return fail('wrong_phase');
    if (this.match && this.match.status !== 'on') return fail('match_over');
    if (!this.game.canStart(this.data, this.context)) return fail('cannot_start');
    const fields = this.randomFields
      ? drawFields(usableFields(this.#words, this.language, this.game.wordsNeeded), (below) => this.#rng.int(below))
      : this.fields;
    const pool = poolOf(this.#words, fields, this.language, this.customWords);
    const clash = this.game.wordsClash?.bind(this.game);
    const draw = drawWords(pool, this.game.wordsNeeded, this.#usedWords, this.#rng, clash);
    // chooseFields() has made sure of this, and the library doesn't change while the server runs.
    if (!draw) throw new Error(`the fields of room ${this.code} have too few words for a game`);
    const gameId = randomId();
    const context: GameContext = { ...this.context, phase: 'playing' };
    const data = this.game.start(this.data, context, draw.words, gameId);
    this.data = data;
    const agents: Record<string, string> = {};
    for (const member of this.members.values()) if (member.agent) agents[member.id] = member.agent;
    this.#log = new GameLog(this.game.id, gameId, this.#now(), this.#seating(data), agents);
    this.#agentLog = new AgentLog(gameId, this.#now());
    this.#setup = this.game.setup?.(data) ?? null;
    this.#ending = null;
    this.#reviewed = null;
    this.#agentsPlayed = Object.keys(agents).length > 0;
    this.#tookOverFor.clear();
    this.#usedWords = draw.used;
    this.#gameFields = [...fields];
    this.gameId = gameId;
    this.round += 1;
    this.phase = 'playing';
    this.#gone.clear();
    this.#streaks.clear();
    this.#duos.clear();
    // Whoever plays in a match's game is in its table from the start, with no points if new.
    if (this.match && this.game.match) {
      for (const id of this.game.match.lineup(this.data)) {
        const member = this.members.get(id);
        if (member) this.match.enter(member.key, member.name, member.account?.avatar ?? null);
      }
    }
    this.changed();
    return { ok: true, clashes: draw.clashes };
  }

  // A withdrawal names the game it is meant for, so that one sent late, for instance by a tab
  // that was offline, can't end the next game.
  //
  // The room only knows which game it has. Whether that game can still be withdrawn is for the
  // module to say, in the same words it has for any other action on a game that is over.
  withdraw(gameId: string): Ack {
    if (this.gameId === null || gameId !== this.gameId) return fail('stale');
    const result = this.game.withdraw(this.data, gameId);
    if (!result.ok) return refusalOf(result);
    this.#logChanges(result.data);
    this.#ended('withdrawn');
    this.data = result.data;
    this.phase = 'ended';
    this.changed();
    return done;
  }

  // Back to the waiting room after the game that the message names. A late one must not clear
  // away the result of a later game.
  //
  // In a match, this is the way to its next game, and a match that is over has none: the chair
  // starts another one or makes the room an ordinary one again (nextMatch).
  again(gameId: string): Ack {
    if (gameId !== this.gameId) return fail('stale');
    if (this.phase !== 'ended') return fail('wrong_phase');
    if (this.match && this.match.status !== 'on') return fail('match_over');
    this.data = this.game.again(this.data, this.context);
    this.#toLobby();
    this.changed();
    return done;
  }

  #toLobby(): void {
    this.gameId = null;
    this.phase = 'lobby';
    this.#lobbySince = this.#now();
    this.#gone.clear();
    this.#log = null;
    this.#agentLog = null;
    this.#setup = null;
    this.#ending = null;
    this.#reviewed = null;
    this.#agentsPlayed = false;
    this.#tookOverFor.clear();
    this.#streaks.clear();
    this.#duos.clear();
  }

  // --- matches ----------------------------------------------------------------------------

  // The room plays a match by these rules from now on. Only a game that can be played as a match
  // can, and only in the waiting room.
  startMatch(rules: MatchRules): Ack {
    if (!this.game.match) return fail('bad_match');
    if (this.phase !== 'lobby') return fail('wrong_phase');
    // A match has no AI players (docs/architecture.md#ai-players).
    if (this.hasAgents()) return fail('agents_in_room');
    this.data = this.game.match.setup(this.data, this.context, rules);
    this.match = new Match(rules);
    this.changed();
    return done;
  }

  // The chair ends the match early. A game in progress is withdrawn, and counts for nothing. The
  // players are ranked as they stand, but nobody is awarded a title (docs/architecture.md#matches).
  endMatch(matchId: string): Ack {
    if (!this.match || this.match.id !== matchId) return fail('stale');
    if (this.match.status !== 'on') return fail('match_over');
    if (this.phase === 'playing' && this.gameId !== null) {
      const result = this.game.withdraw(this.data, this.gameId);
      if (!result.ok) return refusalOf(result);
      this.#logChanges(result.data);
      this.#ended('withdrawn');
      this.data = result.data;
      this.phase = 'ended';
    }
    this.match.finish('stopped', this.#present);
    this.changed();
    return done;
  }

  // After a match, the chair starts another one, by `rules`, or makes the room an ordinary one
  // again, by null. Either takes the room back to the waiting room.
  nextMatch(matchId: string, rules: MatchRules | null): Ack {
    if (!this.match || this.match.id !== matchId) return fail('stale');
    if (this.match.status === 'on') return fail('wrong_phase');
    const hooks = this.game.match;
    if (!hooks) return fail('bad_match');
    const ended = this.phase === 'ended';
    const data = hooks.setup(ended ? this.game.again(this.data, this.context) : this.data, this.context, rules);
    this.data = data;
    if (ended) this.#toLobby();
    this.match = rules && new Match(rules);
    this.changed();
    return done;
  }

  // Who has a member key in the room now, for the match.
  #present: Present = (key) => {
    const member = this.memberByKey(key);
    return member ? { id: member.id, name: member.name, avatar: member.account?.avatar ?? null } : null;
  };

  // A game of a match has ended by itself: the match adds up its score. A game that the chair
  // withdrew ends without this, and counts for nothing.
  #scoreGame(): void {
    if (!this.match || this.match.status !== 'on' || !this.game.match || this.gameId === null) return;
    const scores = this.game.match.score(this.data, this.context);
    if (scores) this.match.score(this.gameId, scores, this.#present);
  }

  // A game may have nothing to shuffle, as a match's game whose groups are drawn when it starts.
  shuffle(): Ack {
    if (this.phase !== 'lobby') return fail('wrong_phase');
    const data = this.game.shuffle(this.data, this.context);
    if (data === this.data) return done;
    this.data = data;
    this.changed();
    return done;
  }

  // An AI player doesn't watch: sending it to the spectators removes it from the room, as
  // remove() does, and the chair may invite it again.
  bench(id: string): Ack {
    const member = this.members.get(id);
    if (!member) return fail('no_such_player');
    if (member.agent) {
      this.#note(this.chairId, 'remove', { player: id });
      this.drop(id);
      return done;
    }
    const data = this.game.bench(this.data, this.context, id);
    if (data !== this.data) this.#note(this.chairId, 'bench', { player: id });
    this.#update(data);
    return done;
  }

  // Removes a member, who then stays out, by their member key and by the keys that their browsers
  // have as guests, so that a player who is logged in can't come back as a guest. Whether the room
  // is public now decides for how long: for good, or for REMOVED_FOR_MS, whatever the room becomes
  // later. Returns the connections they still had, every key they stay out by and what they hear:
  // what room:join would answer them.
  // An AI player has nothing to stay out by, and the chair may invite it again.
  remove(id: string): Ack<{ sockets: string[]; keys: string[]; reason: 'removed' | 'removed_recently' }> {
    const member = this.members.get(id);
    if (!member) return fail('no_such_player');
    this.#note(this.chairId, 'remove', { player: id });
    const sockets = this.drop(id);
    if (member.agent) return { ok: true, sockets, keys: [], reason: 'removed_recently' };
    const removal: Removal = {
      name: member.name,
      until: this.#now() + REMOVED_FOR_MS,
      forGood: this.public,
      keys: [...new Set([member.key, ...member.browsers])],
    };
    this.#removals.add(removal);
    for (const key of removal.keys) this.#removed.set(key, removal);
    this.forgetOldRemovals();
    while (this.#removals.size > MAX_REMOVED) this.#forget(this.#removals.values().next().value as Removal);
    return { ok: true, sockets, keys: removal.keys, reason: this.public ? 'removed' : 'removed_recently' };
  }

  // The chair goes to someone who is there to take it. Handed to a member who has been offline
  // for a while, it would pass on again at the next sweep, to whoever joined first, without a
  // word to anyone.
  handOver(id: string): Ack {
    const member = this.members.get(id);
    if (!member) return fail('no_such_player');
    if (member.agent) return fail('player_is_agent');
    if (!this.isOnline(id)) return fail('player_offline');
    this.#passChair(id, this.chairId);
    this.changed();
    return done;
  }

  // The chair passes to a member, or to nobody, from the chair who handed it on, or from the room
  // itself. The log notes it during a game.
  #passChair(id: string | null, by: string | null = null): void {
    if (id === this.chairId) return;
    this.chairId = id;
    if (id !== null) this.#note(by, 'chair', { player: id });
  }

  // A game message from a member. Whatever the game had due by now happens first, so that a
  // message which arrives after its turn's time has run out finds the turn over, even when the
  // timer that ends it hasn't fired yet. `agent` is the persona of an AI that sends it for a
  // person who is offline in their turn (docs/architecture.md#ai-players).
  act(id: string, type: string, payload: unknown, agent?: AgentPersona): Ack {
    this.expire();
    const result = this.game.handle(this.data, this.context, id, type, payload);
    if (!result.ok) return refusalOf(result);
    if (result.data !== this.data) {
      this.#noteMessage(id, type, payload, agent);
      if (agent !== undefined && this.phase === 'playing') {
        this.#agentsPlayed = true;
        this.#tookOverFor.set(id, agent);
      }
    }
    this.#update(result.data);
    return done;
  }

  // Notes a game's message that changed the game, as the game says to (GameModule.logged): what
  // it carried and what the player said, or nothing of it at all, as of a card chosen. Once the game
  // has ended, and until the room leaves it behind, the log goes on with what the players say as
  // they talk it over, after its `end`, and nothing else (review()).
  #noteMessage(id: string, type: string, payload: unknown, agent?: AgentPersona): void {
    if ((this.phase !== 'playing' && this.phase !== 'ended') || !this.#log) return;
    const note = this.game.logged ? this.game.logged(type, payload) : {};
    if (note === null || (this.phase === 'ended' && note.said === undefined)) return;
    this.#log.add(this.#now(), id, type, { data: note.data, said: note.said, agent });
  }

  // Notes a step of an AI in the AI's log of the game it was asked for, `gameId`, at `at` on the
  // room's clock (agentLog.ts). Once that game is over, there is nothing to note it in: an answer
  // that comes after the end of its game goes nowhere, and never into the next game's log.
  noteAgent(gameId: string | null, at: number, step: Omit<AgentStep, 't'>): void {
    if (this.phase === 'playing' && gameId !== null && gameId === this.gameId) this.#agentLog?.add(at, step);
  }

  // Whether an AI has played in the current game, as an AI player or for someone who was offline.
  get agentsPlayed(): boolean {
    return this.#agentsPlayed;
  }

  // Notes one of the room's own events in the log of the game being played
  // (docs/architecture.md#game-records). Outside a game, there is nothing to note it in.
  #note(by: string | null, type: GameLogEvent, data?: unknown): void {
    if (this.phase === 'playing') this.#log?.add(this.#now(), by, type, { data });
  }

  // Ends the log of the game, which has come to an end in this way. A game that finished by itself
  // ends with a plain `end`; one cut short says how, and why the room closed.
  #ended(ending: GameEnding, why?: string): void {
    this.#note(null, 'end', ending === 'finished' ? undefined : { ending, ...(why === undefined ? {} : { why }) });
    this.#ending = ending;
    this.#reviewed = this.#log?.size ?? null;
  }

  // The room closes while its game is on: the game ends there, unfinished, for its record
  // (docs/architecture.md#game-records): `interrupted` when the server stops, and otherwise
  // `abandoned`, for `why` the room closed, as the socket layer says: its chair closed it
  // ("chair"), its last person left ("empty"), or nobody was online, or nothing happened, in it for
  // too long ("idle", "stale"). Returns whether there was a game to end; record() has it then. The
  // room is closing, so nothing else about it changes.
  cut(why: string): boolean {
    if (this.phase !== 'playing' || this.#ending !== null) return false;
    if (why === 'restart') this.#ended('interrupted');
    else this.#ended('abandoned', why);
    return true;
  }

  // How the current game came to an end, or null while it is on or when there is none.
  get ending(): GameEnding | null {
    return this.#ending;
  }

  // Where everyone in the room is in the game, by player ID, as the game describes each of them
  // (GameModule.seated), for how the game began; null for a game that doesn't say.
  #seating(data: unknown): Record<string, unknown> | null {
    if (!this.game.seated) return null;
    return Object.fromEntries([...this.members.keys()].map((id) => [id, this.game.seated?.(data, id)]));
  }

  // Whether the game has ended by itself with this data, such as when a team wins. A game may
  // end with any change to its data, not only with one of its own messages: a module is free to
  // end a game when a player leaves it or is moved to the spectators.
  #endsWith(data: unknown): boolean {
    return this.phase === 'playing' && this.game.isOver(data);
  }

  // What the game keeps in the log of a change of its own (GameModule.logChanges), from the data
  // the room has to `data`: such as where things stood when a turn ended, or when the chair
  // withdrew the game. It goes into the log before the change, and before the end if the change
  // brought it.
  #logChanges(data: unknown): void {
    if (this.phase !== 'playing' || !this.#log || !this.game.logChanges) return;
    for (const note of this.game.logChanges(this.data, data)) {
      this.#log.add(this.#now(), null, note.type, { data: note.data });
    }
  }

  // Takes the game's new data, and the end of the game if the data brought it. What the game keeps
  // in the log of the change itself comes first.
  #take(data: unknown, over: boolean): void {
    this.#logChanges(data);
    this.data = data;
    if (!over) return;
    this.#ended('finished');
    this.phase = 'ended';
    this.#scoreGame();
  }

  // Takes what a module answered to a message or to the chair's bench. A module that gives back
  // the data it was given, as for a player who asks for the seat they are in, has changed
  // nothing, and then the room hasn't either: nobody is sent a snapshot.
  #update(data: unknown): void {
    if (data === this.data) return;
    this.#take(data, this.#endsWith(data));
    this.changed();
  }

  // How each player did in the game that has just ended, as the game says, or null when it counts
  // for no record. Only an ended game has results.
  results(): PlayerResult[] | null {
    return this.phase === 'ended' ? (this.game.results?.(this.data, this.context) ?? null) : null;
  }

  // The game that has just ended, to watch again, as the game gives it, or null when there is
  // nothing to keep (GameModule.replay). A room with words of the chair's own keeps none: the
  // words stay with the room, and a replay would carry those that were on the board
  // (docs/games/keywords.md#custom-words).
  replay(): unknown {
    if (this.phase !== 'ended' || this.customWords.length > 0) return null;
    return this.game.replay?.(this.data, this.context) ?? null;
  }

  // The streak that the game which has just ended brought a member to, which the socket layer tells
  // the room once it has kept the records (docs/architecture.md#streaks). One of STREAK_MIN games or
  // more goes into the snapshots, which say whose it is and who may see it (views); a shorter one is
  // nobody's business. Returns whether the room looks any different.
  noteStreak(id: string, streak: Streak): boolean {
    if (this.phase !== 'ended' || !this.members.has(id) || streak.length < STREAK_MIN) return false;
    this.#streaks.set(id, streak);
    this.changed();
    return true;
  }

  // The streaks of the ended game as a viewer may see them: every winning streak, for the whole
  // room and its screens to cheer, and the viewer's own losing streak, which nobody else is told
  // of. Whoever has left the room since is left out.
  #streakNotices(viewer: Viewer): StreakNotice[] {
    const notices: StreakNotice[] = [];
    for (const [playerId, streak] of this.#streaks) {
      const own = 'playerId' in viewer && viewer.playerId === playerId;
      if (this.members.has(playerId) && (streak.kind === 'wins' || own)) notices.push({ playerId, ...streak });
    }
    return notices;
  }

  // The titles that the game which has just ended brought a member's friends who played in it,
  // which the socket layer tells the room once it has kept the records
  // (docs/architecture.md#friend-duos). They go to that member alone. Returns whether the room
  // looks any different.
  noteDuos(id: string, notices: DuoNotice[]): boolean {
    if (this.phase !== 'ended' || !this.members.has(id) || notices.length === 0) return false;
    this.#duos.set(id, notices);
    this.changed();
    return true;
  }

  // The viewer's own duo notices, of the friends who are still in the room.
  #duoNotices(viewer: Viewer): DuoNotice[] {
    const notices = 'playerId' in viewer ? this.#duos.get(viewer.playerId) : undefined;
    return (notices ?? []).filter(({ playerId }) => this.members.has(playerId));
  }

  // The points of the game that has just ended, by member key, scored as a match scores a game
  // (docs/architecture.md#academic-ranks), or null when the game counts for none: it was withdrawn,
  // it hasn't ended, an AI played in it (docs/architecture.md#ai-players), or the game can't be
  // scored at all.
  points(): ReadonlyMap<string, number> | null {
    if (this.#agentsPlayed) return null;
    const scores = this.phase === 'ended' ? (this.game.match?.score(this.data, this.context) ?? null) : null;
    return scores && new Map(scores.map(({ key, points }) => [key, points]));
  }

  // Which game of a match the game that has just ended was, for the records
  // (docs/architecture.md#accounts): the match, the game's number in it, from 1, and how many games
  // the match was to have. Null for a game outside a match, and for one that the match didn't score.
  matchGame(): { id: string; game: number; games: number } | null {
    const { match } = this;
    if (this.phase !== 'ended' || !match || this.gameId === null || match.lastGameId !== this.gameId) return null;
    return { id: match.id, game: match.played, games: match.rules.games };
  }

  // What the record keeps of the game that has come to an end (docs/architecture.md#game-records),
  // however it did: finished, withdrawn, or cut short when the room closed (cut()). Null while it
  // is on, and for a game with words of the chair's own, which stay with the room
  // (docs/games/keywords.md#custom-words).
  //
  // - How it ended, and for a game that finished who won and how (GameModule.outcome), how long it
  //   took, and how it began (GameModule.setup).
  // - Its log, or null when it grew too long to keep, and the AI's own log, if an AI played.
  // - Which of those who played in it had which account, by the player ID they had, those who left
  //   during the game included; a player who left and came back has had two. Guests have no
  //   account, and are not in it.
  // - How many played in it, by member key, with an account, as guests and as AI players, and
  //   whether an AI played for someone who was offline.
  // - Whether it was a game of a match, its language, its fields, and the version of its rules.
  record(): GameRecordData | null {
    if (this.#ending === null || !this.#log || this.customWords.length > 0) return null;
    const keys = this.#participants();
    const accounts = this.#accountsOf(keys);
    const kinds = new Map<string, keyof GameRecordData['counts']>();
    for (const member of this.members.values()) {
      kinds.set(member.key, member.agent ? 'agents' : member.account ? 'accounts' : 'guests');
    }
    for (const { key, accountId, agent } of this.#gone.values()) {
      if (!kinds.has(key)) kinds.set(key, agent ? 'agents' : accountId !== null ? 'accounts' : 'guests');
    }
    const counts = { accounts: 0, guests: 0, agents: 0 };
    for (const key of keys) {
      const kind = kinds.get(key);
      if (kind) counts[kind] += 1;
    }
    const agentLog = this.#agentLog && !this.#agentLog.empty ? this.#agentLog.data() : null;
    return {
      ending: this.#ending,
      outcome: this.#ending === 'finished' ? (this.game.outcome?.(this.data) ?? null) : null,
      durationMs: Math.max(0, Math.round(this.#now() - this.#log.startedAt)),
      setup: this.#setup,
      log: this.#log.data(),
      overflowed: this.#log.overflowed,
      agentLog,
      accounts,
      counts,
      takeover: this.#tookOverFor.size > 0,
      agentPlays: this.#agentPlays(),
      match: this.match !== null,
      practice: this.practice,
      language: this.language,
      fields: [...this.#gameFields],
      rules: this.game.rulesVersion ?? null,
      words: this.#words.hash,
    };
  }

  // The member keys of everyone who played in the game.
  #participants(): Set<string> {
    return new Set(
      this.game.participants?.(this.data, this.context) ??
        (this.results() ?? []).map(({ playerId }) => this.context.keyOf(playerId)),
    );
  }

  // Which of those who played in the game, with these member keys, had which account, by the player
  // ID they had, those who left included: a player who left and came back has had two.
  #accountsOf(keys: ReadonlySet<string>): { playerId: string; accountId: number }[] {
    const accounts: { playerId: string; accountId: number }[] = [];
    for (const member of this.members.values()) {
      if (member.account && keys.has(member.key)) accounts.push({ playerId: member.id, accountId: member.account.id });
    }
    for (const [playerId, { key, accountId }] of this.#gone) {
      if (accountId !== null && keys.has(key)) accounts.push({ playerId, accountId });
    }
    return accounts;
  }

  // What the groups have said since the game ended, as they talk it over, that the record of the
  // game doesn't have yet (docs/architecture.md#game-records): the entries of the log after its
  // `end`, or after those handed over last time, with which player ID was which account, also for
  // someone who came back after the end under a new ID. The socket layer adds them to the record as
  // the room leaves the game behind: when the chair plays again or starts the next match, and when
  // the room closes. Each entry is handed over once. Null when there is nothing new, and for a game
  // that has no record (record()).
  review(): { gameId: string; entries: GameLogEntry[]; accounts: { playerId: string; accountId: number }[] } | null {
    const log = this.#log;
    if (this.#reviewed === null || !log || log.overflowed || this.customWords.length > 0) return null;
    const entries = log.since(this.#reviewed);
    this.#reviewed = log.size;
    if (entries.length === 0) return null;
    return { gameId: log.gameId, entries, accounts: this.#accountsOf(this.#participants()) };
  }

  // What the AI players did in the game, if it finished: each that was in a seat at the end, and
  // each person an AI played for while they were offline.
  #agentPlays(): AgentPlay[] {
    if (this.#ending !== 'finished') return [];
    const plays: AgentPlay[] = [];
    const results = new Map((this.results() ?? []).map((result) => [result.playerId, result]));
    for (const [playerId, result] of results) {
      const persona = this.members.get(playerId)?.agent ?? this.#gone.get(playerId)?.agent ?? null;
      if (persona === null) continue;
      plays.push({
        playerId,
        persona,
        takeover: false,
        accountId: null,
        side: result.side,
        role: result.role,
        won: result.won,
        feats: this.game.agentFeats?.(this.data, playerId) ?? null,
      });
    }
    for (const [playerId, persona] of this.#tookOverFor) {
      const result = results.get(playerId);
      const accountId = this.members.get(playerId)?.account?.id ?? this.#gone.get(playerId)?.accountId ?? null;
      plays.push({
        playerId,
        persona,
        takeover: true,
        accountId,
        side: result?.side ?? null,
        role: result?.role ?? null,
        won: result?.won ?? null,
        feats: null,
      });
    }
    return plays;
  }

  // --- the game's own time ----------------------------------------------------------------

  // When the game next has something to do by itself, on the room's clock, or null for never.
  // Only a game in progress has.
  deadline(): number | null {
    return this.phase === 'playing' ? this.game.deadline(this.data) : null;
  }

  // Lets the game do what is due by now, such as ending a turn whose time has run out. Returns
  // whether that changed anything. Everyone needs a new snapshot then, but time running out is
  // not activity: a room in which nobody does anything still closes when the sweep finds that
  // nothing has happened in it for too long.
  expire(): boolean {
    if (this.phase !== 'playing') return false;
    const data = this.game.tick(this.data, this.context);
    if (data === this.data) return false;
    const over = this.#endsWith(data);
    // Whom the game was waiting for, of those who were offline then: the time they let run out.
    const offline = (this.game.due?.(this.data) ?? []).filter((id) => {
      const member = this.members.get(id);
      return member !== undefined && member.agent === null && member.sockets.size === 0;
    });
    this.#note(null, 'tick', offline.length > 0 ? { offline } : undefined);
    this.#take(data, over);
    this.rev += 1;
    return true;
  }

  // --- housekeeping -----------------------------------------------------------------------

  // Hands the chair to the longest-standing member who is online, when the chair has been
  // offline for longer than `after`. Returns whether it did.
  passChairIfAway(after: number): boolean {
    const chair = this.chairId === null ? undefined : this.members.get(this.chairId);
    if (chair && (chair.offlineSince === null || this.#now() - chair.offlineSince < after)) return false;
    const next = [...this.members.values()].find((member) => member.sockets.size > 0 && member.id !== this.chairId);
    if (!next) return false;
    this.#passChair(next.id);
    this.changed();
    return true;
  }

  // Members who have kept the waiting room waiting for longer than `after`. Time offline during
  // a game doesn't count: a player whose phone was locked through the game still has their seat
  // when the room comes back to the waiting room, and all of `after` to return to it.
  awayFromLobby(after: number): string[] {
    const now = this.#now();
    return [...this.members.values()]
      .filter(({ offlineSince }) => offlineSince !== null && now - Math.max(offlineSince, this.#lobbySince) >= after)
      .map((member) => member.id);
  }

  // Forgets the removals from a private room whose wait is over. Those for good stay.
  forgetOldRemovals(): void {
    for (const removal of this.#removals) {
      if (!removal.forGood && removal.until <= this.#now()) this.#forget(removal);
    }
  }

  // Forgets a removal, with its keys, unless a later removal has them.
  #forget(removal: Removal): void {
    this.#removals.delete(removal);
    for (const key of removal.keys) if (this.#removed.get(key) === removal) this.#removed.delete(key);
  }

  forgetOldEmotes(): void {
    for (const [key, at] of this.#emoted) {
      const age = this.#now() - at;
      if (age < 0 || age >= EMOTE_COOLDOWN_MS) this.#emoted.delete(key);
    }
  }

  // --- what people see --------------------------------------------------------------------

  // The room as the home page lists it (docs/architecture.md#public-rooms): nothing of who is in
  // it but how many, and whether a game is on.
  listing(): PublicRoom {
    return {
      code: this.code,
      game: this.game.id,
      language: this.language,
      fields: [...this.fields],
      randomFields: this.randomFields,
      players: this.members.size,
      playing: this.phase === 'playing',
    };
  }

  // The room as it is now, for any number of viewers. Most of a view is the same for everyone, so
  // that part is put together once; the function that this returns adds what one viewer sees,
  // which is who they are and the game's part for them. The game builds its part when the first
  // viewer asks, so that a module which can't build it throws to each viewer in turn, where the
  // socket layer catches it, and costs each of them their snapshot alone.
  views(): (viewer: Viewer) => RoomView {
    const context = this.context;
    let game: ((viewer: Viewer) => unknown) | undefined;
    // Undefined until the first viewer asks; null for a room that isn't a match.
    let match: RoomView['match'] | undefined;
    const shared = {
      roomId: this.id,
      code: this.code,
      rev: this.rev,
      game: this.game.id,
      language: this.language,
      fields: [...this.fields],
      randomFields: this.randomFields,
      public: this.public,
      customWordCount: this.customWords.length,
      phase: this.phase,
      round: this.round,
      gameId: this.gameId,
      chairId: this.chairId,
      players: [...this.members.values()].map((member) => ({
        id: member.id,
        name: member.name,
        online: this.isOnline(member.id),
        ...(member.account?.avatar ? { avatar: member.account.avatar } : {}),
        ...(member.account ? { rank: member.account.rank, handle: member.account.handle } : {}),
        ...(member.agent ? { agent: member.agent } : {}),
        ...(member.takenOver ? { takenOver: true as const } : {}),
      })),
      agents: this.agentsAllowed(),
      screens: this.screens.size,
    };
    // The match is the same for everyone, and is built when the first viewer asks, as the game's
    // part is, since it asks the game for the scores of a game in progress.
    const matchView = (): RoomView['match'] => {
      if (!this.match) return null;
      const live = this.phase === 'playing' ? (this.game.match?.score(this.data, context) ?? null) : null;
      return this.match.view(this.phase, this.gameId, live, this.#present);
    };
    // The chair's own words go to the chair alone, and only in the waiting room, where the chair
    // edits them: the players hear only how many there are, so that none of them knows the words
    // before they are on the board.
    const chair = (viewer: Viewer) =>
      this.phase === 'lobby' && 'playerId' in viewer && viewer.playerId === this.chairId;
    // The points that the game brought each member who played in it, as Room.points() scores them,
    // built when the first viewer asks, with the game's part.
    let points: GamePoints[] | undefined;
    const pointsView = (): GamePoints[] => {
      if (this.phase !== 'ended' || this.#agentsPlayed) return [];
      const scores = this.game.match?.score(this.data, context) ?? [];
      return scores.flatMap(({ key, points: total, detail }) => {
        const member = this.memberByKey(key);
        return member ? [{ playerId: member.id, points: total, ...(detail === undefined ? {} : { detail }) }] : [];
      });
    };
    return (viewer) => ({
      ...shared,
      me: 'playerId' in viewer ? viewer.playerId : null,
      ...(chair(viewer) ? { customWords: this.customWords.map(({ word }) => word) } : {}),
      match: match === undefined ? (match = matchView()) : match,
      streaks: this.#streakNotices(viewer),
      duos: this.#duoNotices(viewer),
      agentsPlayed: this.phase !== 'lobby' && this.#agentsPlayed,
      points: (points ??= pointsView()),
      data: (game ??= this.game.views(this.data, context))(viewer),
    });
  }

  view(viewer: Viewer): RoomView {
    return this.views()(viewer);
  }

  // A name is taken by a member who has it, and for a while by a member who was removed with it.
  // A removal goes by the member key, which another browser gets around; it should at least not
  // come back as the same person.
  // An AI player goes by its persona, which no person may have (shared/src/accounts.ts), so it takes
  // no name.
  #nameTaken(name: string, except?: string): boolean {
    for (const member of this.members.values()) {
      if (member.id !== except && !member.agent && sameName(member.name, name)) return true;
    }
    for (const removed of this.#removals) {
      if (removed.until > this.#now() && sameName(removed.name, name)) return true;
    }
    return false;
  }

  // The member who joined first among those online, or else among everyone: the rule is shared with
  // the client, whose leave sheet names them.
  #nextChair(): string | null {
    return nextChair(
      [...this.members.values()].map((member) => ({
        id: member.id,
        online: member.sockets.size > 0,
        ...(member.agent ? { agent: member.agent } : {}),
      })),
    );
  }
}
