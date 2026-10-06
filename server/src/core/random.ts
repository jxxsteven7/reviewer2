import { randomBytes, randomInt } from 'node:crypto';

// Randomness for dealing cards, drawing words and naming things. The server uses the crypto
// module, because a predictable sequence could let someone work out the key. Tests pass a seeded
// generator instead, to replay the same games.
export interface Rng {
  // A whole number from 0 up to, but not including, `below`, which is a whole number of at
  // least 1. Anything else throws.
  int(below: number): number;
}

export const cryptoRng: Rng = { int: (below) => randomInt(below) };

// mulberry32: fast and repeatable, and never to be used for real games. It refuses what the
// crypto generator refuses, so that a test can't pass on a call that would throw in a real game.
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    int(below) {
      if (!Number.isSafeInteger(below) || below < 1) throw new RangeError(`cannot draw a number below ${below}`);
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * below);
    },
  };
}

// Fisher-Yates.
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    const swap = result[i] as T;
    result[i] = result[j] as T;
    result[j] = swap;
  }
  return result;
}

export function pick<T>(items: readonly T[], rng: Rng): T {
  if (items.length === 0) throw new Error('cannot pick from an empty list');
  return items[rng.int(items.length)] as T;
}

// An unguessable identifier, such as a game ID, that is safe in URLs.
export const randomId = (bytes = 9): string => randomBytes(bytes).toString('base64url');
