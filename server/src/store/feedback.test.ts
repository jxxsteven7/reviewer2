import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
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
    expect(feedback.latest(10)).toEqual([
      { id: 2, createdAt: '2026-10-09T12:01:00.000Z', ...bug, contact: 'wechat: r2', language: 'zh' },
      { id: 1, createdAt: '2026-10-09T12:00:00.000Z', ...entry() },
    ]);
  });

  test('never gets an id that another had, even after the operator deleted the newest', () => {
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

  test('once the database is larger than the limit', () => {
    const feedback = store({ ...DEFAULT_FEEDBACK_LIMITS, maxBytes: 64 * 1024 });
    expect(feedback.full()).toBeNull();
    for (let i = 0; i < 20; i += 1) feedback.add(entry({ text: 'x'.repeat(4000) }));
    expect(feedback.full()).toBe('size');
  });

  test('by default after 10,000 or 50 MB', () => {
    expect(DEFAULT_FEEDBACK_LIMITS).toMatchObject({ maxEntries: 10_000, maxBytes: 50 * 2 ** 20 });
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
