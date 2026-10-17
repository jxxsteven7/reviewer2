import { RECORDS_NOTICE_VERSION, type ContributionSummary } from '@reviewer2/shared';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AccountStore } from './accounts';
import { ContributionStore, type NewGithubContribution } from './contributions';
import { openDatabase } from './database';
import { FeedbackStore, type NewFeedback } from './feedback';

// The contributions, from the site and from GitHub, as the home page lists them, and the
// contributions from GitHub as the operator keeps them.

const DAY = 24 * 60 * 60_000;
const START = Date.UTC(2026, 9, 9, 12);
const SAID: ContributionSummary = { zh: '提出了更多领域', en: 'Suggested more fields' };

let db: DatabaseSync;
let now: number;

beforeEach(async () => {
  ({ db } = await openDatabase(null));
  now = START;
});

afterEach(() => db.close());

const store = () => new ContributionStore(db, () => now);
const feedbackStore = () => new FeedbackStore(db, () => now);

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

const fromGithub = (changes: Partial<NewGithubContribution> = {}): NewGithubContribution => ({
  ref: { issue: 14 },
  kind: 'code',
  login: 'octocat',
  githubId: 583231,
  named: true,
  summary: SAID,
  ...changes,
});

// A contribution from the site with nothing of an account.
const nobody = { source: 'site', profile: null, avatar: null, deleted: false, summary: SAID, advisory: null };

