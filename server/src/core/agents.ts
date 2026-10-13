import type { AgentAnswer, AgentPersona } from '@reviewer2/shared';
import type { AgentChannel, AgentOutcome } from './agentChannel';
import type { AgentTask } from './game';
import type { Room } from './room';
import type { Timers } from './socket';

// The driver of the AI players (docs/architecture.md#ai-players). An AI player is a member of a room
// like any other, with a seat that the game gave it, but no connection: when its seat has something
// to do, the driver asks the agent (agentChannel.ts) and sends the answer to the game as the
// player's page would send a message, through Room.act(), where the rules judge it as they judge
// anyone's. An AI also plays for a person who has been offline for TAKEOVER_MS in a room that may
// have AI players, as long as the turn is theirs, and stops when they come back.
//
// The driver looks at a room every time it changes (poke(), from the socket layer's broadcast), and
// otherwise only when a timer it set comes due: a move that waits for its pace, a player who has
// been offline long enough to be played for, or the agent to be asked whether it is back. The game
// says what a seat is to do (GameModule.agentTask) and what message an answer makes
// (GameModule.agentMove); the driver knows nothing of any game.
//
// What the agent answers is a suggestion that has to get past the rules like any message. An
// answer that comes after the game has moved on is dropped. When the agent can't be reached or its
// model fails, the AI players count as offline until it answers again, and the games' clocks see
// to it that no game waits for them.

type Log = (event: string, fields?: Record<string, unknown>) => void;

// How long a person has been offline in a game before an AI plays their turns, which leaves them
// time to reload the page or to unlock their phone.
export const TAKEOVER_MS = 20_000;
// How long a request may wait at most, and how long before the end of the phase the driver stops
// waiting, so that a move doesn't arrive as the clock runs out. A phase without a time limit, which
// only a game played for someone offline can have, waits MAX_WAIT_MS.
export const MAX_WAIT_MS = 60_000;
export const MARGIN_MS = 3_000;
// How often the agent is asked whether it is back, once it has failed.
export const PING_MS = 30_000;
// The most moves that one answer can make, which no game comes near: a guard against a game whose
// agentMove() would go on for ever.
const MAX_MOVES = 30;
// The persona that plays for someone offline.
const STANDIN: AgentPersona = 'reviewer1';
// How far back the status page counts the AI's steps.
const STATS_MS = 60 * 60_000;

// A task that is under way in a seat: what it is, when it came up, the agent's answer once it has
// come, the messages sent for it so far and when the last went, and the timer of the next move.
interface Running {
  task: AgentTask;
  persona: AgentPersona;
  takeover: boolean;
  since: number;
  answer: AgentAnswer | null;
  made: string[];
  lastMove: number;
  timer: unknown;
  // Done, by a move that the rules refused or by too many moves: nothing more is sent for the task.
  done: boolean;
  cancelled: boolean;
}

export interface DriverOptions {
  channel: AgentChannel;
  // Whether the agent answers, which the rooms read for their AI players (Room.isOnline). It is down
  // until the agent has answered the first ping.
  state: { up: boolean };
  now: () => number;
  timers: Timers;
  log: Log;
  // Sends everyone in the room its new state. The socket layer then pokes the driver again.
  broadcast(room: Room): void;
  // Whether the room is still open.
  isOpen(room: Room): boolean;
  // The rooms whose AI players are seen as online or offline, when the agent comes back or fails.
  rooms(): Iterable<Room>;
}

export class AgentDriver {
  readonly state: { up: boolean };
  readonly #options: DriverOptions;
  readonly #running = new Map<Room, Map<string, Running>>();
  // The timer of each room that waits for someone offline to be played for.
  readonly #wakeups = new Map<Room, { at: number; timer: unknown }>();
  #ping: unknown = null;
  // When the AI's steps of the last hour were asked for, and when those that failed did.
  #steps: number[] = [];
  #failures: number[] = [];

  constructor(options: DriverOptions) {
    this.#options = options;
    this.state = options.state;
    this.state.up = false;
    this.#check();
  }

