import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RECORDS_NOTICE_VERSION } from '@reviewer2/shared';
import { jpeg } from '../test/images';
import { addAccounts } from '../test/statistics';
import { AVATAR_DIR, DirectoryAvatars } from './accounts/avatars';
import { Accounts } from './accounts/service';
import { admin } from './admin';
import { ContentStore } from './store/content';
import { ContributionStore } from './store/contributions';
import { DATABASE_FILE, openDatabase, type Database } from './store/database';
import { FeedbackStore, type NewFeedback } from './store/feedback';
import { ReplayStore } from './store/records';

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
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (database.db.isOpen) database.db.close();
  rmSync(dir, { recursive: true, force: true });
});

const run = (...args: string[]) => admin(args, { DATA_DIR: dir }, (line) => printed.push(line));
// The contributions as the home page lists them.
const contributions = () => new ContributionStore(database.db).all();

function annWithAvatar(): string {
  const ann = accounts.store.create('Ann Lee', 'ann lee', 'hash', RECORDS_NOTICE_VERSION);
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
      ['feedback', 'draft'],
      ['feedback', 'draft', '1', '2'],
      ['feedback', 'draft', '1', '--ban'],
      ['feedback', 'adopt', '1', '--zh'],
      ['feedback', 'adopt', '1', '--zh', 'x', '--en', 'y', '--json'],
      ['feedback', 'describe', '1', '--ban'],
      // The acknowledgments are ACKNOWLEDGMENTS.md alone now, and no command thanks anyone by hand.
      ['acknowledgments', 'add', 'Ann', '--kind', 'words', '--no-account'],
      ['acknowledgments', 'list'],
      ['feedback', 'issue', '1'],
      ['feedback', 'issue', '1', '2', '--clear'],
      ['feedback', 'resolve', '1'],
      ['feedback', 'close'],
      ['feedback', 'reopen', '1', '2'],
      ['feedback', 'delete'],
      ['feedback', 'restore', '1', '--ban'],
      ['feedback', 'trash', '1'],
      ['feedback', 'purge'],
      // What a player sent, and the adoption, are an archive, which no command changes.
      ['feedback', 'unadopt', '1'],
      ['feedback', 'edit', '1'],
    ]) {
      expect(run(...args), args.join(' ')).toBe(2);
      expect(printed.at(-1)).toMatch(/^usage: /);
    }
  });
});

describe('profile clear', () => {
  function annWithProfile() {
    const ann = accounts.store.create('Ann Lee', 'ann lee', 'hash', RECORDS_NOTICE_VERSION);
    if (!ann) throw new Error('no account');
    accounts.store.setProfile(ann.id, { link: 'https://ann.example/', bio: 'Hi', showRecord: true, showThanks: false });
    return ann;
  }

  test('clears the link and the bio, and leaves what the owner shows', () => {
    annWithProfile();
    expect(run('profile', 'clear', 'ANN LEE')).toBe(0);
    expect(printed).toEqual(['Cleared the link and the bio on the profile of Ann Lee.']);
    expect(accounts.store.byKey('ann lee')).toMatchObject({
      profile: { link: null, bio: null, showRecord: true, showThanks: false },
      profileBanned: false,
    });
    expect(run('profile', 'clear', 'Ann Lee')).toBe(0);
    expect(printed[1]).toBe('Ann Lee has no link or bio on their profile.');
  });

  test('with --ban bars the account from writing them again, until profile allow', () => {
    annWithProfile();
    expect(run('profile', 'clear', 'Ann Lee', '--ban')).toBe(0);
    expect(printed.at(-1)).toBe('Ann Lee may not write a link or a bio again.');
    expect(accounts.store.byKey('ann lee')?.profileBanned).toBe(true);
    expect(run('profile', 'allow', 'Ann Lee')).toBe(0);
    expect(printed.at(-1)).toBe('Ann Lee may write a link and a bio again.');
    expect(accounts.store.byKey('ann lee')?.profileBanned).toBe(false);
  });

  test('says so when there is no such account', () => {
    expect(run('profile', 'clear', 'Nobody')).toBe(1);
    expect(printed).toEqual(['No account is called Nobody.']);
    expect(run('profile', 'list', 'Ann')).toBe(2);
  });
});

describe('profile list', () => {
  test('lists every profile with a link or a bio, oldest first, and says when there is none', () => {
    expect(run('profile', 'list')).toBe(0);
    expect(printed).toEqual(['No profile has a link or a bio.']);
    printed.length = 0;
    const ann = accounts.store.create('Ann', 'ann', 'hash', RECORDS_NOTICE_VERSION);
    const bob = accounts.store.create('Bob', 'bob', 'hash', RECORDS_NOTICE_VERSION);
    accounts.store.create('Cy', 'cy', 'hash', RECORDS_NOTICE_VERSION);
    if (!ann || !bob) throw new Error('no account');
    accounts.store.setProfile(ann.id, {
      link: 'https://ann.example/',
      bio: null,
      showRecord: false,
      showThanks: false,
    });
    accounts.store.setProfile(bob.id, { link: null, bio: 'Bob here', showRecord: false, showThanks: false });
    expect(run('profile', 'list')).toBe(0);
    expect(printed).toEqual([
      '2 profiles with a link or a bio:',
      '#1  Ann',
      '    link: https://ann.example/',
      '#2  Bob',
      '    bio: Bob here',
    ]);
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
      'Id  Registered  Games  Matches  Username',
      '#1  2026-09-22      1        1  Ann',
      '#2  2026-10-22      0        0  Bob',
      '#3  2026-11-01      0        0  Cy',
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
      { id: 1, username: 'Ann', createdAt: '2026-09-22T09:00:00.000Z', games: 1, matches: 1, barred: false },
      { id: 2, username: 'Bob', createdAt: '2026-10-22T09:00:00.000Z', games: 0, matches: 0, barred: false },
      { id: 3, username: 'Cy', createdAt: '2026-11-01T09:00:00.000Z', games: 0, matches: 0, barred: false },
    ]);
    expect(Object.keys(json.accounts[0])).toEqual(['id', 'username', 'createdAt', 'games', 'matches', 'barred']);
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
  linkProfile: false,
  version: 'v1',
  language: 'en',
  page: 'home',
  userAgent: null,
  ...changes,
});

describe('accounts bar', () => {
  test('keeps an account out of public rooms, until accounts unbar', () => {
    accounts.store.create('Ann Lee', 'ann lee', 'hash', RECORDS_NOTICE_VERSION);
    expect(run('accounts', 'bar', 'ANN LEE')).toBe(0);
    expect(printed).toEqual(['Ann Lee may not create or join public rooms. Private rooms are still open to them.']);
    expect(accounts.store.byKey('ann lee')).toMatchObject({ publicBarred: true });
    expect(run('accounts')).toBe(0);
    expect(printed.at(-1)).toMatch(/ {2}Ann Lee {2}\(barred from public rooms\)$/);
    expect(run('accounts', 'unbar', 'Ann Lee')).toBe(0);
    expect(printed.at(-1)).toBe('Ann Lee may create and join public rooms again.');
    expect(accounts.store.byKey('ann lee')).toMatchObject({ publicBarred: false });
    expect(run('accounts', 'bar', 'Bob')).toBe(1);
    expect(printed.at(-1)).toBe('No account is called Bob.');
    expect(run('accounts', 'bar')).toBe(2);
  });
});

describe('agents', () => {
  test('let an account invite AI players, until agents deny, and list those that may', () => {
    accounts.store.create('Ann Lee', 'ann lee', 'hash', RECORDS_NOTICE_VERSION);
    expect(run('agents', 'list')).toBe(0);
    expect(printed).toEqual(['No account may invite AI players.']);
    expect(run('agents', 'allow', 'ANN LEE')).toBe(0);
    expect(printed.at(-1)).toBe('Ann Lee may invite AI players to the private rooms they chair.');
    expect(accounts.store.byKey('ann lee')).toMatchObject({ agents: true });
    expect(run('agents', 'list')).toBe(0);
    expect(printed.at(-1)).toMatch(/^\d+\tAnn Lee$/);
    expect(run('agents', 'deny', 'Ann Lee')).toBe(0);
    expect(printed.at(-1)).toBe('Ann Lee may not invite AI players any more. Those in their rooms now stay.');
    expect(accounts.store.byKey('ann lee')).toMatchObject({ agents: false });
    expect(run('agents', 'allow', 'Bob')).toBe(1);
    expect(printed.at(-1)).toBe('No account is called Bob.');
    expect(run('agents', 'allow')).toBe(2);
  });
});

describe('reports list', () => {
  test('prints the latest reports, with whom they name and the note on one line', () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9) });
    const ann = accounts.store.create('Ann', 'ann', 'hash', RECORDS_NOTICE_VERSION);
    const bob = accounts.store.create('Bob', 'bob', 'hash', RECORDS_NOTICE_VERSION);
    if (!ann || !bob) throw new Error('no account');
    expect(run('reports', 'list')).toBe(0);
    expect(printed).toEqual(['No reports yet.']);
    const store = new FeedbackStore(database.db);
    store.report({
      reporterId: ann.id,
      reportedId: bob.id,
      reportedName: 'Bob',
      roomCode: 'K7QX',
      text: 'Rude\nclues',
    });
    printed = [];
    expect(run('reports', 'list')).toBe(0);
    expect(printed).toEqual(['1 report:', '#1  2026-11-01  Ann reported Bob (account Bob) in R2-K7QX: Rude / clues']);
    store.report({ reporterId: bob.id, reportedId: null, reportedName: 'Guest 3', roomCode: 'K7QX', text: null });
    // A report of Ann, whose account goes: the name it keeps may be someone else's by now.
    store.report({ reporterId: bob.id, reportedId: ann.id, reportedName: 'Ann', roomCode: 'K7QX', text: null });
    accounts.store.setPublicBarred(bob.id, true);
    accounts.store.delete(ann.id);
    printed = [];
    expect(run('reports', 'list')).toBe(0);
    expect(printed).toEqual([
      '3 reports in all, the latest 3 first:',
      '#3  2026-11-01  Bob reported Ann (deleted account) in R2-K7QX',
      '#2  2026-11-01  Bob reported Guest 3 in R2-K7QX',
      '#1  2026-11-01  (deleted account) reported Bob (account Bob, barred) in R2-K7QX: Rude / clues',
    ]);
  });
});

// What a player contributed, as --zh and --en say it, which `feedback adopt` and `feedback describe`
// take.
const ZH = '提出了计时器';
const EN = 'Suggested a timer';
const SAID = ['--zh', ZH, '--en', EN];
const adopt = (id: string, ...said: string[]) => run('feedback', 'adopt', id, ...(said.length > 0 ? said : SAID));

