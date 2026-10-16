import { MATCH_GROUPINGS, MATCH_TEAMS, matchGamesValid, type GameRoomSetup, type MatchRules } from '@reviewer2/shared';
import { account } from './account';
import { readStored, writeStored } from './storage';

// How the browser last set up a room and a practice room of each game (RoomSetup in
// shared/src/accounts.ts, docs/architecture.md#accounts), which the next setup starts from: an
// account's as the server keeps it, with the browser's own from before as a fallback, and a guest's
// in the browser's storage. The server keeps an account's as the room is made; the page writes it
// into the summary it has too, so that the next setup starts from it before the page asks for the
// summary again.

type LastRoom = NonNullable<GameRoomSetup['room']>;

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

// The last setup of a room of the game `game`, as far as it can be read: anything may be missing
// or out of shape, which the setup checks part by part as it takes it (CreateRoom.vue).
export function lastRoom(game: string): Partial<LastRoom> | null {
  return account.summary?.roomSetup[game]?.room ?? storedRoom();
}

// The last practice room of the game, as the server keeps it for an account, or null.
export function lastPractice(game: string): GameRoomSetup['practice'] | null {
  return account.summary?.roomSetup[game]?.practice ?? null;
}

export function keepRoomSetup(game: string, part: GameRoomSetup): void {
  if (account.summary) {
    const kept = account.summary.roomSetup;
    account.summary.roomSetup = { ...kept, [game]: { ...kept[game], ...part } };
  } else if (part.room) writeStored(KEY, JSON.stringify(part.room));
}

// The word lists of a setup, by ID, as far as they can be read, and among those that are usable
// where the usable ones are known: before the lists have come, they aren't.
export const keptFields = (fields: unknown, usable?: ReadonlySet<string>): string[] =>
  Array.isArray(fields)
    ? fields.filter((id): id is string => typeof id === 'string' && (usable === undefined || usable.has(id)))
    : [];

// The match rules of a setup, if they still hold.
export function keptMatch(rules: unknown): MatchRules | null {
  if (!isObject(rules)) return null;
  const { games, teams, grouping } = rules;
  if (!matchGamesValid(games)) return null;
  const team = MATCH_TEAMS.find((known) => known === teams);
  const group = MATCH_GROUPINGS.find((known) => known === grouping);
  return team && group ? { games: games as number, teams: team, grouping: group } : null;
}
