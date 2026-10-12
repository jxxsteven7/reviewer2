// The log of one game (docs/architecture.md#game-records): everything that changed it, in order,
// from its start to its end, with when it came and who did it. The room keeps one for the game it
// is playing, and the record of the game keeps it beside the replay, on the server alone. A group's
// chat is never in it: the game says what of its messages the log keeps (GameModule.logged).

// The largest log that is kept, as JSON, in bytes, as large as the largest replay. A whole game
// makes a few kilobytes, about 7 for one of 16 turns; a player who sends message after message
// could make it grow without end, and every room holds its log in memory while its game is on, so
// past three quarters of this the log keeps no more minor entries, such as cards chosen and taken
// back, and notes once that it has left them out. A log that grows past all of it is not kept at
// all, and holds nothing from then on.
export const MAX_GAME_LOG_BYTES = 64 * 1024;
const MINOR_BYTES = (MAX_GAME_LOG_BYTES * 3) / 4;

// One thing that happened: when, in milliseconds from the start of the game on the room's clock;
// who did it, by player ID, or null for the room itself, such as a timer that ran out; what it was,
// a game's message such as "keywords:reveal" or one of the room's own (GAME_LOG_EVENTS); and what
// it said, if anything.
export interface GameLogEntry {
  t: number;
  by: string | null;
  type: string;
  data?: unknown;
}

// What the room logs of its own, besides the game's messages: a member who came or went, came
// online or went offline, a quick reaction, the chair moving a player to the spectators or
// removing them, the chair passing to someone else, a timer that changed the game, the end of the
// game, and, once, that the log left out minor entries from then on.
export const GAME_LOG_EVENTS = [
  'join',
  'leave',
  'online',
  'offline',
  'emote',
  'bench',
  'remove',
  'chair',
  'tick',
  'end',
  'truncated',
] as const;

// A log as the record keeps it. `v` is the version of this shape. `start` is how the game began, as
// the game describes it (GameModule.opening).
export interface GameLogData {
  v: 1;
  game: string;
  gameId: string;
  start: unknown;
  entries: GameLogEntry[];
  truncated?: true;
}

export class GameLog {
  readonly #entries: GameLogEntry[] = [];
  #bytes: number;
  #truncated = false;
  #overflowed = false;

  constructor(
    readonly game: string,
    readonly gameId: string,
    // When the game started, on the room's clock.
    readonly startedAt: number,
    readonly start: unknown,
  ) {
    this.#bytes = Buffer.byteLength(JSON.stringify(this.#data()));
  }

  // Notes one thing that happened at `at`, on the room's clock. A minor one is left out once the
  // log has grown long, and nothing is noted once it has grown too long to keep.
  add(at: number, by: string | null, type: string, data?: unknown, minor = false): void {
    if (this.#overflowed) return;
    if (minor && this.#bytes > MINOR_BYTES) {
      if (this.#truncated) return;
      this.#truncated = true;
      this.#push({ t: at - this.startedAt, by: null, type: 'truncated' });
      return;
    }
    this.#push({ t: at - this.startedAt, by, type, ...(data === undefined ? {} : { data }) });
  }

  #push(entry: GameLogEntry): void {
    // One byte more for the comma between entries.
    this.#bytes += Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (this.#bytes > MAX_GAME_LOG_BYTES) {
      this.#overflowed = true;
      this.#entries.length = 0;
      return;
    }
    this.#entries.push(entry);
  }

  // Whether the log grew too long to keep.
  get overflowed(): boolean {
    return this.#overflowed;
  }

  // The log to keep, or null when it grew too long.
  data(): GameLogData | null {
    return this.#overflowed ? null : this.#data();
  }

  #data(): GameLogData {
    return {
      v: 1,
      game: this.game,
      gameId: this.gameId,
      start: this.start,
      entries: this.#entries,
      ...(this.#truncated ? { truncated: true as const } : {}),
    };
  }
}
