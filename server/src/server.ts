import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { Title } from '@reviewer2/shared';
import { Server, type Socket } from 'socket.io';
import { createAccountApi } from './accounts/http';
import type { Accounts } from './accounts/service';
import type { Config } from './config';
import type { AgentChannel } from './core/agentChannel';
import { agentsIn } from './core/agents';
import { clientIp } from './core/clientIp';
import type { GameModule } from './core/game';
import {
  AddressConnections,
  BusyGauge,
  DEFAULT_BUSY_CONNECTIONS,
  DEFAULT_CONNECTIONS_PER_ADDRESS,
  defaultBusyMemory,
  heapLimit,
  megabytes,
  memoryInUse,
} from './core/load';
import { cryptoRng, type Rng } from './core/random';
import { Refusals } from './core/refusals';
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
import { collectLive, type Live } from './live';
import { log as defaultLog } from './log';
import { collectStats, type Stats } from './stats';
import type { ContributionStore } from './store/contributions';
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
  // The numbers for the `stats` log line and /status.json (stats.ts).
  stats(): Stats;
  // Who is connected and who is in each room this moment, for /live.json (live.ts).
  live(): Live;
  // What the limits turned away, which main.ts writes to the log once a minute (core/refusals.ts).
  refusals: Refusals;
  // Whether the server is busy, and turns newcomers away (core/load.ts).
  busy: BusyGauge;
  // Tells everyone that the server is restarting, waits until they have been sent it, and closes.
  stop(graceMs?: number): Promise<void>;
  // Closes at once, and drops whatever a connection hasn't been sent yet.
  close(): Promise<void>;
}

// How long the HTTP server waits for a client, and how much it reads of a request's headers
// (docs/architecture.md#http). With Node's own timeouts, a client that sends its headers a byte at
// a time holds a connection for a minute, and one that sends its body so for five minutes. The
// timeouts count only while a request is arriving, and while a connection waits for its next
// request; they never cut a WebSocket, which has left the HTTP server once it is open, nor a long
// poll while the server holds its answer.
export interface HttpLimits {
  // From the first byte of a request, or the opening of its connection, to the end of its headers,
  // which a browser sends in one go.
  headersTimeout: number;
  // From the first byte of a request to the end of its body. The largest bodies are an avatar of
  // 64 KB and a message of 16 KB over long polling, which a slow phone sends in a few seconds.
  requestTimeout: number;
  // How long a connection may wait idle for its next request: long polling sends its next one at
  // once. It is Node 24's default, which Node 26 raises to 65 seconds. A server that stops waits
  // this long for a connection that was still answering a request when it began to stop, and
  // stopping may take 5 seconds at most (main.ts).
  keepAliveTimeout: number;
  // How often the server looks for requests over the first two timeouts, which it notices only
  // then, rather than every 30 seconds.
  connectionsCheckingInterval: number;
  // In bytes: the headers of one request, past which it is refused with 431. Node's own default,
  // which a login cookie and what a reverse proxy adds stay well under.
  maxHeaderSize: number;
}

export const HTTP_LIMITS: Readonly<HttpLimits> = Object.freeze({
  headersTimeout: 20_000,
  requestTimeout: 30_000,
  keepAliveTimeout: 5_000,
  connectionsCheckingInterval: 5_000,
  maxHeaderSize: 16 * 1024,
});

