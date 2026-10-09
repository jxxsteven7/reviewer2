import {
  cleanName,
  EMOTE_COOLDOWN_MS,
  MAX_PLAYERS,
  MAX_SCREENS,
  nextChair,
  sameName,
  type Ack,
  type Language,
  type MatchRules,
  type RoomPhase,
  type RoomView,
} from '@reviewer2/shared';
import { done, fail, refusalOf } from './answers';
import type { GameContext, GameModule, PlayerResult, Viewer } from './game';
import { newPlayerId } from './identity';
import { Match, type Present } from './match';
import { randomId, type Rng } from './random';
import { drawWords, type WordLibrary } from './words';

// One room: who is in it, who chairs it, which connections belong to whom, and the game's data.
// The socket layer (socket.ts) calls these methods and then sends everyone the new state.
// Every change bumps `rev`, so clients can tell old snapshots from new ones.
//
// A method asks the game module first and changes the room afterwards. A module that throws
// then leaves the room exactly as it was, instead of half changed.

// A member who is logged in to an account: which account, and the address of its avatar, or null
// for the default one, which the client draws from the name.
export interface MemberAccount {
  id: number;
  avatar: string | null;
}

export interface Member {
  id: string;
  key: string;
  name: string;
  // The account, for a member who is logged in, whose name is then the username.
  account: MemberAccount | null;
  sockets: Set<string>;
  offlineSince: number | null;
}

// How long someone the chair removed must wait before they may come back, and how long nobody
// else may take their name.
export const REMOVED_FOR_MS = 2 * 60_000;

export interface RoomOptions {
  code: string;
  game: GameModule;
  language: Language;
  // As chooseFields() returned them.
  fields: string[];
  words: WordLibrary;
  rng: Rng;
  now: () => number;
}

