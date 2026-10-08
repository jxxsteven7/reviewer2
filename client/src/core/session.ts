import { readStored, writeStored } from './storage';

// What this browser remembers between visits: its token, which brings the player back to their
// seat, and the last nickname it used. Both go through storage.ts, which never throws.

// The end-to-end tests read the token from a page's storage under this key.
export const TOKEN = 'r2.token';
const NAME = 'r2.name';

export const storedToken = (): string | null => readStored(TOKEN);
export const storeToken = (token: string): void => writeStored(TOKEN, token);

export const storedName = (): string => readStored(NAME) ?? '';
export const storeName = (name: string): void => writeStored(NAME, name);
