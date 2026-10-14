import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AccountStore } from './accounts';
import { openDatabase } from './database';
import { FriendStore } from './friends';

let db: DatabaseSync;
let now: number;
let friends: FriendStore;
let accounts: AccountStore;

beforeEach(async () => {
  ({ db } = await openDatabase(null));
  now = Date.UTC(2026, 9, 12, 9);
  accounts = new AccountStore(db, () => now);
  friends = new FriendStore(db, () => now);
});

afterEach(() => db.close());

const account = (name: string) => {
  const created = accounts.create(name, name.toLowerCase(), 'h');
  if (!created) throw new Error(`${name} is taken`);
  return created.id;
};

describe('the friendships table', () => {
  test('has one row for a pair, whichever way it was asked, and lists each side for the other', () => {
    const [ann, bob, cat] = [account('Ann'), account('Bob'), account('Cat')];
    friends.request(ann, bob);
    expect(friends.between(bob, ann)).toEqual({
      id: 1,
      requesterId: ann,
      addresseeId: bob,
      status: 'pending',
      createdAt: '2026-10-12T09:00:00.000Z',
      answeredAt: null,
    });
    expect(() => friends.request(bob, ann)).toThrow(/UNIQUE/);
    expect(friends.outgoing(ann)).toEqual([{ id: bob, handle: expect.any(String), username: 'Bob', avatar: null }]);
    expect(friends.incoming(bob)).toEqual([
      { id: ann, handle: expect.any(String), username: 'Ann', avatar: null, note: null },
    ]);
    expect(friends.counts(ann)).toEqual({ friends: 0, outgoing: 1, incoming: 0 });
    expect(friends.counts(bob)).toEqual({ friends: 0, outgoing: 0, incoming: 1 });

    now += 60_000;
    friends.accept(1);
    expect(friends.between(ann, bob)).toMatchObject({ status: 'accepted', answeredAt: '2026-10-12T09:01:00.000Z' });
    expect(friends.friendsOf(ann)).toEqual([
      { id: bob, handle: expect.any(String), username: 'Bob', avatar: null, alias: null },
    ]);
    expect(friends.friendsOf(bob)).toEqual([
      { id: ann, handle: expect.any(String), username: 'Ann', avatar: null, alias: null },
    ]);
    expect(friends.friendsOf(cat)).toEqual([]);
    expect(friends.incoming(bob)).toEqual([]);
    // Friends come by username, whoever asked.
    friends.request(cat, bob);
    friends.accept(2);
    expect(friends.friendsOf(bob).map(({ username }) => username)).toEqual(['Ann', 'Cat']);
    expect(friends.counts(bob)).toEqual({ friends: 2, outgoing: 0, incoming: 0 });
  });

  test('keeps a declined request until it is pruned, and renews it for whoever asks next', () => {
    const [ann, bob] = [account('Ann'), account('Bob')];
    friends.request(ann, bob);
    friends.decline(1);
    expect(friends.between(ann, bob)).toMatchObject({ status: 'declined', answeredAt: '2026-10-12T09:00:00.000Z' });
    expect(friends.incoming(bob)).toEqual([]);
    expect(friends.pruneDeclined('2026-10-12T08:59:59.000Z')).toBe(0);
    now += 60_000;
    friends.renew(1, bob, ann);
    expect(friends.between(ann, bob)).toEqual({
      id: 1,
      requesterId: bob,
      addresseeId: ann,
      status: 'pending',
      createdAt: '2026-10-12T09:01:00.000Z',
      answeredAt: null,
    });
    friends.decline(1);
    expect(friends.pruneDeclined('2026-10-12T09:01:00.000Z')).toBe(1);
    expect(friends.between(ann, bob)).toBeUndefined();
  });

  test('deletes a row, and goes with either account', () => {
    const [ann, bob, cat] = [account('Ann'), account('Bob'), account('Cat')];
    friends.request(ann, bob);
    friends.accept(1);
    friends.request(cat, ann);
    friends.delete(1);
    expect(friends.friendsOf(ann)).toEqual([]);
    expect(friends.incoming(ann)).toHaveLength(1);
    accounts.delete(cat);
    expect(friends.incoming(ann)).toEqual([]);
    expect(db.prepare('SELECT count(*) AS n FROM friendships').get()).toEqual({ n: 0 });
  });

  test('keeps the line of a request for the account asked alone, until the request is answered', () => {
    const [ann, bob, cat] = [account('Ann'), account('Bob'), account('Cat')];
    friends.request(ann, bob, 'We met at the workshop');
    friends.request(cat, bob);
    expect(friends.incoming(bob).map(({ username, note }) => [username, note])).toEqual([
      ['Ann', 'We met at the workshop'],
      ['Cat', null],
    ]);
    // Its sender doesn't see it again.
    expect(friends.outgoing(ann)).toEqual([{ id: bob, handle: expect.any(String), username: 'Bob', avatar: null }]);
    const note = (a: number, b: number) =>
      (db.prepare('SELECT note FROM friendships WHERE id = ?').get(friends.between(a, b)?.id ?? 0) as { note: unknown })
        .note;
    // Answered, accepted or declined, it is gone from the row.
    friends.accept(friends.between(ann, bob)?.id ?? 0);
    expect(note(ann, bob)).toBeNull();
    friends.request(ann, cat, 'Hello');
    friends.decline(friends.between(ann, cat)?.id ?? 0);
    expect(note(ann, cat)).toBeNull();
    // A request asked anew has a line of its own.
    friends.renew(friends.between(ann, cat)?.id ?? 0, cat, ann, 'Again?');
    expect(friends.incoming(ann).map(({ note: line }) => line)).toEqual(['Again?']);
  });

  test("keeps each friend's name for the other apart, for friends alone, and loses it with the friendship", () => {
    const [ann, bob, cat] = [account('Ann'), account('Bob'), account('Cat')];
    friends.request(ann, bob);
    friends.request(cat, ann);
    const annBob = friends.between(ann, bob)?.id ?? 0;
    // A request has no names yet.
    friends.setAlias(annBob, ann, 'Bobby');
    expect(friends.aliasOf(ann, bob)).toBeNull();
    friends.accept(annBob);
    friends.setAlias(annBob, ann, 'Bobby');
    friends.setAlias(annBob, bob, 'The chair');
    expect(friends.aliasOf(ann, bob)).toBe('Bobby');
    expect(friends.aliasOf(bob, ann)).toBe('The chair');
    expect(friends.friendsOf(ann).map(({ username, alias }) => [username, alias])).toEqual([['Bob', 'Bobby']]);
    expect(friends.friendsOf(bob).map(({ username, alias }) => [username, alias])).toEqual([['Ann', 'The chair']]);
    friends.setAlias(annBob, ann, null);
    expect(friends.aliasOf(ann, bob)).toBeNull();
    expect(friends.aliasOf(bob, ann)).toBe('The chair');
    // Cat's request to Ann knows nothing of it.
    expect(friends.aliasOf(cat, ann)).toBeNull();
    friends.delete(annBob);
    friends.request(ann, bob);
    friends.accept(friends.between(ann, bob)?.id ?? 0);
    expect(friends.aliasOf(bob, ann)).toBeNull();
  });

  test('refuses a row of an account with itself, or with a status that is none', () => {
    const ann = account('Ann');
    expect(() => friends.request(ann, ann)).toThrow(/CHECK/);
    expect(() =>
      db.exec("INSERT INTO friendships VALUES (NULL, 1, 2, 'maybe', 'now', NULL, NULL, NULL, NULL)"),
    ).toThrow(/CHECK|FOREIGN/);
  });
});