// The settings that the server is started with (main.ts), named as in the Config so that one
// spread passes them on, and the parts that tests replace. The database that the feedback is kept
// in belongs to whoever opened it, who also closes it (main.ts).
export interface AppOptions
  extends
    Pick<Config, 'publicDir' | 'version'>,
    Partial<
      Pick<Config, 'trustProxy' | 'cookieSecure' | 'connectionsPerAddress' | 'busyConnections' | 'busyMemoryMb'>
    > {
  words: WordLibrary;
  games: readonly GameModule[];
  feedback: FeedbackStore;
  // The contributions for the home page, from the same database.
  contributions: ContributionStore;
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
  httpLimits?: Partial<HttpLimits>;
  // The memory the process has in use, in bytes, which the server reads to know whether it is busy
  // (memoryInUse in core/load.ts).
  memory?: () => number;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export function createAppServer(options: AppOptions): AppServer {
  const log = options.log ?? defaultLog;
  // The config refuses a bad limit in the environment, such as ROOMS_PER_MINUTE, and a bad limit
  // given in code is refused here, rather than counted as one a minute, which is what the counters
  // make of 0 or NaN. A limit above the default protects less against abuse, so the server says
  // when it has one.
  const socketLimits = options.socketLimits ?? DEFAULT_SOCKET_LIMITS;
  const connectionsPerAddress = options.connectionsPerAddress ?? DEFAULT_CONNECTIONS_PER_ADDRESS;
  const busyConnections = options.busyConnections ?? DEFAULT_BUSY_CONNECTIONS;
  const busyMemoryMb = options.busyMemoryMb ?? null;
  const given = {
    ...socketLimits,
    connectionsPerAddress,
    busyConnections,
    ...(busyMemoryMb !== null && { busyMemoryMb }),
  };
  for (const [name, value] of Object.entries(given)) {
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
  if (connectionsPerAddress > DEFAULT_CONNECTIONS_PER_ADDRESS) {
    log('connections_per_address_raised', { connectionsPerAddress, default: DEFAULT_CONNECTIONS_PER_ADDRESS });
  }
  // The memory in use hardly ever gets past the heap's limit (core/load.ts): the heap runs out
  // first, and the process with it, so a BUSY_MEMORY_MB above it would hardly ever make the server
  // busy.
  if (busyMemoryMb !== null && busyMemoryMb * 2 ** 20 > heapLimit()) {
    log('busy_memory_above_heap_limit', {
      busyMemoryMb,
      heapLimitMb: megabytes(heapLimit()),
      hint: 'lower BUSY_MEMORY_MB, or raise the heap limit with --max-old-space-size',
    });
  }
  const trustProxy = options.trustProxy ?? false;
  const cookieSecure = options.cookieSecure ?? true;
  const { accounts } = options;
  // A login cookie without Secure goes over plain HTTP, where anyone on the way can read it.
  if (accounts && !cookieSecure) log('cookies_not_secure', { hint: 'only for plain HTTP, as in development' });
  const games = new Map(options.games.map((game) => [game.id, game]));
  const refusals = new Refusals(log);
  const http = createServer(
    { ...HTTP_LIMITS, ...options.httpLimits },
    createRequestHandler({
      publicDir: options.publicDir,
      version: options.version,
      lists: options.lists ?? new ThanksLists(null, log),
      contributions: () => options.contributions.all(),
      log,
      ...(accounts && {
        accounts: createAccountApi({
          accounts,
          secureCookies: cookieSecure,
          trustProxy,
          refusals,
          log,
          // Asked only once the server answers requests, when the rooms are there.
          agentsLive: (persona) => agentsIn(rooms.all(), persona),
          // Not while the account still has to guess the AI players of the game in the room that
          // has just played it (Room.guessing): the replay would show who they were.
          showReplay: (kept) =>
            rooms.all().some((room) => room.guessing(kept.log.gameId, kept.viewer))
              ? null
              : (games.get(kept.game)?.showReplay?.(kept) ?? null),
        }),
      }),
    }),
  );
  // The connections that each address has open, from when Engine.IO opens one, whether or not it
  // ever comes to Socket.IO, to when it closes, however that comes about.
  const addressOf = (req: IncomingMessage) => clientIp(req.socket.remoteAddress, req.headers, trustProxy);
  const perAddress = new AddressConnections(connectionsPerAddress);
  const io = new Server(http, {
    serveClient: false, // don't offer Socket.IO's client script: the front end loads only its own bundle
    // Notice dead connections sooner than the defaults of 25 s + 20 s: phones drop them whenever
    // the screen locks.
    pingInterval: 10_000,
    pingTimeout: 8_000,
    maxHttpBufferSize: 16 * 1024,
    // One address may have so many connections open at once. Engine.IO asks before it opens any,
    // over long polling or a WebSocket, and answers one that is refused with 403, before Socket.IO
    // or a room hears of it. Nothing else that Engine.IO refuses gets 403, so the page knows this
    // refusal by its status alone (client/src/core/socket.ts), says that the network has too many
    // connections open, and tries again in a while.
    allowRequest: (req, callback) => {
      const address = addressOf(req);
      if (perAddress.admits(address)) {
        callback(null, true);
      } else {
        refusals.add('connections_per_address', address);
        callback('too_many_connections', false);
      }
    },
  });
  io.engine.on('connection', (conn: Socket['conn']) => {
    const address = addressOf(conn.request);
    perAddress.opened(address);
    conn.once('close', () => perAddress.closed(address));
  });
  // Every connection that Engine.IO has open counts towards being busy, those that have yet to
  // come to Socket.IO or were turned away from it included, since each costs as much.
  const memory = options.memory ?? memoryInUse;
  const busy = new BusyGauge(
    {
      connections: busyConnections,
      memory: busyMemoryMb === null ? defaultBusyMemory() : busyMemoryMb * 2 ** 20,
    },
    () => ({ connections: io.engine.clientsCount, memory: memory() }),
    log,
  );
  const rng = options.rng ?? cryptoRng;
  // The server only ever asks how long ago something happened, never what time it is: for the
  // limits, for how long a player has been away, for when a removed player may come back. So its
  // clock is one that only runs forward. The system's clock gets corrected, sometimes by a lot,
  // and every one of those waits would stretch or collapse with it.
  const now = options.now ?? (() => performance.now());
  const titleCount = accounts ? (id: number, title: Title) => accounts.titles.count(id, title) : null;
  // Whether the agent answers, which the driver of the AI players finds out and the rooms read.
  const agentState = options.agent ? { up: false } : null;
  // What the records say of each pair of related terms of a game, by where the game's setups keep
  // the pair's key (GameModule.setupPaths), for the next draw of a pair in a room.
  const pairRecords = accounts
    ? (game: string, accountIds: readonly number[]) => {
        const path = games.get(game)?.setupPaths?.pair;
        return path === undefined ? new Map() : accounts.ratings.pairRecords(game, path, accountIds);
      }
    : null;
  const rooms = new Rooms(
    options.words,
    rng,
    now,
    options.limits ?? DEFAULT_LIMITS,
    titleCount,
    agentState,
    pairRecords,
  );
  const sockets = attachSockets(io, {
    rooms,
    words: options.words,
    games,
    now,
    timers: options.timers ?? realTimers,
    version: options.version,
    trustProxy,
    limits: socketLimits,
    refusals,
    busy,
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
  const stats = () => collectStats(options.version, rooms, sockets.connections(), sockets.agents(), busy.check());
  const live = () => collectLive(rooms, sockets.connections(), now);
  return { http, io, rooms, sockets, stats, live, refusals, busy, stop, close };
}
