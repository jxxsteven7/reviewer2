import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { usernameKey } from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { jpeg } from '../test/images';
import { addAccounts } from '../test/statistics';
import { AVATAR_DIR, DirectoryAvatars } from './accounts/avatars';
import { Accounts } from './accounts/service';
import { admin, KIND_NAMES, markdown } from './admin';
import type { AcknowledgmentEntry } from './store/acknowledgments';
import { DATABASE_FILE, openDatabase, type Database } from './store/database';
import { FeedbackStore, type NewFeedback } from './store/feedback';

// The operator's commands, on a data directory as the server leaves it.

let dir: string;
let database: Database;
let accounts: Accounts;
let printed: string[];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'reviewer2-admin-'));
  database = await openDatabase(dir);
  accounts = new Accounts({ db: database.db, now: () => 0, avatars: new DirectoryAvatars(join(dir, AVATAR_DIR)) });
  printed = [];
});

afterEach(() => {
  vi.useRealTimers();
  if (database.db.isOpen) database.db.close();
  rmSync(dir, { recursive: true, force: true });
});

const run = (...args: string[]) => admin(args, { DATA_DIR: dir }, (line) => printed.push(line));

function annWithAvatar(): string {
  const ann = accounts.store.create('Ann Lee', 'ann lee', 'hash');
  if (!ann) throw new Error('no account');
  const file = accounts.avatars.save(jpeg(), 'jpeg');
  accounts.store.setAvatar(ann.id, file);
  return file;
}

describe('avatar remove', () => {
  test('takes the avatar down and deletes its file, while the server goes on', () => {
    const file = annWithAvatar();
    expect(run('avatar', 'remove', 'ANN LEE')).toBe(0);
    expect(printed[0]).toBe(
      `Took down /avatars/${file} of Ann Lee. Browsers, and a CDN in front of the site, may keep a copy ` +
        "for up to a year: purge that address from the CDN's cache too.",
    );
    expect(accounts.store.byKey('ann lee')).toMatchObject({ avatar: null, avatarBanned: false });
    expect(existsSync(join(dir, AVATAR_DIR, file))).toBe(false);
    expect(run('avatar', 'remove', 'Ann Lee')).toBe(0);
    expect(printed[1]).toBe('Ann Lee has the default avatar.');
  });

  test('with --ban bars the account from uploading another, until avatar allow', () => {
    annWithAvatar();
    expect(run('avatar', 'remove', 'Ann Lee', '--ban')).toBe(0);
    expect(printed.at(-1)).toBe('Ann Lee may not upload another avatar.');
    expect(accounts.store.byKey('ann lee')?.avatarBanned).toBe(true);
    expect(run('avatar', 'allow', 'Ann Lee')).toBe(0);
    expect(accounts.store.byKey('ann lee')?.avatarBanned).toBe(false);
  });

  test('says so when there is no such account, no DATA_DIR or no such command', () => {
    expect(run('avatar', 'remove', 'Nobody')).toBe(1);
    expect(printed).toEqual(['No account is called Nobody.']);
    expect(admin(['avatar', 'remove', 'Ann'], {}, (line) => printed.push(line))).toBe(1);
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    expect(admin(['avatar', 'remove', 'Ann'], { DATA_DIR: empty }, (line) => printed.push(line))).toBe(1);
    expect(printed.at(-1)).toBe(`There is no database in ${empty}.`);
    expect(readdirSync(empty)).toEqual([]);
    for (const args of [
      [],
      ['avatar'],
      ['avatar', 'delete', 'Ann'],
      ['avatar', 'allow', 'Ann', '--ban'],
      ['avatar', 'remove', 'Ann', '--kind', 'words'],
      ['feedback', 'adopt'],
      ['feedback', 'adopt', '1', '2'],
      ['acknowledgments', 'add', 'Ann', '--kind'],
      ['acknowledgments', 'add', 'Ann', '--kind', 'words', '--ban'],
      ['acknowledgments', 'list', '1'],
      ['acknowledgments', 'link', '1'],
    ]) {
      expect(run(...args), args.join(' ')).toBe(2);
      expect(printed.at(-1)).toMatch(/^usage: /);
    }
  });
});

