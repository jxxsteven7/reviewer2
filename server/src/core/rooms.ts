import { parseCode, type Language } from '@reviewer2/shared';
import { newCode } from './codes';
import type { GameModule } from './game';
import type { Rng } from './random';
import { chooseFields, Room } from './room';
import type { WordLibrary } from './words';

// All the rooms on this server, which live in memory (docs/architecture.md), and the rules for
// cleaning them up.

export interface RoomLimits {
  maxRooms: number;
  // A room in which nobody has been online for this long is closed.
  idleMs: number;
  // A room in which nothing at all has happened for this long is closed, even with people online.
  staleMs: number;
  // A member who has been offline for this long while the room was in the waiting room is dropped.
  lobbyOfflineMs: number;
  // The chair passes to someone else after being offline for this long.
  chairAwayMs: number;
}

export const DEFAULT_LIMITS: RoomLimits = {
  maxRooms: 2000,
  idleMs: 30 * 60_000,
  staleMs: 6 * 60 * 60_000,
  lobbyOfflineMs: 10 * 60_000,
  chairAwayMs: 3 * 60_000,
};

export interface SweepResult {
  // Rooms that closed, with the connections that were still in them and why they closed: nobody
  // had been connected for too long, nothing had happened for too long, or no member was left.
  closed: { room: Room; sockets: string[]; why: 'idle' | 'stale' | 'empty' }[];
  // Rooms that changed, whose members need a new snapshot.
  changed: Room[];
  // Rooms whose game module threw. They are left as they were.
  failed: { room: Room; error: unknown }[];
}

export class Rooms {
  readonly #rooms = new Map<string, Room>();

  constructor(
    private readonly words: WordLibrary,
    private readonly rng: Rng,
    private readonly now: () => number,
    readonly limits: RoomLimits = DEFAULT_LIMITS,
  ) {}

  get size(): number {
    return this.#rooms.size;
  }

  // A new room, or why there can't be one: the server is full, or the fields won't do.
  create(options: {
    game: GameModule;
    language: Language;
    fields: readonly string[];
  }): { ok: true; room: Room } | { ok: false; error: 'too_many_rooms' | 'bad_fields' | 'no_words' } {
    if (this.#rooms.size >= this.limits.maxRooms) return { ok: false, error: 'too_many_rooms' };
    const chosen = chooseFields(this.words, options.fields, options.language, options.game.wordsNeeded);
    if (!chosen.ok) return chosen;
    let code = newCode(this.rng);
    while (this.#rooms.has(code)) code = newCode(this.rng);
    const room = new Room({
      ...options,
      fields: chosen.fields,
      code,
      words: this.words,
      rng: this.rng,
      now: this.now,
    });
    this.#rooms.set(code, room);
    return { ok: true, room };
  }

  // Finds a room by a code as someone typed it.
  find(input: string): Room | undefined {
    const code = parseCode(input);
    return code === null ? undefined : this.#rooms.get(code);
  }

  all(): Room[] {
    return [...this.#rooms.values()];
  }

  // Closes a room and returns the connections that were still in it. Closing a room a second
  // time does nothing: by then its code may belong to another room.
  close(room: Room): string[] {
    if (this.#rooms.get(room.code) === room) this.#rooms.delete(room.code);
    return [...room.screens, ...[...room.members.values()].flatMap((member) => [...member.sockets])];
  }

  // Runs every minute. A game module that throws stops the sweep of its own room only.
  sweep(): SweepResult {
    const result: SweepResult = { closed: [], changed: [], failed: [] };
    for (const room of this.all()) {
      try {
        this.#sweepRoom(room, result);
      } catch (error) {
        result.failed.push({ room, error });
      }
    }
    return result;
  }

  #sweepRoom(room: Room, result: SweepResult): void {
    const now = this.now();
    // The room itself notes every connection that comes or goes, so a visit that begins and ends
    // between two sweeps counts as well.
    if (room.onlineCount() > 0 || room.screens.size > 0) room.lastSeen = now;
    const idle = now - room.lastSeen >= this.limits.idleMs;
    const stale = now - room.lastActivity >= this.limits.staleMs;
    if (idle || stale) {
      result.closed.push({ room, sockets: this.close(room), why: idle ? 'idle' : 'stale' });
      return;
    }
    let changed = false;
    try {
      if (room.phase === 'lobby') {
        for (const id of room.awayFromLobby(this.limits.lobbyOfflineMs)) {
          // Whoever is dropped here is offline, so there is no connection left to tell.
          room.drop(id);
          changed = true;
        }
      }
      // A room that the sweep has emptied closes, as it does when its last member leaves. Left
      // open, it would have no chair, would show its screens an empty list for hours, and would
      // make whoever came next with the code the chair of a room that others had set up.
      if (room.members.size === 0) {
        changed = false;
        result.closed.push({ room, sockets: this.close(room), why: 'empty' });
        return;
      }
      if (room.passChairIfAway(this.limits.chairAwayMs)) changed = true;
      room.forgetOldRemovals();
    } finally {
      // Whatever did change before a game module threw still has to reach the room's members.
      if (changed) result.changed.push(room);
    }
  }
}
