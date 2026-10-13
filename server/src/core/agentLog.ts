import type { AgentNote } from '@reviewer2/shared';

// The AI's side of one game (docs/architecture.md#game-records): for every step that an AI player
// took, or an AI that played for someone who was offline in their turn, what it was asked, what it
// answered and how it came to that, as the agent says (AgentNote): the model, the version of the
// prompts, the clues it considered with what the rules said of them, and the reason it gave. The
// record of the game keeps it beside the game's own log, on the server alone, for the AI players
// of later versions to learn from. The game's log says what the AI did; this says why.

// The largest log that is kept, as JSON, in bytes, apart from the game's own log, so that the AI's
// notes never crowd out what happened. A step takes a few hundred bytes, so a game with four AI
// players fits many times over. Past it, the log keeps no more steps, and says so once.
export const MAX_AGENT_LOG_BYTES = 64 * 1024;

// One step: when it was asked for, in milliseconds from the start of the game on the room's clock;
// the seat, by player ID; the persona that played it, and whether it played for a player who was
// offline rather than as an AI player of its own; what it was to do, as the game names it (such as
// "clue", "guess" or "advise"); and either the answer, as the agent gave it, or why there was none.
export interface AgentStep {
  t: number;
  by: string;
  persona: string;
  takeover?: true;
  kind: string;
  answer?: unknown;
  note?: AgentNote;
  error?: string;
}

export interface AgentLogData {
  v: 1;
  gameId: string;
  steps: AgentStep[];
  truncated?: true;
}

// What the field that says the log was cut short adds to the JSON, with its comma.
const TRUNCATED_BYTES = Buffer.byteLength(',"truncated":true');

export class AgentLog {
  readonly #steps: AgentStep[] = [];
  #bytes: number;
  #truncated = false;

  constructor(
    readonly gameId: string,
    // When the game started, on the room's clock.
    readonly startedAt: number,
  ) {
    this.#bytes = Buffer.byteLength(JSON.stringify(this.data()));
  }

  // Notes a step that was asked for at `at`, on the room's clock, unless the log is full.
  add(at: number, step: Omit<AgentStep, 't'>): void {
    if (this.#truncated) return;
    const entry: AgentStep = { t: at - this.startedAt, ...step };
    const bytes = Buffer.byteLength(JSON.stringify(entry)) + (this.#steps.length > 0 ? 1 : 0);
    if (this.#bytes + bytes + TRUNCATED_BYTES > MAX_AGENT_LOG_BYTES) {
      this.#truncated = true;
      this.#bytes += TRUNCATED_BYTES;
      return;
    }
    this.#bytes += bytes;
    this.#steps.push(entry);
  }

  get empty(): boolean {
    return this.#steps.length === 0 && !this.#truncated;
  }

  data(): AgentLogData {
    return { v: 1, gameId: this.gameId, steps: this.#steps, ...(this.#truncated ? { truncated: true as const } : {}) };
  }
}
