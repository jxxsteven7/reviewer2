import type { GameRoomSetup } from '@reviewer2/shared';
import { account } from './account';
import { readStored, writeStored } from './storage';

// How the browser last set up a room and a practice room of each game (RoomSetup in
// shared/src/accounts.ts, docs/architecture.md#accounts), which the next setup starts from: an
// account's as the server keeps it, with the browser's own from before as a fallback, and a guest's
// in the browser's storage, by game as the server keeps them. The server keeps an account's as the
// room is made; the page writes it into the summary it has too, so that the next setup starts from
// it before the page asks for the summary again.

type LastRoom = NonNullable<GameRoomSetup['room']>;

const KEY = 'r2.roomSetup';

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// The rooms the browser last set up, by game, as far as they can be read. A room kept before they
// were kept by game, which named its game, is left behind: the next room written replaces it.
function storedRooms(): Record<string, unknown> {
  const text = readStored(KEY);
  if (text === null) return {};
  try {
    const rooms: unknown = JSON.parse(text);
    return isObject(rooms) && typeof rooms.game !== 'string' ? rooms : {};
  } catch {
    return {};
  }
}

// The room of the game that the browser last set up, if it kept one. The rules of a match kept
// before they carried the game's own options, as `{games, teams, grouping}`, are read as
// `{games, options: {teams, grouping}}`, which is what they meant.
function storedRoom(game: string): Partial<LastRoom> | null {
  const room = storedRooms()[game];
  if (!isObject(room)) return null;
  const { match } = room;
  if (isObject(match) && !('options' in match) && ('teams' in match || 'grouping' in match)) {
    const { games, ...options } = match;
    return { ...room, match: { games, options } } as Partial<LastRoom>;
  }
  return room as Partial<LastRoom>;
}

// The last setup of a room of the game `game`, as far as it can be read: anything may be missing
// or out of shape, which the setup checks part by part as it takes it (CreateRoom.vue).
export function lastRoom(game: string): Partial<LastRoom> | null {
  return account.summary?.roomSetup[game]?.room ?? storedRoom(game);
}

// The last practice room of the game, as the server keeps it for an account, or null.
export function lastPractice(game: string): GameRoomSetup['practice'] | null {
  return account.summary?.roomSetup[game]?.practice ?? null;
}

// Keeps a setup as the server does (Accounts.rememberRoomSetup): a room's part whole, and of a
// practice room's part what it names, so that one with friends, which names no role, leaves the
// role as it was.
export function keepRoomSetup(game: string, part: GameRoomSetup): void {
  if (account.summary) {
    const kept = account.summary.roomSetup;
    const before = kept[game];
    const own: GameRoomSetup = {
      ...before,
      ...part,
      ...(part.practice ? { practice: { ...before?.practice, ...part.practice } } : {}),
    };
    account.summary.roomSetup = { ...kept, [game]: own };
  } else if (part.room) writeStored(KEY, JSON.stringify({ ...storedRooms(), [game]: part.room }));
}

// The word lists of a setup, by ID, as far as they can be read, and among those that are usable
// where the usable ones are known: before the lists have come, they aren't.
export const keptFields = (fields: unknown, usable?: ReadonlySet<string>): string[] =>
  Array.isArray(fields)
    ? fields.filter((id): id is string => typeof id === 'string' && (usable === undefined || usable.has(id)))
    : [];
