import { shallowRef } from 'vue';
import { onceConnected, send } from './socket';
import { readStored, writeStored } from './storage';

// A practice room (docs/architecture.md#practice-rooms), which the home page makes for an account:
// whether Reviewer 1 can play now, and the role and the word lists that the player chose for their
// last one, which the browser remembers.

export const PRACTICE_ROLES = ['captain', 'guesser'] as const;
export type PracticeRole = (typeof PRACTICE_ROLES)[number];

// The first practice game has its creator as the PI, with the general word list.
export const DEFAULT_ROLE: PracticeRole = 'captain';
export const DEFAULT_FIELDS: readonly string[] = ['general'];

const ROLE_KEY = 'r2.practiceRole';
const FIELDS_KEY = 'r2.practiceFields';

export function storedRole(): PracticeRole {
  const role = readStored(ROLE_KEY);
  return PRACTICE_ROLES.find((known) => known === role) ?? DEFAULT_ROLE;
}

// The word lists of the last practice room, by ID, or null when there was none or what is stored
// can't be read.
export function storedFields(): string[] | null {
  const text = readStored(FIELDS_KEY);
  if (text === null) return null;
  try {
    const ids: unknown = JSON.parse(text);
    if (!Array.isArray(ids)) return null;
    const kept = ids.filter((id): id is string => typeof id === 'string');
    return kept.length > 0 ? kept : null;
  } catch {
    return null;
  }
}

// Keeps the lists, and the role when the player chose one: a practice room with friends names no
// role, and leaves the role stored as it was, as the server keeps the account's.
export function storePractice(role: PracticeRole | null, fields: readonly string[]): void {
  if (role !== null) writeStored(ROLE_KEY, role);
  writeStored(FIELDS_KEY, JSON.stringify(fields));
}

// The server's AI players, as the server last said: unknown until it has answered, none on a server
// without an agent, where the home page offers no practice room, up while they answer, and down
// while they don't. The home page asks when it is shown and again when the practice sheet opens;
// the server refuses a practice room while they are down anyway.
export type AgentsStatus = 'unknown' | 'none' | 'up' | 'down';
export const agents = shallowRef<AgentsStatus>('unknown');

export function checkAgents(): void {
  onceConnected(() => {
    void send<{ available: boolean | null }>('meta:agents').then((reply) => {
      if (!reply.ok) return;
      agents.value = reply.available === null ? 'none' : reply.available ? 'up' : 'down';
    });
  });
}