describe('feedback list', () => {
  const NOW = Date.UTC(2026, 10, 1, 9);
  const AGENT = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0.0.0';

  // Feedback of every status, from every kind of sender: anonymous, with a contact; signed with
  // Ann's account, a bug, published; a guest's name that is Bob's username, resolved by a pull
  // request alone; anonymous from Ann's account, adopted; a guest's name, closed; in the trash; and
  // signed with an account since deleted, adopted with a pull request.
  function sent(): FeedbackStore {
    vi.useFakeTimers({ now: NOW });
    const ann = accounts.store.create('Ann', 'ann', 'hash', RECORDS_NOTICE_VERSION);
    const bob = accounts.store.create('Bob', 'bob', 'hash', RECORDS_NOTICE_VERSION);
    const dan = accounts.store.create('Dan', 'dan', 'hash', RECORDS_NOTICE_VERSION);
    if (!ann || !bob || !dan) throw new Error('no account');
    const store = new FeedbackStore(database.db);
    store.add(feedback({ contact: 'ann@example.com' }));
    store.add(
      feedback({
        kind: 'bug',
        text: 'It froze.\n\nOn the board.',
        contact: 'wechat: ann',
        accountId: ann.id,
        linkProfile: true,
        userAgent: AGENT,
      }),
    );
    store.add(feedback({ credit: 'Bob' }));
    store.add(feedback({ kind: 'words', accountId: ann.id }));
    store.add(feedback({ kind: 'game', credit: 'Cat' }));
    store.add(feedback());
    store.add(feedback({ accountId: dan.id, linkProfile: true }));
    store.setIssue(2, 42);
    store.resolve(3, 50);
    store.setIssue(4, 43);
    store.adopt(4, { zh: ZH, en: EN });
    store.close(5);
    store.delete(6);
    store.setIssue(7, 44);
    store.resolve(7, 51);
    store.adopt(7, { zh: ZH, en: EN });
    accounts.store.delete(dan.id);
    return store;
  }

  const listed = (...args: string[]) => {
    printed = [];
    const code = run('feedback', 'list', ...args);
    return { code, lines: printed };
  };
  const ids = (status: string) =>
    (JSON.parse(listed('--status', status, '--json').lines.join('\n')) as { id: number }[]).map(({ id }) => id);

  test('shows the open feedback unless told otherwise, the newest first', () => {
    sent();
    expect(listed()).toEqual({
      code: 0,
      lines: [
        '1 piece of open feedback:',
        '',
        '#1  2026-11-01 09:00 UTC  Idea  New',
        '    from: anonymous',
        '    contact: ann@example.com',
        '    > A timer, please.',
      ],
    });
  });

  test('shows each piece with its status and trail, who sent it, the contact, the browser and the text', () => {
    sent();
    expect(listed('--status', 'all')).toEqual({
      code: 0,
      lines: [
        '7 pieces of feedback, the newest first:',
        '',
        '#7  2026-11-01 09:00 UTC  Idea  Resolved · PR #51 · issue #44',
        '    published as issue #44 · resolved by PR #51 · adopted 2026-11-01',
        '    from: an account since deleted, which signed it',
        '    contact: (none)',
        '    > A timer, please.',
        '',
        '#6  2026-11-01 09:00 UTC  Idea  Trash',
        '    in the trash since 2026-11-01, 30 days left',
        '    from: anonymous',
        '    contact: (none)',
        '    > A timer, please.',
        '',
        '#5  2026-11-01 09:00 UTC  New game  Closed',
        '    closed 2026-11-01',
        "    from: Cat, a guest's name",
        '    contact: (none)',
        '    > A timer, please.',
        '',
        '#4  2026-11-01 09:00 UTC  Word lists  Resolved · issue #43',
        '    published as issue #43 · adopted 2026-11-01',
        '    from: anonymous, sent from the account Ann',
        '    contact: (none)',
        '    > A timer, please.',
        '',
        '#3  2026-11-01 09:00 UTC  Idea  PR #50',
        '    resolved by PR #50',
        "    from: Bob, a guest's name, also the username of the account Bob, which didn't send it",
        '    contact: (none)',
        '    > A timer, please.',
        '',
        '#2  2026-11-01 09:00 UTC  Bug  Issue #42',
        '    published as issue #42',
        '    from: the account Ann, which signed it',
        '    contact: wechat: ann',
        `    browser: ${AGENT}`,
        '    > It froze.',
        '    >',
        '    > On the board.',
        '',
        '#1  2026-11-01 09:00 UTC  Idea  New',
        '    from: anonymous',
        '    contact: ann@example.com',
        '    > A timer, please.',
      ],
    });
  });

  test('shows each view as the store files the feedback, none overlapping another but all', () => {
    sent();
    expect(ids('all')).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(ids('open')).toEqual([1]);
    expect(ids('issue')).toEqual([3, 2]);
    expect(ids('resolved')).toEqual([7, 4]);
    expect(ids('closed')).toEqual([5]);
    expect(ids('trash')).toEqual([6]);
    expect(listed('--status', 'issue').lines[0]).toBe(
      '2 pieces of issued feedback, waiting to be adopted, the newest first:',
    );
    expect(listed('--status', 'resolved').lines[0]).toBe('2 pieces of resolved feedback, the newest first:');
    expect(listed('--status', 'closed').lines[0]).toBe('1 piece of closed feedback:');
    expect(listed('--status', 'trash').lines[0]).toBe('1 piece of feedback in the trash:');
  });

  test('names the game that feedback sent from the end of one is about', () => {
    vi.useFakeTimers({ now: NOW });
    database.db.exec(
      'INSERT INTO replays (game_id, game, ended_at, log, ending, started_at, accounts, guests, agents, takeover, in_match, ' +
        "practice, language, fields, version, words) VALUES ('g7', 'impostor', 'now', " +
        `'{"v":2,"game":"impostor","gameId":"g7","start":null,"entries":[]}', 'finished', 'now', 0, 1, 0, 0, 0, 0, 'en', '[]', 'v', 'w')`,
    );
    new FeedbackStore(database.db).add(feedback({ game: 'impostor', gameId: 'g7' }));
    expect(listed().lines.slice(2)).toEqual([
      '#1  2026-11-01 09:00 UTC  Idea  New',
      '    from: anonymous',
      '    contact: (none)',
      '    game: impostor g7',
      '    > A timer, please.',
    ]);
    expect(JSON.parse(listed('--json').lines.join('\n'))).toMatchObject([{ game: 'impostor', gameId: 'g7' }]);
  });

  test('gives scripts the same as JSON', () => {
    sent();
    const entries = JSON.parse(listed('--status', 'all', '--json').lines.join('\n'));
    expect(entries).toHaveLength(7);
    const same = { createdAt: '2026-11-01T09:00:00.000Z', text: 'A timer, please.', userAgent: null };
    expect(entries.find(({ id }: { id: number }) => id === 2)).toEqual({
      id: 2,
      createdAt: '2026-11-01T09:00:00.000Z',
      kind: 'bug',
      status: 'issue',
      issue: 42,
      resolvedPr: null,
      adoptedAt: null,
      closedAt: null,
      deletedAt: null,
      daysLeft: null,
      linkProfile: true,
      username: 'Ann',
      credit: null,
      nameTakenBy: null,
      contact: 'wechat: ann',
      text: 'It froze.\n\nOn the board.',
      userAgent: AGENT,
      game: null,
      gameId: null,
    });
    expect(entries.find(({ id }: { id: number }) => id === 6)).toEqual({
      id: 6,
      kind: 'idea',
      status: 'trash',
      issue: null,
      resolvedPr: null,
      adoptedAt: null,
      closedAt: null,
      deletedAt: '2026-11-01T09:00:00.000Z',
      daysLeft: 30,
      linkProfile: false,
      username: null,
      credit: null,
      nameTakenBy: null,
      contact: null,
      game: null,
      gameId: null,
      ...same,
    });
    expect(entries.find(({ id }: { id: number }) => id === 3)).toMatchObject({
      status: 'issue',
      resolvedPr: 50,
      credit: 'Bob',
      nameTakenBy: 'Bob',
      username: null,
    });
    expect(entries.find(({ id }: { id: number }) => id === 7)).toMatchObject({
      status: 'resolved',
      adoptedAt: '2026-11-01T09:00:00.000Z',
      linkProfile: true,
      username: null,
    });
  });

  test('shows feedback kept in the trash as kept, with no days left', () => {
    const store = sent();
    // As `feedback adopt` would have, had it read the feedback just before it went to the trash.
    database.db.exec(`UPDATE feedback SET deleted_at = '${new Date(NOW).toISOString()}' WHERE id = 4`);
    expect(store.byId(4)?.status).toBe('trash');
    expect(listed('--status', 'trash').lines.slice(0, 4)).toEqual([
      '2 pieces of feedback in the trash, the newest first:',
      '',
      '#6  2026-11-01 09:00 UTC  Idea  Trash',
      '    in the trash since 2026-11-01, 30 days left',
    ]);
    expect(listed('--status', 'trash').lines).toContain(
      '    published as issue #43 · adopted 2026-11-01 · in the trash since 2026-11-01, kept: adopted',
    );
    expect(JSON.parse(listed('--status', 'trash', '--json').lines.join('\n'))[1]).toMatchObject({
      id: 4,
      daysLeft: null,
    });
  });

  test('writes out what a terminal would obey in the browser of a bug, which came as it was sent', () => {
    vi.useFakeTimers({ now: NOW });
    // Node reads a header's bytes of 0x80 to 0x9f as the C1 controls they are, which a terminal
    // obeys as it does an escape: here one clears the screen and one sets the title. Then a
    // direction override, and a language tag, which is beyond the first plane. Last, the text
    // `\u{9b}` itself, a backslash and all, which must not pass for the character.
    const agent = 'Mozilla/5.0\u009b2J\u009d0;a title\u009c\u202esdrawkcab\u{e0001} \\u{9b}';
    new FeedbackStore(database.db).add(feedback({ kind: 'bug', userAgent: agent }));
    const text = listed();
    expect(text.lines).toContain(
      '    browser: Mozilla/5.0\\u{9b}2J\\u{9d}0;a title\\u{9c}\\u{202e}sdrawkcab\\u{e0001} \\\\u{9b}',
    );
    const json = listed('--json').lines.join('\n');
    expect(json).toContain(
      '"userAgent": "Mozilla/5.0\\u009b2J\\u009d0;a title\\u009c\\u202esdrawkcab\\udb40\\udc01 \\\\u{9b}"',
    );
    expect(JSON.parse(json)[0].userAgent).toBe(agent);
    for (const line of [...text.lines, ...json.split('\n')]) expect(line).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  });

  test('says when there is none, and refuses a status that it has no view of', () => {
    expect(listed()).toEqual({ code: 0, lines: ['No open feedback.'] });
    expect(listed('--status', 'all')).toEqual({ code: 0, lines: ['No feedback.'] });
    expect(listed('--status', 'trash')).toEqual({ code: 0, lines: ['No feedback in the trash.'] });
    expect(listed('--json')).toEqual({ code: 0, lines: ['[]'] });
    // The store calls the open feedback new, but the view is open.
    for (const status of ['new', 'Open', 'thanked', '']) {
      expect(listed('--status', status), status).toEqual({
        code: 1,
        lines: [`${status} is not a status to list: one of all, open, issue, resolved, closed, trash.`],
      });
    }
    for (const args of [['--status'], ['1'], ['--ban']]) {
      expect(listed(...args).code, args.join(' ')).toBe(2);
      expect(printed.at(-1)).toMatch(/^usage: /);
    }
  });

  test('only reads, on a database that no server has open, and leaves no WAL behind', () => {
    new FeedbackStore(database.db).add(feedback());
    database.db.close();
    expect(listed().code).toBe(0);
    expect(readdirSync(dir).filter((name) => name.startsWith(DATABASE_FILE))).toEqual([DATABASE_FILE]);
  });
});

