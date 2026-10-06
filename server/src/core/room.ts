import {
  cleanName,
  MAX_PLAYERS,
  MAX_SCREENS,
  sameName,
  type Language,
  type RoomPhase,
  type RoomView,
} from '@reviewer2/shared';
import type { GameContext, GameModule, Viewer } from './game';
import { newPlayerId } from './identity';
import { randomId, type Rng } from './random';
import { drawWords, type WordLibrary } from './words';

// One room: who is in it, who chairs it, which connections belong to whom, and the game's data.
// The socket layer (socket.ts) calls these methods and then sends everyone the new state.
// Every change bumps `rev`, so clients can tell old snapshots from new ones.
//
// A method asks the game module first and changes the room afterwards. A module that throws
// then leaves the room exactly as it was, instead of half changed.

export interface Member {
  id: string;
  key: string;
  name: string;
  sockets: Set<string>;
  offlineSince: number | null;
}

export type Done = { ok: true } | { ok: false; error: string };
const done: Done = { ok: true };
const fail = (error: string): Done => ({ ok: false, error });

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
): { ok: true; fields: string[] } | { ok: false; error: 'bad_fields' | 'no_words' } {
  const chosen = [...new Set(fields)];
  if (!chosen.every((id) => words.has(id))) return { ok: false, error: 'bad_fields' };
  if (words.pool(chosen, language).length < needed) return { ok: false, error: 'no_words' };
  return { ok: true, fields: chosen };
}

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
    this.data = options.game.create();
  }

  get context(): GameContext {
    return {
      phase: this.phase,
      language: this.language,
      rng: this.#rng,
      keyOf: (id) => this.members.get(id)?.key ?? id,
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

  // A new member. The first one chairs the room.
  join(key: string, rawName: string): { ok: true; member: Member } | { ok: false; error: string } {
    const refusal = this.refusal(key);
    if (refusal) return { ok: false, error: refusal };
    const name = cleanName(rawName);
    if (name === null) return { ok: false, error: 'name_invalid' };
    if (this.#nameTaken(name)) return { ok: false, error: 'name_taken' };

    const member: Member = {
      id: newPlayerId(),
      key,
      name,
      sockets: new Set(),
      offlineSince: null,
    };
    const data = this.game.join(this.data, member.id);
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
    this.members.delete(id);
    this.#take(data, over);
    if (this.chairId === id) this.chairId = this.#nextChair();
    this.changed();
    return [...member.sockets];
  }

  rename(id: string, rawName: string): Done {
    const name = cleanName(rawName);
    if (name === null) return fail('name_invalid');
    const member = this.members.get(id);
    if (!member) return fail('not_member');
    if (this.#nameTaken(name, id)) return fail('name_taken');
    member.name = name;
    this.changed();
    return done;
  }

  // --- the chair's controls ---------------------------------------------------------------

  setFields(fields: readonly string[]): Done {
    if (this.phase !== 'lobby') return fail('wrong_phase');
    const chosen = chooseFields(this.#words, fields, this.language, this.game.wordsNeeded);
    if (!chosen.ok) return chosen;
    this.fields = chosen.fields;
    this.changed();
    return done;
  }

  // A start is for the waiting room that its sender saw: `round` is how many games the room had
  // started then. One that arrives after another start, such as from a second tab whose
  // connection had stalled, is stale, even when the room is back in the waiting room by now.
  //
  // The room draws the words itself, preferring those that it hasn't played with yet.
  start(round: number): Done {
    if (round !== this.round) return fail('stale');
    if (this.phase !== 'lobby') return fail('wrong_phase');
    if (this.game.startProblems(this.data, this.context).length > 0) return fail('cannot_start');
    const pool = this.#words.pool(this.fields, this.language);
    const draw = drawWords(pool, this.game.wordsNeeded, this.#usedWords, this.#rng);
    // chooseFields() has made sure of this, and the library doesn't change while the server runs.
    if (!draw) throw new Error(`the fields of room ${this.code} have too few words for a game`);
    const gameId = randomId();
    this.data = this.game.start(this.data, { ...this.context, phase: 'playing' }, draw.words, gameId);
    this.#usedWords = draw.used;
    this.gameId = gameId;
    this.round += 1;
    this.phase = 'playing';
    this.changed();
    return done;
  }

  // A withdrawal names the game it is meant for, so that one sent late, for instance by a tab
  // that was offline, can't end the next game.
  //
  // The room only knows which game it has. Whether that game can still be withdrawn is for the
  // module to say, in the same words it has for any other action on a game that is over.
  withdraw(gameId: string): Done {
    if (this.gameId === null || gameId !== this.gameId) return fail('stale');
    const result = this.game.withdraw(this.data, gameId);
    if (!result.ok) return fail(result.error);
    this.data = result.data;
    this.phase = 'ended';
    this.changed();
    return done;
  }

  // Back to the waiting room after the game that the message names. A late one must not clear
  // away the result of a later game.
  again(gameId: string): Done {
    if (gameId !== this.gameId) return fail('stale');
    if (this.phase !== 'ended') return fail('wrong_phase');
    this.data = this.game.again(this.data);
    this.gameId = null;
    this.phase = 'lobby';
    this.#lobbySince = this.#now();
    this.changed();
    return done;
  }

  shuffle(): Done {
    if (this.phase !== 'lobby') return fail('wrong_phase');
    this.data = this.game.shuffle(this.data, this.context);
    this.changed();
    return done;
  }

  bench(id: string): Done {
    if (!this.members.has(id)) return fail('no_such_player');
    const data = this.game.bench(this.data, this.context, id);
    this.#take(data, this.#endsWith(data));
    this.changed();
    return done;
  }

  // Removes a member, who then has to wait before coming back.
  remove(id: string): { ok: true; sockets: string[] } | { ok: false; error: string } {
    const member = this.members.get(id);
    if (!member) return { ok: false, error: 'no_such_player' };
    const sockets = this.drop(id);
    this.#removed.set(member.key, { until: this.#now() + REMOVED_FOR_MS, name: member.name });
    return { ok: true, sockets };
  }

  // The chair goes to someone who is there to take it. Handed to a member who has been offline
  // for a while, it would pass on again at the next sweep, to whoever joined first, without a
  // word to anyone.
  handOver(id: string): Done {
    if (!this.members.has(id)) return fail('no_such_player');
    if (!this.isOnline(id)) return fail('player_offline');
    this.chairId = id;
    this.changed();
    return done;
  }

  // A game message from a member.
  act(id: string, type: string, payload: unknown): Done {
    const result = this.game.handle(this.data, this.context, id, type, payload);
    if (!result.ok) return fail(result.error);
    this.#take(result.data, this.#endsWith(result.data));
    this.changed();
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
    if (over) this.phase = 'ended';
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

  // --- what people see --------------------------------------------------------------------

  view(viewer: Viewer): RoomView {
    return {
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
      })),
      screens: this.screens.size,
      me: 'playerId' in viewer ? viewer.playerId : null,
      data: this.game.view(this.data, this.context, viewer),
    };
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

  // The member who joined first among those online, or else among everyone.
  #nextChair(): string | null {
    const members = [...this.members.values()];
    return (members.find((member) => member.sockets.size > 0) ?? members[0])?.id ?? null;
  }
}
