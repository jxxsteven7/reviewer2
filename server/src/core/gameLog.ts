// The log of one game (docs/architecture.md#game-records): everything that changed it, in order,
// from its start to its end, with when it came and who did it. The room keeps one for the game it
// is playing, and the record of the game keeps it, on the server alone, however the game ended. The
// game says what of its messages the log keeps (GameModule.logged). What a player said in their
// group's chat is kept apart in its entry, as `said`, so that whoever reads the records can leave it
// out where it matters; the player IDs of accounts deleted since are marked (markDeleted), so that
// what they said can be told apart from a guest's.

// The largest log that is kept, as JSON, in bytes. A whole game makes a few kilobytes; a player who
// sends message after message could make it grow without end, and every room holds its log in
// memory while its game is on. What the players say may take up to MAX_SAID_BYTES of it, past
// which the log keeps no more of it, and notes once that it has left it out. Everything else, which
// says who sat where and what they did, is kept until a log that grows past all of it is dropped:
// it is not kept at all, and holds nothing from then on.
export const MAX_GAME_LOG_BYTES = 128 * 1024;
export const MAX_SAID_BYTES = 48 * 1024;

// One thing that happened: when, in milliseconds from the start of the game on the room's clock;
// who did it, by player ID, or null for the room itself, such as a timer that ran out; what it was,
// a game's message such as "keywords:reveal" or one of the room's own (GameLogEvent); what it
// carried, if anything; and what the player said, for a line of a group's chat. A move that an AI
// made for a player who was offline in their turn names the persona it played as in `agent`
// (docs/architecture.md#ai-players), so that nobody takes it for the player's own.
export interface GameLogEntry {
  t: number;
  by: string | null;
  type: string;
  data?: unknown;
  said?: string;
  agent?: string;
}

// What the room logs of its own, besides the game's messages: a member who came or went, the chair
// moving a player to the spectators or removing them, the chair passing to someone else, an AI that
// begins or stops playing for a player who is offline in their turn, a timer that changed the game,
// the end of the game, and, once, that the log left out what the players said from then on. Who is
// online is not logged, nor are quick reactions: a player who looks away for a moment is still in
// the game. What it costs a game when they don't come back in time, the timer says: its entry names
// those it was waiting for who were offline.
export const GAME_LOG_EVENTS = [
  'join',
  'leave',
  'bench',
  'remove',
  'chair',
  'takeover',
  'tick',
  'end',
  'truncated',
] as const;
export type GameLogEvent = (typeof GAME_LOG_EVENTS)[number];

// A log as the record keeps it. `v` is the version of this shape: 2 since the log began to keep the
// chat and the takeovers, and no longer kept the cards chosen, the quick reactions and who came
// online. `start` is where everyone in the room was when the game began, by player ID, as the game
// describes each of them (GameModule.seated), or null for a game that doesn't say. `agents` names
// the AI players among them, by player ID, with the persona each played as; a game without any has
// none. `guests` has the number in the room of each guest who played in the game, by player ID: a
// guest who left and came back has had two IDs with the one number. A game without any has none.
// `deleted` has the player IDs of the accounts deleted since, in the order they went, once each; a
// log without any has none.
export interface GameLogData {
  v: 2;
  game: string;
  gameId: string;
  start: Record<string, unknown> | null;
  agents?: Record<string, string>;
  guests?: Record<string, number>;
  entries: GameLogEntry[];
  truncated?: true;
  deleted?: string[];
}

// How a game came to an end, for its record (docs/architecture.md#game-records): by itself;
// withdrawn by the chair, alone or with the match the chair ended; cut short when its room closed,
// because of its chair, its last person, or the time that nobody was online or nothing happened in
// it; or cut short because the server stopped.
export const GAME_ENDINGS = ['finished', 'withdrawn', 'abandoned', 'interrupted'] as const;
export type GameEnding = (typeof GAME_ENDINGS)[number];

// What an entry may carry besides who, when and what.
export interface GameLogExtra {
  data?: unknown;
  said?: string;
  agent?: string;
}

// What the `truncated` field adds to the JSON, with its comma.
const TRUNCATED_BYTES = Buffer.byteLength(',"truncated":true');

export class GameLog {
  readonly #entries: GameLogEntry[] = [];
  // The size of the log as JSON, kept up to date with each entry, so that no entry has to be
  // written out twice, and the part of it that the entries with something said take up.
  #bytes: number;
  #saidBytes = 0;
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

  // Notes one thing that happened at `at`, on the room's clock. A line of chat is left out once
  // the chat has taken up its share, and nothing is noted once the log has grown too long to keep.
  add(at: number, by: string | null, type: string, { data, said, agent }: GameLogExtra = {}): void {
    if (this.#overflowed) return;
    const entry: GameLogEntry = {
      t: at - this.startedAt,
      by,
      type,
      ...(data === undefined ? {} : { data }),
      ...(said === undefined ? {} : { said }),
      ...(agent === undefined ? {} : { agent }),
    };
    if (said !== undefined) {
      if (this.#truncated) return;
      const bytes = Buffer.byteLength(JSON.stringify(entry)) + 1;
      if (this.#saidBytes + bytes > MAX_SAID_BYTES) {
        this.#truncated = true;
        this.#bytes += TRUNCATED_BYTES;
        this.#push({ t: entry.t, by: null, type: 'truncated' });
        return;
      }
      this.#saidBytes += bytes;
    }
    this.#push(entry);
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

  // How many entries the log holds, and the entries from the one at `index` on: what has been added
  // to the log since it had `index` entries. A log that grew too long holds none.
  get size(): number {
    return this.#entries.length;
  }

  since(index: number): GameLogEntry[] {
    return this.#entries.slice(index);
  }

  // The log to keep, or null when it grew too long.
  data(): GameLogData | null {
    return this.#overflowed ? null : this.#data();
  }

  #data(): GameLogData {
    return {
      v: 2,
      game: this.game,
      gameId: this.gameId,
      start: this.start,
      ...(Object.keys(this.agents).length > 0 ? { agents: this.agents } : {}),
      entries: this.#entries,
      ...(this.#truncated ? { truncated: true as const } : {}),
    };
  }
}

// A kept log with these player IDs marked as those of an account deleted since, the account that is
// deleted, by the IDs it had in the game (docs/architecture.md#game-records). What they said stays,
// as nobody's: nothing links the IDs to the account any more. Returns the log as it was when it has
// them marked already.
export function markDeleted<Log extends { deleted?: string[] }>(log: Log, playerIds: Iterable<string>): Log {
  const marked = new Set(log.deleted);
  const added = [...new Set(playerIds)].filter((id) => !marked.has(id));
  return added.length === 0 ? log : { ...log, deleted: [...marked, ...added] };
}
