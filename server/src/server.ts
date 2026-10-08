import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { DEFAULT_ROOMS_PER_MINUTE, type Config } from './config';
import type { GameModule } from './core/game';
import { cryptoRng, type Rng } from './core/random';
import { DEFAULT_LIMITS, Rooms, type RoomLimits } from './core/rooms';
import { attachSockets, type RoomSockets } from './core/socket';
import type { WordLibrary } from './core/words';
import { createRequestHandler } from './http';
import { log as defaultLog } from './log';
import { collectStats, type Stats } from './stats';

// One HTTP server on one port for both the front end and Socket.IO (docs/rules/constraints.md).
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

// The settings that the server is started with (index.ts), named as in the Config so that one
// spread passes them on, and the parts that tests replace.
export interface AppOptions
  extends Pick<Config, 'publicDir' | 'version'>, Partial<Pick<Config, 'trustProxy' | 'roomsPerMinute'>> {
  words: WordLibrary;
  games: GameModule[];
  rng?: Rng;
  now?: () => number;
  limits?: RoomLimits;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export function createAppServer(options: AppOptions): AppServer {
  const log = options.log ?? defaultLog;
  // The config refuses a bad ROOMS_PER_MINUTE, and a bad number given in code is refused here,
  // rather than counted as one room a minute, which is what the counter makes of 0 or NaN. A
  // limit above the default protects less against abuse, so the server says when it has one.
  const roomsPerMinute = options.roomsPerMinute ?? DEFAULT_ROOMS_PER_MINUTE;
  if (!(Number.isInteger(roomsPerMinute) && roomsPerMinute >= 1)) {
    throw new Error(`roomsPerMinute must be a whole number from 1 up, not ${roomsPerMinute}`);
  }
  if (roomsPerMinute > DEFAULT_ROOMS_PER_MINUTE) {
    log('rooms_per_minute_raised', { roomsPerMinute, default: DEFAULT_ROOMS_PER_MINUTE });
  }
  const http = createServer(createRequestHandler({ publicDir: options.publicDir, version: options.version }));
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
  const rooms = new Rooms(options.words, rng, now, options.limits ?? DEFAULT_LIMITS);
  const sockets = attachSockets(io, {
    rooms,
    words: options.words,
    games: new Map(options.games.map((game) => [game.id, game])),
    now,
    version: options.version,
    trustProxy: options.trustProxy ?? false,
    roomsPerMinute,
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
  const stats = () => collectStats(options.version, rooms, sockets.connections());
  return { http, io, rooms, sockets, stats, stop, close };
}
