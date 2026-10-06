// The messages between the client and the server over Socket.IO (docs/architecture.md). Every
// message from the client gets an acknowledgement: { ok: true, ... } or { ok: false, error }.
// The schemas that the server checks every payload against are in schemas.ts, which the client
// never imports.

export const ROOM_CODE_LENGTH = 4;
// The longest nickname, in the characters that a reader sees, and the longest text that is looked
// at as a name at all, in UTF-16 units as it arrives. One character may take many units: sixteen
// of the longest emoji, which are built from 10 code points each, come to 240.
export const MAX_NAME_LENGTH = 16;
export const MAX_NAME_INPUT = 256;
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
  'player_offline',
  'wrong_phase',
  'cannot_start',
  'stale',
] as const;
export type RoomError = (typeof ROOM_ERRORS)[number];

export type Ack<Data extends object = object> = ({ ok: true } & Data) | { ok: false; error: string };

// The handshake, which brings back whoever has been in a room before the first message runs. A
// browser sends its token and, once it is in a room, that room's code and ID. A screen sends the
// code and ID of the room it shows, as `watch` and `roomId`. Nobody gets into a room for the first
// time through the handshake: that takes room:join or room:watch.
export interface Handshake {
  token?: string;
  code?: string;
  roomId?: string;
  watch?: string;
}

// Why the server closed a room for someone: they were removed, the room expired, they left it
// from another tab, or the server is restarting.
export type ClosedReason = 'removed' | 'expired' | 'left' | 'restart';
