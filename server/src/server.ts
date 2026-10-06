import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Config } from './config';
import { createRequestHandler } from './http';

// One HTTP server on one port for both the front end and Socket.IO (docs/rules/constraints.md).
export interface AppServer {
  http: HttpServer;
  io: Server;
  close(): Promise<void>;
}

export function createAppServer(config: Pick<Config, 'publicDir' | 'version'>): AppServer {
  const http = createServer(createRequestHandler({ publicDir: config.publicDir, version: config.version }));
  const io = new Server(http, {
    serveClient: false, // the client bundles socket.io-client itself
    // Notice dead connections sooner than the defaults of 25 s + 20 s: phones drop them whenever
    // the screen locks. See docs/architecture.md.
    pingInterval: 10_000,
    pingTimeout: 8_000,
    maxHttpBufferSize: 16 * 1024,
  });
  // io.close() also closes the HTTP server.
  const close = () => new Promise<void>((resolve) => io.close(() => resolve()));
  return { http, io, close };
}
