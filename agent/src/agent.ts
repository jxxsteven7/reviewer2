import { createServer, type Server, type Socket } from 'node:net';
import { MAX_AGENT_REQUEST, type AgentReply, type AgentRequest } from '@reviewer2/shared';
import { AGENT_REPLY, AGENT_REQUEST } from '@reviewer2/shared/schemas';
import { playImpostor } from './impostor';
import { giveClue, guess, type Turn } from './keywords';
import type { Model } from './model';
import { PERSONAS } from './personas';

// The agent's work (docs/architecture.md#the-agent): one request on one line of a connection, one
// answer on one line back, and then the connection closes, as with the mailer. The log says what
// kind of request came, how long its answer took and whether it was one, and never what was on the
// board, what the model wrote or which seat asked. Time is read from a clock that only runs
// forward, as the game server reads its own: the system's clock gets corrected, and a wait or a
// note's time would stretch or collapse with it.

type Log = (event: string, fields?: Record<string, unknown>) => void;

// The games that the agent plays, by their IDs.
export type AgentGameId = Exclude<AgentRequest, { kind: 'ping' }>['game'];

export interface AgentOptions {
  // The model that plays every game, but one that has its own (config.ts).
  model: Model;
  models?: Partial<Record<AgentGameId, Model>>;
  log: Log;
  // How many requests go to the model at once, and how many more may wait their turn (config.ts).
  concurrency: number;
  queue: number;
  // How long a connection has to send its request.
  readMs?: number;
  now?: () => number;
}

// How long a ping may take: it only asks the service which models it has.
const PING_MS = 5_000;

// How long a request takes the model without thinking, generously: a second or two, measured, and
// twice that for one that was let think and is asked again. The requests that wait for the model
// are promised this much of it each, and those with it stop thinking in time for that (hurryAt).
const QUICK_MS = 3_000;

// A turn of a game, with the game's own code.
function playGame(request: Exclude<AgentRequest, { kind: 'ping' }>, turn: Turn): Promise<AgentReply> {
  switch (request.game) {
    case 'keywords':
      return request.kind === 'clue' ? giveClue(request, turn) : guess(request, turn);
    case 'impostor':
      return playImpostor(request, turn);
  }
}