  // Looks at the room after it has changed: who is to be played for, and what each AI seat is to do.
  poke(room: Room): void {
    const { isOpen, now, broadcast } = this.#options;
    const playing = isOpen(room) && room.phase === 'playing';
    const rev = room.rev;
    this.#takeovers(room, playing);
    if (room.rev !== rev) {
      // The new state goes out first, and comes back here with it.
      broadcast(room);
      return;
    }
    // Nobody plays a game that no person is online in, so that no AI plays on for nobody.
    const watched = [...room.members.values()].some((member) => !member.agent && member.sockets.size > 0);
    const seats = playing && watched && room.game.agentTask ? this.#seats(room) : new Map<string, AgentPersona>();
    const running = this.#running.get(room) ?? new Map<string, Running>();
    for (const [id, run] of running) if (!seats.has(id)) this.#cancel(running, id, run);
    for (const [id, persona] of seats) {
      const member = room.members.get(id);
      let task = room.game.agentTask?.(room.data, room.context, id) ?? null;
      const takeover = member?.agent === null;
      if (task?.advice && takeover) task = null;
      const run = running.get(id);
      if (!task) {
        if (run) this.#cancel(running, id, run);
        continue;
      }
      if (run && run.task.moment === task.moment) {
        this.#next(room, id, run);
        continue;
      }
      if (run) this.#cancel(running, id, run);
      const started: Running = {
        task,
        persona,
        takeover,
        since: now(),
        answer: null,
        made: [],
        lastMove: 0,
        timer: null,
        done: false,
        cancelled: false,
      };
      running.set(id, started);
      this.#ask(room, id, started);
    }
    if (running.size > 0) this.#running.set(room, running);
    else this.#running.delete(room);
  }

  // Forgets a room that has closed.
  forget(room: Room): void {
    const running = this.#running.get(room);
    if (running) for (const [id, run] of running) this.#cancel(running, id, run);
    this.#running.delete(room);
    this.#unwake(room);
  }

  // For the status page: whether the agent answers, and how many steps the AI took in the last hour,
  // and how many of them failed.
  stats(): { up: boolean; steps: number; failures: number } {
    this.#forgetOld();
    return { up: this.state.up, steps: this.#steps.length, failures: this.#failures.length };
  }

  #forgetOld(): void {
    const since = this.#options.now() - STATS_MS;
    this.#steps = this.#steps.filter((at) => at >= since);
    this.#failures = this.#failures.filter((at) => at >= since);
  }

  // Stops asking whether the agent is back, when the server stops.
  close(): void {
    if (this.#ping !== null) this.#options.timers.stop(this.#ping);
    this.#ping = null;
    for (const room of [...this.#running.keys(), ...this.#wakeups.keys()]) this.forget(room);
  }

  // Who is played for: a person who has been offline for TAKEOVER_MS in a game of a room that may
  // have AI players, until they come back or the game ends. For whoever isn't offline long enough
  // yet, the room is looked at again when they will be.
  #takeovers(room: Room, playing: boolean): void {
    const allowed = playing && this.state.up && room.agentsAllowed();
    const now = this.#options.now();
    let due: number | null = null;
    for (const member of room.members.values()) {
      if (member.agent) continue;
      const since = member.offlineSince;
      const away = allowed && member.sockets.size === 0 && since !== null;
      const ripe = away && now - since >= TAKEOVER_MS;
      room.takeOver(member.id, ripe);
      if (away && !ripe) due = Math.min(due ?? Infinity, since + TAKEOVER_MS);
    }
    this.#wake(room, due);
  }

  // The seats that an AI plays, with the persona it plays them as.
  #seats(room: Room): Map<string, AgentPersona> {
    const seats = new Map<string, AgentPersona>();
    for (const member of room.members.values()) {
      if (member.agent) {
        if (this.state.up) seats.set(member.id, member.agent);
      } else if (member.takenOver) {
        seats.set(member.id, STANDIN);
      }
    }
    return seats;
  }

  #wake(room: Room, at: number | null): void {
    const set = this.#wakeups.get(room);
    if (set?.at === at) return;
    this.#unwake(room);
    if (at === null) return;
    const { timers, now } = this.#options;
    const timer = timers.start(
      () => {
        this.#wakeups.delete(room);
        this.#safely(room, () => this.poke(room));
      },
      Math.max(0, at - now()),
    );
    this.#wakeups.set(room, { at, timer });
  }

