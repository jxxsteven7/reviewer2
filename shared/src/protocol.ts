import type { Language } from './language';

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
  'bad_settings',
  'bad_words',
  'custom_words_private',
  'no_words',
  'too_many_rooms',
  'room_not_found',
  'room_full',
  'screens_full',
  'name_required',
  'name_invalid',
  'name_taken',
  'name_reserved',
  'account_name',
  'account_required',
  'public_barred',
  'removed',
  'removed_recently',
  'not_member',
  'not_chair',
  'no_such_player',
  'player_offline',
  'wrong_phase',
  'cannot_start',
  'stale',
  'emote_cooldown',
  'bad_match',
  'match_over',
  'match_locked',
] as const;
export type RoomError = (typeof ROOM_ERRORS)[number];

// A field of the word library, as the room setup shows it: its name and how many words it has
// in each language.
export interface FieldInfo {
  id: string;
  name: Record<Language, string>;
  counts: Record<Language, number>;
}

// A public room as the list on the home page shows it (meta:rooms): nothing about who is in it but
// how many, and whether a game is on.
export interface PublicRoom {
  code: string;
  game: string;
  language: Language;
  fields: string[];
  players: number;
  playing: boolean;
}

// A room where the connection still has a seat, as the home page offers the way back to it
// (meta:seats): nothing about anyone else, and `playing` from the start of a game until the room
// is back in the waiting room, while the seat is kept however long its player is away.
export interface SeatedRoom {
  code: string;
  game: string;
  playing: boolean;
}

// What the server answers a message with: that it did what was asked, with whatever it has to
// say about it, or that it didn't, with an error code. `language` comes with name_required alone:
// it is the room's language, for the form that asks a newcomer for a name. `waitMs` comes with
// emote_cooldown alone: how much longer the member has to wait before the next reaction.
export type Ack<Data extends object = object> =
  ({ ok: true } & Data) | { ok: false; error: string; language?: Language; waitMs?: number };

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

// The first thing the server sends on a connection, before anything about a room: the version of
// the server, and a token when the browser came without a usable one. The browser keeps the token
// and sends it with every later handshake. `account` is the account that the connection was
// recognized as, from the browser's login cookie, or null for a guest.
export interface Session {
  token?: string;
  version: string;
  account: { username: string; avatar: string | null } | null;
}

// The quick reactions that anyone in a room can send, spectators included (docs/architecture.md).
// Their text and their sounds are the client's. A member may send one every EMOTE_COOLDOWN_MS.
export const EMOTES = ['waiting', 'deadline', 'reviewer2'] as const;
export type Emote = (typeof EMOTES)[number];
export const EMOTE_COOLDOWN_MS = 10_000;

// A reaction, as the server passes it on to every connection in the room as `room:emote`. It is a
// moment rather than a change: no snapshot carries it.
export interface EmoteEvent {
  roomId: string;
  playerId: string;
  emote: Emote;
}

// Why the server closed a room for someone: they were removed, for good from a public room or for
// a while from a private one, as room:join would then answer them; the chair sent the screens
// away; the room expired; they left it from another tab; the chair closed it for everyone; or the
// server is restarting.
export type ClosedReason = 'removed' | 'removed_recently' | 'dismissed' | 'expired' | 'left' | 'closed' | 'restart';
