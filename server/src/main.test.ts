import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LIST_API, RECORDS_NOTICE_VERSION, SPONSORS_END, SPONSORS_START } from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { until } from '../test/helpers';
import { main, type MainOptions, type Running } from './main';
import { DATABASE_FILE, openDatabase, SNAPSHOT_DIR } from './store/database';
import { MIGRATIONS } from './store/migrations';

// Starting and stopping the server as index.ts does, with an environment, a log and an exit of
// the tests' own.

let dir: string;
let words: string;
let logs: { event: string; fields?: Record<string, unknown> }[];
let exits: number[];
const running: Running[] = [];
const blockers: Server[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reviewer2-main-'));
  words = join(dir, 'words');
  mkdirSync(words);
  const terms = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, en: `Term ${i}` }));
  writeFileSync(join(words, 'ml.json'), JSON.stringify({ id: 'ml', name: { zh: 'ml', en: 'ML' }, terms }));
  logs = [];
  exits = [];
});

afterEach(async () => {
  for (const server of running.splice(0)) await server.stop('test');
  for (const blocker of blockers.splice(0)) await new Promise((resolve) => blocker.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

// A port that nothing listens on, found by letting the system pick one and closing it again.
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function start(env: Record<string, string> = {}, options: MainOptions = {}): Promise<Running | null> {
  const started = await main({
    env: { HOST: '127.0.0.1', PORT: String(await freePort()), WORDS_DIR: words, PUBLIC_DIR: join(dir, 'none'), ...env },
    log: (event, fields) => logs.push({ event, ...(fields ? { fields } : {}) }),
    exit: (code) => exits.push(code),
    signals: false,
    ...options,
  });
  if (started) running.push(started);
  return started;
}

const events = () => logs.map(({ event }) => event);
const logged = (event: string) => logs.find((entry) => entry.event === event)?.fields;

// The names of the files under `data` that hold `text`, the database's own files and the snapshots
// alike. A snapshot is written through temporary files that are gone again a moment later, so one
// that was listed but can't be read any more holds nothing.
const filesHolding = (data: string, text: string): string[] =>
  readdirSync(data, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => {
      try {
        return readFileSync(join(entry.parentPath, entry.name)).includes(text);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    })
    .map((entry) => entry.name);

describe('starting', () => {
  test('without DATA_DIR keeps the database in memory, and says so', async () => {
    const started = await start();
    expect(started).not.toBeNull();
    expect(logged('database_opened')).toEqual({
      storage: 'memory',
      note: 'everything in it is lost when the server stops; set DATA_DIR to keep it',
    });
    expect(events()).toEqual(['word_lists_loaded', 'database_opened', 'listening']);
    expect(exits).toEqual([]);
  });

  test('says when the limit on new accounts is raised, and when the login cookie is not Secure', async () => {
    await start({ ACCOUNTS_PER_HOUR: '100', COOKIE_SECURE: '0' });
    expect(logged('accounts_per_hour_raised')).toEqual({ accountsPerHour: 100, default: 5 });
    expect(logged('cookies_not_secure')).toEqual({ hint: 'only for plain HTTP, as in development' });
    expect(logged('listening')).toMatchObject({ accountsPerHour: 100, cookieSecure: false, mail: false });
  });

  test('keeps as much feedback as MAX_FEEDBACK says', async () => {
    const started = (await start({ MAX_FEEDBACK: '25000' })) as Running;
    expect(started.feedback.limits).toMatchObject({ maxEntries: 25_000, maxBytes: 125 * 2 ** 20 });
    expect(logged('listening')).toMatchObject({ maxFeedback: 25_000 });
  });

  test('with CONTENT_DIR shows the lists of thanks there, and says at once which it can use', async () => {
    const content = join(dir, 'content');
    mkdirSync(content);
    const github = '## GitHub Sponsors\n\n- [octocat](https://github.com/octocat)';
    writeFileSync(join(content, 'SPONSORS.md'), `# Sponsors\n\n${SPONSORS_START}\n${github}\n${SPONSORS_END}\n`);
    const started = (await start({ CONTENT_DIR: content })) as Running;
    expect(logs.filter(({ event }) => event.startsWith('thanks_list_'))).toEqual([
      {
        event: 'thanks_list_skipped',
        fields: { file: join(content, 'ACKNOWLEDGMENTS.md'), reason: 'ENOENT', shown: 'bundled' },
      },
      { event: 'thanks_list_read', fields: { file: join(content, 'SPONSORS.md'), entries: 1 } },
    ]);
    const { port } = started.server.http.address() as AddressInfo;
    expect(await (await fetch(`http://127.0.0.1:${port}${LIST_API.sponsors}`)).json()).toEqual({
      ok: true,
      sections: [{ kind: 'github', entries: [{ name: 'octocat', link: 'https://github.com/octocat', thanks: null }] }],
    });
  });

  test('gives accounts email with both the server secret and the mailer', async () => {
    const started = (await start({
      SERVER_SECRET: 's'.repeat(44),
      MAILER_SOCKET: join(dir, 'mailer.sock'),
    })) as Running;
    expect(logged('listening')).toMatchObject({ mail: true });
    expect(started.accounts.mailAvailable).toBe(true);
    await started.stop('test');
    running.splice(0);
    logs = [];
    await start({ SERVER_SECRET: 's'.repeat(44) });
    expect(logged('listening')).toMatchObject({ mail: false });
  });

  test('with DATA_DIR keeps the database there, from one start to the next', async () => {
    const data = join(dir, 'data');
    mkdirSync(data);
    const first = (await start({ DATA_DIR: data })) as Running;
    expect(logged('database_opened')).toEqual({
      storage: 'file',
      file: join(data, DATABASE_FILE),
      journal: 'wal',
      schema: 24,
    });
    expect(logged('database_migrated')).toEqual({ from: 0, to: 24, snapshot: null });
    first.feedback.add({
      kind: 'idea',
      text: 'Kept',
      contact: null,
      credit: null,
      accountId: null,
      linkProfile: false,
      version: 'test',
      language: 'en',
      page: 'home',
      userAgent: null,
    });
    await first.stop('SIGTERM');
    expect(exits).toEqual([0]);
    // The database is closed.
    expect(() => first.feedback.count()).toThrow();

    logs = [];
    const second = (await start({ DATA_DIR: data })) as Running;
    expect(second.feedback.latest(1)[0]?.text).toBe('Kept');
    expect(events()).not.toContain('database_migrated');
  });

  test('with DATA_DIR keeps avatars beside the database, and deletes those that no account shows', async () => {
    const data = join(dir, 'data');
    mkdirSync(join(data, 'avatars'), { recursive: true });
    const unused = `${'a'.repeat(64)}.jpg`;
    writeFileSync(join(data, 'avatars', unused), 'nobody shows this');
    await start({ DATA_DIR: data });
    expect(logged('avatars_cleared')).toEqual({ count: 1 });
    expect(readdirSync(join(data, 'avatars'))).toEqual([]);
  });

  test('with DATA_DIR takes a snapshot on start and every hour', async () => {
    const data = join(dir, 'data');
    mkdirSync(data);
    await start({ DATA_DIR: data }, { housekeepingMs: 50 });
    const saved = () => logs.filter(({ event }) => event === 'snapshot_saved');
    await until(() => saved().length >= 2, 'the second snapshot');
    const file = saved()[0]?.fields?.file;
    expect(file).toMatch(/^reviewer2-\d{8}T\d{6}Z\.db$/);
    expect(readdirSync(join(data, SNAPSHOT_DIR))).toContain(file);
  });

  test('keeps one snapshot from before a recount that fails on every start, or the one from before the migration', async () => {
    const data = join(dir, 'data');
    mkdirSync(data);
    // A database of the release before, with a finished game whose record can't be played through.
    const old = await openDatabase(data, { migrations: MIGRATIONS.slice(0, 23) });
    old.db.exec(`
      INSERT INTO replays (game_id, game, ended_at, log, ending, winner, reason, started_at, setup, accounts, guests, agents,
        takeover, in_match, practice, language, fields, version, rules, words) VALUES
        ('g1', 'keywords', '2026-10-01T00:01:00.000Z', '{"v":2,"game":"keywords","gameId":"g1","start":null,"entries":[]}',
          'finished', 'red', 'found', '2026-10-01T00:00:00.000Z', NULL, 0, 2, 0, 0, 0, 0, 'en', '["ml"]', 'v', 4, 'w')
    `);
    old.db.close();
    const cannot = /the record of game g1 cannot be counted again/;
    // The first start migrates, after a snapshot, which serves the recount too.
    await expect(start({ DATA_DIR: data })).rejects.toThrow(cannot);
    expect(logged('database_migrated')).toMatchObject({ from: 23, to: 24 });
    const snapshots = () => readdirSync(join(data, SNAPSHOT_DIR)).sort();
    expect(snapshots()).toEqual([expect.stringMatching(/-before-v24\.db$/)]);
    // The service is started again every few seconds after a start that failed: each start takes
    // a snapshot of its own now, and keeps the latest alone.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await expect(start({ DATA_DIR: data })).rejects.toThrow(cannot);
    }
    expect(snapshots()).toEqual([
      expect.stringMatching(/-before-v24\.db$/),
      expect.stringMatching(/-before-recount\.db$/),
    ]);
  });

  test('clears a contact that is 90 days old, from the files and not only the table', async () => {
    const data = join(dir, 'data');
    mkdirSync(data);
    const contact = 'old-contact@example.com';
    const old = new Date(Date.now() - 91 * 24 * 60 * 60_000).toISOString();
    const { db } = await openDatabase(data);
    db.prepare(
      "INSERT INTO feedback (created_at, kind, text, contact, version, language, page) VALUES (?, 'idea', 'Old', ?, 'v1', 'en', 'home')",
    ).run(old, contact);
    db.close();
    const holds = () => filesHolding(data, contact);
    expect(holds()).toEqual([DATABASE_FILE]);

    const started = (await start({ DATA_DIR: data })) as Running;
    expect(logged('contacts_cleared')).toEqual({ count: 1, walTruncated: true });
    expect(started.feedback.latest(1)[0]).toMatchObject({ text: 'Old', contact: null });
    // The snapshot that the start takes comes after the clearing.
    await until(() => events().includes('snapshot_saved'), 'the snapshot');
    expect(holds()).toEqual([]);
  });

  test('purges the feedback that has been in the trash for 30 days, from the files and not only the table', async () => {
    const data = join(dir, 'data');
    mkdirSync(data);
    const text = 'BUY CHEAP WATCHES at spam.example';
    const { db } = await openDatabase(data);
    const add = db.prepare(
      "INSERT INTO feedback (created_at, kind, text, version, language, page, deleted_at) VALUES ('t', 'idea', ?, 'v1', 'en', 'home', ?)",
    );
    const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
    add.run(text, daysAgo(31));
    add.run('Still in the trash', daysAgo(29));
    add.run('Open', null);
    db.close();
    const holds = () => filesHolding(data, text);
    expect(holds()).toEqual([DATABASE_FILE]);

    const started = (await start({ DATA_DIR: data })) as Running;
    expect(logged('feedback_purged')).toEqual({ count: 1, walTruncated: true });
    expect(events()).not.toContain('contacts_cleared');
    expect(started.feedback.latest(10).map(({ text: kept, status }) => [kept, status])).toEqual([
      ['Open', 'new'],
      ['Still in the trash', 'trash'],
    ]);
    // The log says how much was purged, and nothing of what; the snapshot that the start takes
    // comes after the purge.
    expect(JSON.stringify(logs)).not.toContain('WATCHES');
    await until(() => events().includes('snapshot_saved'), 'the snapshot');
    expect(holds()).toEqual([]);
  });

  test('truncates the WAL of a cleared contact at the next hour when another connection was in the way', async () => {
    const data = join(dir, 'data');
    mkdirSync(data);
    const contact = 'old-contact@example.com';
    const old = new Date(Date.now() - 91 * 24 * 60 * 60_000).toISOString();
    const { db } = await openDatabase(data);
    db.prepare(
      "INSERT INTO feedback (created_at, kind, text, contact, version, language, page) VALUES (?, 'idea', 'Old', ?, 'v1', 'en', 'home')",
    ).run(old, contact);
    db.close();
    // The operator's sqlite3, in the middle of reading when the server starts.
    const reader = new DatabaseSync(join(data, DATABASE_FILE));
    reader.exec('BEGIN');
    reader.prepare('SELECT count(*) FROM feedback').get();
    // Until the WAL is written back into the database file, the file still has the page as it
    // was, contact and all; the WAL has the page as it is now.
    const holds = () => filesHolding(data, contact);

    const started = performance.now();
    await start({ DATA_DIR: data }, { housekeepingMs: 50 });
    // The server didn't wait the busy timeout out: the start took well under its 5 seconds.
    expect(performance.now() - started).toBeLessThan(2000);
    expect(logged('contacts_cleared')).toEqual({ count: 1, walTruncated: false });
    expect(holds()).toEqual([DATABASE_FILE]);
    // Nothing more is cleared, but the WAL is tried again every hour, until it is truncated, and
    // the log says so each time, apart from the clearing of contacts, of which there is none.
    const tried = () => logs.filter(({ event }) => event === 'wal_truncated');
    await until(() => tried().length >= 2, 'two more tries');
    expect(tried().at(-1)?.fields).toEqual({ ok: false });
    expect(logs.filter(({ event }) => event === 'contacts_cleared')).toHaveLength(1);
    expect(holds()).toEqual([DATABASE_FILE]);
    reader.exec('COMMIT');
    reader.close();
    await until(() => tried().at(-1)?.fields?.ok === true, 'the WAL to be truncated');
    expect(holds()).toEqual([]);
    // Once it is, the hour's clearing has nothing to say.
    const done = tried().length;
    await until(() => logs.filter(({ event }) => event === 'snapshot_saved').length >= 2, 'another hour');
    expect(tried().length).toBe(done);
  });

  test('ends with 1 and one line of log when the port is taken', async () => {
    const blocker = createServer();
    blockers.push(blocker);
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const { port } = blocker.address() as { port: number };
    expect(await start({ PORT: String(port) })).toBeNull();
    expect(exits).toEqual([1]);
    expect(logged('listen_failed')).toEqual({
      host: '127.0.0.1',
      port,
      code: 'EADDRINUSE',
      message: expect.stringContaining('EADDRINUSE'),
    });
    expect(events()).not.toContain('listening');
  });

  test('is refused for a word library without a list', async () => {
    rmSync(join(words, 'ml.json'));
    await expect(start()).rejects.toThrow(`there are no word lists in ${words}`);
    expect(events()).not.toContain('database_opened');
  });

  test("is refused for a DATA_DIR that isn't there", async () => {
    await expect(start({ DATA_DIR: join(dir, 'missing') })).rejects.toThrow(/^cannot use DATA_DIR: ENOENT/);
    expect(existsSync(join(dir, 'missing'))).toBe(false);
  });

  test('serves the feedback and the number of accounts on the status page', async () => {
    const statusPort = await freePort();
    const started = (await start({ STATUS_PORT: String(statusPort) })) as Running;
    started.feedback.add({
      kind: 'bug',
      text: '<script>alert(1)</script>',
      contact: null,
      credit: null,
      accountId: null,
      linkProfile: false,
      version: 'test',
      language: 'zh',
      page: 'room',
      userAgent: 'Agent',
    });
    started.accounts.store.create('Ann', 'ann', 'scrypt$hash', RECORDS_NOTICE_VERSION);
    await until(() => events().includes('status_listening'), 'the status page');
    const status = await (await fetch(`http://127.0.0.1:${statusPort}/`)).text();
    expect(status).toContain('<p class="note">1 in all &middot; <a href="/feedback">Read it</a></p>');
    expect(status).toContain('<dt>Accounts</dt><dd>1<small>registered</small></dd>');
    expect(status).toContain('<dt>New accounts</dt><dd>1<small>in the last 7 days</small></dd>');
    const page = await (await fetch(`http://127.0.0.1:${statusPort}/feedback`)).text();
    expect(page).toContain('1 in all, newest first');
    expect(page).toContain('&#60;script&#62;alert(1)&#60;/script&#62;');
    expect(page).not.toContain('<script>');
  });
});

describe('stopping', () => {
  test('stops the server, closes the database and ends with 0', async () => {
    const started = (await start()) as Running;
    await started.stop('SIGTERM');
    expect(logged('stopping')).toEqual({ signal: 'SIGTERM', rooms: 0 });
    expect(exits).toEqual([0]);
    expect(() => started.feedback.count()).toThrow();
    expect(started.server.http.listening).toBe(false);
    // A second signal changes nothing.
    await started.stop('SIGINT');
    expect(exits).toEqual([0]);
  });

  test('ends with 1 when it takes too long', async () => {
    const started = (await start({}, { stopMs: 50 })) as Running;
    const stop = started.server.stop;
    let finish = () => {};
    started.server.stop = () =>
      new Promise<void>((resolve) => {
        finish = () => void stop().then(resolve);
      });
    const stopping = started.stop('SIGTERM');
    await until(() => exits.length > 0, 'the process to end');
    expect(exits).toEqual([1]);
    expect(logged('stop_timed_out')).toEqual({ ms: 50 });
    // When the stop finishes after all, the process has ended already.
    finish();
    await stopping;
    expect(exits).toEqual([1]);
  });
});
