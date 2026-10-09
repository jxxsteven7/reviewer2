import { createHash } from 'node:crypto';
import { randomId } from '../core/random';

// The secrets that stand for a login and for the links in mails: 32 random bytes in base64url,
// like the tokens of guests (core/identity.ts). Only their SHA-256 is kept, so a database that
// leaks holds nothing that could be used as one.

const SECRET = /^[A-Za-z0-9_-]{43}$/;

export const newSecret = (): string => randomId(32);
export const isSecret = (value: unknown): value is string => typeof value === 'string' && SECRET.test(value);
export const hashSecret = (secret: string): Buffer => createHash('sha256').update(secret).digest();
