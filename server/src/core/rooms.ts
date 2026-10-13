import { parseCode, type Ack, type Language, type MatchRules, type PublicRoom, type Title } from '@reviewer2/shared';
import { fail } from './answers';
import { newCode } from './codes';
import type { GameModule } from './game';
import type { Rng } from './random';
import { chooseFields, Room, type Member, type MemberAccount } from './room';
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
  // How many public rooms the home page lists at most.
  maxListed: number;
}

export const DEFAULT_LIMITS: RoomLimits = {
  maxRooms: 2000,
  idleMs: 30 * 60_000,
  staleMs: 6 * 60 * 60_000,
  lobbyOfflineMs: 10 * 60_000,
  chairAwayMs: 3 * 60_000,
  maxListed: 50,
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

  // `titleCount` says how many times an account has won a title, where accounts are on, for the
  // games to tell (GameContext.titleCount).
  constructor(
    private readonly words: WordLibrary,
    private readonly rng: Rng,
    private readonly now: () => number,
    readonly limits: RoomLimits = DEFAULT_LIMITS,
    private readonly titleCount: ((accountId: number, title: Title) => number) | null = null,
  ) {}

  get size(): number {
    return this.#rooms.size;
  }

  // A new room with its creator in it, who chairs it, or why there can't be one: the server is
  // full, or the fields, the game's settings or the name won't do. `key` is the creator's member
  // key, and `play` says whether they have come to play or only to watch. Without settings, the
  // room has the game's defaults. With `match`, the room plays a match by those rules; with
  // `public`, it is listed on the home page.
  //
  // The room is listed only once its creator has joined it. A game module that throws there
  // leaves no room behind: one without a member would belong to whoever found its code first.
  create(options: {
    game: GameModule;
    language: Language;
    fields: readonly string[];
    settings?: unknown;
    key: string;
    name: string;
    play?: boolean;
    account?: MemberAccount | null;
    match?: MatchRules;
    public?: boolean;
  }): Ack<{ room: Room; member: Member }> {
    const { game, language, key, name, play = false, account = null } = options;
    if (this.#rooms.size >= this.limits.maxRooms) return fail('too_many_rooms');
    const chosen = chooseFields(this.words, options.fields, language, game.wordsNeeded);
    if (!chosen.ok) return chosen;
    let code = newCode(this.rng);
    while (this.#rooms.has(code)) code = newCode(this.rng);
    const room = new Room({
      code,
      game,
      language,
      fields: chosen.fields,
      public: options.public ?? false,
      words: this.words,
      rng: this.rng,
      now: this.now,
      titleCount: this.titleCount,
    });
    if (options.settings !== undefined) {
      const configured = room.setSettings({ settings: options.settings });
      if (!configured.ok) return configured;
    }
    // The match comes before the creator, so that the game seats them by its rules.
    if (options.match !== undefined) {
      const started = room.startMatch(options.match);
      if (!started.ok) return started;
    }
    const joined = room.join(key, name, play, account);
    if (!joined.ok) return joined;
    this.#rooms.set(code, room);
    return { ok: true, room, member: joined.member };
  }

  // Finds a room by a code as someone typed it.
  find(input: string): Room | undefined {
    const code = parseCode(input);
    return code === null ? undefined : this.#rooms.get(code);
  }

  all(): Room[] {
    return [...this.#rooms.values()];
  }

  // The public rooms that have room for someone, and someone in them, as the home page lists
  // them: a room where nobody is online, which the sweep closes in time, would take newcomers
  // nowhere. Waiting rooms first, and the older before the newer, so that a room fills before the
  // next one does. Only the first `maxListed`: a list that long is more than anyone reads, and
  // the answer costs the same whoever asks.
  listed(): PublicRoom[] {
    return this.all()
      .filter((room) => room.public && !room.full() && room.onlineCount() > 0)
      .sort((a, b) => Number(a.phase === 'playing') - Number(b.phase === 'playing') || a.createdAt - b.createdAt)
      .slice(0, this.limits.maxListed)
      .map((room) => room.listing());
  }

  // Closes a room and returns the connections that were still in it. Closing a room a second
  // time does nothing: by then its code may belong to another room.
  close(room: Room): string[] {
    if (this.#rooms.get(room.code) === room) this.#rooms.delete(room.code);
    return room.connections();
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
      room.forgetOldEmotes();
    } finally {
      // Whatever did change before a game module threw still has to reach the room's members.
      if (changed) result.changed.push(room);
    }
  }
}
