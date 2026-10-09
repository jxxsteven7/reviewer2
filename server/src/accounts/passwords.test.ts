import { describe, expect, test } from 'vitest';
import { BusyError, PasswordHasher, SCRYPT } from './passwords';

// Hashes that take a millisecond, so that the tests can make many. The real ones take 32 MiB.
const FAST = { log2N: 10, r: 8, p: 1 };
const hasher = new PasswordHasher(FAST);

describe('a password', () => {
  test('is kept as an scrypt hash with its parameters and a salt of its own', async () => {
    const first = await hasher.hash('correct horse');
    const second = await hasher.hash('correct horse');
    expect(first).toMatch(/^scrypt\$10\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(first).not.toContain('correct');
  });

  test('verifies against its hash, and nothing else does', async () => {
    const stored = await hasher.hash('correct horse');
    expect(await hasher.verify('correct horse', stored)).toEqual({ ok: true, outdated: false });
    for (const wrong of ['correct hors', 'Correct horse', 'correct horse ', '']) {
      expect(await hasher.verify(wrong, stored), wrong).toEqual({ ok: false, outdated: false });
    }
  });

  test('typed with a full-width keyboard is the same password', async () => {
    const stored = await hasher.hash('pass1234');
    expect((await hasher.verify('\u{ff50}\u{ff41}\u{ff53}\u{ff53}1234', stored)).ok).toBe(true);
  });

  test('made with other parameters still verifies, and is said to be outdated', async () => {
    const stored = await new PasswordHasher({ log2N: 11, r: 8, p: 1 }).hash('correct horse');
    expect(await hasher.verify('correct horse', stored)).toEqual({ ok: true, outdated: true });
    expect(await hasher.verify('wrong horse', stored)).toEqual({ ok: false, outdated: false });
  });

  test('fails against no hash, or one that can not be read, after doing the same work', async () => {
    expect(await hasher.verify('correct horse', null)).toEqual({ ok: false, outdated: false });
    const stored = await hasher.hash('correct horse');
    for (const broken of [
      '',
      'correct horse',
      stored.replace('scrypt', 'bcrypt'),
      stored.slice(0, -1),
      'scrypt$30$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ]) {
      expect(await hasher.verify('correct horse', broken), broken).toEqual({ ok: false, outdated: false });
    }
  });

  test('is hashed with 32 MiB by default', () => {
    expect(SCRYPT).toEqual({ log2N: 15, r: 8, p: 3 });
    expect(new PasswordHasher().params).toBe(SCRYPT);
  });
});

describe('the hasher', () => {
  test('works on two at a time, lets a few more wait, and refuses the rest', async () => {
    const limited = new PasswordHasher(FAST, 2, 1);
    const tries = Array.from({ length: 4 }, () => limited.hash('correct horse'));
    const results = await Promise.allSettled(tries);
    expect(results.map(({ status }) => status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'rejected']);
    expect((results[3] as PromiseRejectedResult).reason).toBeInstanceOf(BusyError);
    // Once they are done, there is room again.
    expect(await limited.hash('correct horse')).toMatch(/^scrypt/);
    const again = await Promise.allSettled(Array.from({ length: 3 }, () => limited.verify('x', null)));
    expect(again.every(({ status }) => status === 'fulfilled')).toBe(true);
  });
});
