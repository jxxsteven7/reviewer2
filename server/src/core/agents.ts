import type { AgentAnswer, AgentPersona } from '@reviewer2/shared';
import type { AgentChannel, AgentOutcome } from './agentChannel';
import type { AgentTask, GameContext } from './game';
import type { Member, Room } from './room';
import type { Timers } from './socket';

// The driver of the AI players (docs/architecture.md#ai-players). An AI player is a member of a room
// like any other, with a seat that the game gave it, but no connection: when its seat has something
// to do, the driver asks the agent (agentChannel.ts) and sends the answer to the game as the
// player's page would send a message, through Room.act(), where the rules judge it as they judge
// anyone's. An AI also plays for a person who has been offline for TAKEOVER_MS in a room that may
// have AI players, as long as the turn is theirs and nobody else plays it, and stops when they come
// back.
//
// The driver looks at a room every time it changes (poke(), from the socket layer's broadcast), and
// otherwise only when a timer it set comes due: a move that waits for its pace, a request to ask
// again after one that brought no answer, a player who has been offline long enough to be played
// for or to be counted as gone by the AI players, or the agent to be asked whether it is back. The
// game says what a seat is to do (GameModule.agentTask) and what message an answer makes
// (GameModule.agentMove); the driver knows nothing of any game.
//
// What the agent answers is a suggestion that has to get past the rules like any message. An
// answer that comes after the game has moved on is dropped. When the agent can't be reached or its
// model fails, the AI players count as offline until it answers again, and the games' clocks see
// to it that no game waits for them.

type Log = (event: string, fields?: Record<string, unknown>) => void;

// How long a person has been offline in a game before an AI plays their turns, which leaves them
// time to reload the page or to unlock their phone. Until then, the game counts them as there, so
// that nobody's brief drop changes what an AI does.
export const TAKEOVER_MS = 20_000;
// Whether a person is there, as the AI players see it: online, or offline for less than
// TAKEOVER_MS yet.
const present = (member: Member, now: number): boolean =>
  member.sockets.size > 0 || (member.offlineSince !== null && now - member.offlineSince < TAKEOVER_MS);
// How long a request may wait at most, and how long before the end of the phase the driver stops
// waiting, so that a move doesn't arrive as the clock runs out. A phase without a time limit, which
// only a game played for someone offline can have, waits MAX_WAIT_MS.
export const MAX_WAIT_MS = 60_000;
export const MARGIN_MS = 3_000;
// How long the driver waits before asking again for a seat whose request brought no answer, as
// when the agent was busy, doubling each time up to the longest wait, for as long as the phase
// lasts. A phase without a time limit would otherwise stand still after one such answer.
export const RETRY_MS = 10_000;
export const MAX_RETRY_MS = 60_000;
// How often the agent is asked whether it is back, once it has failed.
export const PING_MS = 30_000;
// How long what the agent last said holds, while it is up, for whoever asks whether the AI players
// can play (recheck()): past it, they are asked again. Nothing asks the agent while no AI plays,
// so without this a model that went away meanwhile would go unseen until the next game.
export const FRESH_MS = 30_000;
// The most moves that one answer can make, which no game comes near: a guard against a game whose
// agentMove() would go on for ever.
const MAX_MOVES = 30;
// The persona that plays for someone offline.
export const STANDIN: AgentPersona = 'reviewer1';
// How far back the status page counts the AI's steps.
const STATS_MS = 60 * 60_000;
// What the agent answers when it, or the model behind it, is gone rather than short of an answer:
// then the AI players are offline until a ping finds it back.
const DOWN_ERRORS = new Set(['unreachable', 'timeout', 'bad_reply', 'model_failed']);

// A task that is under way in a seat: what it is, when it came up, the game it belongs to, the
// agent's answer once it has come, the messages sent for it so far and when the last went, the
// timer of the next move or of the next request, and how many times the request has been made
// again.
interface Running {
  task: AgentTask;
  persona: AgentPersona;
  takeover: boolean;
  since: number;
  gameId: string | null;
  answer: AgentAnswer | null;
  made: string[];
  lastMove: number;
  timer: unknown;
  retries: number;
  // Done, by a move that the rules refused or by too many moves: nothing more is sent for the task.
  done: boolean;
  cancelled: boolean;
}

