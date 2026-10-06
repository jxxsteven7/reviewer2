import { join, resolve } from 'node:path';

// Settings come from environment variables; docs/development.md lists them.
export interface Config {
  host: string;
  port: number;
  publicDir: string;
  version: string;
}

// The repository root, two levels up from both server/src and server/dist.
const root = resolve(import.meta.dirname, '..', '..');

function portNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  // Digits only. Number() alone also reads " " and "0x0", as 0, and on port 0 the server
  // listens on whichever port the system picks.
  const port = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!(port >= 1 && port <= 65535)) throw new Error(`PORT must be a whole number from 1 to 65535, not "${value}"`);
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.HOST || '127.0.0.1',
    port: portNumber(env.PORT, 3000),
    publicDir: env.PUBLIC_DIR || join(root, 'client', 'dist'),
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
  };
}