export function createAgent({
  model,
  models = {},
  log,
  concurrency,
  queue,
  readMs = 2_000,
  now = () => performance.now(),
}: AgentOptions) {
  // The requests that wait for the model, the earliest first, each as when its wait ends and what
  // gives it its turn; how many requests the model is answering; and what hurries each of those
  // (Turn.hurry), which is aborted when they must stop thinking.
  const waiting: { until: number; take: () => void }[] = [];
  let running = 0;
  const hurries = new Set<AbortController>();
  let hurrying: NodeJS.Timeout | null = null;

  // When the requests with the model must stop thinking, so that those waiting are answered in
  // time, or Infinity while none waits. Thinking takes long (thinking.ts), and the waiting ones
  // would be late for it: once the requests with the model are told to stop, each answers without
  // thinking within QUICK_MS, and the waiting ones take their turns, `concurrency` at a time, each
  // answered within QUICK_MS; so the one in place i has its turn QUICK_MS * (i / concurrency + 1)
  // after the stop, and needs it QUICK_MS before its wait ends.
  function hurryAt(): number {
    return waiting.reduce(
      (at, { until }, place) => Math.min(at, until - QUICK_MS * (Math.floor(place / concurrency) + 2)),
      Infinity,
    );
  }

  // Hurries the requests with the model when that time comes, as the queue stands now; called
  // whenever it changes.
  function hurryWhenDue(): void {
    if (hurrying !== null) clearTimeout(hurrying);
    hurrying = null;
    const delay = hurryAt() - now();
    if (delay === Infinity) return;
    if (delay > 0) hurrying = setTimeout(hurryWhenDue, delay);
    else for (const hurry of hurries) hurry.abort();
  }

  // Waits for a turn with the model, or says that there is none to be had: the queue is full, or
  // the request's wait ran out before its turn came, when nobody needs its answer any more. A
  // request leaves the queue as soon as its wait is over, so that the server hears `busy` while it
  // still listens, rather than nothing at all: nothing would read as the agent being gone.
  function turnWith(until: number): Promise<boolean> {
    if (running < concurrency) {
      running += 1;
      return Promise.resolve(true);
    }
    if (waiting.length >= queue) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(
        () => {
          const place = waiting.findIndex((one) => one.take === take);
          if (place !== -1) waiting.splice(place, 1);
          hurryWhenDue();
          resolve(false);
        },
        Math.max(0, until - now()),
      );
      const take = () => {
        clearTimeout(timer);
        resolve(true);
      };
      waiting.push({ until, take });
      hurryWhenDue();
    });
  }

  // A request is done with the model: the next one in the queue takes its place.
  function done(): void {
    const next = waiting.shift();
    if (next) next.take();
    else running -= 1;
    hurryWhenDue();
  }

  async function play(request: Exclude<AgentRequest, { kind: 'ping' }>): Promise<AgentReply> {
    const until = now() + request.waitMs;
    if (!(await turnWith(until))) return { ok: false, error: 'busy' };
    // A request that gets its turn when the waiting ones can't wait for thinking goes without.
    const hurry = new AbortController();
    hurries.add(hurry);
    if (hurryAt() <= now()) hurry.abort();
    try {
      const turn = {
        model: models[request.game] ?? model,
        persona: PERSONAS[request.persona],
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(until - now()))),
        until,
        hurry: hurry.signal,
        now,
      };
      return await playGame(request, turn);
    } finally {
      hurries.delete(hurry);
      done();
    }
  }

  // Every model that plays a game, once each, which a ping asks after: the AI players are there only
  // when each of them is.
  const everyModel = [...new Set([model, ...Object.values(models)])];

  async function answer(request: AgentRequest): Promise<AgentReply> {
    if (request.kind !== 'ping') return play(request);
    const signal = AbortSignal.timeout(PING_MS);
    const known = await Promise.all(everyModel.map((one) => one.ping(signal)));
    const names = [...new Set(everyModel.map(({ name }) => name))].join(', ');
    return known.every(Boolean) ? { ok: true, kind: 'ping', model: names } : { ok: false, error: 'model_failed' };
  }

  // Answers one line. An answer that is anything but what the protocol allows, as a bug could make
  // it, goes out as a failure instead, so that the server never reads a line it can't take: as no
  // answer, since the agent and the model are there all the same.
  async function handle(line: string): Promise<AgentReply> {
    const started = now();
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = undefined;
    }
    const request = AGENT_REQUEST.safeParse(parsed);
    if (!request.success) {
      log('agent_answered', { kind: null, ms: Math.round(now() - started), ok: false, error: 'bad_request' });
      return { ok: false, error: 'bad_request' };
    }
    let reply: AgentReply;
    try {
      reply = await answer(request.data);
    } catch (error) {
      log('error', { message: error instanceof Error ? error.message : String(error) });
      reply = { ok: false, error: 'no_answer' };
    }
    if (!AGENT_REPLY.safeParse(reply).success) {
      log('error', { message: 'an answer that the protocol does not allow', kind: request.data.kind });
      reply = { ok: false, error: 'no_answer' };
    }
    const { kind } = request.data;
    log('agent_answered', {
      kind,
      ms: Math.round(now() - started),
      ok: reply.ok,
      ...(reply.ok ? {} : { error: reply.error }),
    });
    return reply;
  }

  // One request on one connection: what comes after its line is not read, so that the same request
  // can't be answered twice, as it would be if the line were found again in what came after it.
  function serve(socket: Socket): void {
    let received = '';
    let read = false;
    let answered = false;
    const reply = (value: AgentReply) => {
      if (answered) return;
      answered = true;
      socket.end(`${JSON.stringify(value)}\n`);
    };
    socket.setEncoding('utf8');
    socket.setTimeout(readMs, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: string) => {
      if (read) return;
      received += chunk;
      const end = received.indexOf('\n');
      if (end === -1 && Buffer.byteLength(received) <= MAX_AGENT_REQUEST) return;
      read = true;
      if (end === -1 || Buffer.byteLength(received.slice(0, end)) > MAX_AGENT_REQUEST) {
        reply({ ok: false, error: 'bad_request' });
        return;
      }
      // The answer may take as long as the request asked to wait; the server stops waiting then.
      socket.setTimeout(0);
      handle(received.slice(0, end)).then(reply, (error: unknown) => {
        log('error', { message: error instanceof Error ? error.message : String(error) });
        reply({ ok: false, error: 'no_answer' });
      });
    });
  }

  const server: Server = createServer(serve);
  return { handle, server };
}
