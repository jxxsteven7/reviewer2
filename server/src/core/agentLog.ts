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

// The versions of the AI that are certified, each as the version of the prompts and the model, as
// the agent's note names them (AgentNote). A game that an AI played in, as an AI player or for
// someone who was offline, brings points, streaks, titles and friend titles only when every answer
// the AI gave in it came from a certified version (certifiedPlay, docs/architecture.md#ai-players).
// None is yet, so every such game brings nothing, and is kept whole, with the version of each
// answer, for the day one is. The room and the recount decide by this alone: the streaks, the
// friend duos and the records page (store/records.ts), the check of the data (store/check.ts) and
// the game's score floats (RoomView.agentsPlayed) still take "an AI played" for "brought nothing",
// which holds while this is empty, so the first version added here changes those too
// (agentLog.test.ts).
export const CERTIFIED_AGENTS: readonly { prompt: string; model: string }[] = [];

// Whether a game that an AI played in counts, by the AI's log of it: the AI gave at least one
// answer, every one came from a certified version, and the log holds them all. A step without an
// answer, as when the agent was busy or its model failed, played nothing, and says nothing of a
// version. During a game, this is as far as the AI has answered so far.
export function certifiedPlay(log: AgentLogData | null, certified = CERTIFIED_AGENTS): boolean {
  if (log === null || log.truncated) return false;
  const answers = log.steps.filter((step) => step.answer !== undefined);
  const byCertified = (note: AgentNote | undefined) =>
    note !== undefined && certified.some(({ prompt, model }) => note.prompt === prompt && note.model === model);
  return answers.length > 0 && answers.every(({ note }) => byCertified(note));
}

// One step: when it was asked for, in milliseconds from the start of the game on the room's clock;
// the seat, by player ID; the persona that played it, and whether it played for a player who was
// offline rather than as an AI player of its own; what it was to do, as the game names it (such as
// "clue", "guess" or "advise"); either the answer, as the agent gave it, or why there was none; and
// whether the answer came too late to be of use, once the game had moved on.
export interface AgentStep {
  t: number;
  by: string;
  persona: string;
  takeover?: true;
  kind: string;
  answer?: unknown;
  note?: AgentNote;
  error?: string;
  late?: true;
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