  #unwake(room: Room): void {
    const set = this.#wakeups.get(room);
    if (set) this.#options.timers.stop(set.timer);
    this.#wakeups.delete(room);
  }

  // Asks the agent what to do in a seat, for as long as the phase leaves, and notes what came of it in
  // the AI's log of the game.
  #ask(room: Room, id: string, run: Running): void {
    const { channel, now, log } = this.#options;
    const deadline = room.deadline();
    const waitMs = Math.min(MAX_WAIT_MS, deadline === null ? MAX_WAIT_MS : deadline - now() - MARGIN_MS);
    if (waitMs < 1_000) {
      run.done = true;
      return;
    }
    this.#steps.push(now());
    this.#forgetOld();
    const request = { v: 1 as const, persona: run.persona, waitMs: Math.round(waitMs), ...run.task.question };
    void channel.ask(request, waitMs).then((outcome) =>
      this.#safely(room, () => {
        const late = run.cancelled;
        room.noteAgent({
          by: id,
          persona: run.persona,
          ...(run.takeover ? { takeover: true as const } : {}),
          kind: run.task.kind,
          ...answerOf(outcome),
          ...(late ? { error: 'late' } : {}),
        });
        if (!outcome.ok) {
          this.#failures.push(now());
          log('agent_failed', { code: room.code, kind: run.task.kind, error: outcome.error });
          if (['unreachable', 'timeout', 'bad_reply', 'model_failed'].includes(outcome.error)) this.#down();
          run.done = true;
          return;
        }
        if (late || outcome.kind === 'ping') return;
        run.answer = outcome;
        this.#next(room, id, run);
      }),
    );
  }

  // Sends the next move of a task whose answer has come, once its pace allows, unless there is none
  // for now, as for an AI student whose advice stands until the group reveals a card.
  #next(room: Room, id: string, run: Running): void {
    if (run.done || run.cancelled || !run.answer || run.timer !== null) return;
    const { now, timers } = this.#options;
    const wait =
      run.made.length === 0 ? run.since + run.task.pace.first - now() : run.lastMove + run.task.pace.step - now();
    const move = () => {
      run.timer = null;
      if (run.done || run.cancelled || !run.answer) return;
      const current = room.game.agentTask?.(room.data, room.context, id) ?? null;
      if (current?.moment !== run.task.moment) return;
      const next = room.game.agentMove?.(room.data, room.context, id, run.task, run.answer, run.made) ?? null;
      if (!next) return;
      const result = room.act(id, next.type, next.payload, run.takeover ? run.persona : undefined);
      run.made.push(next.type);
      run.lastMove = now();
      if (!result.ok) {
        this.#options.log('agent_move_refused', { code: room.code, type: next.type, error: result.error });
        run.done = true;
      } else if (run.made.length >= MAX_MOVES) {
        run.done = true;
      }
      this.#options.broadcast(room);
    };
    if (wait <= 0) {
      this.#safely(room, move);
      return;
    }
    run.timer = timers.start(() => this.#safely(room, move), wait);
  }

  #cancel(running: Map<string, Running>, id: string, run: Running): void {
    run.cancelled = true;
    if (run.timer !== null) this.#options.timers.stop(run.timer);
    run.timer = null;
    running.delete(id);
  }

  // The agent has failed: the AI players are offline until a ping finds it back.
  #down(): void {
    if (!this.state.up) return;
    this.state.up = false;
    this.#options.log('agent_down');
    this.#refresh();
    this.#schedulePing();
  }

  // Asks the agent whether it answers, and again every PING_MS until it does.
  #check(): void {
    this.#ping = null;
    void this.#options.channel.ask({ v: 1, kind: 'ping' }, 5_000).then((outcome) => {
      if (outcome.ok && outcome.kind === 'ping') {
        if (this.state.up) return;
        this.state.up = true;
        this.#options.log('agent_up', { model: outcome.model });
        this.#refresh();
      } else {
        this.#schedulePing();
      }
    });
  }

  #schedulePing(): void {
    if (this.#ping === null) this.#ping = this.#options.timers.start(() => this.#check(), PING_MS);
  }

  // Everyone in a room with AI players sees them come online or go offline, and the driver looks at
  // the room again.
  #refresh(): void {
    for (const room of this.#options.rooms()) {
      if (!room.hasAgents() || !this.#options.isOpen(room)) continue;
      room.changed();
      this.#safely(room, () => this.#options.broadcast(room));
    }
  }

  // What a game module throws while the driver plays must not end the process, or stop the others.
  #safely(room: Room, run: () => void): void {
    try {
      run();
    } catch (error) {
      this.#options.log('error', {
        where: 'agents',
        code: room.code,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// What the AI's log keeps of an outcome: the answer and the agent's note, or why there was none.
function answerOf(outcome: AgentOutcome): { answer?: unknown; note?: AgentAnswer['note']; error?: string } {
  if (!outcome.ok)
    return { error: outcome.error, ...('note' in outcome && outcome.note ? { note: outcome.note } : {}) };
  if (outcome.kind === 'clue') {
    return { answer: { word: outcome.word, count: outcome.count, targets: outcome.targets }, note: outcome.note };
  }
  if (outcome.kind === 'guess') return { answer: { picks: outcome.picks, reason: outcome.reason }, note: outcome.note };
  return {};
}
