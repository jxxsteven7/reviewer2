import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The mailer's settings, from environment variables (docs/development.md). A setting that is wrong
// stops it, as one does the game server.

export interface MailerConfig {
  transport: 'resend' | 'print';
  apiKey: string | null;
  // The site's address, for the links: https://playreviewer2.com unless MAILER_BASE_URL says else.
  baseUrl: string;
  // Whether systemd handed over the listening socket, as file descriptor 3.
  activated: boolean;
  // The socket to listen on otherwise.
  socket: string | null;
  // Where the count of mails is kept, so that it lasts through a restart.
  stateDir: string | null;
  // Where the print transport writes the mails too.
  printFile: string | null;
}

export const DEFAULT_BASE_URL = 'https://playreviewer2.com';

// The repository's root, two levels up from mailer/src and mailer/dist. A relative path is taken
// from there, as the game server takes its own, so that one MAILER_SOCKET in .env does for both.
const root = resolve(import.meta.dirname, '..', '..');
const path = (value: string | undefined): string | null => (value?.trim() ? resolve(root, value.trim()) : null);

// The longest path that a Unix socket can have on Linux. A longer one would be cut short without a
// word, and the socket made somewhere else.
export const MAX_SOCKET_PATH = 107;

function secret(env: NodeJS.ProcessEnv): string | null {
  const { RESEND_API_KEY: value, RESEND_API_KEY_FILE: file } = env;
  if (value && file) throw new Error('set RESEND_API_KEY or RESEND_API_KEY_FILE, not both');
  const key = file ? readFileSync(file, 'utf8').trim() : (value?.trim() ?? '');
  return key === '' ? null : key;
}

function baseUrl(text: string, https: boolean): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`MAILER_BASE_URL must be an address, not "${text}"`);
  }
  const allowed = https ? ['https:'] : ['https:', 'http:'];
  if (!allowed.includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username) {
    throw new Error(`MAILER_BASE_URL must be the site's address alone, ${https ? 'over https, ' : ''}not "${text}"`);
  }
  return url.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv, pid: number): MailerConfig {
  const transport = (env.MAILER_TRANSPORT ?? '').trim() || 'resend';
  if (transport !== 'resend' && transport !== 'print') {
    throw new Error(`MAILER_TRANSPORT must be resend or print, not "${transport}"`);
  }
  const apiKey = secret(env);
  if (transport === 'resend' && apiKey === null) throw new Error('set RESEND_API_KEY or RESEND_API_KEY_FILE');
  const activated = env.LISTEN_FDS === '1' && env.LISTEN_PID === String(pid);
  const socket = path(env.MAILER_SOCKET);
  if (!activated && socket === null) throw new Error('set MAILER_SOCKET, or start the mailer from its systemd socket');
  if (socket !== null && Buffer.byteLength(socket) > MAX_SOCKET_PATH) {
    throw new Error(`MAILER_SOCKET must be at most ${MAX_SOCKET_PATH} bytes long, which is all a socket's path can be`);
  }
  // systemd names the state directory in STATE_DIRECTORY, several of them separated by colons.
  const stateDir = env.STATE_DIRECTORY?.split(':')[0] || path(env.MAILER_STATE_DIR);
  if (transport === 'resend' && stateDir === null) {
    throw new Error('set STATE_DIRECTORY or MAILER_STATE_DIR, so that the daily limit lasts through a restart');
  }
  return {
    transport,
    apiKey,
    baseUrl: baseUrl(env.MAILER_BASE_URL?.trim() || DEFAULT_BASE_URL, transport === 'resend'),
    activated,
    socket,
    stateDir,
    printFile: path(env.MAILER_PRINT_FILE),
  };
}
