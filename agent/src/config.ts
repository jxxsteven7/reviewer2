import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The agent's settings, from environment variables (docs/development.md). A setting that is wrong
// stops it, as one does the game server and the mailer.

export interface AgentConfig {
  // Whether systemd handed over the listening socket, as file descriptor 3.
  activated: boolean;
  // The socket to listen on otherwise.
  socket: string | null;
  // The language model: the address of a service that answers OpenAI's chat completions, such as
  // http://127.0.0.1:11434/v1 for a model that Ollama runs on the same machine, without a slash at
  // the end; the model's name there; and the key it wants, if any.
  modelUrl: string;
  model: string;
  modelKey: string | null;
  // How many requests the agent puts to the model at once, and how many more may wait their turn.
  // A request that finds the queue full is answered `busy` at once.
  concurrency: number;
  queue: number;
}

export const DEFAULT_CONCURRENCY = 2;
export const DEFAULT_QUEUE = 32;

// The repository's root, two levels up from agent/src and agent/dist. A relative path is taken
// from there, as the game server takes its own, so that one AGENT_SOCKET in .env does for both.
const root = resolve(import.meta.dirname, '..', '..');
const path = (value: string | undefined): string | null => (value?.trim() ? resolve(root, value.trim()) : null);

// The longest path that a Unix socket can have on Linux. A longer one would be cut short without a
// word, and the socket made somewhere else.
export const MAX_SOCKET_PATH = 107;

function secret(env: NodeJS.ProcessEnv): string | null {
  const { AGENT_MODEL_KEY: value, AGENT_MODEL_KEY_FILE: file } = env;
  if (value && file) throw new Error('set AGENT_MODEL_KEY or AGENT_MODEL_KEY_FILE, not both');
  const key = file ? readFileSync(file, 'utf8').trim() : (value?.trim() ?? '');
  return key === '' ? null : key;
}

// The hosts that are this machine, where a key may go over plain HTTP.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// The model's address. With a key, it is HTTPS, so that the key never goes over the network in the
// clear, unless the model runs on this machine.
function modelUrl(text: string | undefined, keyed: boolean): string {
  const trimmed = text?.trim() ?? '';
  if (trimmed === '') throw new Error('set AGENT_MODEL_URL, the address of the language model');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`AGENT_MODEL_URL must be an address, not "${trimmed}"`);
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) {
    throw new Error(`AGENT_MODEL_URL must be an http or https address without a query, not "${trimmed}"`);
  }
  if (keyed && url.protocol === 'http:' && !LOOPBACK.has(url.hostname)) {
    throw new Error('AGENT_MODEL_URL must be an https address when a key is set, unless it is on this machine');
  }
  return url.href.replace(/\/+$/, '');
}

// A whole number from 1 to `max`, or the fallback when the variable is unset.
function wholeNumber(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  const text = value?.trim() ?? '';
  if (text === '') return fallback;
  const number = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}, not "${text}"`);
  }
  return number;
}

export function loadConfig(env: NodeJS.ProcessEnv, pid: number): AgentConfig {
  const activated = env.LISTEN_FDS === '1' && env.LISTEN_PID === String(pid);
  const socket = path(env.AGENT_SOCKET);
  if (!activated && socket === null) throw new Error('set AGENT_SOCKET, or start the agent from its systemd socket');
  if (socket !== null && Buffer.byteLength(socket) > MAX_SOCKET_PATH) {
    throw new Error(`AGENT_SOCKET must be at most ${MAX_SOCKET_PATH} bytes long, which is all a socket's path can be`);
  }
  const model = env.AGENT_MODEL?.trim() ?? '';
  if (model === '') throw new Error("set AGENT_MODEL, the model's name");
  const modelKey = secret(env);
  return {
    activated,
    socket,
    modelUrl: modelUrl(env.AGENT_MODEL_URL, modelKey !== null),
    model,
    modelKey,
    concurrency: wholeNumber('AGENT_CONCURRENCY', env.AGENT_CONCURRENCY, DEFAULT_CONCURRENCY, 1, 64),
    queue: wholeNumber('AGENT_QUEUE', env.AGENT_QUEUE, DEFAULT_QUEUE, 0, 1000),
  };
}
