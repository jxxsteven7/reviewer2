import type { Language } from '@reviewer2/shared';
import { newCode, parseCode } from './codes';
import type { GameModule } from './game';
import type { Rng } from './random';
import { Room } from './room';

// All the rooms on this server, which live in memory (docs/architecture.md), and the rules for
// cleaning them up.

export interface RoomLimits {
  maxRooms: number;
  // A room in which nobody has been online for this long is closed.
  idleMs: number;
  // A room in which nothing at all has happened for this long is closed, even with people online.
  staleMs: number;
  // In the waiting room, a member who has been offline for this long is dropped.
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
  // Rooms that closed, with the connections that were still in them.
  closed: { room: Room; sockets: string[] }[];
  // Rooms that changed, whose members need a new snapshot.
  changed: Room[];
  // Connections of members who were dropped from rooms that stay open.
  dropped: string[];
}

export class Rooms {
  readonly #rooms = new Map<string, Room>();
  readonly #lastOnline = new Map<Room, number>();

  constructor(
    private readonly rng: Rng,
    private readonly now: () => number,
    readonly limits: RoomLimits = DEFAULT_LIMITS,
  ) {}

  get size(): number {
    return this.#rooms.size;
  }

  create(options: { game: GameModule; language: Language; fields: string[] }): Room | null {
    if (this.#rooms.size >= this.limits.maxRooms) return null;
    let code = newCode(this.rng);
    while (this.#rooms.has(code)) code = newCode(this.rng);
    const room = new Room({ ...options, code, rng: this.rng, now: this.now });
    this.#rooms.set(code, room);
    this.#lastOnline.set(room, this.now());
    return room;
  }

  // Finds a room by a code as someone typed it.
  find(input: string): Room | undefined {
    const code = parseCode(input);
    return code === null ? undefined : this.#rooms.get(code);
  }

  all(): Room[] {
    return [...this.#rooms.values()];
  }

  close(room: Room): string[] {
    this.#rooms.delete(room.code);
    this.#lastOnline.delete(room);
    return [...room.screens, ...[...room.members.values()].flatMap((member) => [...member.sockets])];
  }

  // Runs every minute.
  sweep(): SweepResult {
    const now = this.now();
    const result: SweepResult = { closed: [], changed: [], dropped: [] };
    for (const room of this.all()) {
      if (room.onlineCount() > 0 || room.screens.size > 0) this.#lastOnline.set(room, now);
      const idle = now - (this.#lastOnline.get(room) ?? now) >= this.limits.idleMs;
      const stale = now - room.lastActivity >= this.limits.staleMs;
      if (idle || stale) {
        result.closed.push({ room, sockets: this.close(room) });
        continue;
      }
      let changed = false;
      if (room.phase === 'lobby') {
        for (const id of room.offlineFor(this.limits.lobbyOfflineMs)) {
          result.dropped.push(...room.drop(id));
          changed = true;
        }
      }
      if (room.passChairIfAway(this.limits.chairAwayMs)) changed = true;
      room.forgetOldRemovals();
      if (changed) result.changed.push(room);
    }
    return result;
  }
}
