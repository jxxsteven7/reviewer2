import {
  cleanName,
  MAX_PLAYERS,
  MAX_SCREENS,
  sameName,
  type BoardWord,
  type Language,
  type RoomPhase,
  type RoomView,
} from '@reviewer2/shared';
import type { GameContext, GameModule, Viewer } from './game';
import { newPlayerId } from './identity';
import { randomId, type Rng } from './random';

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
  joinedAt: number;
  sockets: Set<string>;
  offlineSince: number | null;
}

export type Done = { ok: true } | { ok: false; error: string };
const done: Done = { ok: true };
const fail = (error: string): Done => ({ ok: false, error });

// How long someone the chair removed must wait before they may come back.
export const REMOVED_FOR_MS = 2 * 60_000;

export interface RoomOptions {
  code: string;
  game: GameModule;
  language: Language;
  fields: string[];
  rng: Rng;
  now: () => number;
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
  usedWords = new Set<string>();
  lastActivity: number;
  readonly members = new Map<string, Member>();
  readonly screens = new Set<string>();
  readonly #removed = new Map<string, number>(); // member key -> until when
  // Since when the room has been in the waiting room this time.
  #lobbySince: number;
  readonly #rng: Rng;
  readonly #now: () => number;

  constructor(options: RoomOptions) {
    this.code = options.code;
    this.game = options.game;
    this.language = options.language;
    this.fields = [...options.fields];
    this.#rng = options.rng;
    this.#now = options.now;
    this.createdAt = options.now();
    this.lastActivity = this.createdAt;
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
    const until = this.#removed.get(key);
    if (until !== undefined && until > this.#now()) return 'removed_recently';
    return this.members.size >= MAX_PLAYERS ? 'room_full' : null;
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
      joinedAt: this.#now(),
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

  attach(member: Member, socketId: string): void {
    member.sockets.add(socketId);
    member.offlineSince = null;
    this.changed();
  }

  // Forgets a connection, whether it was a member's or a screen's.
  detach(socketId: string): void {
    if (this.screens.delete(socketId)) return;
    const member = this.memberBySocket(socketId);
    if (!member) return;
    member.sockets.delete(socketId);
    if (member.sockets.size === 0) member.offlineSince = this.#now();
    this.changed();
  }

  screensFull(): boolean {
    return this.screens.size >= MAX_SCREENS;
  }

  addScreen(socketId: string): void {
    this.screens.add(socketId);
  }

  // A member goes for good: they left, the chair removed them, or they were offline too long in
  // the waiting room. Returns the connections they still had.
  drop(id: string): string[] {
    const member = this.members.get(id);
    if (!member) return [];
    const data = this.game.leave(this.data, id);
    this.members.delete(id);
    this.data = data;
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

  setFields(fields: string[]): Done {
    if (this.phase !== 'lobby') return fail('wrong_phase');
    this.fields = [...fields];
    this.changed();
    return done;
  }

  startProblems(): string[] {
    return this.phase === 'lobby' ? this.game.startProblems(this.data, this.context) : [];
  }

  start(words: BoardWord[], gameId: string): Done {
    if (this.phase !== 'lobby') return fail('wrong_phase');
    if (this.startProblems().length) return fail('cannot_start');
    this.data = this.game.start(this.data, { ...this.context, phase: 'playing' }, words, gameId);
    this.gameId = gameId;
    this.phase = 'playing';
    this.changed();
    return done;
  }

  // A withdrawal names the game it is meant for, so that one sent late, for instance by a tab
  // that was offline, can't end the next game.
  withdraw(gameId: string): Done {
    if (gameId !== this.gameId) return fail('stale');
    if (this.phase !== 'playing') return fail('wrong_phase');
    const result = this.game.withdraw(this.data, gameId);
    if (!result.ok) return fail(result.error);
    this.data = result.data;
    this.phase = 'ended';
    this.changed();
    return done;
  }

  again(): Done {
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
    this.data = this.game.bench(this.data, this.context, id);
    this.changed();
    return done;
  }

  // Removes a member, who then has to wait before coming back.
  remove(id: string): { ok: true; sockets: string[] } | { ok: false; error: string } {
    const member = this.members.get(id);
    if (!member) return { ok: false, error: 'no_such_player' };
    const sockets = this.drop(id);
    this.#removed.set(member.key, this.#now() + REMOVED_FOR_MS);
    return { ok: true, sockets };
  }

  handOver(id: string): Done {
    if (!this.members.has(id)) return fail('no_such_player');
    this.chairId = id;
    this.changed();
    return done;
  }

  // A game message from a member. The game reports when it has ended by itself, such as when a
  // team wins.
  act(id: string, type: string, payload: unknown): Done {
    const result = this.game.handle(this.data, this.context, id, type, payload);
    if (!result.ok) return fail(result.error);
    const over = this.phase === 'playing' && this.game.isOver(result.data);
    this.data = result.data;
    if (over) this.phase = 'ended';
    this.changed();
    return done;
  }

  // --- housekeeping -----------------------------------------------------------------------

  // Hands the chair to the longest-standing member who is online, when the chair has been
  // offline for longer than `after`. Returns whether it did.
  passChairIfAway(after: number): boolean {
    const chair = this.chairId === null ? undefined : this.members.get(this.chairId);
    if (chair && (chair.offlineSince === null || this.#now() - chair.offlineSince < after)) return false;
    const next = [...this.members.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .find((member) => member.sockets.size > 0 && member.id !== this.chairId);
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
    for (const [key, until] of this.#removed) if (until <= this.#now()) this.#removed.delete(key);
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
      chairId: this.chairId,
      players: [...this.members.values()].map((member) => ({
        id: member.id,
        name: member.name,
        online: member.sockets.size > 0,
      })),
      me: 'playerId' in viewer ? viewer.playerId : null,
      data: this.game.view(this.data, this.context, viewer),
    };
  }

  #nameTaken(name: string, except?: string): boolean {
    for (const member of this.members.values()) if (member.id !== except && sameName(member.name, name)) return true;
    return false;
  }

  // The member who joined first among those online, or else among everyone.
  #nextChair(): string | null {
    const members = [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    return (members.find((member) => member.sockets.size > 0) ?? members[0])?.id ?? null;
  }
}
