import {
  cleanName,
  EMOTE_COOLDOWN_MS,
  MAX_PLAYERS,
  MAX_SCREENS,
  nextChair,
  parseCustomWords,
  sameName,
  wordKey,
  type Ack,
  type BoardWord,
  type Language,
  type MatchRules,
  type PublicRoom,
  type Rank,
  type RoomPhase,
  type RoomView,
} from '@reviewer2/shared';
import { done, fail, refusalOf } from './answers';
import type { GameContext, GameModule, PlayerResult, Viewer } from './game';
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

// A member who is logged in to an account: which account, the address of its avatar, or null for
// the default one, which the client draws from the name, and its academic rank, which everyone in
// the room sees beside the name (docs/architecture.md#academic-ranks).
export interface MemberAccount {
  id: number;
  avatar: string | null;
  rank: Rank;
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
  // Listed on the home page for anyone with an account to join (docs/architecture.md#public-rooms).
  public?: boolean;
  words: WordLibrary;
  rng: Rng;
  now: () => number;
}

// The fields that a room is to play with, once each, or why it can't play with them: one of them
// isn't in the library, or together with the chair's own words they have too few words in the
// room's language. Rooms are created and their fields changed only through this check, so a room
// that exists can always deal a game.
export function chooseFields(
  words: WordLibrary,
  fields: readonly string[],
  language: Language,
  needed: number,
  custom: readonly BoardWord[] = [],
): Ack<{ fields: string[] }> {
  const chosen = [...new Set(fields)];
  if (!chosen.every((id) => words.has(id))) return fail('bad_fields');
  if (poolOf(words, chosen, language, custom).length < needed) return fail('no_words');
  return { ok: true, fields: chosen };
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

export class Room {
  readonly id = randomId();
  readonly code: string;
  readonly game: GameModule;
  readonly language: Language;
  readonly createdAt: number;
  fields: string[];
  // The chair's own words, which the games draw from along with the fields, each with its
  // pinyin when it is Chinese (docs/games/keywords.md#custom-words). A private room's alone.
  customWords: BoardWord[] = [];
  public: boolean;
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
  // Those who left during the current game, by player ID, with the member key and the name they
  // had, so that the game can still tell whose was a move they made before they left, as a
  // match's score and a replay need to.
  readonly #gone = new Map<string, { key: string; name: string }>();
  // Since when the room has been in the waiting room this time.
  #lobbySince: number;
  readonly #words: WordLibrary;
  // The words of the games so far, which the next game avoids for as long as it can.
  #usedWords: ReadonlySet<string> = new Set();
  readonly #rng: Rng;
  readonly #now: () => number;

  constructor(options: RoomOptions) {
    this.code = options.code;
    this.game = options.game;
    this.language = options.language;
    this.fields = [...options.fields];
    this.public = options.public ?? false;
    this.#words = options.words;
    this.#rng = options.rng;
    this.#now = options.now;
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
      playerIds: () => [...this.members.keys()],
    };
  }

  // Marks a change: everyone gets a new snapshot.
  changed(): void {
    this.rev += 1;
    this.lastActivity = this.#now();
  }

  isOnline(id: string): boolean {
    return (this.members.get(id)?.sockets.size ?? 0) > 0;
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
    };
    // The newcomer becomes a member only once the module has taken them, so the context learns
    // their key here.
    const context = this.context;
    const keyOf = (id: string) => (id === member.id ? key : context.keyOf(id));
    const data = this.game.join(this.data, { ...context, keyOf }, member.id, play);
    this.members.set(member.id, member);
    this.chairId ??= member.id;
    this.data = data;
    this.changed();
    return { ok: true, member };
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
  // the waiting room. Returns the connections they still had.
  drop(id: string): string[] {
    const member = this.members.get(id);
    if (!member) return [];
    const data = this.game.leave(this.data, id);
    const over = this.#endsWith(data);
    if (this.phase !== 'lobby') this.#gone.set(id, { key: member.key, name: member.name });
    this.members.delete(id);
    this.#take(data, over);
    if (this.chairId === id) this.chairId = this.#nextChair();
    this.changed();
    return [...member.sockets];
  }

  // A member's quick reaction, at most one every EMOTE_COOLDOWN_MS. It changes nothing in the room:
  // the socket layer passes it on, and no snapshot carries it. One that comes too soon is refused
  // with how long is left, so that the tab it came from, which may not be the one that sent the
  // last, counts down the right wait. A clock that was set back counts as a wait that is over,
  // rather than one that lasts until the clock has caught up.
  emote(id: string): Ack {
    const member = this.members.get(id);
    if (!member) return fail('not_member');
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

  // A member's account has a new username, a new avatar or a new rank. The name changes too, unless
  // someone else in the room has it, as a guest may have since before the account was renamed: then
  // the member keeps the name they had here. Returns whether the room looks any different.
  updateAccount(id: string, username: string, avatar: string | null, rank: Rank): boolean {
    const member = this.members.get(id);
    if (!member?.account) return false;
    const renamed = this.#takeUsername(member, username);
    if (!renamed && member.account.avatar === avatar && member.account.rank === rank) return false;
    member.account.avatar = avatar;
    member.account.rank = rank;
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

  // The chair changes the fields, the game's own settings, their own words, or any of them, in the
  // waiting room. All change together or none does: one that won't do refuses the others with it.
  // The chair's words come as the text they were pasted as, and are checked as the editor checks
  // them (parseCustomWords); a public room takes none, since they are for a private one.
  setSettings(changes: { fields?: readonly string[]; settings?: unknown; words?: string }): Ack {
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
        return pinyin === null ? { word } : { word, pinyin };
      });
    }
    let fields = this.fields;
    if (changes.fields !== undefined || custom !== this.customWords) {
      const chosen = chooseFields(
        this.#words,
        changes.fields ?? this.fields,
        this.language,
        this.game.wordsNeeded,
        custom,
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
    if (data === this.data && sameFields(fields, this.fields) && sameWords) return done;
    this.fields = fields;
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
  // apart those that clash with each other, as far as it can. `clashes` says how many pairs of
  // the words drawn clash all the same: it is 0 unless the draw found no way to keep them apart.
  start(round: number): Ack<{ clashes: number }> {
    if (round !== this.round) return fail('stale');
    if (this.phase !== 'lobby') return fail('wrong_phase');
    if (this.match && this.match.status !== 'on') return fail('match_over');
    if (!this.game.canStart(this.data, this.context)) return fail('cannot_start');
    const pool = poolOf(this.#words, this.fields, this.language, this.customWords);
    const clash = this.game.wordsClash?.bind(this.game);
    const draw = drawWords(pool, this.game.wordsNeeded, this.#usedWords, this.#rng, clash);
    // chooseFields() has made sure of this, and the library doesn't change while the server runs.
    if (!draw) throw new Error(`the fields of room ${this.code} have too few words for a game`);
    const gameId = randomId();
    this.data = this.game.start(this.data, { ...this.context, phase: 'playing' }, draw.words, gameId);
    this.#usedWords = draw.used;
    this.gameId = gameId;
    this.round += 1;
    this.phase = 'playing';
    this.#gone.clear();
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
  }

  // --- matches ----------------------------------------------------------------------------

  // The room plays a match by these rules from now on. Only a game that can be played as a match
  // can, and only in the waiting room.
  startMatch(rules: MatchRules): Ack {
    if (!this.game.match) return fail('bad_match');
    if (this.phase !== 'lobby') return fail('wrong_phase');
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

  bench(id: string): Ack {
    if (!this.members.has(id)) return fail('no_such_player');
    this.#update(this.game.bench(this.data, this.context, id));
    return done;
  }

  // Removes a member, who then stays out, by their member key and by the keys that their browsers
  // have as guests, so that a player who is logged in can't come back as a guest. Whether the room
  // is public now decides for how long: for good, or for REMOVED_FOR_MS, whatever the room becomes
  // later. Returns the connections they still had, every key they stay out by and what they hear:
  // what room:join would answer them.
  remove(id: string): Ack<{ sockets: string[]; keys: string[]; reason: 'removed' | 'removed_recently' }> {
    const member = this.members.get(id);
    if (!member) return fail('no_such_player');
    const sockets = this.drop(id);
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
    if (!this.members.has(id)) return fail('no_such_player');
    if (!this.isOnline(id)) return fail('player_offline');
    this.chairId = id;
    this.changed();
    return done;
  }

  // A game message from a member. Whatever the game had due by now happens first, so that a
  // message which arrives after its turn's time has run out finds the turn over, even when the
  // timer that ends it hasn't fired yet.
  act(id: string, type: string, payload: unknown): Ack {
    this.expire();
    const result = this.game.handle(this.data, this.context, id, type, payload);
    if (!result.ok) return refusalOf(result);
    this.#update(result.data);
    return done;
  }

  // Whether the game has ended by itself with this data, such as when a team wins. A game may
  // end with any change to its data, not only with one of its own messages: a module is free to
  // end a game when a player leaves it or is moved to the spectators.
  #endsWith(data: unknown): boolean {
    return this.phase === 'playing' && this.game.isOver(data);
  }

  // Takes the game's new data, and the end of the game if the data brought it.
  #take(data: unknown, over: boolean): void {
    this.data = data;
    if (!over) return;
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

  // The points of the game that has just ended, by member key, scored as a match scores a game
  // (docs/architecture.md#academic-ranks), or null when the game counts for none: it was withdrawn,
  // it hasn't ended, or the game can't be scored at all.
  points(): ReadonlyMap<string, number> | null {
    const scores = this.phase === 'ended' ? (this.game.match?.score(this.data, this.context) ?? null) : null;
    return scores && new Map(scores.map(({ key, points }) => [key, points]));
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
    this.#take(data, this.#endsWith(data));
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
    this.chairId = next.id;
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
      public: this.public,
      customWordCount: this.customWords.length,
      phase: this.phase,
      round: this.round,
      gameId: this.gameId,
      chairId: this.chairId,
      players: [...this.members.values()].map((member) => ({
        id: member.id,
        name: member.name,
        online: member.sockets.size > 0,
        ...(member.account?.avatar ? { avatar: member.account.avatar } : {}),
        ...(member.account ? { rank: member.account.rank } : {}),
      })),
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
    return (viewer) => ({
      ...shared,
      me: 'playerId' in viewer ? viewer.playerId : null,
      ...(chair(viewer) ? { customWords: this.customWords.map(({ word }) => word) } : {}),
      match: match === undefined ? (match = matchView()) : match,
      data: (game ??= this.game.views(this.data, context))(viewer),
    });
  }

  view(viewer: Viewer): RoomView {
    return this.views()(viewer);
  }

  // A name is taken by a member who has it, and for a while by a member who was removed with it.
  // A removal goes by the member key, which another browser gets around; it should at least not
  // come back as the same person.
  #nameTaken(name: string, except?: string): boolean {
    for (const member of this.members.values()) if (member.id !== except && sameName(member.name, name)) return true;
    for (const removed of this.#removals) {
      if (removed.until > this.#now() && sameName(removed.name, name)) return true;
    }
    return false;
  }

  // The member who joined first among those online, or else among everyone: the rule is shared with
  // the client, whose leave sheet names them.
  #nextChair(): string | null {
    return nextChair([...this.members.values()].map((member) => ({ id: member.id, online: member.sockets.size > 0 })));
  }
}
