// The log of one game (docs/architecture.md#game-records): everything that changed it, in order,
// from its start to its end, with when it came and who did it. The room keeps one for the game it
// is playing, and the record of the game keeps it, on the server alone, however the game ended. The
// game says what of its messages the log keeps (GameModule.logged). What a player said in their
// group's chat is kept apart in its entry, as `said`, so that whoever reads the records can leave it
// out where it matters; the player IDs of accounts deleted since are marked (markDeleted), so that
// what they said can be told apart from a guest's.

// How large a log may grow, as JSON, in bytes. A whole game makes a few kilobytes, and nothing of
// what happened in a game is ever dropped from its log: the records are counted again from it when
// the rules change (store/recount.ts). What the players say may take up to MAX_SAID_BYTES of it,
// past which the log keeps no more of it, and notes once that it has left it out. The rest, which
// says who sat where and what they did, each member may add a few hundred entries to
// (MAX_LOGGED_PER_MEMBER in room.ts), past which the room refuses what they send. Past
// CROWDED_GAME_LOG_BYTES of it, many times what a game takes, the log is crowded (`crowded`) with
// comings and goings, as of guests who come and go under one browser key after another, and the
// room takes nobody in and lets nobody change seats until the game ends, while the game's own
// moves go on, which are few: the cards on the board, a clue a turn, and the timers. The whole of
// it has MAX_GAME_LOG_BYTES, which only a game left to its timers for hours reaches: the log is
// then full (`full`), and the room closes with its game cut short there (socket.ts), so that no
// room can grow without end in the server's memory. The log is kept whole, with the end that says
// why.
export const MAX_GAME_LOG_BYTES = 128 * 1024;
export const CROWDED_GAME_LOG_BYTES = 64 * 1024;
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
// guest who left and came back has had two IDs with the one number, and one who logged in during
// the game keeps it for the IDs they had as a guest. A game without any has none.
// `match` is there for a game of a match (docs/architecture.md#matches): the number in the match of
// everyone in the room who has one, by player ID, and, where a guest's line in the match has gone
// into an account's (`merged`), each number that went into another, by the number it went into, as
// they stood when the game ended. `deleted` has the player IDs of the accounts deleted since, in the
// order they went, once each; a log without any has none.
export interface GameLogData {
  v: 2;
  game: string;
  gameId: string;
  start: Record<string, unknown> | null;
  agents?: Record<string, string>;
  guests?: Record<string, number>;
  match?: MatchNumbers;
  entries: GameLogEntry[];
  truncated?: true;
  deleted?: string[];
}

export interface MatchNumbers {
  numbers: Record<string, number>;
  merged?: Record<string, number>;
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

  constructor(
    readonly game: string,
    readonly gameId: string,
    // When the game started, on the room's clock.
    readonly startedAt: number,
    readonly start: Record<string, unknown> | null,
    readonly agents: Record<string, string> = {},
  ) {
    this.#bytes = Buffer.byteLength(JSON.stringify(this.data()));
  }

  // Notes one thing that happened at `at`, on the room's clock. A line of chat is left out once
  // the chat has taken up its share.
  add(at: number, by: string | null, type: string, { data, said, agent }: GameLogExtra = {}): void {
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
    this.#entries.push(entry);
  }

  // Whether the log has grown as large as a log may, apart from what the players said, which has
  // its own share: a flood of messages, on which the room closes.
  get full(): boolean {
    return this.#doneBytes > MAX_GAME_LOG_BYTES;
  }

  // Whether the log is crowded with comings and goings, on which the room takes nobody in and lets
  // nobody change seats until the game ends.
  get crowded(): boolean {
    return this.#doneBytes > CROWDED_GAME_LOG_BYTES;
  }

  // The size of what was done, apart from what was said.
  get #doneBytes(): number {
    return this.#bytes - this.#saidBytes;
  }

  // How many entries the log holds, and the entries from the one at `index` on: what has been added
  // to the log since it had `index` entries.
  get size(): number {
    return this.#entries.length;
  }

  since(index: number): GameLogEntry[] {
    return this.#entries.slice(index);
  }

  // The log to keep.
  data(): GameLogData {
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
