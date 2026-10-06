import { createHash, randomBytes } from 'node:crypto';

// Who a player is (docs/architecture.md). Each browser keeps a secret token, which the server
// hands out on the first visit and which brings the player back to their seat after a reconnect.
// The server never stores a token: it keeps only its hash, the member key. Players know each
// other by a separate random player ID, so a token never leaves the browser that holds it.

const TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes in base64url

export const newToken = (): string => randomBytes(32).toString('base64url');
export const isToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);
export const memberKey = (token: string): string => createHash('sha256').update(token).digest('base64url');
export const newPlayerId = (): string => randomBytes(6).toString('base64url');
