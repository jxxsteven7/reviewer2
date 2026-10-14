import { usernameKey, type FeedbackKind } from '@reviewer2/shared';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AccountStore } from './accounts';
import { AcknowledgmentStore } from './acknowledgments';
import { databaseBytes, openDatabase } from './database';
import {
  DEFAULT_FEEDBACK_LIMITS,
  FeedbackStore,
  feedbackLimits,
  type Feedback,
  type FeedbackView,
  type NewFeedback,
} from './feedback';

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
    const alone = {
      issue: null,
      resolvedPr: null,
      resolvedAt: null,
      closedAt: null,
      deletedAt: null,
      status: 'new',
      username: null,
      acknowledgmentId: null,
      nameTakenBy: null,
    };
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
    // Feedback from before players were asked, and from a page that didn't ask.
    db.exec(
      "INSERT INTO feedback (created_at, kind, text, version, language, page) VALUES ('now', 'idea', 'Old', 'v1', 'en', 'home')",
    );
    feedback.add(entry({ publicIssue: null }));
    expect(feedback.latest(10).map(({ publicIssue, issue }) => [publicIssue, issue])).toEqual([
      [null, null],
      [null, null],
      [true, null],
      [false, null],
    ]);
    expect(feedback.setIssue(2, 42)).toBe(true);
    expect(feedback.setIssue(5, 42)).toBe(false);
    expect(feedback.byId(2)).toMatchObject({ publicIssue: true, issue: 42, text: 'More fields, please.' });
    expect(() => feedback.setIssue(2, 0)).toThrow(/CHECK constraint/);
    // The number can be put right, or taken out.
    expect(feedback.setIssue(2, 43)).toBe(true);
    expect(feedback.byId(2)).toMatchObject({ issue: 43, status: 'issue' });
    expect(feedback.setIssue(2, null)).toBe(true);
    expect(feedback.byId(2)).toMatchObject({ issue: null, status: 'new' });
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

  test('is read of one kind, and counted by kind', () => {
    const feedback = store();
    for (const kind of ['game', 'idea', 'game', 'bug', 'game'] as const) feedback.add(entry({ kind }));
    expect(feedback.latest(10, undefined, 'game').map(({ id, kind }) => [id, kind])).toEqual([
      [5, 'game'],
      [3, 'game'],
      [1, 'game'],
    ]);
    expect(feedback.latest(1, 5, 'game').map(({ id }) => id)).toEqual([3]);
    expect(feedback.latest(10, undefined, 'words')).toEqual([]);
    expect(feedback.latest(10).map(({ id }) => id)).toEqual([5, 4, 3, 2, 1]);
    expect(feedback.kinds()).toEqual({ game: 3, idea: 1, bug: 1 });
  });

  test('of a language or a page that does not exist is refused by the database too', () => {
    const feedback = store();
    expect(() => feedback.add(entry({ language: 'fr' as NewFeedback['language'] }))).toThrow(/CHECK constraint/);
    expect(() => feedback.add(entry({ page: 'lobby' as NewFeedback['page'] }))).toThrow(/CHECK constraint/);
    expect(feedback.count()).toBe(0);
  });

  test('of any kind is kept by the database, which leaves the kinds to the code', () => {
    // The server takes only the kinds in shared/src/feedback.ts; one that a later server added is
    // kept, and read back by a server rolled back from it.
    const feedback = store();
    feedback.add(entry({ kind: 'game' }));
    feedback.add(entry({ kind: 'later' as NewFeedback['kind'] }));
    expect(feedback.latest(10).map(({ kind }) => kind)).toEqual(['later', 'game']);
  });
});

