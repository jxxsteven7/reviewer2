import { RECORDS_NOTICE_VERSION, usernameKey } from '@reviewer2/shared';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AccountStore } from './accounts';
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
  accountId: null,
  linkProfile: false,
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
      adoptedAt: null,
      summaryZh: null,
      summaryEn: null,
      status: 'new',
      username: null,
      nameTakenBy: null,
    };
    expect(feedback.latest(10)).toEqual([
      { id: 2, createdAt: '2026-10-09T12:01:00.000Z', ...bug, contact: 'wechat: r2', language: 'zh', ...alone },
      { id: 1, createdAt: '2026-10-09T12:00:00.000Z', ...entry(), ...alone },
    ]);
    expect(feedback.byId(1)).toEqual({ id: 1, createdAt: '2026-10-09T12:00:00.000Z', ...entry(), ...alone });
    expect(feedback.byId(3)).toBeUndefined();
  });

  test('is signed with the account it came from, which keeps no name, or anonymous, and only a guest leaves a name', () => {
    const feedback = store();
    const ann = new AccountStore(db).create('Ann', 'ann', 'h', RECORDS_NOTICE_VERSION);
    if (!ann) throw new Error('no account');
    // Signed with the account: the name that came along isn't kept, as the account's is looked up.
    feedback.add(entry({ credit: 'Ann L', accountId: ann.id, linkProfile: true }));
    // Logged in without signing: anonymous, counted for the account.
    feedback.add(entry({ accountId: ann.id }));
    // A guest's name of their own, which links to no account whatever the page asked.
    feedback.add(entry({ credit: 'Ann L', linkProfile: true }));
    // A name of its own from an account, as a page from before signing sent it, signs with the
    // account all the same.
    feedback.add(entry({ credit: 'Annie', accountId: ann.id }));
    expect(feedback.byId(1)).toMatchObject({ credit: null, accountId: 1, linkProfile: true, username: 'Ann' });
    expect(feedback.byId(2)).toMatchObject({ credit: null, accountId: 1, linkProfile: false, username: 'Ann' });
    expect(feedback.byId(3)).toMatchObject({ credit: 'Ann L', accountId: null, linkProfile: false, username: null });
    expect(feedback.byId(4)).toMatchObject({ credit: null, accountId: 1, linkProfile: true, username: 'Ann' });
    expect(
      db.prepare('SELECT count(*) AS n FROM feedback WHERE account_id IS NOT NULL AND credit IS NOT NULL').get(),
    ).toEqual({ n: 0 });
    feedback.setIssue(1, 42);
    expect(feedback.adopt(1, { zh: '提出了更多领域', en: 'Suggested more fields' })).toBe(true);
    expect(feedback.byId(1)).toMatchObject({
      adoptedAt: '2026-10-09T12:00:00.000Z',
      summaryZh: '提出了更多领域',
      summaryEn: 'Suggested more fields',
      status: 'resolved',
    });
    // Once the account is gone, the feedback is signed by nobody that is left, and names nobody.
    new AccountStore(db).delete(ann.id);
    expect(feedback.byId(1)).toMatchObject({ credit: null, accountId: null, linkProfile: true, username: null });
    expect(feedback.byId(1)?.status).toBe('resolved');
  });

  test("says when a guest's name is an account's username, however the name is written", () => {
    const feedback = store();
    const accounts = new AccountStore(db);
    const cat = accounts.create('Cat', usernameKey('Cat'), 'h', RECORDS_NOTICE_VERSION);
    if (!cat) throw new Error('no account');
    feedback.add(entry({ credit: 'CAT' }));
    feedback.add(entry({ credit: 'cat' }));
    // A name that is nobody's, no name, and Cat's own feedback, signed with the account, which
    // keeps no name to pass for anyone.
    feedback.add(entry({ credit: 'Dan' }));
    feedback.add(entry());
    feedback.add(entry({ accountId: cat.id, linkProfile: true }));
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

  test('says whether its name may link to its profile, and remembers the issue it was published as', () => {
    const feedback = store();
    const ann = new AccountStore(db).create('Ann', 'ann', 'h', RECORDS_NOTICE_VERSION);
    if (!ann) throw new Error('no account');
    feedback.add(entry());
    feedback.add(entry({ accountId: ann.id, linkProfile: true }));
    expect(feedback.latest(10).map(({ id, linkProfile }) => [id, linkProfile])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(() => db.exec('UPDATE feedback SET link_profile = 2 WHERE id = 1')).toThrow(/CHECK constraint/);
    // The link that came with a name, and whether the player agreed to a public issue, are gone.
    const columns = (db.prepare('PRAGMA table_info(feedback)').all() as { name: string }[]).map(({ name }) => name);
    expect(columns).toContain('link_profile');
    expect(columns).not.toContain('link');
    expect(columns).not.toContain('public_issue');
    expect(feedback.setIssue(2, 42)).toBe(true);
    expect(feedback.setIssue(5, 42)).toBe(false);
    expect(feedback.byId(2)).toMatchObject({ issue: 42, text: 'More fields, please.' });
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
  // Feedback adopted by the operator, which lists it among the contributions.
  const SAID = { zh: '提出了更多领域', en: 'Suggested more fields' };
  const adopt = (id: number) => store().adopt(id, SAID);
  // As the operator's adoption would be, had it read the feedback just before it went to the trash
  // (admin.ts): adopt() itself refuses feedback in the trash.
  const adoptedMeanwhile = (id: number) =>
    db.prepare("UPDATE feedback SET adopted_at = '2026-10-09T12:00:00.000Z' WHERE id = ?").run(id);

  test('is its status, the first of the trail that holds, and the trail stays beside it', () => {
    const feedback = store();
    feedback.add(entry());
    expect(feedback.byId(1)?.status).toBe('new');
    expect(feedback.setIssue(1, 42)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({ issue: 42, status: 'issue' });
    now += DAY;
    expect(feedback.resolve(1, 50)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({
      issue: 42,
      resolvedPr: 50,
      resolvedAt: '2026-10-10T12:00:00.000Z',
      // Its pull request recorded but not adopted yet, it still waits as an issue.
      status: 'issue',
    });
    expect(adopt(1)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({
      adoptedAt: '2026-10-10T12:00:00.000Z',
      resolvedPr: 50,
      status: 'resolved',
    });
    now += DAY;
    // Adopted feedback is neither closed, which would say that it wasn't adopted, nor put in the
    // trash; feedback that wasn't adopted can be, closed or not, unless it is an issue.
    expect(feedback.close(1)).toBe(false);
    expect(feedback.delete(1)).toBe(false);
    expect(feedback.byId(1)).toMatchObject({ closedAt: null, deletedAt: null, status: 'resolved' });
    feedback.add(entry());
    expect(feedback.close(2)).toBe(true);
    expect(feedback.byId(2)).toMatchObject({ closedAt: '2026-10-11T12:00:00.000Z', status: 'closed' });
    now += DAY;
    expect(feedback.delete(2)).toBe(true);
    expect(feedback.byId(2)).toMatchObject({ deletedAt: '2026-10-12T12:00:00.000Z', status: 'trash' });
    // Closed feedback, which was set aside, is reopened before it is adopted, and only an issue is.
    feedback.add(entry());
    feedback.setIssue(3, 43);
    feedback.close(3);
    expect(adopt(3)).toBe(false);
    feedback.reopen(3);
    feedback.setIssue(3, null);
    expect(adopt(3)).toBe(false);
    feedback.setIssue(3, 43);
    expect(adopt(3)).toBe(true);
    expect(feedback.byId(3)).toMatchObject({ status: 'resolved', issue: 43 });
    // What the player sent is as it was throughout.
    expect(feedback.byId(1)).toMatchObject({ text: 'More fields, please.', createdAt: '2026-10-09T12:00:00.000Z' });
    expect(feedback.count()).toBe(3);
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

  test('goes to the trash once, unless it was adopted or is an issue, and comes back as it was', () => {
    const feedback = store();
    feedback.add(entry());
    feedback.add(entry({ credit: 'Ann' }));
    feedback.add(entry());
    feedback.resolve(1, 50);
    feedback.close(1);
    expect(feedback.restore(1)).toBe(false);
    expect(feedback.delete(1)).toBe(true);
    expect(feedback.delete(1)).toBe(false);
    expect(feedback.byId(1)).toMatchObject({ resolvedPr: 50, status: 'trash' });
    // Back out of the trash, it is closed, as it was.
    expect(feedback.restore(1)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({ deletedAt: null, resolvedPr: 50, status: 'closed' });
    expect(feedback.restore(1)).toBe(false);
    // Adopted feedback stays: the home page lists it.
    feedback.setIssue(2, 41);
    expect(adopt(2)).toBe(true);
    expect(feedback.delete(2)).toBe(false);
    expect(feedback.byId(2)).toMatchObject({ deletedAt: null, status: 'resolved' });
    // So does feedback that is an issue, which is public, closed or not, until the issue is taken
    // back.
    feedback.setIssue(3, 42);
    expect(feedback.delete(3)).toBe(false);
    feedback.close(3);
    expect(feedback.delete(3)).toBe(false);
    expect(feedback.byId(3)).toMatchObject({ deletedAt: null, issue: 42, status: 'closed' });
    feedback.setIssue(3, null);
    expect(feedback.delete(3)).toBe(true);
    expect(feedback.delete(4)).toBe(false);
    expect(feedback.restore(4)).toBe(false);
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

  test('is never purged once it was adopted or is an issue, even if that came in the trash', () => {
    const feedback = store();
    feedback.add(entry());
    feedback.add(entry());
    feedback.add(entry());
    feedback.delete(1);
    feedback.delete(2);
    feedback.delete(3);
    // An issue in the trash, as `feedback issue` recorded before issues kept feedback out of it.
    feedback.setIssue(3, 42);
    // admin.ts refuses to adopt feedback in the trash, but it reads before it writes, so feedback
    // deleted in between would be adopted all the same.
    expect(adopt(1)).toBe(false);
    adoptedMeanwhile(1);
    now = START + 31 * DAY;
    expect(feedback.purge()).toBe(1);
    expect(feedback.byId(2)).toBeUndefined();
    expect(feedback.byId(1)).toMatchObject({ status: 'trash', adoptedAt: '2026-10-09T12:00:00.000Z' });
    expect(feedback.byId(3)).toMatchObject({ status: 'trash', issue: 42 });
    expect(feedback.daysLeft(feedback.byId(1) as Feedback)).toBe(0);
    expect(feedback.purge()).toBe(0);
    // Its issue taken back, it goes.
    feedback.setIssue(3, null);
    expect(feedback.purge()).toBe(1);
    expect(feedback.byId(3)).toBeUndefined();
    // Restored, it is resolved, as it was.
    expect(feedback.restore(1)).toBe(true);
    expect(feedback.byId(1)).toMatchObject({ status: 'resolved', deletedAt: null });
    expect(feedback.count()).toBe(1);
  });

  test('is read by status, or all of it, and counted by status', () => {
    const feedback = store();
    for (const kind of ['idea', 'bug', 'idea', 'bug', 'idea', 'words', 'bug', 'idea'] as const) {
      feedback.add(entry({ kind }));
    }
    feedback.setIssue(2, 42);
    feedback.resolve(3, 50);
    feedback.setIssue(4, 44);
    adopt(4);
    feedback.close(5);
    feedback.delete(6);
    // Adopted with a pull request recorded; and a pull request recorded, then closed.
    feedback.setIssue(7, 47);
    feedback.resolve(7, 51);
    adopt(7);
    feedback.resolve(8, 52);
    feedback.close(8);
    const ids = (view: FeedbackView) => feedback.latest(10, undefined, view).map(({ id }) => id);
    // All of it, in the trash too, newest first.
    expect(ids('all')).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(ids('new')).toEqual([1]);
    // An issue is published as one, or has a pull request recorded but isn't adopted.
    expect(ids('issue')).toEqual([3, 2]);
    // Resolved is what was adopted, with a pull request recorded or not; closed feedback is closed
    // alone. No view overlaps another.
    expect(ids('resolved')).toEqual([7, 4]);
    expect(ids('closed')).toEqual([8, 5]);
    expect(ids('trash')).toEqual([6]);
    expect(feedback.latest(1, 7, 'resolved').map(({ id }) => id)).toEqual([4]);
    expect(feedback.statuses()).toEqual({ new: 1, issue: 2, resolved: 2, closed: 2, trash: 1 });
  });
});

describe('the feedback contributions', () => {
  const SAID = { zh: '提出了更多领域', en: 'Suggested more fields' };

  // The contributions as the home page lists them are read by ContributionStore
  // (contributions.test.ts); here, what adopting does to the feedback.
  test('are adopted once, as an issue, and never in the trash, and say what the player contributed', () => {
    const feedback = store();
    feedback.add(entry({ credit: 'Ann' }));
    feedback.add(entry());
    expect(feedback.describe(1, SAID)).toBe(false);
    expect(feedback.adopt(1, SAID)).toBe(false);
    feedback.setIssue(1, 41);
    expect(feedback.adopt(1, SAID)).toBe(true);
    // Only once.
    expect(feedback.adopt(1, { zh: '又一次', en: 'Again' })).toBe(false);
    expect(feedback.byId(1)).toMatchObject({
      credit: 'Ann',
      text: 'More fields, please.',
      status: 'resolved',
      adoptedAt: '2026-10-09T12:00:00.000Z',
      summaryZh: SAID.zh,
      summaryEn: SAID.en,
    });
    expect(feedback.describe(1, { zh: '提出了计时器', en: 'Suggested a timer' })).toBe(true);
    expect(feedback.byId(1)).toMatchObject({ summaryZh: '提出了计时器', summaryEn: 'Suggested a timer' });
    expect(feedback.describe(3, SAID)).toBe(false);
    feedback.delete(2);
    expect(feedback.adopt(2, SAID)).toBe(false);
    expect(feedback.byId(2)).toMatchObject({ adoptedAt: null, status: 'trash' });
  });

  test('are counted for the account they came from, by kind, those without a name too', () => {
    const feedback = store();
    const accounts = new AccountStore(db);
    const ann = accounts.create('Ann', 'ann', 'h', RECORDS_NOTICE_VERSION);
    const bob = accounts.create('Bob', 'bob', 'h', RECORDS_NOTICE_VERSION);
    if (!ann || !bob) throw new Error('no account');
    for (const [kind, credit, accountId] of [
      ['bug', 'Ann', ann.id],
      ['idea', null, ann.id],
      ['idea', 'Ann', ann.id],
      ['words', 'Ann', ann.id],
      ['idea', 'Bob', bob.id],
      ['game', 'Ann', ann.id],
    ] as const) {
      feedback.add(entry({ kind, credit, accountId }));
    }
    // Feedback that wasn't adopted counts for nothing.
    for (const id of [1, 2, 3, 4, 5]) {
      feedback.setIssue(id, 40 + id);
      feedback.adopt(id, SAID);
    }
    expect(feedback.counts(ann.id)).toEqual([
      { kind: 'idea', count: 2 },
      { kind: 'bug', count: 1 },
      { kind: 'words', count: 1 },
    ]);
    expect(feedback.counts(bob.id)).toEqual([{ kind: 'idea', count: 1 }]);
    expect(feedback.counts(99)).toEqual([]);
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
    // A Chinese character takes three bytes, so each of these holds 3,123 with its contact, its
    // name and its version.
    const large = entry({
      text: '\u{8bcd}'.repeat(1000),
      contact: 'x'.repeat(100),
      credit: 'y'.repeat(16),
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
    const ann = accounts.create('Ann', 'ann', 'h', RECORDS_NOTICE_VERSION);
    const bob = accounts.create('Bob', 'bob', 'h', RECORDS_NOTICE_VERSION);
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
    const ann = new AccountStore(db).create('Ann', 'ann', 'h', RECORDS_NOTICE_VERSION);
    if (!ann) throw new Error('no account');
    expect(
      feedback.report({ reporterId: ann.id, reportedId: null, reportedName: 'X', roomCode: 'K7QX', text: null }),
    ).toBeNull();
    expect(feedback.reportCount()).toBe(0);
  });
});
