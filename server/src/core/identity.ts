import { createHash, randomBytes } from 'node:crypto';
import { MAX_NAME_LENGTH } from '@reviewer2/shared';

// Who a player is (docs/architecture.md). Each browser keeps a secret token, which the server
// hands out on the first visit and which brings the player back to their seat after a reconnect.
// The server never stores a token: it keeps only its hash, the member key. Players know each
// other by a separate random player ID, so a token never leaves the browser that holds it.

const TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes in base64url

export const newToken = (): string => randomBytes(32).toString('base64url');
export const isToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);
export const memberKey = (token: string): string => createHash('sha256').update(token).digest('base64url');
export const newPlayerId = (): string => randomBytes(6).toString('base64url');

// Control characters and the invisible characters that could make two names look alike. The
// zero-width joiner stays allowed, because emoji sequences need it.
const INVISIBLE = /[\p{Cc}\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\ufeff]/u;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

// A nickname as it will be shown, or null when it can't be one: empty, too long or containing
// invisible characters. Spaces inside are collapsed and full-width forms folded.
export function cleanName(raw: string): string | null {
  const name = raw.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!name || INVISIBLE.test(name)) return null;
  return [...graphemes.segment(name)].length <= MAX_NAME_LENGTH ? name : null;
}

// Two names clash when they differ only in case.
export const sameName = (a: string, b: string): boolean => a.toLocaleLowerCase('en') === b.toLocaleLowerCase('en');