describe('the contributions', () => {
  test('are the adopted feedback, the latest first, by the account that signed it as it is now, a guest name or anonymous', () => {
    const feedback = feedbackStore();
    const accounts = new AccountStore(db);
    const ann = accounts.create('Ann', 'ann', 'h', RECORDS_NOTICE_VERSION);
    const bob = accounts.create('Bob', 'bob', 'h', RECORDS_NOTICE_VERSION);
    if (!ann || !bob) throw new Error('no account');
    // Ann signed with her account; Bob stayed anonymous, though he shows his contributions on his
    // profile; Cat was a guest who left her name; the fourth left none.
    accounts.setProfile(bob.id, { link: null, bio: null, showRecord: false, showThanks: true });
    feedback.add(entry({ accountId: ann.id, linkProfile: true }));
    feedback.add(entry({ kind: 'bug', accountId: bob.id }));
    feedback.add(entry({ kind: 'words', credit: 'Cat' }));
    feedback.add(entry({ kind: 'game' }));
    feedback.add(entry({ credit: 'Dan' }));
    for (const id of [1, 2, 3, 4]) feedback.setIssue(id, 40 + id);
    expect(store().all()).toEqual([]);
    expect(feedback.adopt(1, SAID)).toBe(true);
    now += 40 * DAY;
    expect(feedback.adopt(2, SAID)).toBe(true);
    expect(feedback.adopt(3, SAID)).toBe(true);
    expect(feedback.adopt(4, SAID)).toBe(true);
    expect(store().all()).toEqual([
      { kind: 'game', name: null, ...nobody, issue: 44, month: '2026-11' },
      { kind: 'words', name: 'Cat', ...nobody, issue: 43, month: '2026-11' },
      { kind: 'bug', name: null, ...nobody, issue: 42, month: '2026-11' },
      { kind: 'idea', name: 'Ann', ...nobody, profile: ann.handle, issue: 41, month: '2026-10' },
    ]);
    // Signed with the account, the contribution shows it as it is now: its username and its avatar.
    accounts.setAvatar(ann.id, 'a1b2.webp');
    accounts.rename(ann.id, 'Annie', 'annie');
    expect(store().all().at(-1)).toMatchObject({
      name: 'Annie',
      profile: ann.handle,
      avatar: '/avatars/a1b2.webp',
      deleted: false,
    });
    // Once Ann's account is gone, it is a deleted player's: no name, no profile, no avatar.
    accounts.delete(ann.id);
    expect(
      store()
        .all()
        .map(({ name, profile, deleted }) => [name, profile, deleted]),
    ).toEqual([
      [null, null, false],
      ['Cat', null, false],
      [null, null, false],
      [null, null, true],
    ]);
    expect(store().all().at(-1)?.avatar).toBeNull();
  });

  test('say what the player contributed once the operator has written it, which can be written again', () => {
    const feedback = feedbackStore();
    feedback.add(entry({ credit: 'Ann' }));
    feedback.add(entry());
    feedback.setIssue(1, 41);
    feedback.adopt(1, SAID);
    expect(feedback.describe(1, { zh: '提出了计时器', en: 'Suggested a timer' })).toBe(true);
    expect(store().all()[0]?.summary).toEqual({ zh: '提出了计时器', en: 'Suggested a timer' });
    // Adopted feedback is an issue (FeedbackStore.adopt() sees to it); a row adopted without one,
    // which only a hand on the database makes, isn't listed, rather than listed without its issue.
    db.exec("UPDATE feedback SET adopted_at = '2026-10-01T00:00:00.000Z' WHERE id = 2");
    expect(store().all()).toHaveLength(1);
    // Adopted before the sentences were written, it says nothing yet.
    db.exec('UPDATE feedback SET issue = 42 WHERE id = 2');
    expect(store().all()[1]).toEqual({
      kind: 'idea',
      source: 'site',
      name: null,
      profile: null,
      avatar: null,
      deleted: false,
      summary: null,
      issue: 42,
      advisory: null,
      month: '2026-10',
    });
  });

  test('leave out a kind that this server does not know, from either place', () => {
    const feedback = feedbackStore();
    feedback.add(entry({ kind: 'later' as NewFeedback['kind'] }));
    feedback.setIssue(1, 41);
    feedback.adopt(1, SAID);
    // The code, which only GitHub is about, is no kind of feedback.
    feedback.add(entry({ kind: 'code' as NewFeedback['kind'] }));
    feedback.setIssue(2, 42);
    feedback.adopt(2, SAID);
    store().adopt(fromGithub({ ref: { issue: 14 }, kind: 'later' as NewGithubContribution['kind'] }));
    store().adopt(fromGithub({ ref: { issue: 15 }, kind: 'code' }));
    expect(
      store()
        .all()
        .map(({ source, issue }) => [source, issue]),
    ).toEqual([['github', 15]]);
  });

  test('list the issues and the advisories adopted from GitHub beside the feedback, by the time each was adopted', () => {
    const feedback = feedbackStore();
    feedback.add(entry({ credit: 'Dan' }));
    feedback.setIssue(1, 41);
    feedback.adopt(1, SAID);
    const contributions = store();
    now += DAY;
    // Named, by the author's GitHub username; anonymous, by nobody; and a security advisory.
    expect(contributions.adopt(fromGithub())).toMatchObject({ issue: 14, kind: 'code', named: true });
    now += DAY;
    expect(
      contributions.adopt(fromGithub({ ref: { issue: 15 }, kind: 'idea', login: 'hubot', githubId: 2, named: false })),
    ).toMatchObject({ issue: 15, login: 'hubot', githubId: 2, named: false });
    now += DAY;
    expect(
      contributions.adopt(
        fromGithub({
          ref: { advisory: 'GHSA-24fc-5gmw-5x4j' },
          kind: 'bug',
          summary: { zh: '报了 bug', en: 'Reported a bug' },
        }),
      ),
    ).toMatchObject({ issue: null, advisory: 'GHSA-24fc-5gmw-5x4j', kind: 'bug' });
    const github = { source: 'github', profile: null, avatar: null, deleted: false };
    expect(contributions.all()).toEqual([
      {
        kind: 'bug',
        name: 'octocat',
        ...github,
        summary: { zh: '报了 bug', en: 'Reported a bug' },
        issue: null,
        advisory: 'GHSA-24fc-5gmw-5x4j',
        month: '2026-10',
      },
      { kind: 'idea', name: null, ...github, summary: SAID, issue: 15, advisory: null, month: '2026-10' },
      { kind: 'code', name: 'octocat', ...github, summary: SAID, issue: 14, advisory: null, month: '2026-10' },
      { kind: 'idea', name: 'Dan', ...nobody, issue: 41, month: '2026-10' },
    ]);
    expect(contributions.list().map(({ issue, advisory, adoptedAt }) => [issue, advisory, adoptedAt])).toEqual([
      [null, 'GHSA-24fc-5gmw-5x4j', '2026-10-12T12:00:00.000Z'],
      [15, null, '2026-10-11T12:00:00.000Z'],
      [14, null, '2026-10-10T12:00:00.000Z'],
    ]);
    expect(contributions.byRef({ issue: 14 })).toEqual({
      issue: 14,
      advisory: null,
      kind: 'code',
      login: 'octocat',
      githubId: 583231,
      named: true,
      adoptedAt: '2026-10-10T12:00:00.000Z',
      summaryZh: SAID.zh,
      summaryEn: SAID.en,
    });
    expect(contributions.byRef({ issue: 16 })).toBeUndefined();
    expect(contributions.byRef({ advisory: 'GHSA-xxxx-xxxx-xxxx' })).toBeUndefined();
  });

  test("adopt an issue or an advisory once, and never an issue that is a player's feedback", () => {
    const feedback = feedbackStore();
    feedback.add(entry({ credit: 'Dan' }));
    feedback.setIssue(1, 41);
    const contributions = store();
    expect(contributions.adopt(fromGithub({ ref: { issue: 41 } }))).toBe('feedback_issue');
    expect(contributions.adopt(fromGithub())).toMatchObject({ issue: 14 });
    expect(contributions.adopt(fromGithub({ kind: 'idea' }))).toBe('adopted_already');
    expect(contributions.adopt(fromGithub({ ref: { advisory: 'GHSA-24fc-5gmw-5x4j' } }))).toMatchObject({
      advisory: 'GHSA-24fc-5gmw-5x4j',
    });
    expect(contributions.adopt(fromGithub({ ref: { advisory: 'GHSA-24fc-5gmw-5x4j' } }))).toBe('adopted_already');
    expect(contributions.list()).toHaveLength(2);
  });

  test('write the sentences again, list the author anonymously or forget them at their request, and delete nothing', () => {
    const contributions = store();
    contributions.adopt(fromGithub());
    const ref = { issue: 14 };
    expect(contributions.describe(ref, { zh: '改了测试', en: 'Fixed the tests' })).toBe(true);
    expect(contributions.describe({ issue: 15 }, SAID)).toBe(false);
    expect(contributions.all()[0]?.summary).toEqual({ zh: '改了测试', en: 'Fixed the tests' });
    // Anonymous: the author stays on record, and the home page names nobody.
    expect(contributions.anonymize(ref)).toBe(true);
    expect(contributions.anonymize(ref)).toBe(false);
    expect(contributions.byRef(ref)).toMatchObject({ login: 'octocat', githubId: 583231, named: false });
    expect(contributions.all()[0]?.name).toBeNull();
    // Forgotten: nothing names them any more.
    expect(contributions.forget(ref)).toBe(true);
    expect(contributions.forget(ref)).toBe(false);
    expect(contributions.byRef(ref)).toMatchObject({ login: null, githubId: null, named: false });
    expect(contributions.forget({ advisory: 'GHSA-24fc-5gmw-5x4j' })).toBe(false);
    expect(contributions.list()).toHaveLength(1);
  });

  test('put what was adopted at the same moment from the site first, and then the latest row of each', () => {
    const feedback = feedbackStore();
    feedback.add(entry({ credit: 'Dan' }));
    feedback.add(entry({ credit: 'Eve' }));
    for (const id of [1, 2]) {
      feedback.setIssue(id, 40 + id);
      feedback.adopt(id, SAID);
    }
    const contributions = store();
    contributions.adopt(fromGithub({ ref: { issue: 14 } }));
    contributions.adopt(fromGithub({ ref: { issue: 15 } }));
    expect(contributions.all().map(({ source, issue }) => [source, issue])).toEqual([
      ['site', 42],
      ['site', 41],
      ['github', 15],
      ['github', 14],
    ]);
  });
});