describe('feedback adopt', () => {
  test('lists the feedback among the contributions at once, by its name, counted for its account', () => {
    const ann = accounts.store.create('Ann', 'ann', 'hash', RECORDS_NOTICE_VERSION);
    if (!ann) throw new Error('no account');
    const store = new FeedbackStore(database.db);
    store.add(feedback({ credit: 'Ann L.', accountId: ann.id, linkProfile: true }));
    store.add(feedback({ kind: 'words', credit: 'octocat' }));
    store.add(feedback({ kind: 'bug', accountId: ann.id }));
    for (const id of [1, 2, 3]) store.setIssue(id, 40 + id);
    vi.useFakeTimers({ now: Date.parse('2026-10-14T08:00:00.000Z') });
    expect(adopt('1')).toBe(0);
    expect(printed).toEqual([
      "Adopted feedback #1, issue #41. The home page lists it now, as Ann, with the account's avatar, counted " +
        'for the account Ann, saying that the player contributed:',
      `  zh: ${ZH}`,
      `  en: ${EN}`,
    ]);
    expect(adopt('2', '--zh', '加了词', '--en', 'Added words')).toBe(0);
    expect(printed.at(-3)).toBe(
      'Adopted feedback #2, issue #42. The home page lists it now, as octocat, counted for no account, ' +
        'saying that the player contributed:',
    );
    // Feedback without a name is adopted too: its player stays anonymous, and it counts for the
    // account all the same.
    expect(adopt('3')).toBe(0);
    expect(printed.at(-3)).toBe(
      'Adopted feedback #3, issue #43. The home page lists it now, as an anonymous player, counted for the ' +
        'account Ann, saying that the player contributed:',
    );
    expect(store.byId(1)).toMatchObject({
      status: 'resolved',
      adoptedAt: '2026-10-14T08:00:00.000Z',
      summaryZh: ZH,
      summaryEn: EN,
    });
    const site = { source: 'site', avatar: null, deleted: false, advisory: null, month: '2026-10' };
    expect(contributions()).toEqual([
      { kind: 'bug', name: null, profile: null, summary: { zh: ZH, en: EN }, issue: 43, ...site },
      {
        kind: 'words',
        name: 'octocat',
        profile: null,
        summary: { zh: '加了词', en: 'Added words' },
        issue: 42,
        ...site,
      },
      { kind: 'idea', name: 'Ann', profile: ann.handle, summary: { zh: ZH, en: EN }, issue: 41, ...site },
    ]);
    expect(accounts.summary(ann).contributions).toEqual([
      { kind: 'idea', count: 1 },
      { kind: 'bug', count: 1 },
    ]);

    // Only once, and only feedback that is there.
    expect(adopt('1')).toBe(1);
    expect(printed.at(-1)).toBe(
      'Feedback #1 was adopted already, on 2026-10-14. To say again what the player contributed: ' +
        'feedback describe 1 --zh <sentence> --en <sentence>.',
    );
    expect(adopt('4')).toBe(1);
    expect(printed.at(-1)).toBe('There is no feedback #4.');
    expect(adopt('x')).toBe(1);
    expect(printed.at(-1)).toBe('There is no feedback #x.');
    expect(contributions()).toHaveLength(3);
  });

  test('lists feedback signed with an account that is gone as a deleted player, counted for no account', () => {
    const bob = accounts.store.create('Bob', 'bob', 'hash', RECORDS_NOTICE_VERSION);
    if (!bob) throw new Error('no account');
    const store = new FeedbackStore(database.db);
    store.add(feedback({ accountId: bob.id, linkProfile: true }));
    store.setIssue(1, 41);
    accounts.store.delete(bob.id);
    expect(adopt('1')).toBe(0);
    expect(printed[0]).toBe(
      'Adopted feedback #1, issue #41. The home page lists it now, as a deleted player, counted for no account, ' +
        'saying that the player contributed:',
    );
    expect(contributions()).toMatchObject([{ name: null, profile: null, deleted: true, issue: 41 }]);
  });

  test('takes only feedback that is a GitHub issue, which it keeps', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback({ credit: 'Ann' }));
    expect(adopt('1')).toBe(1);
    expect(printed.at(-1)).toBe(
      'Feedback #1 is no GitHub issue. Every adopted piece of feedback is one: publish it first, or record one ' +
        'made by hand with feedback issue 1 <number>.',
    );
    expect(store.byId(1)?.adoptedAt).toBeNull();
    expect(run('feedback', 'issue', '1', '43')).toBe(0);
    expect(adopt('1')).toBe(0);
    // The issue may be put right, but not taken away.
    expect(run('feedback', 'issue', '1', '--clear')).toBe(1);
    expect(printed.at(-1)).toBe(
      'Feedback #1 was adopted, and keeps an issue, which the home page links. Record another number in its ' +
        'place if #43 is wrong: feedback issue 1 <number>.',
    );
    expect(run('feedback', 'issue', '1', '44')).toBe(0);
    expect(contributions()[0]?.issue).toBe(44);
  });

  test('takes what the player contributed in both languages, by the rules of a contribution', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback());
    store.setIssue(1, 41);
    expect(run('feedback', 'adopt', '1')).toBe(2);
    expect(printed).toEqual([
      'Say what the player contributed in both languages: --zh "<a sentence in Chinese>" --en "<a sentence in English>".',
    ]);
    expect(run('feedback', 'adopt', '1', '--zh', ZH)).toBe(2);
    // A flag without its value is a usage error, as for any command.
    expect(run('feedback', 'adopt', '1', '--zh', ZH, '--en')).toBe(2);
    expect(printed.at(-1)).toMatch(/^usage: /);
    printed = [];
    expect(adopt('1', '--zh', ' \u200b ', '--en', 'x'.repeat(101))).toBe(1);
    expect(printed).toEqual(['--zh shows nothing.', '--en has more than 100 characters.']);
    expect(store.byId(1)?.adoptedAt).toBeNull();
    // Cleaned as a bio is: one line, without hidden characters or spaces at its ends.
    expect(adopt('1', '--zh', ` 提出了\n计时器\u200b `, '--en', `${'x'.repeat(100)} `)).toBe(0);
    expect(store.byId(1)).toMatchObject({ summaryZh: '提出了 计时器', summaryEn: 'x'.repeat(100) });
  });

  test('refuses feedback in the trash, which would be listed on its way out', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback({ credit: 'Ann' }));
    expect(run('feedback', 'delete', '1')).toBe(0);
    // Recorded as an issue in the trash, as `feedback issue` allows.
    expect(store.setIssue(1, 41)).toBe(true);
    expect(adopt('1')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #1 is in the trash. Restore it first: feedback restore 1.');
    expect(contributions()).toEqual([]);
    expect(run('feedback', 'restore', '1')).toBe(0);
    expect(adopt('1')).toBe(0);
    expect(contributions()).toHaveLength(1);
  });

  test('refuses closed feedback, which was set aside, until it is reopened', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback({ credit: 'Ann' }));
    store.setIssue(1, 41);
    expect(run('feedback', 'close', '1')).toBe(0);
    expect(adopt('1')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #1 is closed. Reopen it first: feedback reopen 1.');
    expect(store.byId(1)).toMatchObject({ adoptedAt: null, status: 'closed' });
    expect(run('feedback', 'reopen', '1')).toBe(0);
    expect(adopt('1')).toBe(0);
    // Adopted, it can't be closed: the home page lists it.
    expect(run('feedback', 'close', '1')).toBe(1);
    expect(printed.at(-1)).toBe("Feedback #1 was adopted, and the home page lists it, so it can't be closed.");
    expect(store.byId(1)?.status).toBe('resolved');
  });

  test('says what another command did meanwhile when the feedback can no longer be adopted', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback({ credit: 'Ann' }));
    store.setIssue(1, 41);
    // Between the command's reading and its writing, someone else closes the feedback.
    vi.spyOn(FeedbackStore.prototype, 'adopt').mockImplementation(function (this: FeedbackStore) {
      store.close(1);
      return false;
    });
    expect(adopt('1')).toBe(1);
    expect(printed.at(-1)).toBe(
      'Feedback #1 was adopted, closed or moved to the trash just now, or its issue was taken back. Look at it again.',
    );
    expect(store.byId(1)).toMatchObject({ adoptedAt: null, status: 'closed' });
  });

  test("says when the name is another account's username, which may be someone passing for its owner", () => {
    accounts.store.create('Cat', 'cat', 'hash', RECORDS_NOTICE_VERSION);
    const store = new FeedbackStore(database.db);
    store.add(feedback({ credit: 'CAT' }));
    store.setIssue(1, 41);
    expect(adopt('1')).toBe(0);
    expect(printed.at(-1)).toBe(
      "CAT is also the username of the account Cat, which didn't send the feedback. Make sure that they are " +
        'the same person.',
    );
  });
});

describe('feedback describe', () => {
  test('says again what the player contributed, of adopted feedback alone', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback({ credit: 'Ann' }));
    store.setIssue(1, 41);
    expect(run('feedback', 'describe', '1', ...SAID)).toBe(1);
    expect(printed).toEqual([
      "Feedback #1 isn't adopted. Adopt it with feedback adopt 1 --zh <sentence> --en <sentence>.",
    ]);
    expect(store.byId(1)).toMatchObject({ adoptedAt: null, summaryZh: null });
    expect(adopt('1')).toBe(0);
    printed = [];
    expect(run('feedback', 'describe', '1', '--zh', '提出了倒计时', '--en', 'Suggested a countdown')).toBe(0);
    expect(printed).toEqual([
      'Feedback #1 now says that the player contributed:',
      '  zh: 提出了倒计时',
      '  en: Suggested a countdown',
      'It said:',
      `  zh: ${ZH}`,
      `  en: ${EN}`,
    ]);
    expect(contributions()[0]).toMatchObject({
      name: 'Ann',
      summary: { zh: '提出了倒计时', en: 'Suggested a countdown' },
    });
    expect(run('feedback', 'describe', '1', '--zh', '提出了倒计时')).toBe(2);
    expect(run('feedback', 'describe', '2', ...SAID)).toBe(1);
    expect(printed.at(-1)).toBe('There is no feedback #2.');
  });
});

