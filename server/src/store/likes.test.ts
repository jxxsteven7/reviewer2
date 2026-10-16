import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { RECORDS_NOTICE_VERSION } from '@reviewer2/shared';
import { AccountStore } from './accounts';
import { openDatabase } from './database';
import { LikeStore } from './likes';

let db: DatabaseSync;
let now: number;
let accounts: AccountStore;
let likes: LikeStore;

beforeEach(async () => {
  ({ db } = await openDatabase(null));
  now = Date.UTC(2026, 9, 13, 12);
  accounts = new AccountStore(db, () => now);
  likes = new LikeStore(db, () => now);
});

afterEach(() => db.close());

const account = (name: string) => {
  const created = accounts.create(name, name.toLowerCase(), 'scrypt$hash', RECORDS_NOTICE_VERSION);
  if (!created) throw new Error(`${name} is taken`);
  return created;
};

describe('the likes table', () => {
  test('counts each account once for a profile, and lists them latest first', () => {
    const ann = account('Ann');
    const bob = account('Bob');
    const cy = account('Cy');
    expect(likes.count(ann.id)).toBe(0);
    expect(likes.has(ann.id, bob.id)).toBe(false);
    expect(likes.add(ann.id, bob.id)).toBe(true);
    expect(likes.add(ann.id, bob.id)).toBe(false);
    now += 1000;
    expect(likes.add(ann.id, cy.id)).toBe(true);
    expect(likes.count(ann.id)).toBe(2);
    expect(likes.has(ann.id, bob.id)).toBe(true);
    expect(likes.likersOf(ann.id)).toEqual([
      { id: cy.id, handle: cy.handle, username: 'Cy', avatar: null },
      { id: bob.id, handle: bob.handle, username: 'Bob', avatar: null },
    ]);
    expect(likes.likersOf(ann.id, 1)).toEqual([{ id: cy.id, handle: cy.handle, username: 'Cy', avatar: null }]);
    expect(likes.count(bob.id)).toBe(0);
  });

  test('forgets a like that is taken back, and every like of an account that is deleted', () => {
    const ann = account('Ann');
    const bob = account('Bob');
    likes.add(ann.id, bob.id);
    likes.add(bob.id, ann.id);
    expect(likes.remove(ann.id, bob.id)).toBe(true);
    expect(likes.remove(ann.id, bob.id)).toBe(false);
    expect(likes.count(ann.id)).toBe(0);
    expect(likes.count(bob.id)).toBe(1);
    accounts.delete(ann.id);
    expect(likes.count(bob.id)).toBe(0);
    expect(likes.likersOf(bob.id)).toEqual([]);
  });
});
