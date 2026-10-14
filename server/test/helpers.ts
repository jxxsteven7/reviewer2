import type { AddressInfo } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Ack,
  AgentReply,
  AgentRequest,
  ClosedReason,
  EmoteEvent,
  FriendLimits,
  InvitationView,
  JoinAskView,
  MailRequest,
  RoomView,
  Session,
} from '@reviewer2/shared';
import { io as connect, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import { fingerprintKey } from '../src/accounts/email';
import { DEFAULT_ACCOUNT_LIMITS, type AccountLimits } from '../src/accounts/limits';
import type { MailChannel, MailOutcome } from '../src/accounts/mail';
import { PasswordHasher } from '../src/accounts/passwords';
import { Accounts } from '../src/accounts/service';
import type { AgentChannel, AgentOutcome } from '../src/core/agentChannel';
import type { GameModule } from '../src/core/game';
import { seededRng, type Rng } from '../src/core/random';
import type { RoomLimits } from '../src/core/rooms';
import { DEFAULT_SOCKET_LIMITS, type SocketLimits, type Timers } from '../src/core/socket';
import { WordLibrary, type WordListData } from '../src/core/words';
import { createAppServer, type AppServer } from '../src/server';
import { openDatabase } from '../src/store/database';
import { DEFAULT_FEEDBACK_LIMITS, FeedbackStore, type FeedbackLimits } from '../src/store/feedback';
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

// A mailer that keeps what it is asked to send, and answers `outcome`.
export class FakeMail implements MailChannel {
  readonly sent: MailRequest[] = [];
  outcome: MailOutcome = 'sent';

  send(request: MailRequest): Promise<MailOutcome> {
    this.sent.push(request);
    return Promise.resolve(this.outcome);
  }

  // The secret in the last mail of a kind.
  last(kind: MailRequest['kind']): string {
    const mail = this.sent.filter((request) => request.kind === kind).at(-1);
    if (!mail) throw new Error(`no ${kind} mail was sent`);
    return mail.token;
  }
}

// An agent that plays by a script rather than with a model, for the tests of AI players: it answers
// a ping while it is `up`, and every other request as `play` answers it, by default with the clue
// "zebra" for the first two cards of the group's own that are face down, and with no cards to
// reveal. It keeps every request, and holds the answers back from hold() until release().
export class ScriptedAgent implements AgentChannel {
  readonly asked: AgentRequest[] = [];
  up = true;
  play: (request: Exclude<AgentRequest, { kind: 'ping' }>) => AgentOutcome = scriptedPlay;
  #held: (() => void)[] | null = null;

  ask(request: AgentRequest): Promise<AgentOutcome> {
    this.asked.push(request);
    const down = { ok: false, error: 'unreachable' } as const;
    if (request.kind === 'ping') return Promise.resolve(this.up ? { ok: true, kind: 'ping', model: 'script' } : down);
    const answer = () => (this.up ? this.play(request) : down);
    const held = this.#held;
    if (held) return new Promise((resolve) => held.push(() => resolve(answer())));
    return Promise.resolve(answer());
  }

  // The requests other than pings.
  get questions(): Exclude<AgentRequest, { kind: 'ping' }>[] {
    return this.asked.filter((request) => request.kind !== 'ping');
  }

  hold(): void {
    this.#held = [];
  }

  release(): void {
    const held = this.#held ?? [];
    this.#held = null;
    for (const go of held) go();
  }
}

export const SCRIPT_NOTE = { model: 'script', prompt: 'test', ms: 1 };

export function scriptedPlay(request: Exclude<AgentRequest, { kind: 'ping' }>): AgentReply {
  if (request.kind === 'clue') {
    const own = request.cards.flatMap((card, i) => (card.color === request.team && !card.revealed ? [i] : []));
    const targets = own.slice(0, 2);
    return { ok: true, kind: 'clue', word: 'zebra', count: targets.length, targets, note: SCRIPT_NOTE };
  }
  return { ok: true, kind: 'guess', picks: [], reason: 'No idea.', note: SCRIPT_NOTE };
}

export const TEST_SECRET = 'test-secret-'.repeat(4);

// Hashes that take a millisecond, rather than a tenth of a second, so that tests can make many.
export const fastHasher = (concurrency = 2, queue = 32) =>
  new PasswordHasher({ log2N: 10, r: 8, p: 1 }, concurrency, queue);

export interface TestServer {
  app: AppServer;
  accounts: Accounts;
  // The feedback that the server keeps, in a database in memory, on the system's clock.
  feedback: FeedbackStore;
  db: DatabaseSync;
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
    socketLimits?: Partial<SocketLimits>;
    feedbackLimits?: Partial<FeedbackLimits>;
    accountLimits?: Partial<AccountLimits>;
    friendLimits?: Partial<FriendLimits>;
    hasher?: PasswordHasher;
    cookieSecure?: boolean;
    // The system's clock for what accounts keep, such as how old a login is.
    clock?: () => number;
    // A mailer, which gives accounts email, with the server secret of the tests.
    mail?: MailChannel;
    // How much room all avatars may take.
    maxAvatarBytes?: number;
    rng?: Rng;
    // The agent that plays for the AI players.
    agent?: AgentChannel;
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
  const { db } = await openDatabase(null);
  const feedback = new FeedbackStore(db, undefined, { ...DEFAULT_FEEDBACK_LIMITS, ...options.feedbackLimits });
  const accounts = new Accounts({
    db,
    now,
    ...(options.clock && { clock: options.clock }),
    log: (event, fields) => logs.push({ event, ...(fields ? { fields } : {}) }),
    limits: { ...DEFAULT_ACCOUNT_LIMITS, ...options.accountLimits },
    ...(options.friendLimits && { friendLimits: options.friendLimits }),
    hasher: options.hasher ?? fastHasher(),
    ...(options.mail && { mail: options.mail, fingerprintKey: fingerprintKey(TEST_SECRET) }),
    ...(options.maxAvatarBytes !== undefined && { maxAvatarBytes: options.maxAvatarBytes }),
  });
  accounts.adoptFingerprintKey();
  const socketLimits = { ...DEFAULT_SOCKET_LIMITS, ...options.socketLimits };
  if (options.roomsPerMinute !== undefined) socketLimits.roomsPerMinute = options.roomsPerMinute;
  let app: AppServer;
  try {
    app = createAppServer({
      publicDir: '/no/front/end',
      version: 'test',
      words: options.words ?? testWords(),
      games: options.games ?? [fakeGame],
      rng: options.rng ?? seededRng(1),
      now,
      timers,
      trustProxy: options.trustProxy ?? false,
      cookieSecure: options.cookieSecure ?? false,
      feedback,
      accounts,
      socketLimits,
      ...(options.limits ? { limits: options.limits } : {}),
      ...(options.agent ? { agent: options.agent } : {}),
      log: (event, fields) => logs.push({ event, ...(fields ? { fields } : {}) }),
    });
  } catch (error) {
    db.close();
    throw error;
  }
  await new Promise<void>((resolve) => app.http.listen(0, '127.0.0.1', resolve));
  const { port } = app.http.address() as AddressInfo;
  return {
    app,
    accounts,
    feedback,
    db,
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
    close: async () => {
      await app.close();
      db.close();
    },
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
  readonly emotes: EmoteEvent[] = [];
  readonly sessions: Session[] = [];
  // The invitations to rooms that the connection was sent, the IDs of those it heard had ended, the
  // same of the requests to be let into its room, and how often it heard that its account's friends
  // or requests changed.
  readonly invitations: InvitationView[] = [];
  readonly uninvited: string[] = [];
  readonly asks: JoinAskView[] = [];
  readonly unasked: string[] = [];
  friendsChanged = 0;
  // How often the server said that the connection's login had ended, and why it disconnected.
  loginsEnded = 0;
  readonly disconnects: string[] = [];
  token = '';
  version = '';

  private constructor(readonly socket: Socket) {
    socket.on('room:state', (state: RoomView) => this.states.push(state));
    socket.on('room:closed', ({ reason }: { reason: ClosedReason }) => this.closed.push(reason));
    socket.on('room:emote', (event: EmoteEvent) => this.emotes.push(event));
    socket.on('session', (session: Session) => this.sessions.push(session));
    socket.on('friends:invited', (invitation: InvitationView) => this.invitations.push(invitation));
    socket.on('friends:uninvited', ({ id }: { id: string }) => this.uninvited.push(id));
    socket.on('friends:asked', (ask: JoinAskView) => this.asks.push(ask));
    socket.on('friends:unasked', ({ id }: { id: string }) => this.unasked.push(id));
    socket.on('friends:changed', () => (this.friendsChanged += 1));
    socket.on('account:ended', () => (this.loginsEnded += 1));
    socket.on('disconnect', (reason) => this.disconnects.push(reason));
  }

  // The account that the server last said the connection is, or null for a guest.
  get account(): Session['account'] | undefined {
    return this.sessions.at(-1)?.account;
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

export async function joinRoom(url: string, code: string, name: string, payload: Record<string, unknown> = {}) {
  const client = await TestClient.connect(url);
  const reply = await client.send('room:join', { code, name, ...payload });
  if (!reply.ok) throw new Error(`could not join: ${reply.error}`);
  await client.waitFor((state) => state.code === code);
  return client;
}

export interface ApiResponse {
  status: number;
  body: Reply & Record<string, unknown>;
  // The Set-Cookie header, if there was one.
  cookie: string | undefined;
}

// A browser's side of the account API: requests that come from the page, as a browser sends them,
// with the login cookie that the last answer set. `headers` replace or add to what a browser
// would send, and leave out what they give as ''.
export class Browser {
  cookie = '';

  constructor(
    readonly url: string,
    readonly ip?: string,
  ) {}

  // The secret in the login cookie, as the server set it.
  get secret(): string {
    return this.cookie.split('=')[1] ?? '';
  }

  async request(
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<ApiResponse> {
    const host = new URL(this.url).host;
    // A header given as '' is left out.
    const sent = Object.fromEntries(
      Object.entries({
        ...(method === 'POST' ? { origin: `http://${host}`, 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.ip ? { 'x-forwarded-for': this.ip } : {}),
        ...headers,
      }).filter(([, value]) => value !== ''),
    );
    const payload = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body);
    const response = await fetch(`${this.url}${path}`, {
      method,
      headers: sent,
      ...(body === undefined ? {} : { body: payload }),
    });
    const cookie = response.headers.get('set-cookie') ?? undefined;
    if (cookie !== undefined) {
      const [pair = ''] = cookie.split(';');
      this.cookie = cookie.includes('Max-Age=0') ? '' : pair;
    }
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : {}) as ApiResponse['body'], cookie };
  }

  // Uploads an avatar, as the page does: the bytes as they are, with their type.
  upload(bytes: Buffer, type = 'image/jpeg', headers: Record<string, string> = {}) {
    return this.request('/api/account/avatar', bytes, { 'content-type': type, ...headers });
  }

  register(username: string, password = 'correct horse') {
    return this.request('/api/register', { username, password });
  }

  logIn(username: string, password = 'correct horse') {
    return this.request('/api/login', { username, password });
  }

  async account() {
    return (await this.request('/api/account')).body.account as Record<string, unknown> | null;
  }

  // A connection from a page of this browser, with its login cookie, if it has one.
  connect(auth: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<TestClient> {
    return TestClient.connect(this.url, auth, {
      extraHeaders: { origin: this.url, ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
  }
}
