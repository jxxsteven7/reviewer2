import { createServer, type Server, type Socket } from 'node:net';
import { MAX_AGENT_REQUEST, type AgentReply, type AgentRequest } from '@reviewer2/shared';
import { AGENT_REPLY, AGENT_REQUEST } from '@reviewer2/shared/schemas';
import { giveClue, guess } from './keywords';
import type { Model } from './model';
import { PERSONAS } from './personas';

// The agent's work (docs/architecture.md#the-agent): one request on one line of a connection, one
// answer on one line back, and then the connection closes, as with the mailer. The log says what
// kind of request came, how long its answer took and whether it was one, and never what was on the
// board, what the model wrote or which seat asked. Time is read from a clock that only runs
// forward, as the game server reads its own: the system's clock gets corrected, and a wait or a
// note's time would stretch or collapse with it.

type Log = (event: string, fields?: Record<string, unknown>) => void;

export interface AgentOptions {
  model: Model;
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

export function createAgent({
  model,
  log,
  concurrency,
  queue,
  readMs = 2_000,
  now = () => performance.now(),
}: AgentOptions) {
  // The requests that wait for the model, the earliest first, each as what gives it its turn, and
  // how many requests the model is answering.
  const waiting: (() => void)[] = [];
  let running = 0;

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
          const place = waiting.indexOf(take);
          if (place !== -1) waiting.splice(place, 1);
          resolve(false);
        },
        Math.max(0, until - now()),
      );
      const take = () => {
        clearTimeout(timer);
        resolve(true);
      };
      waiting.push(take);
    });
  }

  // A request is done with the model: the next one in the queue takes its place.
  function done(): void {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }

  async function play(request: Exclude<AgentRequest, { kind: 'ping' }>): Promise<AgentReply> {
    const until = now() + request.waitMs;
    if (!(await turnWith(until))) return { ok: false, error: 'busy' };
    try {
      const turn = {
        model,
        persona: PERSONAS[request.persona],
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(until - now()))),
        now,
      };
      if (request.game !== 'keywords') return { ok: false, error: 'bad_request' };
      return request.kind === 'clue' ? await giveClue(request, turn) : await guess(request, turn);
    } finally {
      done();
    }
  }

  async function answer(request: AgentRequest): Promise<AgentReply> {
    if (request.kind !== 'ping') return play(request);
    const known = await model.ping(AbortSignal.timeout(PING_MS));
    return known ? { ok: true, kind: 'ping', model: model.name } : { ok: false, error: 'model_failed' };
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
