import { readStored, removeStored, writeStored } from './storage';

// What this browser remembers between visits: its token, which brings the player back to their
// seat, and the room that a screen of it showed last, by code and ID, which brings a screen that
// is reloaded back to its room (room.ts). It goes through storage.ts, which never throws.

// The end-to-end tests read the token from a page's storage under this key.
export const TOKEN = 'r2.token';

export const storedToken = (): string | null => readStored(TOKEN);
export const storeToken = (token: string): void => writeStored(TOKEN, token);

// The screen's room, as `{ code, roomId }` in JSON: one for the browser, so that a browser that
// shows room after room keeps nothing of the earlier ones.
export const SCREEN_ROOM = 'r2.screen';

interface ScreenRoom {
  code: string;
  roomId: string;
}

const isScreenRoom = (value: unknown): value is ScreenRoom =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ScreenRoom).code === 'string' &&
  typeof (value as ScreenRoom).roomId === 'string';

function screenRoom(): ScreenRoom | null {
  const stored = readStored(SCREEN_ROOM);
  if (stored === null) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return isScreenRoom(parsed) ? parsed : null;
  } catch {
    return null; // not what this page writes
  }
}

// The ID of the room that the browser's screen showed last, if that is the room of this code.
export function storedScreenRoom(code: string): string | null {
  const kept = screenRoom();
  return kept?.code === code ? kept.roomId : null;
}

// Every snapshot of the room comes through here (room.ts): the storage is written when the room
// is new to it.
export function storeScreenRoom(code: string, roomId: string): void {
  if (storedScreenRoom(code) === roomId) return;
  writeStored(SCREEN_ROOM, JSON.stringify({ code, roomId }));
}

// Forgets the room of this code, if it is the one kept.
export function forgetScreenRoom(code: string): void {
  if (screenRoom()?.code === code) removeStored(SCREEN_ROOM);
}
