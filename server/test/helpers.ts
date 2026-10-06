import type { AddressInfo } from 'node:net';
import type { ClosedReason, RoomView } from '@reviewer2/shared';
import { io as connect, type Socket } from 'socket.io-client';
import type { GameModule } from '../src/core/game';
import { seededRng } from '../src/core/random';
import type { RoomLimits } from '../src/core/rooms';
import { WordLibrary, type WordListData } from '../src/core/words';
import { createAppServer, type AppServer } from '../src/server';
import { fakeGame } from './fakeGame';

// Helpers for the integration tests: a real server on a free port, with a clock that tests can
// move forward, and clients that record everything the server sends them.

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
  advance(ms: number): void;
  close(): Promise<void>;
}

export async function startServer(
  options: { games?: GameModule[]; words?: WordLibrary; limits?: RoomLimits } = {},
): Promise<TestServer> {
  let offset = 0;
  const logs: TestServer['logs'] = [];
  const app = createAppServer({
    publicDir: '/no/front/end',
    version: 'test',
    words: options.words ?? testWords(),
    games: options.games ?? [fakeGame as GameModule],
    rng: seededRng(1),
    now: () => Date.now() + offset,
    ...(options.limits ? { limits: options.limits } : {}),
    log: (event, fields) => logs.push({ event, ...(fields ? { fields } : {}) }),
  });
  await new Promise<void>((resolve) => app.http.listen(0, '127.0.0.1', resolve));
  const { port } = app.http.address() as AddressInfo;
  return {
    app,
    url: `http://127.0.0.1:${port}`,
    logs,
    advance: (ms) => {
      offset += ms;
    },
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

export type Reply = { ok: boolean; error?: string; [field: string]: unknown };

export class TestClient {
  readonly states: RoomView[] = [];
  readonly closed: ClosedReason[] = [];
  token = '';
  version = '';

  private constructor(readonly socket: Socket) {
    socket.on('room:state', (state: RoomView) => this.states.push(state));
    socket.on('room:closed', ({ reason }: { reason: ClosedReason }) => this.closed.push(reason));
  }

  static async connect(
    url: string,
    auth: { token?: string; code?: string; roomId?: string; watch?: string } = {},
  ): Promise<TestClient> {
    const socket = connect(url, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
    const client = new TestClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('session', (session: { token?: string; version: string }) => {
        client.token = session.token ?? auth.token ?? '';
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
