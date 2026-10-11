import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { addAccounts } from '../../test/statistics';
import { AccountStore } from './accounts';
import { openDatabase } from './database';
import { RecordStore, TitleStore, type NewMatchRecord, type NewRecord } from './records';
import { DEFAULT_SESSION_LIMITS, MailTokenStore, SessionStore } from './sessions';

const DAY = 24 * 60 * 60_000;
const NO_MATCHES = { played: 0, recent: [] };
const START = Date.UTC(2026, 9, 9, 12);

let db: DatabaseSync;
let now: number;
let accounts: AccountStore;

beforeEach(async () => {
  ({ db } = await openDatabase(null));
  now = START;
  accounts = new AccountStore(db, () => now);
});

afterEach(() => db.close());

const hash = (text: string) => createHash('sha256').update(text).digest();
const hex = (hashes: Uint8Array[]) => hashes.map((value) => Buffer.from(value).toString('hex')).sort();
const account = (name = 'Ann') => {
  const created = accounts.create(name, name.toLowerCase(), 'scrypt$hash');
  if (!created) throw new Error(`${name} is taken`);
  return created;
};

describe('an account', () => {
  test('is created with its username, key and password, and found by id and by key', () => {
    const ann = account();
    expect(ann).toEqual({
      id: 1,
      username: 'Ann',
      key: 'ann',
      password: 'scrypt$hash',
      emailFp: null,
      avatar: null,
      avatarBanned: false,
      publicBarred: false,
      createdAt: '2026-10-09T12:00:00.000Z',
    });
    expect(accounts.byKey('ann')).toEqual(ann);
    expect(accounts.byKey('bob')).toBeUndefined();
    expect(accounts.count()).toBe(1);
  });

  test('can not take a key that another has, nor rename itself to one', () => {
    account('Ann');
    expect(accounts.create('ANN', 'ann', 'h')).toBeNull();
    const bob = account('Bob');
    expect(accounts.rename(bob.id, 'ANN', 'ann')).toBe(false);
    expect(accounts.rename(bob.id, 'Bobby', 'bobby')).toBe(true);
    expect(accounts.byId(bob.id)).toMatchObject({ username: 'Bobby', key: 'bobby' });
    expect(accounts.byKey('bob')).toBeUndefined();
  });

  test('never gets an id that a deleted account had', () => {
    const ann = account('Ann');
    account('Bob');
    accounts.delete(2);
    expect(account('Cat').id).toBe(3);
    expect(accounts.delete(ann.id)).toMatchObject({ username: 'Ann' });
    expect(accounts.delete(ann.id)).toBeUndefined();
  });

  test('binds an address that no other account has', () => {
    const ann = account('Ann');
    const bob = account('Bob');
    const address = hash('ann@example.com');
    expect(accounts.setEmail(ann.id, address)).toBe(true);
    expect(accounts.byEmail(address)?.id).toBe(ann.id);
    expect(accounts.setEmail(bob.id, address)).toBe(false);
    expect(accounts.setEmail(ann.id, null)).toBe(true);
    expect(accounts.byEmail(address)).toBeUndefined();
    expect(accounts.setEmail(bob.id, address)).toBe(true);
  });

  test('keeps the file name of its avatar, which two accounts may share', () => {
    const ann = account('Ann');
    const bob = account('Bob');
    expect(accounts.setAvatar(ann.id, 'a.webp')).toBeNull();
    expect(accounts.setAvatar(bob.id, 'a.webp')).toBeNull();
    expect(accounts.avatarUsers('a.webp')).toBe(2);
    expect(accounts.setAvatar(ann.id, 'b.jpg')).toBe('a.webp');
    expect(accounts.avatarUsers('a.webp')).toBe(1);
    expect(accounts.avatarFiles()).toEqual(new Set(['a.webp', 'b.jpg']));
    accounts.setAvatarBanned(bob.id, true);
    expect(accounts.byId(bob.id)?.avatarBanned).toBe(true);
  });

  test('writes all of a transaction or none of it', () => {
    const ann = account('Ann');
    expect(() =>
      accounts.transaction(() => {
        accounts.setPassword(ann.id, 'new');
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(accounts.byId(ann.id)?.password).toBe('scrypt$hash');
    accounts.transaction(() => accounts.setPassword(ann.id, 'new'));
    expect(accounts.byId(ann.id)?.password).toBe('new');
  });
});

describe('the statistics of the accounts', () => {
  test('count the accounts created lately, by day, and the ones active lately', () => {
    addAccounts(db, START);
    expect(accounts.counts(7)).toEqual({ total: 3, recent: 1 });
    expect(accounts.counts(30)).toEqual({ total: 3, recent: 2 });
    const days = accounts.createdByDay(30);
    expect(days).toHaveLength(30);
    expect(days[0]).toEqual({ day: '2026-09-10', count: 0 });
    expect(days.filter(({ count }) => count > 0)).toEqual([
      { day: '2026-09-29', count: 1 },
      { day: '2026-10-09', count: 1 },
    ]);
    // Ann played a game 2 days ago; Bob logged in 10 days ago; Cy only registered.
    expect(accounts.activeWithin(7)).toBe(1);
    expect(accounts.activeWithin(30)).toBe(2);
    accounts.setPublicBarred(2, true);
    expect(accounts.list()).toEqual([
      { username: 'Ann', createdAt: '2026-08-30T12:00:00.000Z', games: 1, matches: 1, barred: false },
      { username: 'Bob', createdAt: '2026-09-29T12:00:00.000Z', games: 0, matches: 0, barred: true },
      { username: 'Cy', createdAt: '2026-10-09T12:00:00.000Z', games: 0, matches: 0, barred: false },
    ]);
    expect(accounts.byId(2)).toMatchObject({ publicBarred: true });
    accounts.setPublicBarred(2, false);
    expect(accounts.byId(2)).toMatchObject({ publicBarred: false });
  });

  test('count 0 when there are no accounts', () => {
    expect(accounts.counts(7)).toEqual({ total: 0, recent: 0 });
  });

  test('refuse a window of activity longer than logins are kept', () => {
    addAccounts(db, START);
    expect(accounts.activeWithin(30)).toBe(2);
    expect(() => accounts.activeWithin(31)).toThrow(RangeError);
  });

  test('count a day in UTC, and an account once however often it was active', () => {
    const sessions = new SessionStore(db, () => now);
    now = Date.UTC(2026, 9, 9, 23, 30);
    const ann = account('Ann');
    sessions.create(hash('a1'), ann.id);
    sessions.create(hash('a2'), ann.id);
    now = Date.UTC(2026, 9, 10, 0, 30);
    expect(accounts.createdByDay(2)).toEqual([
      { day: '2026-10-09', count: 1 },
      { day: '2026-10-10', count: 0 },
    ]);
    expect(accounts.activeWithin(7)).toBe(1);
  });

  test("don't count a login that has ended", () => {
    const sessions = new SessionStore(db, () => now);
    const ann = account('Ann');
    sessions.create(hash('a1'), ann.id);
    expect(accounts.activeWithin(7)).toBe(1);
    // Logging out deletes the login with the time it was used.
    sessions.delete(hash('a1'));
    expect(accounts.activeWithin(7)).toBe(0);
  });

  test('read the clock once, so that the days agree with the cutoff across midnight', () => {
    now = Date.UTC(2026, 9, 8, 23);
    account('Ann');
    // A clock that passes midnight between one reading and the next.
    let readings = 0;
    const store = new AccountStore(db, () => Date.UTC(2026, 9, 9, 23, 59, 59, 999) + readings++);
    expect(store.createdByDay(2)).toEqual([
      { day: '2026-10-08', count: 1 },
      { day: '2026-10-09', count: 0 },
    ]);
  });

  test('are read on one snapshot while another connection writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reviewer2-accounts-'));
    const reader = await openDatabase(dir);
    const writer = await openDatabase(dir);
    try {
      const read = new AccountStore(reader.db);
      const write = new AccountStore(writer.db);
      write.create('Ann', 'ann', 'hash');
      const counts = read.snapshot(() => {
        const before = read.count();
        write.create('Bob', 'bob', 'hash');
        return [before, read.count()];
      });
      expect(counts).toEqual([1, 1]);
      expect(read.count()).toBe(2);
    } finally {
      reader.db.close();
      writer.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a login', () => {
  const sessions = () => new SessionStore(db, () => now);

  test('is found by the hash of its token until 30 days after it was last used', () => {
    const store = sessions();
    const ann = account();
    store.create(hash('one'), ann.id);
    expect(store.find(hash('one'))).toEqual({ accountId: ann.id });
    expect(store.find(hash('two'))).toBeNull();

    // Each use that is more than an hour after the last one counts.
    now += 29 * DAY;
    expect(store.find(hash('one'))).toEqual({ accountId: ann.id });
    now += 29 * DAY;
    expect(store.find(hash('one'))).toEqual({ accountId: ann.id });
    now += 30 * DAY + 1;
    expect(store.find(hash('one'))).toBeNull();
    expect(store.prune()).toBe(1);
  });

  test('is written down at most once an hour', () => {
    const store = sessions();
    const ann = account();
    store.create(hash('one'), ann.id);
    const usedAt = () => db.prepare('SELECT used_at AS usedAt FROM sessions').get() as { usedAt: string };
    now += 59 * 60_000;
    store.find(hash('one'));
    expect(usedAt()).toEqual({ usedAt: '2026-10-09T12:00:00.000Z' });
    now += 2 * 60_000;
    store.find(hash('one'));
    expect(usedAt()).toEqual({ usedAt: '2026-10-09T13:01:00.000Z' });
  });

  test('ends after a year, however much it is used', () => {
    const store = sessions();
    const ann = account();
    store.create(hash('one'), ann.id);
    for (let day = 0; day < 364; day += 20) {
      now = START + day * DAY;
      expect(store.find(hash('one')), `day ${day}`).not.toBeNull();
    }
    now = START + 365 * DAY;
    expect(store.find(hash('one'))).toBeNull();
  });

  test('of one account too many ends the one used longest ago', () => {
    const store = new SessionStore(db, () => now, { ...DEFAULT_SESSION_LIMITS, perAccount: 2 });
    const ann = account('Ann');
    const bob = account('Bob');
    expect(store.create(hash('a1'), ann.id)).toEqual([]);
    now += 2 * 60 * 60_000;
    store.create(hash('a2'), ann.id);
    store.create(hash('b1'), bob.id);
    now += 2 * 60 * 60_000;
    store.find(hash('a1'));
    now += 1000;
    expect(hex(store.create(hash('a3'), ann.id))).toEqual(hex([hash('a2')]));
    expect(store.find(hash('a2'))).toBeNull();
    expect(store.find(hash('a1'))).not.toBeNull();
    expect(store.find(hash('b1'))).not.toBeNull();
  });

  test('can be ended alone, or with every other login of its account', () => {
    const store = sessions();
    const ann = account('Ann');
    const bob = account('Bob');
    for (const token of ['a1', 'a2', 'a3']) store.create(hash(token), ann.id);
    store.create(hash('b1'), bob.id);
    expect(store.delete(hash('a1'))).toBe(true);
    expect(store.delete(hash('a1'))).toBe(false);
    expect(hex(store.deleteForAccount(ann.id, hash('a2')))).toEqual(hex([hash('a3')]));
    expect(store.find(hash('a2'))).not.toBeNull();
    expect(hex(store.deleteForAccount(ann.id))).toEqual(hex([hash('a2')]));
    expect(store.find(hash('b1'))).not.toBeNull();
  });

  test('goes with its account', () => {
    const store = sessions();
    const ann = account();
    store.create(hash('one'), ann.id);
    accounts.delete(ann.id);
    expect(store.find(hash('one'))).toBeNull();
  });
});

describe('a link in a mail', () => {
  test('is found for its purpose until it expires', () => {
    const tokens = new MailTokenStore(db, () => now);
    const ann = account();
    const address = hash('ann@example.com');
    tokens.create(hash('bind'), ann.id, 'bind', address, DAY);
    tokens.create(hash('reset'), ann.id, 'reset', null, 30 * 60_000);
    expect(tokens.find(hash('bind'), 'bind')).toEqual({ accountId: ann.id, emailFp: new Uint8Array(address) });
    expect(tokens.find(hash('bind'), 'reset')).toBeNull();
    expect(tokens.find(hash('reset'), 'reset')).toEqual({ accountId: ann.id, emailFp: null });
    expect(tokens.pending(ann.id)).toBe(true);

    now += 30 * 60_000;
    expect(tokens.find(hash('reset'), 'reset')).toBeNull();
    expect(tokens.find(hash('bind'), 'bind')).not.toBeNull();
    expect(tokens.prune()).toBe(1);
    now += DAY;
    expect(tokens.pending(ann.id)).toBe(false);
  });

  test('can be deleted alone, or with every other link of the same purpose', () => {
    const tokens = new MailTokenStore(db, () => now);
    const ann = account();
    for (const token of ['r1', 'r2']) tokens.create(hash(token), ann.id, 'reset', null, DAY);
    tokens.create(hash('b1'), ann.id, 'bind', hash('x'), DAY);
    expect(tokens.delete(hash('r1'))).toBe(true);
    expect(tokens.delete(hash('r1'))).toBe(false);
    expect(tokens.deleteForAccount(ann.id, 'reset')).toBe(1);
    expect(tokens.find(hash('b1'), 'bind')).not.toBeNull();
  });
});

describe('the record of games', () => {
  const record = (changes: Partial<NewRecord> = {}): NewRecord => ({
    game: 'keywords',
    gameId: 'g1',
    side: 'red',
    role: 'captain',
    winner: 'red',
    won: true,
    verdict: 'oral',
    ...changes,
  });

  test('keeps each game once, and counts the games and the wins', () => {
    const records = new RecordStore(db, () => now);
    const ann = account('Ann');
    const bob = account('Bob');
    expect(records.add(ann.id, record())).toBe(true);
    expect(records.add(ann.id, record())).toBe(false);
    now += 60_000;
    records.add(ann.id, record({ gameId: 'g2', side: 'blue', role: 'guesser', won: false, verdict: 'deskReject' }));
    records.add(bob.id, record());
    expect(records.view(ann.id)).toEqual({
      games: 2,
      wins: 1,
      recent: [
        {
          game: 'keywords',
          endedAt: '2026-10-09T12:01:00.000Z',
          side: 'blue',
          role: 'guesser',
          winner: 'red',
          won: false,
          verdict: 'deskReject',
        },
        {
          game: 'keywords',
          endedAt: '2026-10-09T12:00:00.000Z',
          side: 'red',
          role: 'captain',
          winner: 'red',
          won: true,
          verdict: 'oral',
        },
      ],
      matches: NO_MATCHES,
    });
    expect(records.view(account('Cat').id)).toEqual({ games: 0, wins: 0, recent: [], matches: NO_MATCHES });
  });

  test('lists the latest 20 games and counts them all', () => {
    const records = new RecordStore(db, () => now);
    const ann = account();
    for (let i = 1; i <= 25; i += 1) records.add(ann.id, record({ gameId: `g${i}`, won: i % 5 === 0 }));
    const view = records.view(ann.id);
    expect(view).toMatchObject({ games: 25, wins: 5 });
    expect(view.recent).toHaveLength(20);
  });
});

describe('titles', () => {
  test('are counted, and can be awarded again and again', () => {
    const titles = new TitleStore(db, () => now);
    const ann = account();
    expect(titles.counts(ann.id)).toEqual([]);
    expect(titles.award(ann.id, 'best_paper', 'm1')).toBe(true);
    expect(titles.award(ann.id, 'best_paper', 'm2')).toBe(true);
    expect(titles.award(ann.id, 'black_hole')).toBe(true);
    expect(titles.counts(ann.id)).toEqual([
      { title: 'best_paper', count: 2 },
      { title: 'black_hole', count: 1 },
    ]);
    expect(() => titles.award(ann.id, 'worst_paper' as 'best_paper')).toThrow(/CHECK constraint/);
  });

  test('are awarded once for each match, however often its end is reported', () => {
    const titles = new TitleStore(db, () => now);
    const ann = account();
    expect(titles.award(ann.id, 'best_paper', 'm1')).toBe(true);
    expect(titles.award(ann.id, 'best_paper', 'm1')).toBe(false);
    expect(titles.award(account('Bob').id, 'best_paper', 'm1')).toBe(true);
    expect(titles.counts(ann.id)).toEqual([{ title: 'best_paper', count: 1 }]);
  });
});

describe('the record of matches', () => {
  const match = (overrides: Partial<NewMatchRecord> = {}): NewMatchRecord => ({
    game: 'keywords',
    matchId: 'm1',
    games: 3,
    rank: 1,
    players: 4,
    score: 12,
    title: 'best_paper',
    ...overrides,
  });

  test('keeps each match once, the latest first, and counts them all', () => {
    const records = new RecordStore(db, () => now);
    const ann = account();
    expect(records.addMatch(ann.id, match())).toBe(true);
    expect(records.addMatch(ann.id, match({ rank: 2 }))).toBe(false);
    now += 60_000;
    records.addMatch(ann.id, match({ matchId: 'm2', rank: 4, score: -2, title: 'black_hole' }));
    records.addMatch(account('Bob').id, match());
    expect(records.view(ann.id).matches).toEqual({
      played: 2,
      recent: [
        {
          game: 'keywords',
          endedAt: '2026-10-09T12:01:00.000Z',
          games: 3,
          rank: 4,
          players: 4,
          score: -2,
          title: 'black_hole',
        },
        {
          game: 'keywords',
          endedAt: '2026-10-09T12:00:00.000Z',
          games: 3,
          rank: 1,
          players: 4,
          score: 12,
          title: 'best_paper',
        },
      ],
    });
  });

  test("refuses a title that isn't one", () => {
    const records = new RecordStore(db, () => now);
    expect(() => records.addMatch(account().id, match({ title: 'worst_paper' as 'best_paper' }))).toThrow(/CHECK/);
  });
});
