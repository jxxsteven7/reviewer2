import { createServer, type Server as HttpServer } from 'node:http';
import type { Title } from '@reviewer2/shared';
import { Server } from 'socket.io';
import { createAccountApi } from './accounts/http';
import type { Accounts } from './accounts/service';
import type { Config } from './config';
import type { AgentChannel } from './core/agentChannel';
import { agentsIn } from './core/agents';
import type { GameModule } from './core/game';
import { cryptoRng, type Rng } from './core/random';
import { DEFAULT_LIMITS, Rooms, type RoomLimits } from './core/rooms';
import {
  attachSockets,
  DEFAULT_SOCKET_LIMITS,
  realTimers,
  type RoomSockets,
  type SocketLimits,
  type Timers,
} from './core/socket';
import type { WordLibrary } from './core/words';
import { createRequestHandler } from './http';
import { log as defaultLog } from './log';
import { collectStats, type Stats } from './stats';
import type { FeedbackStore } from './store/feedback';
import { ThanksLists } from './thanks';

// One HTTP server on one port for both the front end and Socket.IO (docs/rules/constraints.md),
// put together as docs/architecture.md describes: the HTTP handler for everything that isn't
// Socket.IO (http.ts), the rooms, and the connections to them (core/socket.ts).
export interface AppServer {
  http: HttpServer;
  io: Server;
  rooms: Rooms;
  sockets: RoomSockets;
  // The numbers for the `stats` log line and the status page (stats.ts).
  stats(): Stats;
  // Tells everyone that the server is restarting, waits until they have been sent it, and closes.
  stop(graceMs?: number): Promise<void>;
  // Closes at once, and drops whatever a connection hasn't been sent yet.
  close(): Promise<void>;
}