describe('feedback draft', () => {
  const ZWSP = '\u200b';
  const SENT = 'that a player sent through the feedback form:';
  const hint = (id: number) =>
    `Create the issue on GitHub with this title and body, then record its number: feedback issue ${id} <number>.`;
  // The command's exit code and what it printed, which the next run starts afresh.
  const draft = (id: string, ...flags: string[]) => ({
    code: run('feedback', 'draft', id, ...flags),
    lines: printed.splice(0),
  });
  // The draft as --json prints it.
  const drafted = (id: string): { id: number; kind: string; title: string; body: string } => {
    expect(run('feedback', 'draft', id, '--json')).toBe(0);
    return JSON.parse(printed.splice(0).join('\n')) as { id: number; kind: string; title: string; body: string };
  };

  test('writes the title and the body of the issue for any feedback, and says what comes next', () => {
    const store = new FeedbackStore(database.db);
    store.add(
      feedback({
        text: 'AI agent player',
        contact: 'me@example.com',
        credit: 'Ann L',
        version: 'v0.1.10',
        userAgent: 'Mozilla/5.0',
      }),
    );
    expect(draft('1')).toEqual({
      code: 0,
      lines: [
        'Idea: AI agent player',
        '',
        `An idea ${SENT}`,
        '',
        '> AI agent player',
        '',
        'Suggested by Ann L.',
        '',
        hint(1),
      ],
    });
    // It only reads: nothing is recorded until the issue is.
    expect(store.byId(1)).toMatchObject({ issue: null, status: 'new' });
  });

  test('with --json prints the draft on one line, with the id and the kind for a script', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback({ kind: 'bug', text: 'Line one\nLine two', credit: 'Ann' }));
    expect(run('feedback', 'draft', '1', '--json')).toBe(0);
    expect(printed).toEqual([
      JSON.stringify({
        id: 1,
        kind: 'bug',
        title: 'Bug: Line one',
        body: `A bug report ${SENT}\n\n> Line one\n> Line two\n\nReported by Ann.\n\nVersion: v1`,
      }),
    ]);
    expect(Object.keys(JSON.parse(printed[0] as string) as object)).toEqual(['id', 'kind', 'title', 'body']);
  });

  test('holds the text and the name alone, which is all that the form says is published', () => {
    const store = new FeedbackStore(database.db);
    const ann = accounts.store.create('Ann', 'ann', 'hash', RECORDS_NOTICE_VERSION);
    store.add(
      feedback({
        text: 'The board is gone.',
        contact: 'wechat: r2',
        credit: 'Ann L',
        accountId: ann?.id,
        version: 'v0.1.10',
        language: 'zh',
        page: 'room',
        userAgent: 'Mozilla/5.0',
      }),
    );
    const { title, body } = drafted('1');
    expect(title).toBe('Idea: The board is gone.');
    expect(body).toBe(`An idea ${SENT}\n\n> The board is gone\\.\n\nSuggested by Ann.`);
    // No contact, link, account, version, language, page, browser, time or id.
    expect(`${title}\n${body}`).not.toMatch(
      /wechat|r2|ann\.example|account|v0\.1\.10|Chinese|zh|room|Mozilla|20\d\d|#1/,
    );
  });

  test('says which version and browser a bug report came from, by their names and versions alone', () => {
    const store = new FeedbackStore(database.db);
    const wechat =
      'Mozilla/5.0 (Linux; Android 15; 2211133C Build/AQ3A.240912.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Version/4.0 Chrome/130.0.6723.107 Mobile Safari/537.36 MicroMessenger/8.0.56.2800(0x28003855)';
    store.add(feedback({ kind: 'bug', text: 'The board is gone.', version: 'v0.1.42', userAgent: wechat }));
    // A build named by its commit, which GitHub would link, and a browser it says nothing of.
    store.add(feedback({ kind: 'bug', text: 'The board is gone.', version: 'abc1234def', userAgent: 'curl/8.5.0' }));
    // A bug report from before the browser was kept.
    store.add(feedback({ kind: 'bug', text: 'The board is gone.', version: 'v0.1.5' }));
    // Only a bug report says them.
    store.add(feedback({ text: 'The board is gone.', version: 'v0.1.42', userAgent: wechat }));
    const bug = drafted('1').body;
    expect(bug).toBe(
      `A bug report ${SENT}\n\n> The board is gone\\.\n\nSent by an anonymous player.\n\n` +
        'Version: v0\\.1\\.42\nBrowser: WeChat 8.0.56 on Android 15',
    );
    // Never the model or the user agent itself.
    expect(bug).not.toMatch(/2211133C|Build|AppleWebKit|Mozilla|0x28003855/);
    expect(drafted('2').body.split('\n').slice(-1)).toEqual([`Version: a${ZWSP}bc1234def`]);
    expect(drafted('3').body.split('\n').slice(-2)).toEqual(['', 'Version: v0\\.1\\.5']);
    expect(drafted('4').body).not.toMatch(/Version|Browser|v0\.1\.42|WeChat/);
  });

  test('names feedback signed with an account by the account as it is now, or a deleted player', () => {
    const store = new FeedbackStore(database.db);
    const ann = accounts.store.create('Ann', 'ann', 'hash', RECORDS_NOTICE_VERSION);
    if (!ann) throw new Error('no account');
    store.add(feedback({ accountId: ann.id, linkProfile: true }));
    store.add(feedback({ kind: 'bug', accountId: ann.id, linkProfile: true }));
    accounts.store.rename(ann.id, 'Annie', 'annie');
    expect(drafted('1').body).toBe(`An idea ${SENT}\n\n> A timer\\, please\\.\n\nSuggested by Annie.`);
    accounts.store.delete(ann.id);
    expect(drafted('1').body).toBe(`An idea ${SENT}\n\n> A timer\\, please\\.\n\nSuggested by a deleted player.`);
    expect(drafted('2').body).toBe(
      `A bug report ${SENT}\n\n> A timer\\, please\\.\n\nReported by a deleted player.\n\nVersion: v1`,
    );
  });

  test('opens by the kind, as `feedback list` calls it, and names who sent it, or an anonymous player', () => {
    const store = new FeedbackStore(database.db);
    for (const kind of ['idea', 'game', 'bug', 'words'] as const) store.add(feedback({ kind, credit: 'Ann' }));
    for (const kind of ['idea', 'bug'] as const) store.add(feedback({ kind }));
    expect(drafted('1')).toEqual({
      id: 1,
      kind: 'idea',
      title: 'Idea: A timer, please.',
      body: `An idea ${SENT}\n\n> A timer\\, please\\.\n\nSuggested by Ann.`,
    });
    expect(drafted('2')).toMatchObject({
      title: 'New game: A timer, please.',
      body: `An idea for a new game ${SENT}\n\n> A timer\\, please\\.\n\nSuggested by Ann.`,
    });
    expect(drafted('3')).toMatchObject({
      title: 'Bug: A timer, please.',
      body: `A bug report ${SENT}\n\n> A timer\\, please\\.\n\nReported by Ann.\n\nVersion: v1`,
    });
    expect(drafted('4')).toMatchObject({
      title: 'Word lists: A timer, please.',
      body: `A suggestion for the word lists ${SENT}\n\n> A timer\\, please\\.\n\nSuggested by Ann.`,
    });
    expect(drafted('5').body).toBe(`An idea ${SENT}\n\n> A timer\\, please\\.\n\nSent by an anonymous player.`);
    expect(drafted('6').body).toBe(
      `A bug report ${SENT}\n\n> A timer\\, please\\.\n\nSent by an anonymous player.\n\nVersion: v1`,
    );
  });

  test('takes the first line for the title, on one line, cut after 60 characters that a reader sees', () => {
    const store = new FeedbackStore(database.db);
    const han = '\u6c49';
    const family = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}';
    store.add(feedback({ text: `${'x'.repeat(60)}\nThe second line` }));
    store.add(feedback({ text: 'x'.repeat(61) }));
    store.add(feedback({ text: han.repeat(61) }));
    store.add(feedback({ text: `${'x'.repeat(59)}${family}${family}` }));
    store.add(feedback({ text: ' Spaced \t  out \nand more' }));
    store.add(feedback({ text: `${'x'.repeat(59)} and more` }));
    store.add(feedback({ text: family.repeat(61) }));
    const chain = Array.from({ length: 80 }, () => '\u{1f468}').join('\u200d');
    store.add(feedback({ text: `${chain} and more` }));
    expect(drafted('1').title).toBe(`Idea: ${'x'.repeat(60)}`);
    expect(drafted('2').title).toBe(`Idea: ${'x'.repeat(60)}\u2026`);
    expect(drafted('3').title).toBe(`Idea: ${han.repeat(60)}\u2026`);
    // An emoji built from several code points is one character, and stays whole.
    expect(drafted('4').title).toBe(`Idea: ${'x'.repeat(59)}${family}\u2026`);
    expect(drafted('5').title).toBe('Idea: Spaced out');
    // No space is left before the ellipsis.
    expect(drafted('6').title).toBe(`Idea: ${'x'.repeat(59)}\u2026`);
    // Fewer characters when 60 would be more than 120 code points, which GitHub counts: 24 of these
    // emoji, of five code points each.
    expect(drafted('7').title).toBe(`Idea: ${family.repeat(24)}\u2026`);
    // One character of more than 120 code points, such as 80 emoji joined into one, is cut inside,
    // after 120: 60 of the emoji, with the joiners between them.
    expect(drafted('8').title).toBe(`Idea: ${'\u{1f468}\u200d'.repeat(60)}\u2026`);
    // The body keeps every line as it is.
    expect(drafted('1').body).toContain(`> ${'x'.repeat(60)}\n> The second line`);
  });

  test('quotes every line of the text as one quotation, with a blank line as a bare >', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback({ kind: 'bug', text: 'Steps:\n1. Lock the phone\n\n2. Come back' }));
    expect(drafted('1').body).toBe(
      `A bug report ${SENT}\n\n> Steps\\:\n> 1\\. Lock the phone\n>\n> 2\\. Come back\n\nSent by an anonymous player.\n\n` +
        'Version: v1',
    );
  });

  test('keeps what the player wrote from mentioning, referring, linking or marking anything up on GitHub', () => {
    const store = new FeedbackStore(database.db);
    store.add(
      feedback({
        kind: 'bug',
        text:
          '# Heading @octocat, see #12, GH-13 and fbcd508 :tada:\n\n- item [x](https://e.example) ' +
          '![](https://i.example/i.png) <b>bold</b>\n> quoted 1. list\nwww.example.com me@example.com ' +
          'o/r/issues/4 https://github.com/o/r/pull/5\n' +
          '7ccd7e7e3bd9256e1cb82d4993944a842502dc58 :+1: at 10:30:45, by the feedback form\n' +
          '$x^2$ costs $5 or $$\\color{red}{\\Huge y}$$\n$$\n\\sum\n$$',
        credit: '[@bob](#1)',
      }),
    );
    const { title, body } = drafted('1');
    // GitHub renders no Markdown in a title but a code span, so the title is as written, with its
    // signs unlinked all the same.
    expect(title).toBe(`Bug: # Heading @${ZWSP}octocat, see #${ZWSP}12, GH-${ZWSP}13 and f${ZWSP}bcd508 :${ZWSP}tada:`);
    // In the body, every ASCII punctuation character is escaped, and a zero-width space follows an
    // @ before a name, a # or GH- before a number, a / before a number, as in owner/repo/issues/4
    // with or without the address of the site in front, the first of seven or more hexadecimal
    // digits on their own and a : before a shortcode, and precedes every $, so that GitHub, which
    // reads them in the text once Markdown has taken the backslashes away, finds no mention,
    // reference, address, commit, emoji or formula. A time, and a word with fewer such digits in a
    // row, are left alone.
    expect(body).toBe(
      [
        `A bug report ${SENT}`,
        '',
        `> \\# Heading \\@${ZWSP}octocat\\, see \\#${ZWSP}12\\, GH\\-${ZWSP}13 and f${ZWSP}bcd508 \\:${ZWSP}tada\\:`,
        '>',
        '> \\- item \\[x\\]\\(https\\:\\/\\/e\\.example\\) \\!\\[\\]\\(https\\:\\/\\/i\\.example\\/i\\.png\\) \\<b\\>bold\\<\\/b\\>',
        '> \\> quoted 1\\. list',
        `> www\\.example\\.com me\\@${ZWSP}example\\.com o\\/r\\/issues\\/${ZWSP}4 ` +
          `https\\:\\/\\/github\\.com\\/o\\/r\\/pull\\/${ZWSP}5`,
        `> 7${ZWSP}ccd7e7e3bd9256e1cb82d4993944a842502dc58 \\:${ZWSP}\\+1\\: at 10\\:30\\:45\\, by the feedback form`,
        `> ${ZWSP}\\$x\\^2${ZWSP}\\$ costs ${ZWSP}\\$5 or ${ZWSP}\\$${ZWSP}\\$\\\\color\\{red\\}\\{\\\\Huge y\\}${ZWSP}\\$${ZWSP}\\$`,
        `> ${ZWSP}\\$${ZWSP}\\$`,
        '> \\\\sum',
        `> ${ZWSP}\\$${ZWSP}\\$`,
        '',
        `Reported by \\[\\@${ZWSP}bob\\]\\(\\#${ZWSP}1\\).`,
        '',
        'Version: v1',
      ].join('\n'),
    );
    // Nothing that GitHub links or replaces is left as it was.
    expect(body).not.toMatch(/@[a-z0-9]|#\d|GH-\d|\/\d|https?:\/\/|www\.|fbcd508|7ccd7e7|:[\w+-]+:|[^\u200b]\\\$/i);
  });

  test('keeps the quotation from becoming an alert', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback({ text: '[!WARNING]\nDanger ahead' }));
    store.add(feedback({ text: '[!note]\n\nSee [!tip] here', kind: 'bug' }));
    // GitHub shows a quotation whose first line is [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or
    // [!CAUTION] alone, in any case, as an alert, once Markdown has taken the backslashes away, so
    // a zero-width space follows the [ of every [!.
    const warning = drafted('1');
    expect(warning.title).toBe(`Idea: [${ZWSP}!WARNING]`);
    expect(warning.body.split('\n').slice(2, 4)).toEqual([`> \\[${ZWSP}\\!WARNING\\]`, '> Danger ahead']);
    expect(drafted('2').body.split('\n').slice(2, 5)).toEqual([
      `> \\[${ZWSP}\\!note\\]`,
      '>',
      `> See \\[${ZWSP}\\!tip\\] here`,
    ]);
  });

  test('leaves a time, a date, a fraction and a word of few hexadecimal digits alone', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback({ text: 'Froze at 10:30:45 on 10/13, 1/2 of the time, with feedback' }));
    const { title, body } = drafted('1');
    expect(title).toBe('Idea: Froze at 10:30:45 on 10/13, 1/2 of the time, with feedback');
    expect(body).not.toContain(ZWSP);
  });

  test('escapes a name as the lists of thanks do, and unlinks it', () => {
    const store = new FeedbackStore(database.db);
    for (const credit of ['--Ann', '#1 fan', '<b>Ann</b>', '@octocat', 'Dr. Who', '$\\Huge Ann$']) {
      store.add(feedback({ credit }));
    }
    const signed = (id: string) => drafted(id).body.split('\n').at(-1);
    expect(signed('1')).toBe('Suggested by \\-\\-Ann.');
    expect(signed('2')).toBe(`Suggested by \\#${ZWSP}1 fan.`);
    expect(signed('3')).toBe('Suggested by \\<b\\>Ann\\<\\/b\\>.');
    expect(signed('4')).toBe(`Suggested by \\@${ZWSP}octocat.`);
    expect(signed('5')).toBe('Suggested by Dr\\. Who.');
    expect(signed('6')).toBe(`Suggested by ${ZWSP}\\$\\\\Huge Ann${ZWSP}\\$.`);
  });

  test('refuses feedback in the trash, published already, or not there, and drafts any other', () => {
    const store = new FeedbackStore(database.db);
    for (let i = 0; i < 5; i += 1) store.add(feedback());
    // Any feedback is drafted: every adopted piece is an issue.
    expect(draft('1').code).toBe(0);
    expect(draft('2').code).toBe(0);
    expect(run('feedback', 'delete', '3')).toBe(0);
    printed = [];
    expect(draft('3')).toEqual({
      code: 1,
      lines: ['Feedback #3 is in the trash. Restore it first: feedback restore 3.'],
    });
    expect(run('feedback', 'issue', '4', '42')).toBe(0);
    printed = [];
    expect(draft('4')).toEqual({
      code: 1,
      lines: ['Feedback #4 is issue #42 already. To publish it again, take that back first: feedback issue 4 --clear.'],
    });
    expect(run('feedback', 'issue', '4', '--clear')).toBe(0);
    printed = [];
    expect(draft('4').code).toBe(0);
    expect(draft('6')).toEqual({ code: 1, lines: ['There is no feedback #6.'] });
    expect(draft('x')).toEqual({ code: 1, lines: ['There is no feedback #x.'] });
    // Closed feedback is drafted all the same, as feedback issue records an issue for it.
    expect(run('feedback', 'close', '5')).toBe(0);
    printed = [];
    expect(draft('5').code).toBe(0);
    // A kind from a later server, which this one was rolled back from, has no title or opening.
    database.db.exec("UPDATE feedback SET kind = 'later' WHERE id = 5");
    expect(draft('5')).toEqual({ code: 1, lines: ["This build doesn't know the kind later of feedback #5."] });
    expect(draft('3', '--json').code).toBe(1);
  });

  test('only reads, on a database that no server has open, and leaves no WAL behind', () => {
    new FeedbackStore(database.db).add(feedback());
    database.db.close();
    expect(draft('1').code).toBe(0);
    expect(readdirSync(dir).filter((name) => name.startsWith(DATABASE_FILE))).toEqual([DATABASE_FILE]);
  });
});

