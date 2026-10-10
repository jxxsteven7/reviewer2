import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AccountStore } from './accounts';
import { AcknowledgmentStore, kindOfFeedback } from './acknowledgments';
import { openDatabase } from './database';

const START = Date.UTC(2026, 9, 10, 12);

let db: DatabaseSync;
let now: number;
let store: AcknowledgmentStore;
let accounts: AccountStore;

beforeEach(async () => {
  ({ db } = await openDatabase(null));
  now = START;
  store = new AcknowledgmentStore(db, () => now);
  accounts = new AccountStore(db, () => now);
});

afterEach(() => db.close());

const entry = (changes = {}) => ({
  name: 'Ann L',
  kind: 'feedback' as const,
  feedbackId: null,
  accountId: null,
  ...changes,
});

describe('the acknowledgments', () => {
  test('are listed for everyone by name, kind and day, the oldest first, and in full for the operator', () => {
    const ann = accounts.create('Ann', 'ann', 'h');
    expect(store.add(entry({ feedbackId: 7, accountId: ann?.id }))).toBe(1);
    now += 36 * 60 * 60_000;
    expect(store.add(entry({ name: 'Bob', kind: 'playtesting' }))).toBe(2);
    expect(store.list()).toEqual([
      { name: 'Ann L', kind: 'feedback', date: '2026-10-10' },
      { name: 'Bob', kind: 'playtesting', date: '2026-10-12' },
    ]);
    expect(store.all()).toEqual([
      {
        id: 1,
        name: 'Ann L',
        kind: 'feedback',
        creditedAt: '2026-10-10T12:00:00.000Z',
        feedbackId: 7,
        accountId: 1,
        username: 'Ann',
      },
      {
        id: 2,
        name: 'Bob',
        kind: 'playtesting',
        creditedAt: '2026-10-12T00:00:00.000Z',
        feedbackId: null,
        accountId: null,
        username: null,
      },
    ]);
    expect(store.byId(2)).toMatchObject({ name: 'Bob' });
    expect(store.byId(3)).toBeUndefined();
  });

  test('adopt a piece of feedback once', () => {
    expect(store.add(entry({ feedbackId: 7 }))).toBe(1);
    expect(store.add(entry({ feedbackId: 7 }))).toBeNull();
    expect(store.add(entry({ feedbackId: 8 }))).toBe(2);
    expect(store.add(entry())).toBe(3);
  });

  test('are linked to an account and unlinked, counted on it by kind, and removed', () => {
    const ann = accounts.create('Ann', 'ann', 'h');
    if (!ann) throw new Error('no account');
    store.add(entry());
    store.add(entry({ kind: 'words' }));
    store.add(entry({ kind: 'words' }));
    store.add(entry({ kind: 'playtesting' }));
    expect(store.counts(ann.id)).toEqual([]);
    for (const id of [1, 2, 3, 4]) expect(store.setAccount(id, ann.id)).toBe(true);
    expect(store.setAccount(5, ann.id)).toBe(false);
    // In the order of the kinds, not of the alphabet.
    expect(store.counts(ann.id)).toEqual([
      { kind: 'feedback', count: 1 },
      { kind: 'words', count: 2 },
      { kind: 'playtesting', count: 1 },
    ]);
    expect(store.setAccount(2, null)).toBe(true);
    expect(store.remove(4)).toBe(true);
    expect(store.remove(4)).toBe(false);
    expect(store.counts(ann.id)).toEqual([
      { kind: 'feedback', count: 1 },
      { kind: 'words', count: 1 },
    ]);
    expect(store.list()).toHaveLength(3);
    // A deleted account takes nothing with it but the link.
    accounts.delete(ann.id);
    expect(store.list().map(({ name }) => name)).toEqual(['Ann L', 'Ann L', 'Ann L']);
    expect(store.all().every(({ accountId, username }) => accountId === null && username === null)).toBe(true);
  });

  test('thank ideas and bugs as feedback, and the word lists as words', () => {
    expect(kindOfFeedback('idea')).toBe('feedback');
    expect(kindOfFeedback('bug')).toBe('feedback');
    expect(kindOfFeedback('words')).toBe('words');
  });
});