// A seat that an AI plays now: as which persona, what it is to do, and whether it plays for a
// person who is offline.
interface Seat {
  persona: AgentPersona;
  task: AgentTask;
  takeover: boolean;
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
  // When the agent last answered as one that is there, whether a recheck() is on its way, and
  // whether the server has stopped, after which an answer that comes changes nothing.
  #heard = -Infinity;
  #rechecking = false;
  #closed = false;
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
    const seats = this.#seats(room, playing);
    if (room.rev !== rev) {
      // Someone is played for, or no longer: the new state goes out first, and comes back here.
      broadcast(room);
      return;
    }
    const running = this.#running.get(room) ?? new Map<string, Running>();
    for (const [id, run] of running) if (!seats.has(id)) this.#cancel(running, id, run);
    for (const [id, { persona, task, takeover }] of seats) {
      const run = running.get(id);
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
        gameId: room.gameId,
        answer: null,
        made: [],
        lastMove: 0,
        timer: null,
        retries: 0,
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

  // Asks the agent whether it is still there, for a page that is about to offer the AI players, as
  // the home page does with practice rooms (docs/architecture.md#practice-rooms), unless it has
  // answered in the last FRESH_MS or is down, when the pings every PING_MS see to it. What the
  // agent answers changes `state` for the next one who asks.
  recheck(): void {
    const { now, channel } = this.#options;
    if (!this.state.up || this.#rechecking || now() - this.#heard < FRESH_MS) return;
    this.#rechecking = true;
    void channel.ask({ v: 1, kind: 'ping' }, 5_000).then((outcome) => {
      this.#rechecking = false;
      if (this.#closed) return;
      if (outcome.ok && outcome.kind === 'ping') this.#heard = now();
      else this.#down();
    });
  }

  // Stops asking whether the agent is back, when the server stops.
  close(): void {
    this.#closed = true;
    if (this.#ping !== null) this.#options.timers.stop(this.#ping);
    this.#ping = null;
    for (const room of [...this.#running.keys(), ...this.#wakeups.keys()]) this.forget(room);
  }

  // The seats that an AI plays now, and as whom. The AI players' own, while the agent answers; and
  // the seats of the people who have been offline for TAKEOVER_MS in a game of a room that may have
  // AI players, as far as those seats have something to do that nobody else does: not the advice
  // that an AI player gives the people of its group, since they are there to play the turn, and not
  // what another seat is given already, as when two students of a group are offline, or one is and
  // the group has an AI student, who plays the guesses alone. Nobody plays a game that no person is
  // in, online or offline for less than TAKEOVER_MS, so that no AI plays on for nobody, and nothing
  // an AI is doing is dropped when the one person in the room reloads the page.
  //
  // Whoever is played for is marked so (Room.takeOver) from the moment an AI is to play for them,
  // as it is asked what to do, until they are back, or the game ends. The room is looked at again
  // when someone who is offline will have been for long enough: for an AI to play for them, or for
  // the AI players of the room to count them as gone, as an AI student that advised them does.
  #seats(room: Room, playing: boolean): Map<string, Seat> {
    const now = this.#options.now();
    const seats = new Map<string, Seat>();
    const moments = new Set<string>();
    const watched = [...room.members.values()].some((member) => !member.agent && present(member, now));
    const asked = playing && watched && this.state.up && room.game.agentTask !== undefined;
    const allowed = playing && this.state.up && room.agentsAllowed();
    const played = asked && room.hasAgents();
    let due: number | null = null;
    if (asked) {
      for (const member of room.members.values()) {
        if (!member.agent) continue;
        const task = this.#task(room, member.id);
        if (!task || moments.has(task.moment)) continue;
        seats.set(member.id, { persona: member.agent, task, takeover: false });
        moments.add(task.moment);
      }
    }
    for (const member of room.members.values()) {
      if (member.agent) continue;
      const since = member.offlineSince;
      const offline = (allowed || played) && member.sockets.size === 0 && since !== null;
      const away = offline && !present(member, now);
      if (offline && !away) due = Math.min(due ?? Infinity, since + TAKEOVER_MS);
      if (!away || !allowed) {
        room.takeOver(member.id, false);
        continue;
      }
      const task = asked ? this.#task(room, member.id) : null;
      if (!task || task.advice || moments.has(task.moment)) continue;
      room.takeOver(member.id, true);
      seats.set(member.id, { persona: STANDIN, task, takeover: true });
      moments.add(task.moment);
    }
    this.#wake(room, due);
    return seats;
  }

  // What the game has for a seat now. The game is told who is there to play: the AI players while
  // the agent answers, and the people who are online or have been offline for less than TAKEOVER_MS
  // yet, so that a person's brief drop changes nothing of what an AI does.
  #task(room: Room, id: string): AgentTask | null {
    const now = this.#options.now();
    const context: GameContext = {
      ...room.context,
      isOnline: (playerId) => {
        const member = room.members.get(playerId);
        if (!member) return false;
        return member.agent ? this.state.up : present(member, now);
      },
    };
    return room.game.agentTask?.(room.data, context, id) ?? null;
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
  // the AI's log of the game it was asked for.
  #ask(room: Room, id: string, run: Running): void {
    const { channel, now, log } = this.#options;
    const deadline = room.deadline();
    const waitMs = Math.min(MAX_WAIT_MS, deadline === null ? MAX_WAIT_MS : deadline - now() - MARGIN_MS);
    if (waitMs < 1_000) {
      run.done = true;
      return;
    }
    const asked = now();
    this.#steps.push(asked);
    this.#forgetOld();
    const request = { v: 1 as const, persona: run.persona, waitMs: Math.round(waitMs), ...run.task.question };
    void channel.ask(request, waitMs).then((outcome) =>
      this.#safely(room, () => {
        const late = run.cancelled;
        room.noteAgent(run.gameId, asked, {
          by: id,
          persona: run.persona,
          ...(run.takeover ? { takeover: true as const } : {}),
          kind: run.task.kind,
          ...answerOf(outcome),
          ...(late ? { late: true as const } : {}),
        });
        if (!outcome.ok) {
          this.#failures.push(now());
          log('agent_failed', { code: room.code, kind: run.task.kind, error: outcome.error });
          if (DOWN_ERRORS.has(outcome.error)) {
            this.#down();
            return;
          }
          this.#heard = now();
          if (!late) this.#retry(room, id, run);
          return;
        }
        this.#heard = now();
        if (late || outcome.kind === 'ping') return;
        run.answer = outcome;
        this.#next(room, id, run);
      }),
    );
  }

  // Asks again after a while for a seat whose request brought no answer, with the task as the game
  // has it then, as long as the game is at the same moment: the agent may have been busy, or the
  // model may have nothing the first time and something the next.
  #retry(room: Room, id: string, run: Running): void {
    if (run.done || run.cancelled || run.timer !== null) return;
    const { timers } = this.#options;
    const wait = Math.min(MAX_RETRY_MS, RETRY_MS * 2 ** run.retries);
    run.retries += 1;
    run.timer = timers.start(
      () =>
        this.#safely(room, () => {
          run.timer = null;
          if (run.done || run.cancelled) return;
          const task = this.#task(room, id);
          if (task?.moment !== run.task.moment) return;
          run.task = task;
          this.#ask(room, id, run);
        }),
      wait,
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
      const current = this.#task(room, id);
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
        this.#heard = this.#options.now();
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
  // the room again; so does it at every other room that may have an AI play for someone offline,
  // whom it takes over or lets go of.
  #refresh(): void {
    const { isOpen, broadcast } = this.#options;
    for (const room of this.#options.rooms()) {
      if (!isOpen(room)) continue;
      if (room.hasAgents()) {
        room.changed();
        this.#safely(room, () => broadcast(room));
      } else if (room.agentsAllowed()) {
        this.#safely(room, () => this.poke(room));
      }
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

// How many of an AI player are in the rooms now, for its page (docs/architecture.md#ai-players): the
// AI players of that persona, and the people it plays for while they are offline, and how many
// rooms they are in.
export function agentsIn(rooms: Iterable<Room>, persona: AgentPersona): { players: number; rooms: number } {
  let players = 0;
  let count = 0;
  for (const room of rooms) {
    let here = 0;
    for (const member of room.members.values()) {
      if (member.agent === persona || (member.takenOver && persona === STANDIN)) here += 1;
    }
    players += here;
    if (here > 0) count += 1;
  }
  return { players, rooms: count };
}
