import { usernameKey } from '@reviewer2/shared';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AccountStore } from './accounts';
import { AcknowledgmentStore } from './acknowledgments';
import { openDatabase } from './database';
import { DEFAULT_FEEDBACK_LIMITS, FeedbackStore, type NewFeedback } from './feedback';

const DAY = 24 * 60 * 60_000;
const START = Date.UTC(2026, 9, 9, 12);

let db: DatabaseSync;
let now: number;

beforeEach(async () => {
  ({ db } = await openDatabase(null));
  now = START;
});

afterEach(() => db.close());

const store = (limits = DEFAULT_FEEDBACK_LIMITS) => new FeedbackStore(db, () => now, limits);

const entry = (changes: Partial<NewFeedback> = {}): NewFeedback => ({
  kind: 'idea',
  text: 'More fields, please.',
  contact: null,
  credit: null,
  link: null,
  accountId: null,
  publicIssue: false,
  version: 'v0.0.15',
  language: 'en',
  page: 'home',
  userAgent: null,
  ...changes,
});

describe('the feedback', () => {
  test('is kept with the time it came, and read back newest first', () => {
    const feedback = store();
    expect(feedback.add(entry())).toBe(1);
    now += 60_000;
    const bug = entry({ kind: 'bug', text: 'Line one\nLine two', userAgent: 'Mozilla/5.0', page: 'room' });
    expect(feedback.add({ ...bug, contact: 'wechat: r2', language: 'zh' })).toBe(2);
    expect(feedback.count()).toBe(2);
    const alone = { issue: null, username: null, acknowledgmentId: null, nameTakenBy: null };
    expect(feedback.latest(10)).toEqual([
      { id: 2, createdAt: '2026-10-09T12:01:00.000Z', ...bug, contact: 'wechat: r2', language: 'zh', ...alone },
      { id: 1, createdAt: '2026-10-09T12:00:00.000Z', ...entry(), ...alone },
    ]);
    expect(feedback.byId(1)).toEqual({ id: 1, createdAt: '2026-10-09T12:00:00.000Z', ...entry(), ...alone });
    expect(feedback.byId(3)).toBeUndefined();
  });

  test('comes with the name for the acknowledgments, its link, its account while there is one, and its adoption', () => {
    const feedback = store();
    const ann = new AccountStore(db).create('Ann', 'ann', 'h');
    if (!ann) throw new Error('no account');
    feedback.add(entry({ credit: 'Ann L', link: 'https://ann.example/', accountId: ann.id }));
    expect(feedback.byId(1)).toMatchObject({
      credit: 'Ann L',
      link: 'https://ann.example/',
      accountId: 1,
      username: 'Ann',
      acknowledgmentId: null,
    });
    new AcknowledgmentStore(db).add({ name: 'Ann L', kind: 'feedback', feedbackId: 1, accountId: ann.id });
    expect(feedback.byId(1)).toMatchObject({ acknowledgmentId: 1 });
    new AccountStore(db).delete(ann.id);
    expect(feedback.byId(1)).toMatchObject({ credit: 'Ann L', accountId: null, username: null, acknowledgmentId: 1 });
  });

  test("says when its name is another account's username, however the name is written", () => {
    const feedback = store();
    const accounts = new AccountStore(db);
    const cat = accounts.create('Cat', usernameKey('Cat'), 'h');
    const bob = accounts.create('Bob', usernameKey('Bob'), 'h');
    if (!cat || !bob) throw new Error('no account');
    feedback.add(entry({ credit: 'CAT' }));
    feedback.add(entry({ credit: 'cat', accountId: bob.id }));
    // The account's own username, and a name that is nobody's.
    feedback.add(entry({ credit: 'Cat', accountId: cat.id }));
    feedback.add(entry({ credit: 'Dan' }));
    feedback.add(entry());
    const taken = () => feedback.latest(10).map(({ id, nameTakenBy }) => [id, nameTakenBy]);
    expect(taken()).toEqual([
      [5, null],
      [4, null],
      [3, null],
      [2, 'Cat'],
      [1, 'Cat'],
    ]);
    expect(feedback.byId(1)).toMatchObject({ credit: 'CAT', nameTakenBy: 'Cat' });
    // An account that is gone has no username to take.
    accounts.delete(cat.id);
    expect(taken().every(([, name]) => name === null)).toBe(true);
  });

  test('says whether the player agreed to a public issue, and remembers the issue it was published as', () => {
    const feedback = store();
    feedback.add(entry());
    feedback.add(entry({ publicIssue: true }));
    // Feedback from before players were asked.
    db.exec(
      "INSERT INTO feedback (created_at, kind, text, version, language, page) VALUES ('now', 'idea', 'Old', 'v1', 'en', 'home')",
    );
    expect(feedback.latest(10).map(({ publicIssue, issue }) => [publicIssue, issue])).toEqual([
      [null, null],
      [true, null],
      [false, null],
    ]);
    expect(feedback.setIssue(2, 42)).toBe(true);
    expect(feedback.setIssue(4, 42)).toBe(false);
    expect(feedback.byId(2)).toMatchObject({ publicIssue: true, issue: 42, text: 'More fields, please.' });
    expect(() => feedback.setIssue(2, 0)).toThrow(/CHECK constraint/);
  });

  test('never gets an id that another had, even if a row were deleted by hand', () => {
    const feedback = store();
    for (let i = 0; i < 3; i += 1) feedback.add(entry());
    db.exec('DELETE FROM feedback WHERE id = 3');
    expect(feedback.add(entry())).toBe(4);
    expect(feedback.latest(10).map(({ id }) => id)).toEqual([4, 2, 1]);
  });

  test('is read a page at a time, back from an id', () => {
    const feedback = store();
    for (let i = 1; i <= 5; i += 1) feedback.add(entry({ text: `Number ${i}` }));
    expect(feedback.latest(2).map(({ id }) => id)).toEqual([5, 4]);
    expect(feedback.latest(2, 4).map(({ id }) => id)).toEqual([3, 2]);
    expect(feedback.latest(2, 2).map(({ id }) => id)).toEqual([1]);
    expect(feedback.latest(2, 1)).toEqual([]);
  });

  test('of a kind, a language or a page that does not exist is refused by the database too', () => {
    const feedback = store();
    expect(() => feedback.add(entry({ kind: 'praise' as NewFeedback['kind'] }))).toThrow(/CHECK constraint/);
    expect(() => feedback.add(entry({ language: 'fr' as NewFeedback['language'] }))).toThrow(/CHECK constraint/);
    expect(() => feedback.add(entry({ page: 'lobby' as NewFeedback['page'] }))).toThrow(/CHECK constraint/);
    expect(feedback.count()).toBe(0);
  });
});

