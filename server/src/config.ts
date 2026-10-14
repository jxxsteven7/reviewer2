import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MIN_SECRET_LENGTH } from './accounts/email';
import { DEFAULT_ACCOUNT_LIMITS } from './accounts/limits';
import { DEFAULT_SOCKET_LIMITS } from './core/socket';
import { DEFAULT_ADMIN_COMMAND } from './statusPage';
import { DEFAULT_FEEDBACK_LIMITS } from './store/feedback';

// Settings come from environment variables; docs/development.md lists them.
export interface Config {
  host: string;
  port: number;
  publicDir: string;
  wordsDir: string;
  trustProxy: boolean;
  // Whether the login cookie is Secure: on unless the server is served over plain HTTP.
  cookieSecure: boolean;
  roomsPerMinute: number;
  feedbackPerWindow: number;
  // How many pieces of feedback the server keeps, with room for them, before it takes no more
  // (feedbackLimits() in store/feedback.ts).
  maxFeedback: number;
  // How many accounts one address may create in an hour (docs/architecture.md).
  accountsPerHour: number;
  // Where the database and its snapshots are kept, or null for a database in memory, which is
  // lost when the server stops (docs/architecture.md).
  dataDir: string | null;
  // A directory to read newer copies of ACKNOWLEDGMENTS.md and SPONSORS.md from, or null for the
  // ones the build bundled (thanks.ts).
  contentDir: string | null;
  // The port of the status page, or null when it is off (docs/architecture.md).
  statusPort: number | null;
  // What the status page puts in front of the arguments of the operator's commands it shows, for
  // copying: how admin.cjs is run where the server is (statusPage.ts).
  adminCommand: string;
  // A command of the operator's that takes the subcommands of `admin.cjs feedback`, and
  // `publish <id>`, which publishes the feedback as an issue in one go: the status page shows the
  // feedback commands with it in front, or null for none (statusPage.ts).
  feedbackCommand: string | null;
  // The server's secret, which email fingerprints are made with, and the mailer's socket. Without
  // both, accounts have no email (docs/architecture.md).
  secret: string | null;
  mailerSocket: string | null;
  // The agent's socket, or null when the server has no agent, and no AI players
  // (docs/architecture.md#the-agent).
  agentSocket: string | null;
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
function flag(name: string, value: string | undefined, fallback = false): boolean {
  const text = (value ?? '').trim().toLowerCase();
  if (text === '') return fallback;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  throw new Error(`${name} must be 1 or 0, not "${value}"`);
}

// The server's secret, from SERVER_SECRET or, as systemd's credentials give it, from the file that
// SERVER_SECRET_FILE names. One that is too short to be safe stops the server.
function serverSecret(env: NodeJS.ProcessEnv): string | null {
  const { SERVER_SECRET: value, SERVER_SECRET_FILE: file } = env;
  if (value?.trim() && file?.trim()) throw new Error('set SERVER_SECRET or SERVER_SECRET_FILE, not both');
  const secret = file?.trim() ? readFileSync(file.trim(), 'utf8').trim() : (value?.trim() ?? '');
  if (secret === '') return null;
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `the server's secret must have at least ${MIN_SECRET_LENGTH} characters, such as 32 random bytes in base64`,
    );
  }
  return secret;
}

// The socket of the mailer or of the agent, taken from the repository's root when it is relative, as
// DATA_DIR is. A socket's path can have 107 bytes at most on Linux, and a longer one would be cut
// short.
function socketPath(name: string, value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const path = resolve(root, value.trim());
  if (Buffer.byteLength(path) > 107) throw new Error(`${name} must be a path of at most 107 bytes, not ${path}`);
  return path;
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
    // Off only where the game is served over plain HTTP, as in development: a browser drops a
    // Secure cookie that comes over HTTP from anywhere but localhost.
    cookieSecure: flag('COOKIE_SECURE', env.COOKIE_SECURE, true),
    // How many times a minute one address may try to create a room (docs/architecture.md).
    roomsPerMinute: wholeNumber('ROOMS_PER_MINUTE', env.ROOMS_PER_MINUTE, DEFAULT_SOCKET_LIMITS.roomsPerMinute),
    // How much feedback one address may send in 10 minutes, which is the window of the default.
    feedbackPerWindow: wholeNumber(
      'FEEDBACK_PER_10_MINUTES',
      env.FEEDBACK_PER_10_MINUTES,
      DEFAULT_SOCKET_LIMITS.feedbackPerWindow,
    ),
    // Feedback is never deleted to make room, so this is what to raise once the server is full of it.
    maxFeedback: wholeNumber('MAX_FEEDBACK', env.MAX_FEEDBACK, DEFAULT_FEEDBACK_LIMITS.maxEntries),
    accountsPerHour: wholeNumber(
      'ACCOUNTS_PER_HOUR',
      env.ACCOUNTS_PER_HOUR,
      DEFAULT_ACCOUNT_LIMITS.registrationsPerHour,
    ),
    // A relative path is taken from the repository's root, as the defaults above are, wherever the
    // server is started from: `npm run dev` starts it in server/.
    dataDir: env.DATA_DIR?.trim() ? resolve(root, env.DATA_DIR.trim()) : null,
    contentDir: env.CONTENT_DIR?.trim() ? resolve(root, env.CONTENT_DIR.trim()) : null,
    statusPort,
    adminCommand: env.ADMIN_COMMAND?.trim() || DEFAULT_ADMIN_COMMAND,
    feedbackCommand: env.FEEDBACK_COMMAND?.trim() || null,
    secret: serverSecret(env),
    mailerSocket: socketPath('MAILER_SOCKET', env.MAILER_SOCKET),
    agentSocket: socketPath('AGENT_SOCKET', env.AGENT_SOCKET),
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
  };
}
