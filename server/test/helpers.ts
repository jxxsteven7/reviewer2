import type { AddressInfo } from 'node:net';
import type { Ack, ClosedReason, RoomView, Session } from '@reviewer2/shared';
import { io as connect, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import type { GameModule } from '../src/core/game';
import { seededRng, type Rng } from '../src/core/random';
import type { RoomLimits } from '../src/core/rooms';
import type { Timers } from '../src/core/socket';
import { WordLibrary, type WordListData } from '../src/core/words';
import { createAppServer, type AppServer } from '../src/server';
import { fakeGame } from './fakeGame';

// Helpers for the integration tests: a real server on a free port, with a clock that only the
// tests move forward and timers that go by it, and clients that record everything the server
// sends them. The clock stands still between two moves, so that what a test measures with it, such
// as the latency of a heartbeat or the time a turn has left, doesn't depend on how long the test
// itself takes.

const list = (id: string, count: number): WordListData => ({
  id,
  name: { zh: id, en: id },
  terms: Array.from({ length: count }, (_, i) => ({ id: `${id}-${i}`, zh: `${id}\u8bcd${i}`, en: `${id} word ${i}` })),
});

export const testWords = () => new WordLibrary([list('general', 40), list('tiny', 2)]);

export interface TestServer {
  app: AppServer;
  url: string;
  logs: { event: string; fields?: Record<string, unknown> }[];
  // Moves the clock forward, and runs the timers that are due by then, in the order of their
  // times, unless a test wants them late.
  advance(ms: number, runTimers?: boolean): void;
  // How many timers are waiting.
  timers(): number;
  close(): Promise<void>;
}

export async function startServer(
  options: {
    games?: GameModule[];
    words?: WordLibrary;
    limits?: RoomLimits;
    trustProxy?: boolean;
    roomsPerMinute?: number;
    rng?: Rng;
  } = {},
): Promise<TestServer> {
  let offset = 0;
  const start = Date.now();
  const now = () => start + offset;
  const logs: TestServer['logs'] = [];
  // The timers that are waiting, each with the time it is due by the clock above.
  const waiting = new Set<{ due: number; run: () => void }>();
  const timers: Timers = {
    start(run, ms) {
      const timer = { due: now() + ms, run };
      waiting.add(timer);
      return timer;
    },
    stop: (timer) => waiting.delete(timer as { due: number; run: () => void }),
  };
  const app = createAppServer({
    publicDir: '/no/front/end',
    version: 'test',
    words: options.words ?? testWords(),
    games: options.games ?? [fakeGame],
    rng: options.rng ?? seededRng(1),
    now,
    timers,
    trustProxy: options.trustProxy ?? false,
    ...(options.roomsPerMinute === undefined ? {} : { roomsPerMinute: options.roomsPerMinute }),
    ...(options.limits ? { limits: options.limits } : {}),
    log: (event, fields) => logs.push({ event, ...(fields ? { fields } : {}) }),
  });
  await new Promise<void>((resolve) => app.http.listen(0, '127.0.0.1', resolve));
  const { port } = app.http.address() as AddressInfo;
  return {
    app,
    url: `http://127.0.0.1:${port}`,
    logs,
    advance: (ms, runTimers = true) => {
      offset += ms;
      while (runTimers) {
        const due = [...waiting].filter((timer) => timer.due <= now()).sort((a, b) => a.due - b.due)[0];
        if (!due) break;
        waiting.delete(due);
        due.run();
      }
    },
    timers: () => waiting.size,
    close: () => app.close(),
  };
}

export async function until(condition: () => boolean, what = 'condition', timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export type Reply = Ack<Record<string, unknown>>;

// A connection made by hand over Engine.IO's long polling, for what no client would do: put
// several packets into one request, or stop asking for what the server has for it. Packets in one
// request are separated by "\x1e"; "40" connects to Socket.IO, "41" disconnects from it, and
// "42[...]" is an event.
export async function rawPolling(url: string) {
  const base = `${url}/socket.io/?EIO=4&transport=polling`;
  const opened = await (await fetch(base)).text();
  const { sid } = JSON.parse(opened.slice(1)) as { sid: string };
  const session = `${base}&sid=${sid}`;
  const post = async (body: string) => (await fetch(session, { method: 'POST', body })).text();
  const get = async () => (await fetch(session)).text();
  await post('40');
  await get();
  return { post, get };
}

export class TestClient {
  readonly states: RoomView[] = [];
  readonly closed: ClosedReason[] = [];
  token = '';
  version = '';

  private constructor(readonly socket: Socket) {
    socket.on('room:state', (state: RoomView) => this.states.push(state));
    socket.on('room:closed', ({ reason }: { reason: ClosedReason }) => this.closed.push(reason));
  }

  // `auth` is the handshake. It is typed loosely, because tests also send what no client should.
  static async connect(
    url: string,
    auth: Record<string, unknown> = {},
    options: Partial<ManagerOptions & SocketOptions> = {},
  ): Promise<TestClient> {
    const socket = connect(url, { auth, transports: ['websocket'], reconnection: false, forceNew: true, ...options });
    const client = new TestClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('session', (session: Session) => {
        client.token = session.token ?? (typeof auth.token === 'string' ? auth.token : '');
        client.version = session.version;
        resolve();
      });
      socket.once('connect_error', reject);
    });
    return client;
  }

  get state(): RoomView | undefined {
    return this.states.at(-1);
  }

  get me(): string {
    const me = this.state?.me;
    if (!me) throw new Error('not in a room');
    return me;
  }

  send(event: string, payload: unknown = {}): Promise<Reply> {
    return this.socket.timeout(2000).emitWithAck(event, payload) as Promise<Reply>;
  }

  async waitFor(condition: (state: RoomView) => boolean, what = 'a state'): Promise<RoomView> {
    await until(() => this.state !== undefined && condition(this.state), what);
    return this.state as RoomView;
  }

  close(): void {
    this.socket.close();
  }
}

// A room with its chair and the reply to the create message.
export async function createRoom(url: string, name = 'Ann', payload: Record<string, unknown> = {}) {
  const chair = await TestClient.connect(url);
  const reply = await chair.send('room:create', {
    game: 'test',
    language: 'en',
    fields: ['general'],
    name,
    ...payload,
  });
  if (!reply.ok) throw new Error(`could not create a room: ${reply.error}`);
  await chair.waitFor((state) => state.code === reply.code);
  return { chair, code: reply.code as string, roomId: reply.roomId as string };
}

export async function joinRoom(url: string, code: string, name: string) {
  const client = await TestClient.connect(url);
  const reply = await client.send('room:join', { code, name });
  if (!reply.ok) throw new Error(`could not join: ${reply.error}`);
  await client.waitFor((state) => state.code === code);
  return client;
}
