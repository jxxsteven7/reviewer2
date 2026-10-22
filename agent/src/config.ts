import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REASONING_LEVELS, type ReasoningLevel } from '@reviewer2/shared';

// The agent's settings, from environment variables (docs/development.md). A setting that is wrong
// stops it, as one does the game server and the mailer.

export interface AgentConfig {
  // Whether systemd handed over the listening socket, as file descriptor 3.
  activated: boolean;
  // The socket to listen on otherwise.
  socket: string | null;
  // The language model: the address of a service that answers OpenAI's chat completions, such as
  // http://127.0.0.1:11434/v1 for a model that Ollama runs on the same machine, without a slash at
  // the end; the model's name there; the key it wants, if any; and how long it thinks before a
  // move (REASONING_LEVELS), low unless set: off for a model that can't think.
  modelUrl: string;
  model: string;
  modelKey: string | null;
  reasoning: ReasoningLevel;
  // The model of a game that has one of its own, set as the first game's is, with the game's name
  // after AGENT_ (GAME_MODELS): AGENT_IMPOSTOR_MODEL and so on. What a game leaves unset is the
  // first game's: the model's name, its address, the key, unless the game names an address of its
  // own, which the first game's key never goes to, and the level. A game that sets nothing plays
  // with the first game's model.
  models: Partial<Record<GameWithModel, ModelSettings>>;
  // How many requests the agent puts to the model at once, and how many more may wait their turn.
  // A request that finds the queue full is answered `busy` at once.
  concurrency: number;
  queue: number;
}

export interface ModelSettings {
  modelUrl: string;
  model: string;
  modelKey: string | null;
  reasoning: ReasoningLevel;
}

// The games that may have a model of their own, with the prefix of their settings.
export const GAME_MODELS = { impostor: 'AGENT_IMPOSTOR_' } as const;
export type GameWithModel = keyof typeof GAME_MODELS;

export const DEFAULT_CONCURRENCY = 2;
export const DEFAULT_QUEUE = 32;

// The repository's root, two levels up from agent/src and agent/dist. A relative path is taken
// from there, as the game server takes its own, so that one AGENT_SOCKET in .env does for both.
const root = resolve(import.meta.dirname, '..', '..');
const path = (value: string | undefined): string | null => (value?.trim() ? resolve(root, value.trim()) : null);

// The longest path that a Unix socket can have on Linux. A longer one would be cut short without a
// word, and the socket made somewhere else.
export const MAX_SOCKET_PATH = 107;

function secret(env: NodeJS.ProcessEnv, prefix = 'AGENT_'): string | null {
  const value = env[`${prefix}MODEL_KEY`];
  const file = env[`${prefix}MODEL_KEY_FILE`];
  if (value && file) throw new Error(`set ${prefix}MODEL_KEY or ${prefix}MODEL_KEY_FILE, not both`);
  const key = file ? readFileSync(file, 'utf8').trim() : (value?.trim() ?? '');
  return key === '' ? null : key;
}

// The hosts that are this machine, where a key may go over plain HTTP.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// Whether a key sent to the address would go over the network in the clear: plain HTTP to a host
// that isn't this machine.
const inTheClear = (url: URL): boolean => url.protocol === 'http:' && !LOOPBACK.has(url.hostname);

// The model's address. With a key, it is HTTPS, so that the key never goes over the network in the
// clear, unless the model runs on this machine.
function modelUrl(text: string | undefined, keyed: boolean, name = 'AGENT_MODEL_URL'): string {
  const trimmed = text?.trim() ?? '';
  if (trimmed === '') throw new Error(`set ${name}, the address of the language model`);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${name} must be an address, not "${trimmed}"`);
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) {
    throw new Error(`${name} must be an http or https address without a query, not "${trimmed}"`);
  }
  if (keyed && inTheClear(url)) {
    throw new Error(`${name} must be an https address when a key is set, unless it is on this machine`);
  }
  return url.href.replace(/\/+$/, '');
}

// How long the model thinks, or the fallback when the variable is unset.
function reasoning(env: NodeJS.ProcessEnv, prefix: string, fallback: ReasoningLevel): ReasoningLevel {
  const text = env[`${prefix}REASONING`]?.trim() ?? '';
  if (text === '') return fallback;
  if (!(REASONING_LEVELS as readonly string[]).includes(text)) {
    throw new Error(`${prefix}REASONING must be one of ${REASONING_LEVELS.join(', ')}, not "${text}"`);
  }
  return text as ReasoningLevel;
}

// The model of a game with the prefix of its settings, from the first game's where the game sets
// nothing of its own, or null for a game that sets nothing at all.
function gameModel(env: NodeJS.ProcessEnv, prefix: string, first: ModelSettings): ModelSettings | null {
  const model = env[`${prefix}MODEL`]?.trim() ?? '';
  const url = env[`${prefix}MODEL_URL`]?.trim() ?? '';
  const key = secret(env, prefix);
  const level = env[`${prefix}REASONING`]?.trim() ?? '';
  if (model === '' && url === '' && key === null && level === '') return null;
  // The first game's key goes only to the first game's address.
  const modelKey = url === '' ? (key ?? first.modelKey) : key;
  // The first game's address was checked for the first game's key alone: a key of the game's own
  // goes to it only where that key would go too.
  if (url === '' && key !== null && inTheClear(new URL(first.modelUrl))) {
    throw new Error(
      `AGENT_MODEL_URL must be an https address when ${prefix}MODEL_KEY is set without ${prefix}MODEL_URL, ` +
        'unless it is on this machine',
    );
  }
  return {
    modelUrl: url === '' ? first.modelUrl : modelUrl(url, modelKey !== null, `${prefix}MODEL_URL`),
    model: model === '' ? first.model : model,
    modelKey,
    reasoning: reasoning(env, prefix, first.reasoning),
  };
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
  const first = {
    modelUrl: modelUrl(env.AGENT_MODEL_URL, modelKey !== null),
    model,
    modelKey,
    reasoning: reasoning(env, 'AGENT_', 'low'),
  };
  const models: AgentConfig['models'] = {};
  for (const [game, prefix] of Object.entries(GAME_MODELS) as [GameWithModel, string][]) {
    const own = gameModel(env, prefix, first);
    if (own) models[game] = own;
  }
  return {
    activated,
    socket,
    ...first,
    models,
    concurrency: wholeNumber('AGENT_CONCURRENCY', env.AGENT_CONCURRENCY, DEFAULT_CONCURRENCY, 1, 64),
    queue: wholeNumber('AGENT_QUEUE', env.AGENT_QUEUE, DEFAULT_QUEUE, 0, 1000),
  };
}