// The fields that a room is to play with, once each, or why it can't play with them: one of them
// isn't in the library, or together they have too few words in the room's language. Rooms are
// created and their fields changed only through this check, so a room that exists can always
// deal a game.
export function chooseFields(
  words: WordLibrary,
  fields: readonly string[],
  language: Language,
  needed: number,
): Ack<{ fields: string[] }> {
  const chosen = [...new Set(fields)];
  if (!chosen.every((id) => words.has(id))) return fail('bad_fields');
  if (words.pool(chosen, language).length < needed) return fail('no_words');
  return { ok: true, fields: chosen };
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
  readonly screens = new Set<string>();
  // Whom the chair has removed, by member key: until when they must wait, and the name they had.
  readonly #removed = new Map<string, { until: number; name: string }>();
  // When each member last sent a quick reaction, by member key, so that neither another tab nor
  // leaving and coming back starts the wait again.
  readonly #emoted = new Map<string, number>();
  // The member keys of those who left during the current game, by player ID, so that the game can
  // still tell whose was a move they made before they left, as a match's score needs to.
  readonly #gone = new Map<string, string>();
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
      now: this.#now,
      keyOf: (id) => this.members.get(id)?.key ?? this.#gone.get(id) ?? id,
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

  // Why nobody new can come in with this key for now, whatever they call themselves. A newcomer
  // hears this before being asked for a name, rather than after having typed one.
  refusal(key: string): 'removed_recently' | 'room_full' | null {
    if (this.removedRecently(key)) return 'removed_recently';
    return this.members.size >= MAX_PLAYERS ? 'room_full' : null;
  }

  // Whether the chair removed whoever has this key so recently that they must still wait.
  removedRecently(key: string): boolean {
    const removed = this.#removed.get(key);
    return removed !== undefined && removed.until > this.#now();
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

  // A member's connection. Returns whether the room looks any different with it, which it does
  // only when it is the member's first: they come online. Another tab of someone who is online
  // is news to nobody.
  attach(member: Member, socketId: string): boolean {
    const first = member.sockets.size === 0;
    member.sockets.add(socketId);
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

  screensFull(): boolean {
    return this.screens.size >= MAX_SCREENS;
  }

  addScreen(socketId: string): void {
    this.screens.add(socketId);
    this.lastSeen = this.#now();
    this.changed();
  }

  // The chair sends every screen away. Returns their connections.
  dismissScreens(): string[] {
    const screens = [...this.screens];
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
    if (this.phase !== 'lobby') this.#gone.set(id, member.key);
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
    return [...this.screens, ...[...this.members.values()].flatMap((member) => [...member.sockets])];
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

  // A member's account has a new username or a new avatar. The name changes too, unless someone
  // else in the room has it, as a guest may have since before the account was renamed: then the
  // member keeps the name they had here. Returns whether the room looks any different.
  updateAccount(id: string, username: string, avatar: string | null): boolean {
    const member = this.members.get(id);
    if (!member?.account) return false;
    const renamed = this.#takeUsername(member, username);
    if (!renamed && member.account.avatar === avatar) return false;
    member.account.avatar = avatar;
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

  // --- the chair's controls ---------------------------------------------------------------

  // The chair changes the fields, the game's own settings, or both, in the waiting room. Both
  // change together or neither does: one that won't do refuses the other with it.
  setSettings(changes: { fields?: readonly string[]; settings?: unknown }): Ack {
    if (this.phase !== 'lobby') return fail('wrong_phase');
    // A match plays all its games by the same settings, once one of them has counted.
    if (this.match?.status === 'on' && this.match.played > 0) return fail('match_locked');
    let fields = this.fields;
    if (changes.fields !== undefined) {
      const chosen = chooseFields(this.#words, changes.fields, this.language, this.game.wordsNeeded);
      if (!chosen.ok) return chosen;
      fields = chosen.fields;
    }
    let data = this.data;
    if (changes.settings !== undefined) {
      const configured = this.game.configure(this.data, this.context, changes.settings);
      if (!configured.ok) return refusalOf(configured);
      data = configured.data;
    }
    if (data === this.data && sameFields(fields, this.fields)) return done;
    this.fields = fields;
    this.data = data;
    this.changed();
    return done;
  }

  // A start is for the waiting room that its sender saw: `round` is how many games the room had
  // started then. One that arrives after another start, such as from a second tab whose
  // connection had stalled, is stale, even when the room is back in the waiting room by now.
  //
  // The room draws the words itself, preferring those that it hasn't played with yet, and none
  // that clash with each other, as far as its fields allow. `clashes` says how many pairs of the
  // words drawn clash all the same: it is 0 unless the fields leave no other way.
  start(round: number): Ack<{ clashes: number }> {
    if (round !== this.round) return fail('stale');
    if (this.phase !== 'lobby') return fail('wrong_phase');
    if (this.match && this.match.status !== 'on') return fail('match_over');
    if (!this.game.canStart(this.data, this.context)) return fail('cannot_start');
    const pool = this.#words.pool(this.fields, this.language);
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

  // Removes a member, who then has to wait before coming back. Returns the connections they
  // still had and their member key.
  remove(id: string): Ack<{ sockets: string[]; key: string }> {
    const member = this.members.get(id);
    if (!member) return fail('no_such_player');
    const sockets = this.drop(id);
    this.#removed.set(member.key, { until: this.#now() + REMOVED_FOR_MS, name: member.name });
    return { ok: true, sockets, key: member.key };
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

  forgetOldRemovals(): void {
    for (const [key, { until }] of this.#removed) if (until <= this.#now()) this.#removed.delete(key);
  }

  forgetOldEmotes(): void {
    for (const [key, at] of this.#emoted) {
      const age = this.#now() - at;
      if (age < 0 || age >= EMOTE_COOLDOWN_MS) this.#emoted.delete(key);
    }
  }

  // --- what people see --------------------------------------------------------------------

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
      phase: this.phase,
      round: this.round,
      gameId: this.gameId,
      chairId: this.chairId,
      players: [...this.members.values()].map((member) => ({
        id: member.id,
        name: member.name,
        online: member.sockets.size > 0,
        ...(member.account?.avatar ? { avatar: member.account.avatar } : {}),
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
    return (viewer) => ({
      ...shared,
      me: 'playerId' in viewer ? viewer.playerId : null,
      match: match === undefined ? (match = matchView()) : match,
      data: (game ??= this.game.views(this.data, context))(viewer),
    });
  }

  view(viewer: Viewer): RoomView {
    return this.views()(viewer);
  }

  // A name is taken by a member who has it, and for a while by a member who was removed with it.
  // The wait after a removal goes by the browser's token, which is all the server knows a player
  // by, so another browser gets around it. It should at least not come back as the same person.
  #nameTaken(name: string, except?: string): boolean {
    for (const member of this.members.values()) if (member.id !== except && sameName(member.name, name)) return true;
    for (const removed of this.#removed.values()) {
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