describe('feedback issue', () => {
  test('records the issue that feedback was published as', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback());
    store.add(feedback());
    expect(run('feedback', 'issue', '1', '42')).toBe(0);
    expect(printed.at(-1)).toBe('Feedback #1 is issue #42, https://github.com/jxxsteven7/reviewer2/issues/42.');
    expect(store.byId(1)).toMatchObject({ issue: 42, text: 'A timer, please.' });
    // A mistake can be put right, and the command says what it replaced.
    expect(run('feedback', 'issue', '1', '43')).toBe(0);
    expect(printed.at(-1)).toBe(
      'Feedback #1 is issue #43, https://github.com/jxxsteven7/reviewer2/issues/43, no longer #42.',
    );

    expect(run('feedback', 'issue', '2', '44')).toBe(0);
    expect(store.byId(2)?.issue).toBe(44);
    for (const number of ['0', '-1', '4.5', 'x']) {
      expect(run('feedback', 'issue', '1', number)).toBe(1);
      expect(printed.at(-1)).toBe(`${number} is not the number of an issue.`);
    }
    expect(run('feedback', 'issue', '3', '1')).toBe(1);
    expect(printed.at(-1)).toBe('There is no feedback #3.');
    expect(store.byId(1)?.issue).toBe(43);
  });
});

describe('feedback issue --clear', () => {
  test("takes the issue out, of feedback that wasn't adopted", () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback({ credit: 'Ann' }));
    store.add(feedback());
    expect(run('feedback', 'issue', '1', '--clear')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #1 has no issue recorded.');
    expect(run('feedback', 'issue', '1', '42')).toBe(0);
    expect(run('feedback', 'issue', '1', '--clear')).toBe(0);
    expect(printed.at(-1)).toBe('Feedback #1 is no longer recorded as issue #42.');
    expect(store.byId(1)).toMatchObject({ issue: null, status: 'new', text: 'A timer, please.' });
    expect(run('feedback', 'issue', '2', '43')).toBe(0);
    expect(run('feedback', 'issue', '2', '--clear')).toBe(0);
    expect(store.byId(2)?.issue).toBeNull();
    // Adopted feedback keeps its issue, which the home page links.
    expect(run('feedback', 'issue', '1', '44')).toBe(0);
    expect(adopt('1')).toBe(0);
    expect(run('feedback', 'issue', '1', '--clear')).toBe(1);
    expect(store.byId(1)?.issue).toBe(44);
    expect(run('feedback', 'issue', '3', '--clear')).toBe(1);
    expect(printed.at(-1)).toBe('There is no feedback #3.');
  });

  test('refuses an issue for feedback in the trash, and says where it is when one is taken back', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback());
    expect(run('feedback', 'delete', '1')).toBe(0);
    // The trash would delete it in 30 days, with its issue still public.
    expect(run('feedback', 'issue', '1', '42')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #1 is in the trash. Restore it first: feedback restore 1.');
    expect(store.byId(1)).toMatchObject({ issue: null });
    // Feedback that went to the trash before the rule may have one all the same.
    store.setIssue(1, 42);
    expect(run('feedback', 'issue', '1', '--clear')).toBe(0);
    expect(printed.slice(-2)).toEqual([
      'Feedback #1 is no longer recorded as issue #42.',
      'It is in the trash, by the way: feedback restore 1 brings it back.',
    ]);
    expect(run('feedback', 'resolve', '1', '50')).toBe(0);
    expect(run('feedback', 'resolve', '1', '--clear')).toBe(0);
    expect(printed.slice(-2)).toEqual([
      'Feedback #1 is no longer recorded as resolved by PR #50.',
      'It is in the trash, by the way: feedback restore 1 brings it back.',
    ]);
    expect(store.byId(1)).toMatchObject({ issue: null, resolvedPr: null, status: 'trash' });
  });
});