describe('what became of the feedback', () => {
  // Feedback adopted by the operator, which thanks its player.
  const adopt = (id: number) =>
    new AcknowledgmentStore(db).add({ name: '', kind: 'feedback', feedbackId: id, accountId: null });

  test('is its status, the first of the trail that holds, and the trail stays beside it', () => {
    const feedback = store();
    feedback.add(entry({ publicIssue: true }));
    expect(feedback.byId(1)?.status).toBe('new');
    expect(feedback.setIssue(1, 42)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({ issue: 42, status: 'issue' });
    now += DAY;
    expect(feedback.resolve(1, 50)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({
      issue: 42,
      resolvedPr: 50,
      resolvedAt: '2026-10-10T12:00:00.000Z',
      status: 'resolved',
    });
    expect(adopt(1)).toBe(1);
    expect(feedback.byId(1)).toMatchObject({ acknowledgmentId: 1, resolvedPr: 50, status: 'thanked' });
    now += DAY;
    expect(feedback.close(1)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({ closedAt: '2026-10-11T12:00:00.000Z', status: 'closed' });
    // Adopted feedback can't go to the trash; feedback that wasn't can, closed or not.
    expect(feedback.delete(1)).toBe(false);
    expect(feedback.byId(1)).toMatchObject({ deletedAt: null, status: 'closed' });
    feedback.add(entry());
    now += DAY;
    expect(feedback.delete(2)).toBe(true);
    expect(feedback.byId(2)).toMatchObject({ deletedAt: '2026-10-12T12:00:00.000Z', status: 'trash' });
    // What the player sent is as it was throughout.
    expect(feedback.byId(1)).toMatchObject({ text: 'More fields, please.', createdAt: '2026-10-09T12:00:00.000Z' });
    expect(feedback.count()).toBe(2);
  });

  test('records the pull request, which can be changed or cleared, with the time of the note', () => {
    const feedback = store();
    feedback.add(entry());
    expect(feedback.resolve(1, 50)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({ resolvedPr: 50, resolvedAt: '2026-10-09T12:00:00.000Z' });
    now += 60_000;
    expect(feedback.resolve(1, 51)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({ resolvedPr: 51, resolvedAt: '2026-10-09T12:01:00.000Z' });
    expect(feedback.resolve(1, null)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({ resolvedPr: null, resolvedAt: null, status: 'new' });
    expect(feedback.resolve(2, 50)).toBe(false);
    expect(() => feedback.resolve(1, 0)).toThrow(/CHECK constraint/);
    // With no issue, or in the trash, all the same.
    expect(feedback.delete(1)).toBe(true);
    expect(feedback.resolve(1, 52)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({ resolvedPr: 52, status: 'trash' });
  });

  test('is closed once and reopened once, and neither while it is in the trash', () => {
    const feedback = store();
    feedback.add(entry());
    expect(feedback.reopen(1)).toBe(false);
    expect(feedback.close(1)).toBe(true);
    const closedAt = feedback.byId(1)?.closedAt;
    now += DAY;
    // Closing again doesn't move the time.
    expect(feedback.close(1)).toBe(false);
    expect(feedback.byId(1)).toMatchObject({ closedAt, status: 'closed' });
    expect(feedback.reopen(1)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({ closedAt: null, status: 'new' });
    expect(feedback.close(1)).toBe(true);
    expect(feedback.delete(1)).toBe(true);
    expect(feedback.reopen(1)).toBe(false);
    expect(feedback.close(1)).toBe(false);
    expect(feedback.byId(1)).toMatchObject({ status: 'trash' });
    expect(feedback.close(2)).toBe(false);
    expect(feedback.reopen(2)).toBe(false);
  });

  test('goes to the trash once, unless it was adopted, and comes back as it was', () => {
    const feedback = store();
    feedback.add(entry({ publicIssue: true }));
    feedback.add(entry({ credit: 'Ann' }));
    feedback.setIssue(1, 42);
    feedback.close(1);
    expect(feedback.restore(1)).toBe(false);
    expect(feedback.delete(1)).toBe(true);
    expect(feedback.delete(1)).toBe(false);
    expect(feedback.byId(1)).toMatchObject({ issue: 42, status: 'trash' });
    // Back out of the trash, it is closed, as it was.
    expect(feedback.restore(1)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({ deletedAt: null, issue: 42, status: 'closed' });
    expect(feedback.restore(1)).toBe(false);
    // The acknowledgment points at the feedback it came from, so that feedback stays.
    expect(adopt(2)).toBe(1);
    expect(feedback.delete(2)).toBe(false);
    expect(feedback.byId(2)).toMatchObject({ deletedAt: null, status: 'thanked' });
    expect(feedback.delete(3)).toBe(false);
    expect(feedback.restore(3)).toBe(false);
  });

  test('is purged 30 days after it went to the trash, and nothing else ever is', () => {
    const feedback = store();
    for (let i = 0; i < 4; i += 1) feedback.add(entry({ text: `Number ${i + 1}` }));
    feedback.delete(1);
    feedback.close(2);
    now += DAY;
    feedback.delete(3);
    expect(feedback.daysLeft(feedback.byId(1) as Feedback)).toBe(29);
    expect(feedback.daysLeft(feedback.byId(3) as Feedback)).toBe(30);
    expect(feedback.daysLeft(feedback.byId(2) as Feedback)).toBeNull();

    now = START + 30 * DAY - 1;
    expect(feedback.daysLeft(feedback.byId(1) as Feedback)).toBe(1);
    expect(feedback.purge()).toBe(0);
    now = START + 30 * DAY + 1;
    expect(feedback.daysLeft(feedback.byId(1) as Feedback)).toBe(0);
    expect(feedback.purge()).toBe(1);
    expect(feedback.byId(1)).toBeUndefined();
    expect(feedback.latest(10).map(({ id, status }) => [id, status])).toEqual([
      [4, 'new'],
      [3, 'trash'],
      [2, 'closed'],
    ]);
    expect(feedback.count()).toBe(3);
    // Restored in time, it stays; purging twice purges nothing more.
    expect(feedback.restore(3)).toBe(true);
    expect(feedback.purge()).toBe(0);
    now += DAY;
    expect(feedback.purge()).toBe(0);
    expect(feedback.count()).toBe(3);
    // An id that was purged is never given out again.
    expect(feedback.add(entry())).toBe(5);
    expect(DEFAULT_FEEDBACK_LIMITS.trashMs).toBe(30 * DAY);
  });

  test('is never purged while an acknowledgment points at it, even if it was adopted in the trash', () => {
    const feedback = store();
    feedback.add(entry());
    feedback.add(entry());
    feedback.delete(1);
    feedback.delete(2);
    // admin.ts refuses to adopt feedback in the trash, but it reads before it writes, so feedback
    // deleted in between would be adopted all the same.
    expect(adopt(1)).toBe(1);
    now = START + 31 * DAY;
    expect(feedback.purge()).toBe(1);
    expect(feedback.byId(2)).toBeUndefined();
    expect(feedback.byId(1)).toMatchObject({ status: 'trash', acknowledgmentId: 1 });
    expect(feedback.daysLeft(feedback.byId(1) as Feedback)).toBe(0);
    expect(feedback.purge()).toBe(0);
    // Restored, it is thanked, as it was.
    expect(feedback.restore(1)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({ status: 'thanked', deletedAt: null });
    expect(feedback.count()).toBe(1);
  });

  test('is read by view, and counted by status and by kind within a view', () => {
    const feedback = store();
    for (const kind of ['idea', 'bug', 'idea', 'bug', 'idea', 'words', 'bug', 'idea'] as const) {
      feedback.add(entry({ kind, publicIssue: true }));
    }
    feedback.setIssue(2, 42);
    feedback.resolve(3, 50);
    adopt(4);
    feedback.close(5);
    feedback.delete(6);
    // Resolved by a pull request and thanked, both; and resolved, then closed.
    feedback.resolve(7, 51);
    adopt(7);
    feedback.resolve(8, 52);
    feedback.close(8);
    const ids = (view: FeedbackView, kind: FeedbackKind | null = null) =>
      feedback.latest(10, undefined, kind, view).map(({ id }) => id);
    expect(ids('all')).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    // Open is what still waits: new, or published as an issue.
    expect(ids('open')).toEqual([2, 1]);
    expect(ids('new')).toEqual([1]);
    expect(ids('issue')).toEqual([2]);
    // Resolved and thanked go by the facts, and overlap; closed feedback is closed alone.
    expect(ids('resolved')).toEqual([7, 3]);
    expect(ids('thanked')).toEqual([7, 4]);
    expect(ids('closed')).toEqual([8, 5]);
    expect(ids('trash')).toEqual([6]);
    expect(ids('open', 'idea')).toEqual([1]);
    expect(ids('open', 'bug')).toEqual([2]);
    expect(ids('resolved', 'bug')).toEqual([7]);
    expect(ids('trash', 'idea')).toEqual([]);
    expect(feedback.latest(1, 7, 'bug', 'thanked').map(({ id }) => id)).toEqual([4]);
    expect(feedback.statuses()).toEqual({ new: 1, issue: 1, resolved: 2, thanked: 2, closed: 2, trash: 1 });
    expect(feedback.statuses('idea')).toEqual({ new: 1, issue: 0, resolved: 1, thanked: 0, closed: 2, trash: 0 });
    expect(feedback.statuses('game')).toEqual({ new: 0, issue: 0, resolved: 0, thanked: 0, closed: 0, trash: 0 });
    expect(feedback.kinds()).toEqual({ idea: 4, bug: 3, words: 1 });
    expect(feedback.kinds('open')).toEqual({ idea: 1, bug: 1 });
    expect(feedback.kinds('resolved')).toEqual({ idea: 1, bug: 1 });
    expect(feedback.kinds('trash')).toEqual({ words: 1 });
    expect(feedback.kinds('new')).toEqual({ idea: 1 });
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
    // The limit is set above what the schema takes, so that the test holds as the schema grows.
    const feedback = store({ ...DEFAULT_FEEDBACK_LIMITS, maxDatabaseBytes: databaseBytes(db) + 256 * 1024 });
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

  test('later when MAX_FEEDBACK is raised, with room for the feedback that grows with it', () => {
    expect(feedbackLimits(10_000)).toEqual(DEFAULT_FEEDBACK_LIMITS);
    expect(feedbackLimits(30_000)).toEqual({ ...DEFAULT_FEEDBACK_LIMITS, maxEntries: 30_000, maxBytes: 150 * 2 ** 20 });
    expect(feedbackLimits(1)).toMatchObject({ maxEntries: 1, maxBytes: 5243, maxDatabaseBytes: 2 ** 30 });
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

describe('a report', () => {
  test('is kept with who reported whom, read back newest first, and stays when an account goes', () => {
    const feedback = store();
    const accounts = new AccountStore(db);
    const ann = accounts.create('Ann', 'ann', 'h');
    const bob = accounts.create('Bob', 'bob', 'h');
    if (!ann || !bob) throw new Error('no account');
    expect(
      feedback.report({ reporterId: ann.id, reportedId: bob.id, reportedName: 'Bob', roomCode: 'K7QX', text: 'Rude' }),
    ).toBe(1);
    now += 60_000;
    expect(
      feedback.report({ reporterId: bob.id, reportedId: null, reportedName: 'Guest', roomCode: 'K7QX', text: null }),
    ).toBe(2);
    expect(feedback.reportCount()).toBe(2);
    accounts.setPublicBarred(bob.id, true);
    expect(feedback.reports(10)).toEqual([
      {
        id: 2,
        createdAt: '2026-10-09T12:01:00.000Z',
        reporter: 'Bob',
        reported: null,
        reportedId: null,
        reportedBarred: false,
        reportedName: 'Guest',
        roomCode: 'K7QX',
        text: null,
      },
      {
        id: 1,
        createdAt: '2026-10-09T12:00:00.000Z',
        reporter: 'Ann',
        reported: 'Bob',
        reportedId: 2,
        reportedBarred: true,
        reportedName: 'Bob',
        roomCode: 'K7QX',
        text: 'Rude',
      },
    ]);
    expect(feedback.reports(10, 2).map(({ id }) => id)).toEqual([1]);
    accounts.delete(bob.id);
    expect(feedback.reports(10)).toMatchObject([
      { id: 2, reporter: null },
      { id: 1, reported: null, reportedId: null, reportedBarred: false, reportedName: 'Bob' },
    ]);
    // Reports count for nothing against the limits of feedback.
    expect(feedback.full()).toBeNull();
  });

  test('is refused when the database is too large', () => {
    const feedback = store({ ...DEFAULT_FEEDBACK_LIMITS, maxDatabaseBytes: 1 });
    const ann = new AccountStore(db).create('Ann', 'ann', 'h');
    if (!ann) throw new Error('no account');
    expect(
      feedback.report({ reporterId: ann.id, reportedId: null, reportedName: 'X', roomCode: 'K7QX', text: null }),
    ).toBeNull();
    expect(feedback.reportCount()).toBe(0);
  });
});
