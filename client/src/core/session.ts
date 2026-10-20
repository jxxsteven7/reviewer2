import { readStored, removeStored, writeStored } from './storage';

// What this browser remembers between visits: its token, which brings the player back to their
// seat, and the ID of the room that each of its screens shows, which brings a screen that is
// reloaded back to its room (room.ts). It goes through storage.ts, which never throws.

// The end-to-end tests read the token from a page's storage under this key.
export const TOKEN = 'r2.token';

export const storedToken = (): string | null => readStored(TOKEN);
export const storeToken = (token: string): void => writeStored(TOKEN, token);

const screenKey = (code: string) => `r2.screen.${code}`;

export const storedScreenRoom = (code: string): string | null => readStored(screenKey(code));
export const storeScreenRoom = (code: string, roomId: string): void => writeStored(screenKey(code), roomId);
export const forgetScreenRoom = (code: string): void => removeStored(screenKey(code));