describe('feedback resolve', () => {
  test('records the pull request that resolved any feedback, which can be changed or cleared', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback());
    store.add(feedback());
    expect(run('feedback', 'resolve', '1', '50')).toBe(0);
    expect(printed.at(-1)).toBe('Feedback #1 is resolved by PR #50, https://github.com/jxxsteven7/reviewer2/pull/50.');
    // Not adopted, it still waits, as an issue does.
    expect(store.byId(1)).toMatchObject({ resolvedPr: 50, status: 'issue', text: 'A timer, please.' });
    expect(store.byId(1)?.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(run('feedback', 'resolve', '1', '51')).toBe(0);
    expect(printed.at(-1)).toBe(
      'Feedback #1 is resolved by PR #51, https://github.com/jxxsteven7/reviewer2/pull/51, no longer #50.',
    );
    expect(run('feedback', 'resolve', '1', '51')).toBe(0);
    expect(printed.at(-1)).toBe('Feedback #1 is resolved by PR #51, https://github.com/jxxsteven7/reviewer2/pull/51.');
    expect(run('feedback', 'resolve', '1', '--clear')).toBe(0);
    expect(printed.at(-1)).toBe('Feedback #1 is no longer recorded as resolved by PR #51.');
    expect(store.byId(1)).toMatchObject({ resolvedPr: null, resolvedAt: null, status: 'new' });
    expect(run('feedback', 'resolve', '1', '--clear')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #1 has no pull request recorded.');
    // With its issue, the issue stays beside it, and it waits for the adoption as an issue.
    expect(run('feedback', 'issue', '2', '42')).toBe(0);
    expect(run('feedback', 'resolve', '2', '52')).toBe(0);
    expect(store.byId(2)).toMatchObject({ issue: 42, resolvedPr: 52, status: 'issue' });
    for (const number of ['0', '-1', '4.5', 'x', '--all']) {
      expect(run('feedback', 'resolve', '1', number)).toBe(1);
      expect(printed.at(-1)).toBe(`${number} is not the number of a pull request.`);
    }
    expect(run('feedback', 'resolve', '3', '1')).toBe(1);
    expect(printed.at(-1)).toBe('There is no feedback #3.');
    // In the trash, the note is taken, and the command says where the feedback is.
    expect(run('feedback', 'delete', '1')).toBe(0);
    expect(run('feedback', 'resolve', '1', '53')).toBe(0);
    expect(printed.slice(-2)).toEqual([
      'Feedback #1 is resolved by PR #53, https://github.com/jxxsteven7/reviewer2/pull/53.',
      'It is in the trash, by the way: feedback restore 1 brings it back.',
    ]);
  });
});

describe('feedback close and reopen', () => {
  test('close feedback once and reopen it once, and leave the trash alone', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback());
    store.add(feedback());
    expect(run('feedback', 'reopen', '1')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #1 is open.');
    expect(run('feedback', 'close', '1')).toBe(0);
    expect(printed.at(-1)).toBe('Closed feedback #1. It stays, for the record; feedback reopen 1 opens it again.');
    expect(store.byId(1)).toMatchObject({ status: 'closed', text: 'A timer, please.' });
    expect(run('feedback', 'close', '1')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #1 is closed already.');
    expect(run('feedback', 'reopen', '1')).toBe(0);
    expect(printed.at(-1)).toBe('Reopened feedback #1.');
    expect(store.byId(1)).toMatchObject({ status: 'new', closedAt: null });
    expect(run('feedback', 'delete', '2')).toBe(0);
    for (const command of ['close', 'reopen']) {
      expect(run('feedback', command, '2')).toBe(1);
      expect(printed.at(-1)).toBe('Feedback #2 is in the trash. Restore it first: feedback restore 2.');
      expect(run('feedback', command, '3')).toBe(1);
      expect(printed.at(-1)).toBe('There is no feedback #3.');
    }
    expect(store.byId(2)).toMatchObject({ status: 'trash', closedAt: null });
  });
});

describe('feedback delete, restore and trash', () => {
  test('move feedback to the trash and back, and list what is there with the days it has left', () => {
    const NOW = Date.UTC(2026, 10, 1, 9);
    vi.useFakeTimers({ now: NOW });
    const store = new FeedbackStore(database.db);
    store.add(feedback({ text: 'BUY CHEAP WATCHES\nat spam.example' }));
    store.add(feedback({ kind: 'bug', text: 'x'.repeat(70) }));
    store.add(feedback({ credit: 'Ann' }));
    expect(run('feedback', 'trash')).toBe(0);
    expect(printed).toEqual(['The trash is empty.']);
    expect(run('feedback', 'resolve', '1', '50')).toBe(0);
    expect(run('feedback', 'close', '2')).toBe(0);

    expect(run('feedback', 'delete', '1')).toBe(0);
    expect(printed.at(-1)).toBe(
      'Moved feedback #1 to the trash. The server deletes it for good in 30 days; feedback restore 1 brings it ' +
        'back before then.',
    );
    expect(store.byId(1)).toMatchObject({
      status: 'trash',
      resolvedPr: 50,
      text: 'BUY CHEAP WATCHES\nat spam.example',
    });
    vi.setSystemTime(NOW + 3 * 24 * 60 * 60_000 + 1);
    expect(run('feedback', 'delete', '2')).toBe(0);
    expect(printed.at(-1)).toBe(
      'Moved feedback #2 to the trash. The server deletes it for good in 30 days; feedback restore 2 brings it ' +
        'back before then.',
    );
    expect(run('feedback', 'delete', '1')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #1 is in the trash already, 27 days left.');

    expect(run('feedback', 'trash')).toBe(0);
    expect(printed.slice(-3)).toEqual([
      '2 pieces of feedback in the trash, each deleted for good 30 days after it went in:',
      `#2  2026-11-04  30 days left  bug  ${'x'.repeat(60)}...`,
      '#1  2026-11-01  27 days left  idea  BUY CHEAP WATCHES / at spam.example',
    ]);
    // The feedback adopted can't go, since the home page lists it.
    store.setIssue(3, 45);
    expect(adopt('3')).toBe(0);
    expect(run('feedback', 'delete', '3')).toBe(1);
    expect(printed.at(-1)).toBe("Feedback #3 was adopted, and the home page lists it, so it can't be deleted.");
    expect(store.byId(3)?.status).toBe('resolved');

    // Back out of the trash, closed if it was.
    expect(run('feedback', 'restore', '2')).toBe(0);
    expect(printed.at(-1)).toBe('Restored feedback #2 from the trash. It is still closed.');
    expect(store.byId(2)).toMatchObject({ status: 'closed', deletedAt: null });
    expect(run('feedback', 'restore', '1')).toBe(0);
    expect(printed.at(-1)).toBe('Restored feedback #1 from the trash.');
    expect(store.byId(1)).toMatchObject({ status: 'issue', deletedAt: null });
    expect(run('feedback', 'restore', '1')).toBe(1);
    expect(printed.at(-1)).toBe("Feedback #1 isn't in the trash.");
    expect(run('feedback', 'trash')).toBe(0);
    expect(printed.at(-1)).toBe('The trash is empty.');
    for (const command of ['delete', 'restore']) {
      expect(run('feedback', command, '4')).toBe(1);
      expect(printed.at(-1)).toBe('There is no feedback #4.');
    }
    expect(store.count()).toBe(3);
  });

  test('keep feedback that is a GitHub issue, which is public, out of the trash: it is closed instead', () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback());
    expect(run('feedback', 'issue', '1', '42')).toBe(0);
    for (const closed of [false, true]) {
      expect(run('feedback', 'delete', '1')).toBe(1);
      expect(printed.at(-1)).toBe(
        "Feedback #1 is issue #42, which is public, so it can't be deleted: close it instead with feedback close 1. " +
          'If the issue was recorded by mistake, take it back first with feedback issue 1 --clear.',
      );
      expect(store.byId(1)).toMatchObject({ deletedAt: null, issue: 42, status: closed ? 'closed' : 'issue' });
      if (!closed) expect(run('feedback', 'close', '1')).toBe(0);
    }
    // Taken back as a mistake, it may go.
    expect(run('feedback', 'issue', '1', '--clear')).toBe(0);
    expect(run('feedback', 'delete', '1')).toBe(0);
    expect(store.byId(1)?.status).toBe('trash');
  });

  test('show feedback adopted on its way to the trash as kept there, not as purged any day', () => {
    const NOW = Date.UTC(2026, 10, 1, 9);
    vi.useFakeTimers({ now: NOW });
    const store = new FeedbackStore(database.db);
    store.add(feedback({ credit: 'Ann' }));
    store.add(feedback());
    expect(run('feedback', 'delete', '1')).toBe(0);
    expect(run('feedback', 'delete', '2')).toBe(0);
    // As `feedback adopt` would have, had it read the feedback just before it went to the trash.
    database.db.exec("UPDATE feedback SET adopted_at = '2026-11-01T09:00:00.000Z' WHERE id = 1");
    // And an issue in the trash, as `feedback issue` recorded before issues kept feedback out of it.
    store.add(feedback());
    expect(run('feedback', 'delete', '3')).toBe(0);
    database.db.exec('UPDATE feedback SET issue = 42 WHERE id = 3');
    vi.setSystemTime(NOW + 31 * 24 * 60 * 60_000);
    expect(run('feedback', 'trash')).toBe(0);
    expect(printed.slice(-3)).toEqual([
      '#3  2026-11-01  kept: issue  idea  A timer, please.',
      '#2  2026-11-01  0 days left  idea  A timer, please.',
      '#1  2026-11-01  kept: adopted  idea  A timer, please.',
    ]);
    expect(run('feedback', 'delete', '1')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #1 is in the trash already, kept: adopted.');
    expect(run('feedback', 'delete', '2')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #2 is in the trash already, 0 days left.');
    expect(store.purge()).toBe(1);
    expect(store.byId(1)).toMatchObject({ status: 'trash', adoptedAt: '2026-11-01T09:00:00.000Z' });
    expect(store.byId(3)).toMatchObject({ status: 'trash', issue: 42 });
  });

  test('say what another command did meanwhile when the feedback can no longer go to the trash', () => {
    const store = new FeedbackStore(database.db);
    for (let i = 0; i < 3; i += 1) store.add(feedback({ credit: 'Ann' }));
    // Between the command's reading and its writing, someone else adopts the feedback, puts it in
    // the trash, or deletes the row by hand. The store's own delete() is kept from before the spy,
    // so that the change doesn't run the spy again.
    const original = FeedbackStore.prototype.delete;
    const meanwhile = (change: (id: number) => void) => {
      vi.spyOn(FeedbackStore.prototype, 'delete').mockImplementation(function (this: FeedbackStore, id: number) {
        change(id);
        return original.call(this, id);
      });
    };
    meanwhile((id) => {
      database.db.prepare('UPDATE feedback SET issue = 41 WHERE id = ?').run(id);
      store.adopt(id, { zh: ZH, en: EN });
    });
    expect(run('feedback', 'delete', '1')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #1 was adopted just now, so it stays.');
    expect(store.byId(1)).toMatchObject({ deletedAt: null, summaryEn: EN });
    store.add(feedback());
    meanwhile((id) => store.setIssue(id, 42));
    expect(run('feedback', 'delete', '4')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #4 was recorded as an issue just now, so it stays.');
    expect(store.byId(4)).toMatchObject({ deletedAt: null, issue: 42 });
    meanwhile((id) => original.call(store, id));
    expect(run('feedback', 'delete', '2')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #2 was moved to the trash just now.');
    expect(store.byId(2)?.status).toBe('trash');
    meanwhile((id) => database.db.prepare('DELETE FROM feedback WHERE id = ?').run(id));
    expect(run('feedback', 'delete', '3')).toBe(1);
    expect(printed.at(-1)).toBe("Feedback #3 couldn't be moved to the trash. Look at it again.");
    expect(store.byId(3)).toBeUndefined();
  });

  test('cut a long text by its characters, so that an emoji stays whole', () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9) });
    const smile = String.fromCodePoint(0x1f600);
    new FeedbackStore(database.db).add(feedback({ text: `${'x'.repeat(59)}${smile.repeat(3)}` }));
    expect(run('feedback', 'delete', '1')).toBe(0);
    expect(run('feedback', 'trash')).toBe(0);
    expect(printed.at(-1)).toBe(`#1  2026-11-01  30 days left  idea  ${'x'.repeat(59)}${smile}...`);
  });

  test('say so on the day the next purge takes it, and list the trash on a database no server has open', () => {
    const NOW = Date.UTC(2026, 10, 1, 9);
    vi.useFakeTimers({ now: NOW });
    const store = new FeedbackStore(database.db);
    store.add(feedback());
    expect(run('feedback', 'delete', '1')).toBe(0);
    vi.setSystemTime(NOW + 30 * 24 * 60 * 60_000);
    database.db.close();
    expect(run('feedback', 'trash')).toBe(0);
    expect(printed.at(-1)).toBe('#1  2026-11-01  0 days left  idea  A timer, please.');
    expect(run('feedback', 'delete', '1')).toBe(1);
    expect(printed.at(-1)).toBe('Feedback #1 is in the trash already, 0 days left.');
    expect(readdirSync(dir).filter((name) => name.startsWith(DATABASE_FILE))).toEqual([DATABASE_FILE]);
  });
});

