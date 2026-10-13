// The log of one game (docs/architecture.md#game-records): everything that changed it, in order,
// from its start to its end, with when it came and who did it. The room keeps one for the game it
// is playing, and the record of the game keeps it beside the replay, on the server alone. A group's
// chat is never in it: the game says what of its messages the log keeps (GameModule.logged).

// The largest log that is kept, as JSON, in bytes, as large as the largest replay. A whole game
// makes a few kilobytes; a player who sends message after message could make it grow without end,
// and every room holds its log in memory while its game is on, so past three quarters of this the
// log keeps no more of the entries that the game calls minor, such as cards chosen and taken back,
// and notes once that it has left them out. Everything else, which says who sat where and what
// they did, is kept until a log that grows past all of it is dropped: it is not kept at all, and
// holds nothing from then on.
export const MAX_GAME_LOG_BYTES = 64 * 1024;
const MINOR_BYTES = (MAX_GAME_LOG_BYTES * 3) / 4;

// One thing that happened: when, in milliseconds from the start of the game on the room's clock;
// who did it, by player ID, or null for the room itself, such as a timer that ran out; what it was,
// a game's message such as "keywords:reveal" or one of the room's own (GameLogEvent); and what it
// said, if anything. A move that an AI made for a player who was offline in their turn names the
// persona it played as in `agent` (docs/architecture.md#ai-players), so that nobody takes it for
// the player's own.
export interface GameLogEntry {
  t: number;
  by: string | null;
  type: string;
  data?: unknown;
  agent?: string;
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
export type GameLogEvent = (typeof GAME_LOG_EVENTS)[number];

// A log as the record keeps it. `v` is the version of this shape. `start` is where everyone in the
// room was when the game began, by player ID, as the game describes each of them
// (GameModule.seated), or null for a game that doesn't say. `agents` names the AI players among
// them, by player ID, with the persona each played as; a game without any has none.
export interface GameLogData {
  v: 1;
  game: string;
  gameId: string;
  start: Record<string, unknown> | null;
  agents?: Record<string, string>;
  entries: GameLogEntry[];
  truncated?: true;
}

// What the `truncated` field adds to the JSON, with its comma.
const TRUNCATED_BYTES = Buffer.byteLength(',"truncated":true');

export class GameLog {
  readonly #entries: GameLogEntry[] = [];
  // The size of the log as JSON, kept up to date with each entry, so that no entry has to be
  // written out twice.
  #bytes: number;
  #truncated = false;
  #overflowed = false;

  constructor(
    readonly game: string,
    readonly gameId: string,
    // When the game started, on the room's clock.
    readonly startedAt: number,
    readonly start: Record<string, unknown> | null,
    readonly agents: Record<string, string> = {},
  ) {
    this.#bytes = Buffer.byteLength(JSON.stringify(this.#data()));
  }

  // Notes one thing that happened at `at`, on the room's clock, and the persona of the AI that did
  // it for an offline player, if one did. A minor one is left out once the log has grown long, and
  // nothing is noted once it has grown too long to keep.
  add(at: number, by: string | null, type: string, data?: unknown, minor = false, agent?: string): void {
    if (this.#overflowed) return;
    if (minor && this.#bytes > MINOR_BYTES) {
      if (this.#truncated) return;
      this.#truncated = true;
      this.#bytes += TRUNCATED_BYTES;
      this.#push({ t: at - this.startedAt, by: null, type: 'truncated' });
      return;
    }
    this.#push({
      t: at - this.startedAt,
      by,
      type,
      ...(data === undefined ? {} : { data }),
      ...(agent === undefined ? {} : { agent }),
    });
  }

  #push(entry: GameLogEntry): void {
    // One byte more for the comma before every entry but the first.
    this.#bytes += Buffer.byteLength(JSON.stringify(entry)) + (this.#entries.length > 0 ? 1 : 0);
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
      ...(Object.keys(this.agents).length > 0 ? { agents: this.agents } : {}),
      entries: this.#entries,
      ...(this.#truncated ? { truncated: true as const } : {}),
    };
  }
}
