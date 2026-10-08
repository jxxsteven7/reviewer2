import { join, resolve } from 'node:path';

// Settings come from environment variables; docs/development.md lists them.
export interface Config {
  host: string;
  port: number;
  publicDir: string;
  wordsDir: string;
  trustProxy: boolean;
  roomsPerMinute: number;
  version: string;
}

// How many times a minute one address may try to create a room unless ROOMS_PER_MINUTE says
// otherwise (docs/architecture.md). The server applies it when it is given no number.
export const DEFAULT_ROOMS_PER_MINUTE = 5;

// The repository root, two levels up from both server/src and server/dist.
const root = resolve(import.meta.dirname, '..', '..');

// A whole number from 1 up, to `max` if there is one, or the fallback when the variable is unset
// or empty. Digits only: Number() alone also reads " " and "0x0", as 0, and on port 0 the server
// listens on whichever port the system picks. Anything else stops the server rather than quietly
// mean something else.
function wholeNumber(name: string, value: string | undefined, fallback: number, max?: number): number {
  if (value === undefined || value === '') return fallback;
  const number = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!(number >= 1 && number <= (max ?? Number.MAX_SAFE_INTEGER))) {
    throw new Error(`${name} must be a whole number from 1 ${max === undefined ? 'up' : `to ${max}`}, not "${value}"`);
  }
  return number;
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
    port: wholeNumber('PORT', env.PORT, 3000, 65535),
    publicDir: env.PUBLIC_DIR || join(root, 'client', 'dist'),
    wordsDir: env.WORDS_DIR || join(root, 'words'),
    // Only behind a reverse proxy that sets X-Forwarded-For; see core/clientIp.ts.
    trustProxy: flag('TRUST_PROXY', env.TRUST_PROXY),
    // How many times a minute one address may try to create a room (docs/architecture.md).
    roomsPerMinute: wholeNumber('ROOMS_PER_MINUTE', env.ROOMS_PER_MINUTE, DEFAULT_ROOMS_PER_MINUTE),
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
  };
}