describe('accounts', () => {
  const DAY = 24 * 60 * 60_000;
  const NOW = Date.UTC(2026, 10, 1, 9);

  test('prints the counts, the days and the usernames, and nothing that identifies a player', () => {
    vi.useFakeTimers({ now: NOW });
    addAccounts(database.db, NOW);
    expect(run('accounts')).toBe(0);
    expect(printed[0]).toBe(
      '3 accounts, 1 active in the last 7 days and 2 in the last 30, by a login used or a game finished',
    );
    expect(printed[2]).toBe('New accounts by day, UTC, last 30 days');
    expect(printed.slice(3, 33)).toHaveLength(30);
    expect(printed[3]).toBe('2026-10-03  0');
    expect(printed[22]).toBe('2026-10-22  1');
    expect(printed[32]).toBe('2026-11-01  1');
    expect(printed.slice(34)).toEqual([
      'Registered  Games  Matches  Username',
      '2026-09-22      1        1  Ann',
      '2026-10-22      0        0  Bob',
      '2026-11-01      0        0  Cy',
    ]);
    expect(printed.join('\n')).not.toMatch(/hash|email|token|@/);
  });

  test('with --json prints the same as JSON', () => {
    vi.useFakeTimers({ now: NOW });
    addAccounts(database.db, NOW);
    expect(run('accounts', '--json')).toBe(0);
    const json = JSON.parse(printed.join('\n'));
    expect(json).toMatchObject({ total: 3, active: { last7Days: 1, last30Days: 2 } });
    expect(json.createdByDay).toHaveLength(30);
    expect(json.createdByDay[0]).toEqual({ day: '2026-10-03', count: 0 });
    expect(json.createdByDay[29]).toEqual({ day: '2026-11-01', count: 1 });
    expect(json.accounts).toEqual([
      { username: 'Ann', createdAt: '2026-09-22T09:00:00.000Z', games: 1, matches: 1 },
      { username: 'Bob', createdAt: '2026-10-22T09:00:00.000Z', games: 0, matches: 0 },
      { username: 'Cy', createdAt: '2026-11-01T09:00:00.000Z', games: 0, matches: 0 },
    ]);
    expect(Object.keys(json.accounts[0])).toEqual(['username', 'createdAt', 'games', 'matches']);
  });

  test('takes no other flag', () => {
    expect(run('accounts', '--all')).toBe(2);
    expect(run('accounts', '--json', 'Ann')).toBe(2);
  });

  test('cuts every count off at the same moment, however long it takes', () => {
    vi.useFakeTimers({ now: NOW });
    addAccounts(database.db, NOW);
    expect(run('accounts', '--json')).toBe(0);
    const steady = printed.splice(0);
    // A clock that moves on by a day at every reading.
    let readings = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => NOW + readings++ * DAY);
    expect(run('accounts', '--json')).toBe(0);
    expect(printed).toEqual(steady);
  });

  test('works on a database that no server has open, and leaves no WAL behind', () => {
    vi.useFakeTimers({ now: NOW });
    addAccounts(database.db, NOW);
    database.db.close();
    expect(readdirSync(dir)).not.toContain(`${DATABASE_FILE}-wal`);
    expect(run('accounts')).toBe(0);
    expect(printed[0]).toMatch(/^3 accounts, /);
    expect(readdirSync(dir).filter((name) => name.startsWith(DATABASE_FILE))).toEqual([DATABASE_FILE]);
  });
});

const feedback = (changes: Partial<NewFeedback> = {}): NewFeedback => ({
  kind: 'idea',
  text: 'A timer, please.',
  contact: null,
  credit: null,
  accountId: null,
  version: 'v1',
  language: 'en',
  page: 'home',
  userAgent: null,
  ...changes,
});

