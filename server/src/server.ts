import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Config } from './config';
import type { GameModule } from './core/game';
import { cryptoRng, type Rng } from './core/random';
import { DEFAULT_LIMITS, Rooms, type RoomLimits } from './core/rooms';
import { attachSockets, type RoomSockets } from './core/socket';
import type { WordLibrary } from './core/words';
import { createRequestHandler } from './http';
import { log as defaultLog } from './log';

// One HTTP server on one port for both the front end and Socket.IO (docs/rules/constraints.md).
export interface AppServer {
  http: HttpServer;
  io: Server;
  rooms: Rooms;
  sockets: RoomSockets;
  close(): Promise<void>;
}

export interface AppOptions extends Pick<Config, 'publicDir' | 'version'> {
  words: WordLibrary;
  games: GameModule[];
  trustProxy?: boolean;
  rng?: Rng;
  now?: () => number;
  limits?: RoomLimits;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export function createAppServer(options: AppOptions): AppServer {
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
  const now = options.now ?? Date.now;
  const rooms = new Rooms(rng, now, options.limits ?? DEFAULT_LIMITS);
  const sockets = attachSockets(io, {
    rooms,
    words: options.words,
    games: new Map(options.games.map((game) => [game.id, game])),
    rng,
    now,
    version: options.version,
    trustProxy: options.trustProxy ?? false,
    log: options.log ?? defaultLog,
  });
  // io.close() also closes the HTTP server.
  const close = () => new Promise<void>((resolve) => io.close(() => resolve()));
  return { http, io, rooms, sockets, close };
}
