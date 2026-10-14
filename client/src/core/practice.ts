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

export function storePractice(role: PracticeRole, fields: readonly string[]): void {
  writeStored(ROLE_KEY, role);
  writeStored(FIELDS_KEY, JSON.stringify(fields));
}

// Whether the server's AI players answer now, or null until the server has said. The home page asks
// when it is shown and again when the practice sheet opens; the server refuses a practice room
// while they don't anyway.
export const agentsAvailable = shallowRef<boolean | null>(null);

export function checkAgents(): void {
  onceConnected(() => {
    void send<{ available: boolean }>('meta:agents').then((reply) => {
      if (reply.ok) agentsAvailable.value = reply.available;
    });
  });
}