// The settings that the server is started with (main.ts), named as in the Config so that one
// spread passes them on, and the parts that tests replace. The database that the feedback is kept
// in belongs to whoever opened it, who also closes it (main.ts).
export interface AppOptions
  extends Pick<Config, 'publicDir' | 'version'>, Partial<Pick<Config, 'trustProxy' | 'cookieSecure'>> {
  words: WordLibrary;
  games: GameModule[];
  feedback: FeedbackStore;
  // Accounts, which keep their data in the same database. Without them, the server has no
  // account API and every player is a guest.
  accounts?: Accounts;
  // The lists of thanks for the home page; by default, the ones the build bundled.
  lists?: ThanksLists;
  // The agent, which plays for the AI players (docs/architecture.md#ai-players). Without it, there
  // are none.
  agent?: AgentChannel;
  rng?: Rng;
  now?: () => number;
  // The timers for the games' deadlines, which go by `now`.
  timers?: Timers;
  limits?: RoomLimits;
  socketLimits?: SocketLimits;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export function createAppServer(options: AppOptions): AppServer {
  const log = options.log ?? defaultLog;
  // The config refuses a bad ROOMS_PER_MINUTE or FEEDBACK_PER_10_MINUTES, and a bad limit given
  // in code is refused here, rather than counted as one a minute, which is what the counters make
  // of 0 or NaN. A limit above the default protects less against abuse, so the server says when
  // it has one.
  const socketLimits = options.socketLimits ?? DEFAULT_SOCKET_LIMITS;
  for (const [name, value] of Object.entries(socketLimits)) {
    if (!(Number.isInteger(value) && value >= 1)) {
      throw new Error(`${name} must be a whole number from 1 up, not ${value}`);
    }
  }
  const { roomsPerMinute, feedbackPerWindow } = socketLimits;
  if (roomsPerMinute > DEFAULT_SOCKET_LIMITS.roomsPerMinute) {
    log('rooms_per_minute_raised', { roomsPerMinute, default: DEFAULT_SOCKET_LIMITS.roomsPerMinute });
  }
  if (feedbackPerWindow > DEFAULT_SOCKET_LIMITS.feedbackPerWindow) {
    log('feedback_limit_raised', { feedbackPerWindow, default: DEFAULT_SOCKET_LIMITS.feedbackPerWindow });
  }
  const trustProxy = options.trustProxy ?? false;
  const cookieSecure = options.cookieSecure ?? true;
  const { accounts } = options;
  // A login cookie without Secure goes over plain HTTP, where anyone on the way can read it.
  if (accounts && !cookieSecure) log('cookies_not_secure', { hint: 'only for plain HTTP, as in development' });
  const http = createServer(
    createRequestHandler({
      publicDir: options.publicDir,
      version: options.version,
      lists: options.lists ?? new ThanksLists(null, log),
      contributions: () => options.feedback.contributions(),
      log,
      ...(accounts && {
        accounts: createAccountApi({
          accounts,
          secureCookies: cookieSecure,
          trustProxy,
          log,
          // Asked only once the server answers requests, when the rooms are there.
          agentsLive: (persona) => agentsIn(rooms.all(), persona),
        }),
      }),
    }),
  );
  const io = new Server(http, {
    serveClient: false, // don't offer Socket.IO's client script: the front end loads only its own bundle
    // Notice dead connections sooner than the defaults of 25 s + 20 s: phones drop them whenever
    // the screen locks.
    pingInterval: 10_000,
    pingTimeout: 8_000,
    maxHttpBufferSize: 16 * 1024,
  });
  const rng = options.rng ?? cryptoRng;
  // The server only ever asks how long ago something happened, never what time it is: for the
  // limits, for how long a player has been away, for when a removed player may come back. So its
  // clock is one that only runs forward. The system's clock gets corrected, sometimes by a lot,
  // and every one of those waits would stretch or collapse with it.
  const now = options.now ?? (() => performance.now());
  const titleCount = accounts ? (id: number, title: Title) => accounts.titles.count(id, title) : null;
  // Whether the agent answers, which the driver of the AI players finds out and the rooms read.
  const agentState = options.agent ? { up: false } : null;
  const rooms = new Rooms(options.words, rng, now, options.limits ?? DEFAULT_LIMITS, titleCount, agentState);
  const sockets = attachSockets(io, {
    rooms,
    words: options.words,
    games: new Map(options.games.map((game) => [game.id, game])),
    now,
    timers: options.timers ?? realTimers,
    version: options.version,
    trustProxy,
    limits: socketLimits,
    feedback: options.feedback,
    ...(accounts && { accounts, cookieSecure }),
    ...(options.agent && agentState && { agent: { channel: options.agent, state: agentState } }),
    log,
  });
  // io.close() also closes the HTTP server.
  const close = () => new Promise<void>((resolve) => io.close(() => resolve()));

  // Rooms live in memory, so they end with the process, and everyone is told so rather than left
  // waiting. io.close() throws away whatever a connection hasn't been sent yet, which is the
  // notice itself for anyone on a long poll that is between two requests, or on a slow
  // connection. So each connection is first ended in the way that sends what is waiting, and
  // gets a moment for it.
  const stop = async (graceMs = 2_000) => {
    sockets.closeAll('restart');
    let timer: NodeJS.Timeout | undefined;
    const sent = [...io.sockets.sockets.values()].map(
      (socket) =>
        new Promise<void>((resolve) => {
          socket.conn.once('close', () => resolve());
          socket.disconnect(true);
        }),
    );
    const grace = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, graceMs);
    });
    await Promise.race([Promise.all(sent), grace]);
    clearTimeout(timer);
    // Whoever connected and made a room in the meantime is told as well, as far as that goes
    // without waiting once more.
    sockets.closeAll('restart');
    for (const socket of io.sockets.sockets.values()) socket.disconnect(true);
    await close();
  };
  const stats = () => collectStats(options.version, rooms, sockets.connections(), sockets.agents());
  return { http, io, rooms, sockets, stats, stop, close };
}