describe('no more feedback is taken', () => {
  test('once there are as many as the limit', () => {
    const feedback = store({ ...DEFAULT_FEEDBACK_LIMITS, maxEntries: 3 });
    for (let i = 0; i < 2; i += 1) feedback.add(entry());
    expect(feedback.full()).toBeNull();
    feedback.add(entry());
    expect(feedback.full()).toBe('entries');
  });

  test('once the feedback holds more than the limit', () => {
    const feedback = store({ ...DEFAULT_FEEDBACK_LIMITS, maxBytes: 20_000 });
    expect(feedback.full()).toBeNull();
    // A Chinese character takes three bytes, so each of these holds 3,323 with its contact, its
    // name, its link and its version.
    const large = entry({
      text: '\u{8bcd}'.repeat(1000),
      contact: 'x'.repeat(100),
      credit: 'y'.repeat(16),
      link: `https://${'z'.repeat(189)}.cn`,
    });
    for (let i = 0; i < 6; i += 1) feedback.add(large);
    expect(feedback.full()).toBeNull();
    feedback.add(large);
    expect(feedback.full()).toBe('size');
  });

  test('whatever else the database holds, until the whole database is larger than its limit', () => {
    const feedback = store({ ...DEFAULT_FEEDBACK_LIMITS, maxDatabaseBytes: 256 * 1024 });
    db.exec('CREATE TABLE filler (data BLOB) STRICT');
    const fill = db.prepare('INSERT INTO filler VALUES (randomblob(4096))');
    for (let i = 0; i < 20; i += 1) fill.run();
    expect(feedback.full()).toBeNull();
    for (let i = 0; i < 60; i += 1) fill.run();
    expect(feedback.full()).toBe('database');
  });

  test('by default after 10,000, 50 MB of feedback or a database of 1 GB', () => {
    expect(DEFAULT_FEEDBACK_LIMITS).toMatchObject({
      maxEntries: 10_000,
      maxBytes: 50 * 2 ** 20,
      maxDatabaseBytes: 2 ** 30,
    });
  });
});

describe('a contact', () => {
  test('is cleared 90 days after the feedback came, and the feedback stays', () => {
    const feedback = store();
    feedback.add(entry({ contact: 'first@example.com' }));
    now += DAY;
    feedback.add(entry({ contact: 'second@example.com' }));
    feedback.add(entry());

    now = START + 90 * DAY - 1;
    expect(feedback.clearContacts()).toBe(0);
    now = START + 90 * DAY + 1;
    expect(feedback.clearContacts()).toBe(1);
    expect(feedback.latest(10).map(({ contact }) => contact)).toEqual([null, 'second@example.com', null]);
    expect(feedback.count()).toBe(3);
    expect(feedback.latest(10).map(({ text }) => text)).toEqual(Array(3).fill('More fields, please.'));

    // Clearing twice clears nothing more.
    expect(feedback.clearContacts()).toBe(0);
    now += DAY;
    expect(feedback.clearContacts()).toBe(1);
    expect(feedback.latest(10).every(({ contact }) => contact === null)).toBe(true);
  });

  test('is kept 90 days by default', () => {
    expect(DEFAULT_FEEDBACK_LIMITS.contactMs).toBe(90 * DAY);
  });
});
