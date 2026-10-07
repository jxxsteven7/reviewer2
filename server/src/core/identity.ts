import { createHash } from 'node:crypto';
import { randomId } from './random';

// Who a player is (docs/architecture.md). Each browser keeps a secret token, which the server
// hands out on the first visit and which brings the player back to their seat after a reconnect.
// The server never stores a token: it keeps only its hash, the member key. Players know each
// other by a separate random player ID, so a token never leaves the browser that holds it.

const TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes in base64url, as randomId(32) writes them

export const newToken = (): string => randomId(32);
export const isToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);
export const memberKey = (token: string): string => createHash('sha256').update(token).digest('base64url');
export const newPlayerId = (): string => randomId(6);
