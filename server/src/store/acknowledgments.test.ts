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
  test('are kept with the day they were given, and listed in full for the operator', () => {
    const ann = accounts.create('Ann', 'ann', 'h');
    expect(store.add(entry({ feedbackId: 7, accountId: ann?.id }))).toBe(1);
    now += 36 * 60 * 60_000;
    expect(store.add(entry({ name: '', feedbackId: 8 }))).toBe(2);
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
      // Feedback that came without a name.
      {
        id: 2,
        name: '',
        kind: 'feedback',
        creditedAt: '2026-10-12T00:00:00.000Z',
        feedbackId: 8,
        accountId: null,
        username: null,
      },
    ]);
  });

  test('adopt a piece of feedback once', () => {
    expect(store.add(entry({ feedbackId: 7 }))).toBe(1);
    expect(store.add(entry({ feedbackId: 7 }))).toBeNull();
    expect(store.add(entry({ feedbackId: 8 }))).toBe(2);
    expect(store.add(entry())).toBe(3);
  });

  test('are counted on their account by kind, until the account is deleted', () => {
    const ann = accounts.create('Ann', 'ann', 'h');
    const bob = accounts.create('Bob', 'bob', 'h');
    if (!ann || !bob) throw new Error('no account');
    expect(store.counts(ann.id)).toEqual([]);
    store.add(entry({ kind: 'playtesting', accountId: ann.id }));
    store.add(entry({ kind: 'words', accountId: ann.id }));
    store.add(entry({ kind: 'words', accountId: ann.id }));
    store.add(entry({ accountId: ann.id }));
    store.add(entry({ accountId: bob.id }));
    store.add(entry());
    // In the order of the kinds, not of the alphabet.
    expect(store.counts(ann.id)).toEqual([
      { kind: 'feedback', count: 1 },
      { kind: 'words', count: 2 },
      { kind: 'playtesting', count: 1 },
    ]);
    // A deleted account takes nothing with it but the link.
    accounts.delete(ann.id);
    expect(store.all()).toHaveLength(6);
    expect(store.all().filter(({ accountId }) => accountId !== null)).toEqual([
      expect.objectContaining({ id: 5, accountId: bob.id, username: 'Bob' }),
    ]);
    expect(store.all().map(({ name }) => name)).toEqual(Array(6).fill('Ann L'));
  });

  test('thank ideas, new games and bugs as feedback, and the word lists as words', () => {
    expect(kindOfFeedback('idea')).toBe('feedback');
    expect(kindOfFeedback('bug')).toBe('feedback');
    expect(kindOfFeedback('game')).toBe('feedback');
    expect(kindOfFeedback('words')).toBe('words');
  });
});