describe('data check', () => {
  const ann = () => {
    const account = accounts.store.create('Ann', 'ann', 'hash', RECORDS_NOTICE_VERSION);
    if (!account) throw new Error('no account');
    return account;
  };

  test('says that every check passed, on a database that no server has open, and leaves no WAL behind', () => {
    ann();
    database.db.close();
    expect(run('data', 'check')).toBe(0);
    expect(printed).toEqual(['Every check passed.']);
    expect(readdirSync(dir).filter((name) => name.startsWith(DATABASE_FILE))).toEqual([DATABASE_FILE]);
  });

  test('prints each rule broken with how many rows break it and the first few, by id, and exits with 1', () => {
    const account = ann();
    accounts.store.setAvatar(account.id, `${'a'.repeat(64)}.webp`);
    const many = Array.from({ length: 12 }, () => "('t', 'rant', 'x', 'v', 'en', 'home')");
    database.db.exec(
      `INSERT INTO feedback (created_at, kind, text, version, language, page) VALUES ${many.join(', ')}`,
    );
    expect(run('data', 'check')).toBe(1);
    expect(printed).toEqual([
      'accounts whose avatar file is missing: 1 row: 1',
      'feedback of a kind there is not: 12 rows: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and 2 more',
      '2 checks failed.',
    ]);
  });

  test('leaves the avatar files unchecked where there is no directory of them, and says so', () => {
    const account = ann();
    accounts.store.setAvatar(account.id, `${'a'.repeat(64)}.webp`);
    rmSync(join(dir, AVATAR_DIR), { recursive: true });
    expect(run('data', 'check')).toBe(0);
    expect(printed).toEqual([
      `There is no ${AVATAR_DIR} directory in ${dir}, so the avatar files were not checked.`,
      'Every check passed.',
    ]);
  });
});

// A contribution from GitHub, as `github adopt` takes it: the issue, the kind, the author and the
// two sentences.
const FROM_GITHUB = ['--kind', 'code', '--login', 'octocat', '--id', '583231', ...SAID];
const GITHUB_URL = 'https://github.com/octocat';
const ADVISORY = 'GHSA-24fc-5gmw-5x4j';

describe('github adopt', () => {
  test('lists an issue from GitHub among the contributions at once, by its author or anonymously, and once only', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-14T08:00:00.000Z') });
    expect(run('github', 'adopt', '14', ...FROM_GITHUB)).toBe(0);
    expect(printed).toEqual([
      'Adopted issue #14 as a contribution to the code or the docs. The home page lists it now, as octocat, ' +
        `linked to ${GITHUB_URL}, saying that the player contributed:`,
      `  zh: ${ZH}`,
      `  en: ${EN}`,
    ]);
    expect(
      run('github', 'adopt', '16', '--kind', 'idea', '--login', 'hubot', '--id', '2', '--anonymous', ...SAID),
    ).toBe(0);
    expect(printed.at(-3)).toBe(
      'Adopted issue #16 as an idea. The home page lists it now, as an anonymous player, saying that the player ' +
        'contributed:',
    );
    const github = { source: 'github', profile: null, avatar: null, deleted: false, summary: { zh: ZH, en: EN } };
    expect(contributions()).toEqual([
      { kind: 'idea', name: null, issue: 16, advisory: null, month: '2026-10', ...github },
      { kind: 'code', name: 'octocat', issue: 14, advisory: null, month: '2026-10', ...github },
    ]);
    expect(new ContributionStore(database.db).byRef({ issue: 16 })).toMatchObject({
      login: 'hubot',
      githubId: 2,
      named: false,
      adoptedAt: '2026-10-14T08:00:00.000Z',
    });
    // Only once.
    expect(run('github', 'adopt', '14', ...FROM_GITHUB)).toBe(1);
    expect(printed.at(-1)).toBe(
      'Issue #14 was adopted already. To say again what was contributed: github describe 14 --zh <sentence> ' +
        '--en <sentence>.',
    );
  });

  test('adopts a published security advisory as a bug report, by its id', () => {
    expect(run('github', 'adopt', '--advisory', ADVISORY, '--login', 'octocat', '--id', '583231', ...SAID)).toBe(0);
    expect(printed[0]).toBe(
      `Adopted advisory ${ADVISORY} as a bug report. The home page lists it now, as octocat, linked to ` +
        `${GITHUB_URL}, saying that the player contributed:`,
    );
    expect(contributions()).toMatchObject([
      { kind: 'bug', source: 'github', name: 'octocat', issue: null, advisory: ADVISORY },
    ]);
    // An advisory is a bug report, and is adopted once.
    expect(
      run(
        'github',
        'adopt',
        '--advisory',
        'GHSA-2345-6789-cfgh',
        '--kind',
        'idea',
        '--login',
        'octocat',
        '--id',
        '1',
        ...SAID,
      ),
    ).toBe(1);
    expect(printed.at(-1)).toBe('An advisory is adopted as a bug report: --kind bug.');
    expect(
      run('github', 'adopt', '--advisory', ADVISORY, '--kind', 'bug', '--login', 'octocat', '--id', '583231', ...SAID),
    ).toBe(1);
    expect(printed.at(-1)).toBe(
      `Advisory ${ADVISORY} was adopted already. To say again what was contributed: github describe --advisory ` +
        `${ADVISORY} --zh <sentence> --en <sentence>.`,
    );
  });

  test("refuses an issue that a player's feedback was published as, and the other way round", () => {
    const store = new FeedbackStore(database.db);
    store.add(feedback({ credit: 'Ann' }));
    store.setIssue(1, 41);
    expect(run('github', 'adopt', '41', ...FROM_GITHUB)).toBe(1);
    expect(printed.at(-1)).toBe(
      "Issue #41 is a player's feedback, which is adopted as feedback: feedback adopt <id> --zh <sentence> " +
        '--en <sentence>.',
    );
    expect(run('github', 'adopt', '14', ...FROM_GITHUB)).toBe(0);
    store.add(feedback({ credit: 'Bob' }));
    expect(run('feedback', 'issue', '2', '14')).toBe(1);
    expect(printed.at(-1)).toBe(
      "Issue #14 is a contribution from GitHub (github list), so it can't be a player's feedback too.",
    );
    expect(store.byId(2)?.issue).toBeNull();
    expect(run('feedback', 'issue', '2', '15')).toBe(0);
  });

  test('names the issue by its number or the advisory by its id, one of the two', () => {
    expect(run('github', 'adopt', ...FROM_GITHUB)).toBe(1);
    expect(printed.at(-1)).toBe('Name the issue by its number, or an advisory with --advisory GHSA-xxxx-xxxx-xxxx.');
    expect(run('github', 'adopt', 'x', ...FROM_GITHUB)).toBe(1);
    expect(printed.at(-1)).toBe('x is not the number of an issue.');
    expect(run('github', 'adopt', '0', ...FROM_GITHUB)).toBe(1);
    expect(run('github', 'adopt', '14', '--advisory', ADVISORY, ...FROM_GITHUB)).toBe(1);
    expect(printed.at(-1)).toBe('Name the issue by its number, or the advisory with --advisory, not both.');
    for (const advisory of ['GHSA-24fc-5gmw', 'ghsa-24fc-5gmw-5x4j', 'GHSA-aaaa-bbbb-cccc', 'CVE-2026-1']) {
      expect(run('github', 'adopt', '--advisory', advisory, ...FROM_GITHUB), advisory).toBe(1);
      expect(printed.at(-1)).toBe(
        `${advisory} is not the id of a GitHub security advisory, which is GHSA- and three groups of four.`,
      );
    }
    // Two words, or a flag it doesn't take, are a usage error.
    expect(run('github', 'adopt', '14', '15', ...FROM_GITHUB)).toBe(2);
    expect(run('github', 'adopt', '14', '--ban', ...FROM_GITHUB)).toBe(2);
    expect(contributions()).toEqual([]);
  });

  test('takes the kind, the author and the sentences, by their rules', () => {
    expect(run('github', 'adopt', '14', ...SAID)).toBe(2);
    expect(printed.at(-1)).toBe(
      'Say what kind of contribution it is and who made it: --kind <kind> --login <GitHub username> ' +
        '--id <id of the GitHub account>.',
    );
    expect(run('github', 'adopt', '14', '--kind', 'code', '--login', 'octocat', '--id', '583231')).toBe(2);
    expect(printed.at(-1)).toBe(
      'Say what the player contributed in both languages: --zh "<a sentence in Chinese>" --en "<a sentence in English>".',
    );
    expect(run('github', 'adopt', '14', '--kind', 'rant', '--login', 'octocat', '--id', '583231', ...SAID)).toBe(1);
    expect(printed.at(-1)).toBe('rant is not a kind of contribution: one of idea, game, bug, words, code.');
    for (const login of ['-octo-', 'octo cat', 'x'.repeat(40), 'octo@cat']) {
      expect(run('github', 'adopt', '14', '--kind', 'code', '--login', login, '--id', '583231', ...SAID), login).toBe(
        1,
      );
      expect(printed.at(-1)).toBe(`${login} is not a GitHub username.`);
    }
    expect(run('github', 'adopt', '14', '--kind', 'code', '--login', 'octocat', '--id', 'x', ...SAID)).toBe(1);
    expect(printed.at(-1)).toBe('x is not the id of a GitHub account.');
    expect(
      run('github', 'adopt', '14', '--kind', 'code', '--login', 'octocat', '--id', '583231', '--zh', ' ', '--en', EN),
    ).toBe(1);
    expect(printed.at(-1)).toBe('--zh shows nothing.');
    expect(contributions()).toEqual([]);
    // Cleaned as a bio is, and every kind.
    expect(
      run(
        'github',
        'adopt',
        '14',
        '--kind',
        'words',
        '--login',
        'Mona-Lisa',
        '--id',
        '7',
        '--zh',
        ' 提了词 ',
        '--en',
        'Proposed terms',
      ),
    ).toBe(0);
    expect(printed.at(-3)).toBe(
      'Adopted issue #14 as a contribution to the word lists. The home page lists it now, as Mona-Lisa, linked to ' +
        'https://github.com/Mona-Lisa, saying that the player contributed:',
    );
    expect(contributions()[0]).toMatchObject({
      kind: 'words',
      name: 'Mona-Lisa',
      summary: { zh: '提了词', en: 'Proposed terms' },
    });
    expect(run('github', 'adopt', '15', '--kind', 'game', '--login', 'octocat', '--id', '1', ...SAID)).toBe(0);
    expect(printed.at(-3)).toContain('Adopted issue #15 as an idea for a new game.');
  });
});

