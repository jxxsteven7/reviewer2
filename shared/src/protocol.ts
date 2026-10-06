import { z } from 'zod';
import { LANGUAGES } from './language';

// The messages between the client and the server over Socket.IO (docs/architecture.md). Every
// message from the client gets an acknowledgement: { ok: true, ... } or { ok: false, error }.
// The server checks every payload against these schemas before it looks at it.

export const ROOM_CODE_LENGTH = 4;
export const MAX_NAME_LENGTH = 16;
export const MAX_PLAYERS = 30;
export const MAX_SCREENS = 5;

// What the server may answer instead of doing what was asked. The client shows each one with the
// text under errors.<code> in the locale files. Games add their own codes.
export const ROOM_ERRORS = [
  'bad_request',
  'rate_limited',
  'internal',
  'bad_game',
  'bad_fields',
  'no_words',
  'too_many_rooms',
  'room_not_found',
  'room_full',
  'screens_full',
  'name_required',
  'name_invalid',
  'name_taken',
  'removed_recently',
  'not_member',
  'not_chair',
  'no_such_player',
  'wrong_phase',
  'cannot_start',
  'stale',
] as const;
export type RoomError = (typeof ROOM_ERRORS)[number];

export type Ack<Data extends object = object> = ({ ok: true } & Data) | { ok: false; error: string };

// The handshake. A browser sends its token, and, when it is reconnecting, the room it was in;
// a screen sends the code of the room it shows instead.
export interface Handshake {
  token?: string;
  code?: string;
  roomId?: string;
  watch?: string;
}

const code = z.string().max(16);
const name = z.string().max(64);
const playerId = z.string().max(32);
const gameId = z.string().max(64);
const fields = z.array(z.string().max(64)).min(1).max(20);
const none = z.object({});

export const ROOM_MESSAGES = {
  'sys:ping': none,
  'meta:fields': none,
  'room:create': z.object({ game: z.string().max(32), language: z.enum(LANGUAGES), fields, name }),
  'room:join': z.object({ code, name: name.optional() }),
  'room:watch': z.object({ code }),
  'room:leave': none,
  'room:rename': z.object({ name }),
  // The chair's controls.
  'room:settings': z.object({ fields }),
  'room:start': none,
  // A withdrawal names its game, so that one sent late can't end the next game.
  'room:end': z.object({ gameId }),
  'room:again': none,
  'room:shuffle': none,
  'room:spectate': z.object({ playerId }),
  'room:remove': z.object({ playerId }),
  'room:chair': z.object({ playerId }),
} as const;

export type RoomMessage = keyof typeof ROOM_MESSAGES;

// Why the server closed a room for someone: they were removed, the room expired, they left it
// from another tab, or the server is restarting.
export type ClosedReason = 'removed' | 'expired' | 'left' | 'restart';
