import { join, resolve } from 'node:path';

// Settings come from environment variables; docs/development.md lists them.
export interface Config {
  host: string;
  port: number;
  publicDir: string;
  wordsDir: string;
  trustProxy: boolean;
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

// A switch is on or off and nothing else. A value that is neither stops the server, as a bad PORT
// does: TRUST_PROXY=yes that quietly meant "off" would leave every player behind a reverse proxy
// sharing the limits of one address.
function flag(name: string, value: string | undefined): boolean {
  const text = (value ?? '').trim().toLowerCase();
  if (['', '0', 'false', 'no', 'off'].includes(text)) return false;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  throw new Error(`${name} must be 1 or 0, not "${value}"`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.HOST || '127.0.0.1',
    port: portNumber(env.PORT, 3000),
    publicDir: env.PUBLIC_DIR || join(root, 'client', 'dist'),
    wordsDir: env.WORDS_DIR || join(root, 'words'),
    // Only behind a reverse proxy that sets X-Forwarded-For; see core/clientIp.ts.
    trustProxy: flag('TRUST_PROXY', env.TRUST_PROXY),
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
  };
}