describe('feedback adopt', () => {
  test('thanks the player by the name they left, linked to the account they were logged in to', () => {
    const ann = accounts.store.create('Ann', 'ann', 'hash');
    const store = new FeedbackStore(database.db);
    store.add(feedback({ credit: 'Ann L', accountId: ann?.id }));
    store.add(feedback({ kind: 'words', credit: 'octocat' }));
    store.add(feedback({ kind: 'bug' }));
    expect(run('feedback', 'adopt', '1')).toBe(0);
    expect(printed.at(-1)).toBe(
      'Adopted feedback #1 as acknowledgment #1: Ann L for Ideas and bug reports, linked to the account Ann.',
    );
    expect(run('feedback', 'adopt', '2')).toBe(0);
    expect(printed.at(-1)).toBe(
      'Adopted feedback #2 as acknowledgment #2: octocat for Word lists, linked to no account.',
    );
    expect(accounts.acknowledgments.all()).toEqual([
      expect.objectContaining({ id: 1, name: 'Ann L', kind: 'feedback', feedbackId: 1, accountId: 1, username: 'Ann' }),
      expect.objectContaining({ id: 2, name: 'octocat', kind: 'words', feedbackId: 2, accountId: null }),
    ]);
    expect(accounts.summary(ann as NonNullable<typeof ann>).acknowledgments).toEqual([{ kind: 'feedback', count: 1 }]);
    expect(store.byId(1)?.acknowledgmentId).toBe(1);

    // Only once, only with a name, and only feedback that is there.
    expect(run('feedback', 'adopt', '1')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #1 was adopted already, as acknowledgment #1.');
    expect(run('feedback', 'adopt', '3')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #3 came without a name for the acknowledgments: the player stays anonymous.');
    expect(run('feedback', 'adopt', '4')).toBe(1);
    expect(printed.at(-1)).toBe('There is no feedback #4.');
    expect(run('feedback', 'adopt', 'x')).toBe(1);
    expect(printed.at(-1)).toBe('There is no feedback #x.');
    expect(accounts.acknowledgments.all()).toHaveLength(2);
  });

  test("says when the name is another account's username, which may be someone passing for its owner", () => {
    accounts.store.create('Cat', 'cat', 'hash');
    new FeedbackStore(database.db).add(feedback({ credit: 'CAT' }));
    expect(run('feedback', 'adopt', '1')).toBe(0);
    expect(printed).toEqual([
      'Adopted feedback #1 as acknowledgment #1: CAT for Ideas and bug reports, linked to no account.',
      "CAT is also the username of the account Cat, which didn't send the feedback. If they aren't the same " +
        'person, take it out with: acknowledgments remove 1',
    ]);
  });
});

describe('acknowledgments', () => {
  test('are added by hand, linked and unlinked, listed, and removed', () => {
    accounts.store.create('Bob', 'bob', 'hash');
    expect(run('acknowledgments', 'list')).toBe(0);
    expect(printed.at(-1)).toBe('No acknowledgments yet.');

    expect(run('acknowledgments', 'add', ' Bob  B ', '--kind', 'playtesting', '--account', 'bob')).toBe(0);
    expect(printed.at(-1)).toBe('Added acknowledgment #1: Bob B for Playtesting, linked to the account Bob.');
    expect(run('acknowledgments', 'add', 'Cat', '--kind', 'words')).toBe(0);
    expect(printed.at(-1)).toBe('Added acknowledgment #2: Cat for Word lists, linked to no account.');
    expect(run('acknowledgments', 'add', 'x'.repeat(17), '--kind', 'words')).toBe(1);
    expect(printed.at(-1)).toBe('The name must have 1 to 16 visible characters, as a nickname does.');
    expect(run('acknowledgments', 'add', ' ', '--kind', 'words')).toBe(1);
    expect(printed.at(-1)).toBe('The name must have 1 to 16 visible characters, as a nickname does.');
    expect(run('acknowledgments', 'add', 'Reviewer 2', '--kind', 'words')).toBe(1);
    expect(printed.at(-1)).toBe('Reviewer 2 is a reserved name, which no nickname may be either.');
    expect(run('acknowledgments', 'add', 'Dan', '--kind', 'praise')).toBe(2);
    expect(printed.at(-1)).toBe('--kind must be one of feedback, words, playtesting.');
    expect(run('acknowledgments', 'add', 'Dan', '--kind', 'words', '--account', 'Nobody')).toBe(1);
    expect(printed.at(-1)).toBe('No account is called Nobody.');
    expect(accounts.acknowledgments.all()).toHaveLength(2);

    expect(run('acknowledgments', 'link', '2', 'BOB')).toBe(0);
    expect(printed.at(-1)).toBe('Linked acknowledgment #2, Cat for Word lists, to the account Bob.');
    expect(run('acknowledgments', 'list')).toBe(0);
    expect(printed.at(-1)).toBe(
      [
        `#1  ${new Date().toISOString().slice(0, 10)}  playtesting  -  Bob B  (account Bob)`,
        `#2  ${new Date().toISOString().slice(0, 10)}  words        -  Cat  (account Bob)`,
      ].join('\n'),
    );
    expect(run('acknowledgments', 'unlink', '2')).toBe(0);
    expect(printed.at(-1)).toBe('Unlinked acknowledgment #2, Cat for Word lists, from the account Bob.');
    expect(run('acknowledgments', 'unlink', '2')).toBe(0);
    expect(printed.at(-1)).toBe('acknowledgment #2, Cat for Word lists, was linked to no account.');
    expect(run('acknowledgments', 'link', '3', 'Bob')).toBe(1);
    expect(printed.at(-1)).toBe('There is no acknowledgment #3.');
    expect(run('acknowledgments', 'link', '1', 'Nobody')).toBe(1);
    expect(printed.at(-1)).toBe('No account is called Nobody.');

    expect(run('acknowledgments', 'remove', '1')).toBe(0);
    expect(printed.at(-1)).toBe('Removed acknowledgment #1, Bob B for Playtesting.');
    expect(run('acknowledgments', 'remove', '1')).toBe(1);
    expect(accounts.acknowledgments.list()).toEqual([{ kind: 'words', name: 'Cat', date: expect.any(String) }]);
  });

  test('are listed in columns that line up whatever the names are made of', () => {
    accounts.store.create('\u5f20\u4e09', usernameKey('\u5f20\u4e09'), 'hash');
    const store = new FeedbackStore(database.db);
    for (let id = 1; id <= 11; id += 1) store.add(feedback());
    store.add(feedback({ credit: '\u674e\u56db' }));
    expect(run('feedback', 'adopt', '12')).toBe(0);
    expect(run('acknowledgments', 'add', '\u5f20\u4e09\u4e30', '--kind', 'words', '--account', '\u5f20\u4e09')).toBe(0);
    expect(run('acknowledgments', 'add', 'Bob', '--kind', 'playtesting')).toBe(0);
    expect(run('acknowledgments', 'list')).toBe(0);
    // A terminal shows a Chinese character two columns wide, so the names and the usernames come
    // after the columns.
    const day = new Date().toISOString().slice(0, 10);
    expect(printed.at(-1)?.split('\n')).toEqual([
      `#1  ${day}  feedback     feedback #12  \u674e\u56db`,
      `#2  ${day}  words        -             \u5f20\u4e09\u4e30  (account \u5f20\u4e09)`,
      `#3  ${day}  playtesting  -             Bob`,
    ]);
  });

  test('are listed and written out on a database that no server has open, leaving nothing behind', () => {
    expect(run('acknowledgments', 'add', 'Cat', '--kind', 'words')).toBe(0);
    database.db.close();
    rmSync(join(dir, AVATAR_DIR), { recursive: true });
    expect(run('acknowledgments', 'list')).toBe(0);
    expect(run('acknowledgments', 'markdown')).toBe(0);
    expect(printed.at(-1)).toBe('## Word lists\n\n- Cat, ' + new Date().toISOString().slice(0, 10));
    // They only read: neither the WAL's files nor the avatars' directory are left behind.
    expect(readdirSync(dir).filter((name) => name.startsWith(DATABASE_FILE))).toEqual([DATABASE_FILE]);
    expect(existsSync(join(dir, AVATAR_DIR))).toBe(false);
  });

  test('take a name that begins with --, as a nickname may', () => {
    expect(run('acknowledgments', 'add', '--Ann', '--kind', 'words')).toBe(0);
    expect(printed.at(-1)).toBe('Added acknowledgment #1: --Ann for Word lists, linked to no account.');
  });

  test('call the kinds as the interface does', () => {
    const en = JSON.parse(readFileSync(new URL('../../client/src/locales/en.json', import.meta.url), 'utf8')) as {
      acknowledgments: { kinds: Record<string, string> };
    };
    expect(KIND_NAMES).toEqual(en.acknowledgments.kinds);
  });

  test('are written out as ACKNOWLEDGMENTS.md has them', () => {
    expect(run('acknowledgments', 'markdown')).toBe(0);
    expect(printed.at(-1)).toBe('_No one yet._');
    const entry = (changes: Partial<AcknowledgmentEntry>): AcknowledgmentEntry => ({
      id: 1,
      name: 'Ann L',
      kind: 'feedback',
      creditedAt: '2026-10-10T12:00:00.000Z',
      feedbackId: null,
      accountId: null,
      username: null,
      ...changes,
    });
    expect(
      markdown([
        entry({ kind: 'playtesting', name: 'Bob' }),
        entry({ name: 'Ann L' }),
        entry({ name: 'octocat', creditedAt: '2026-10-12T00:00:00.000Z' }),
      ]),
    ).toBe(
      [
        '## Ideas and bug reports',
        '',
        '- Ann L, 2026-10-10',
        '- octocat, 2026-10-12',
        '',
        '## Playtesting',
        '',
        '- Bob, 2026-10-10',
      ].join('\n'),
    );
  });

  test('are written out as the names they are, not as links, headings or tags', () => {
    const entries = ['[a](http://x.co)', '# Big', '<b>x</b>', '**Ann** _L_', 'Ann-Lee'].map((name, id) => ({
      id,
      name,
      kind: 'words' as const,
      creditedAt: '2026-10-10T12:00:00.000Z',
      feedbackId: null,
      accountId: null,
      username: null,
    }));
    expect(markdown(entries).split('\n').slice(2)).toEqual([
      '- \\[a\\]\\(http\\:\\/\\/x\\.co\\), 2026-10-10',
      '- \\# Big, 2026-10-10',
      '- \\<b\\>x\\<\\/b\\>, 2026-10-10',
      '- \\*\\*Ann\\*\\* \\_L\\_, 2026-10-10',
      '- Ann\\-Lee, 2026-10-10',
    ]);
  });
});
