// The messages between the client and the server over Socket.IO (docs/architecture.md). Every
// message from the client gets an acknowledgement: { ok: true, ... } or { ok: false, error }.
// The schemas that the server checks every payload against are in schemas.ts, which the client
// never imports.

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

// Why the server closed a room for someone: they were removed, the room expired, they left it
// from another tab, or the server is restarting.
export type ClosedReason = 'removed' | 'expired' | 'left' | 'restart';
