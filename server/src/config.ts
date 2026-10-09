import { join, resolve } from 'node:path';
import { DEFAULT_SOCKET_LIMITS } from './core/socket';

// Settings come from environment variables; docs/development.md lists them.
export interface Config {
  host: string;
  port: number;
  publicDir: string;
  wordsDir: string;
  trustProxy: boolean;
  roomsPerMinute: number;
  feedbackPerWindow: number;
  // Where the database and its snapshots are kept, or null for a database in memory, which is
  // lost when the server stops (docs/architecture.md).
  dataDir: string | null;
  // The port of the status page, or null when it is off (docs/architecture.md).
  statusPort: number | null;
  version: string;
}

// The repository root, two levels up from both server/src and server/dist.
const root = resolve(import.meta.dirname, '..', '..');

// A whole number from 1 to `max`, or the fallback when the variable is unset or blank. Whitespace
// around the value is ignored, as it is around a switch. Digits only: Number() alone also reads
// "0x0" as 0 and "1e3" as 1000, and 0 is never what anyone means, because on port 0 the server
// listens on whichever port the system picks, and 0 rooms a minute would be no game at all.
// Anything else stops the server rather than quietly mean something else.
function wholeNumber<Fallback extends number | null>(
  name: string,
  value: string | undefined,
  fallback: Fallback,
  max = Number.MAX_SAFE_INTEGER,
): number | Fallback {
  const text = (value ?? '').trim();
  if (text === '') return fallback;
  const number = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!(number >= 1 && number <= max)) {
    const range = max === Number.MAX_SAFE_INTEGER ? 'from 1 up' : `from 1 to ${max}`;
    throw new Error(`${name} must be a whole number ${range}, not "${value}"`);
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
  const port = wholeNumber('PORT', env.PORT, 3000, 65535);
  // The status page listens on 127.0.0.1 only, and is off unless STATUS_PORT names a port for it.
  const statusPort = wholeNumber('STATUS_PORT', env.STATUS_PORT, null, 65535);
  if (statusPort === port) throw new Error(`STATUS_PORT must be another port than PORT, not ${port} as well`);
  return {
    host: env.HOST || '127.0.0.1',
    port,
    publicDir: env.PUBLIC_DIR || join(root, 'client', 'dist'),
    wordsDir: env.WORDS_DIR || join(root, 'words'),
    // Only behind a reverse proxy that sets X-Forwarded-For; see core/clientIp.ts.
    trustProxy: flag('TRUST_PROXY', env.TRUST_PROXY),
    // How many times a minute one address may try to create a room (docs/architecture.md).
    roomsPerMinute: wholeNumber('ROOMS_PER_MINUTE', env.ROOMS_PER_MINUTE, DEFAULT_SOCKET_LIMITS.roomsPerMinute),
    // How much feedback one address may send in 10 minutes, which is the window of the default.
    feedbackPerWindow: wholeNumber(
      'FEEDBACK_PER_10_MINUTES',
      env.FEEDBACK_PER_10_MINUTES,
      DEFAULT_SOCKET_LIMITS.feedbackPerWindow,
    ),
    // A relative path is taken from the repository's root, as the defaults above are, wherever the
    // server is started from: `npm run dev` starts it in server/.
    dataDir: env.DATA_DIR?.trim() ? resolve(root, env.DATA_DIR.trim()) : null,
    statusPort,
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
  };
}
