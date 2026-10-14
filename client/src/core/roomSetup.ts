import { MATCH_GROUPINGS, MATCH_TEAMS, matchGamesValid, type MatchRules, type RoomSetup } from '@reviewer2/shared';
import { account } from './account';
import { readStored, writeStored } from './storage';

// How the browser last set up a room and a practice room (RoomSetup in shared/src/accounts.ts,
// docs/architecture.md#accounts), which the next setup starts from: an account's as the server
// keeps it, with the browser's own from before as a fallback, and a guest's in the browser's
// storage. The server keeps an account's as the room is made; the page writes it into the summary it
// has too, so that the next setup starts from it before the page asks for the summary again.

type LastRoom = NonNullable<RoomSetup['room']>;

const KEY = 'r2.roomSetup';

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function storedRoom(): Partial<LastRoom> | null {
  const text = readStored(KEY);
  if (text === null) return null;
  try {
    const room: unknown = JSON.parse(text);
    return isObject(room) ? (room as Partial<LastRoom>) : null;
  } catch {
    return null;
  }
}

// The last room setup, as far as it can be read: anything may be missing or out of shape, which
// the setup checks part by part as it takes it (CreateRoom.vue).
export function lastRoom(): Partial<LastRoom> | null {
  return account.summary?.roomSetup.room ?? storedRoom();
}

export function keepRoomSetup(part: RoomSetup): void {
  if (account.summary) account.summary.roomSetup = { ...account.summary.roomSetup, ...part };
  else if (part.room) writeStored(KEY, JSON.stringify(part.room));
}

// The word lists of a setup that are still usable, by ID.
export const keptFields = (fields: unknown, usable: ReadonlySet<string>): string[] =>
  Array.isArray(fields) ? fields.filter((id): id is string => typeof id === 'string' && usable.has(id)) : [];

// The match rules of a setup, if they still hold.
export function keptMatch(rules: unknown): MatchRules | null {
  if (!isObject(rules)) return null;
  const { games, teams, grouping } = rules;
  if (!matchGamesValid(games)) return null;
  const team = MATCH_TEAMS.find((known) => known === teams);
  const group = MATCH_GROUPINGS.find((known) => known === grouping);
  return team && group ? { games: games as number, teams: team, grouping: group } : null;
}