describe('github describe, anonymous and forget', () => {
  test('write the sentences again, list the author anonymously or forget them, at their request, and delete nothing', () => {
    expect(run('github', 'describe', '14', ...SAID)).toBe(1);
    expect(printed.at(-1)).toBe(
      "Issue #14 isn't adopted. Adopt it with github adopt 14 --kind <kind> --login <username> --id <number> " +
        '--zh <sentence> --en <sentence>.',
    );
    expect(run('github', 'adopt', '14', ...FROM_GITHUB)).toBe(0);
    printed = [];
    expect(run('github', 'describe', '14', '--zh', '整理了测试', '--en', 'Tidied the tests')).toBe(0);
    expect(printed).toEqual([
      'Issue #14 now says that the player contributed:',
      '  zh: 整理了测试',
      '  en: Tidied the tests',
      'It said:',
      `  zh: ${ZH}`,
      `  en: ${EN}`,
    ]);
    expect(run('github', 'describe', '14', '--zh', ZH)).toBe(2);
    expect(contributions()[0]).toMatchObject({
      name: 'octocat',
      summary: { zh: '整理了测试', en: 'Tidied the tests' },
    });

    expect(run('github', 'anonymous', '15')).toBe(1);
    expect(printed.at(-1)).toBe("Issue #15 isn't adopted.");
    expect(run('github', 'anonymous', '14')).toBe(0);
    expect(printed.at(-1)).toBe(
      'Issue #14 is listed as an anonymous player from now on. Its author, octocat, stays on record; github forget ' +
        '14 drops them too.',
    );
    expect(run('github', 'anonymous', '14')).toBe(1);
    expect(printed.at(-1)).toBe('Issue #14 is listed anonymously already.');
    expect(contributions()[0]).toMatchObject({ name: null });
    const store = new ContributionStore(database.db);
    expect(store.byRef({ issue: 14 })).toMatchObject({ login: 'octocat', githubId: 583231, named: false });

    expect(run('github', 'forget', '15')).toBe(1);
    expect(printed.at(-1)).toBe("Issue #15 isn't adopted.");
    expect(run('github', 'forget', '14')).toBe(0);
    expect(printed.at(-1)).toBe(
      'Forgot that octocat made issue #14: it is listed as an anonymous player, and nothing names its author any more.',
    );
    expect(run('github', 'forget', '14')).toBe(1);
    expect(printed.at(-1)).toBe('The author of issue #14 was forgotten already.');
    expect(store.byRef({ issue: 14 })).toMatchObject({ login: null, githubId: null, named: false });
    expect(contributions()).toHaveLength(1);
    // By the advisory too.
    expect(run('github', 'adopt', '--advisory', ADVISORY, '--login', 'hubot', '--id', '2', ...SAID)).toBe(0);
    expect(run('github', 'anonymous', '--advisory', ADVISORY)).toBe(0);
    expect(printed.at(-1)).toBe(
      `Advisory ${ADVISORY} is listed as an anonymous player from now on. Its author, hubot, stays on record; ` +
        `github forget --advisory ${ADVISORY} drops them too.`,
    );
    expect(run('github', 'forget', '--advisory', 'GHSA-24fc-5gmw')).toBe(1);
    expect(run('github', 'describe', '--advisory', ADVISORY, '14', ...SAID)).toBe(1);
  });
});

describe('github list', () => {
  test('shows every contribution from GitHub, the latest first, with its author as the home page lists them', () => {
    expect(run('github', 'list')).toBe(0);
    expect(printed).toEqual(['No contribution from GitHub yet.']);
    vi.useFakeTimers({ now: Date.parse('2026-10-14T08:00:00.000Z') });
    run('github', 'adopt', '14', ...FROM_GITHUB);
    printed = [];
    expect(run('github', 'list')).toBe(0);
    expect(printed).toEqual(['1 contribution from GitHub:', `#14  2026-10-14  code  octocat (583231)  ${ZH} · ${EN}`]);
    vi.setSystemTime(Date.parse('2026-10-15T08:00:00.000Z'));
    run('github', 'adopt', '16', '--kind', 'idea', '--login', 'hubot', '--id', '2', '--anonymous', ...SAID);
    vi.setSystemTime(Date.parse('2026-10-16T08:00:00.000Z'));
    run('github', 'adopt', '--advisory', ADVISORY, '--login', 'quiet-heron', '--id', '9', ...SAID);
    run('github', 'forget', '--advisory', ADVISORY);
    printed = [];
    expect(run('github', 'list')).toBe(0);
    expect(printed).toEqual([
      '3 contributions from GitHub, the latest first:',
      `${ADVISORY}  2026-10-16  bug  author forgotten  ${ZH} · ${EN}`,
      `#16  2026-10-15  idea  hubot (2), listed anonymously  ${ZH} · ${EN}`,
      `#14  2026-10-14  code  octocat (583231)  ${ZH} · ${EN}`,
    ]);
    // It only reads.
    expect(run('github', 'list', '14')).toBe(2);
  });
});

describe('content', () => {
  // A kept game of the second game whose setter, Ann, gave the words, as she asked, named; and a
  // game of the first game without words of the chair's own.
  function kept(gameId: string, game: string, setup: object, players: { playerId: string; accountId: number }[]) {
    new ReplayStore(database.db, () => Date.parse('2026-10-20T08:00:00.000Z')).add({
      game,
      gameId,
      ending: 'finished',
      outcome: { winner: 'student', reason: 'caught' },
      durationMs: 1000,
      setup,
      log: { v: 2, game, gameId, start: null, entries: [{ t: 1, by: null, type: 'end' }] },
      agentLog: null,
      players,
      counts: { accounts: players.length, guests: 0, agents: 0 },
      takeover: false,
      agentPlays: [],
      match: null,
      inMatch: false,
      practice: false,
      language: 'en',
      fields: ['fruit'],
      version: 'v',
      rules: 1,
      words: 'w',
    });
  }
  function games(): number {
    const ann = accounts.store.create('Ann', 'ann', 'hash', RECORDS_NOTICE_VERSION);
    if (!ann) throw new Error('no account');
    const setup = (named: boolean) => ({
      settings: {},
      players: [],
      words: { student: 'Apple', reviewer2: 'Pear' },
      source: { kind: 'setter', setter: 's', field: 'fruit', named },
    });
    kept('g1', 'impostor', setup(true), [{ playerId: 's', accountId: ann.id }]);
    kept('g2', 'impostor', setup(true), [{ playerId: 's', accountId: ann.id }]);
    kept('g3', 'keywords', { settings: {}, startingTeam: 'red', cards: [] }, []);
    return ann.id;
  }

  test('adopts the words a player gave in a game once, named as they asked or not, and lists them', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-21T08:00:00.000Z') });
    const ann = games();
    expect(run('content', 'adopt', 'g1', ...SAID)).toBe(0);
    expect(printed).toEqual([
      'Adopted, as #1:',
      `#1  2026-10-21  impostor g1  pair  Apple / Pear (fruit)  Ann  ${ZH} · ${EN}`,
    ]);
    expect(run('content', 'adopt', 'g1', ...SAID)).toBe(1);
    expect(printed.at(-1)).toBe('The words of game g1 were adopted already (content list).');
    expect(run('content', 'adopt', 'g2', '--anonymous', ...SAID)).toBe(0);
    expect(printed.at(-1)).toBe(`#2  2026-10-21  impostor g2  pair  Apple / Pear (fruit)  Ann, unnamed  ${ZH} · ${EN}`);
    // A game without words of a player's own, and one that isn't kept, have nothing to adopt.
    expect(run('content', 'adopt', 'g3', ...SAID)).toBe(1);
    expect(printed.at(-1)).toBe('Game g3 holds no words that a player gave.');
    expect(run('content', 'adopt', 'g9', ...SAID)).toBe(1);
    expect(printed.at(-1)).toBe('No game g9 is kept.');
    expect(run('content', 'adopt', 'g3')).toBe(2);
    printed.length = 0;
    expect(run('content', 'list')).toBe(0);
    expect(printed).toEqual([
      '2 adoptions from the games, the latest first:',
      `#2  2026-10-21  impostor g2  pair  Apple / Pear (fruit)  Ann, unnamed  ${ZH} · ${EN}`,
      `#1  2026-10-21  impostor g1  pair  Apple / Pear (fruit)  Ann  ${ZH} · ${EN}`,
    ]);
    // Words given by an account that is deleted since name nobody, and stay.
    new ContentStore(database.db).forget(ann);
    accounts.store.delete(ann);
    printed.length = 0;
    expect(run('content', 'list')).toBe(0);
    expect(printed.at(-1)).toBe(`#1  2026-10-21  impostor g1  pair  Apple / Pear (fruit)  nobody named  ${ZH} · ${EN}`);
  });

  test('says when nothing was adopted', () => {
    expect(run('content', 'list')).toBe(0);
    expect(printed).toEqual(['No words adopted from the games yet.']);
  });
});
