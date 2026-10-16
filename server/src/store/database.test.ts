import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  BUSY_TIMEOUT_MS,
  DATABASE_FILE,
  openDatabase,
  schemaVersion,
  SNAPSHOT_DIR,
  truncateWal,
  type Database,
} from './database';
import { MIGRATIONS } from './migrations';
import { AccountStore } from './accounts';
import { RecordStore } from './records';

const NOW = Date.UTC(2026, 9, 9, 13, 30, 5);

let dir: string;
let now: number;
let logs: { event: string; fields?: Record<string, unknown> }[];
const opened: Database[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reviewer2-db-'));
  now = NOW;
  logs = [];
});

afterEach(() => {
  for (const { db } of opened.splice(0)) if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function open(dataDir: string | null, migrations: readonly string[] = MIGRATIONS): Promise<Database> {
  const database = await openDatabase(dataDir, {
    migrations,
    now: () => now,
    log: (event, fields) => logs.push({ event, ...(fields ? { fields } : {}) }),
  });
  opened.push(database);
  return database;
}

const tables = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
    ({ name }) => name,
  );

const pragma = (db: DatabaseSync, name: string) => Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0];

describe('a database in DATA_DIR', () => {
  test('is created with the latest schema, in WAL mode and with its settings', async () => {
    const database = await open(dir);
    expect(database).toMatchObject({
      file: join(dir, DATABASE_FILE),
      snapshots: join(dir, SNAPSHOT_DIR),
      journal: 'wal',
      schema: MIGRATIONS.length,
      migratedFrom: 0,
      beforeMigration: null,
    });
    // sqlite_sequence is SQLite's own, for the ids that are never given out twice.
    expect(tables(database.db)).toEqual([
      'accounts',
      'agent_plays',
      'email_tokens',
      'feedback',
      'friendships',
      'game_players',
      'game_records',
      'likes',
      'match_records',
      'replays',
      'reports',
      'sessions',
      'settings',
      'sqlite_sequence',
      'titles',
    ]);
    expect(schemaVersion(database.db)).toBe(MIGRATIONS.length);
    expect(pragma(database.db, 'busy_timeout')).toBe(BUSY_TIMEOUT_MS);
    expect(pragma(database.db, 'foreign_keys')).toBe(1);
    expect(pragma(database.db, 'secure_delete')).toBe(1);
    // A new database has nothing to lose, so it gets no snapshot.
    expect(existsSync(join(dir, SNAPSHOT_DIR))).toBe(false);
  });

  test('truncates its WAL unless another connection is in the middle of it, and then says so at once', async () => {
    const { db } = await open(dir);
    db.exec(
      "INSERT INTO feedback (created_at, kind, text, version, language, page) VALUES ('t', 'idea', 'x', 'v', 'en', 'home')",
    );
    expect(truncateWal(db)).toBe(true);
    expect(statSync(join(dir, `${DATABASE_FILE}-wal`)).size).toBe(0);

    db.exec("UPDATE feedback SET text = 'y'");
    // The operator's sqlite3, in the middle of reading.
    const reader = new DatabaseSync(join(dir, DATABASE_FILE));
    reader.exec('BEGIN');
    reader.prepare('SELECT count(*) FROM feedback').get();
    const started = performance.now();
    expect(truncateWal(db)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(statSync(join(dir, `${DATABASE_FILE}-wal`)).size).toBeGreaterThan(0);
    // The timeout for ordinary writes is back in place.
    expect(pragma(db, 'busy_timeout')).toBe(BUSY_TIMEOUT_MS);

    reader.exec('COMMIT');
    reader.close();
    expect(truncateWal(db)).toBe(true);
    expect(statSync(join(dir, `${DATABASE_FILE}-wal`)).size).toBe(0);
  });

  test('keeps its data, and is left alone when it is up to date', async () => {
    const first = await open(dir);
    first.db.exec(
      "INSERT INTO feedback (id, created_at, kind, text, version, language, page) VALUES (1, 'now', 'idea', 'Keep me', 'v1', 'en', 'home')",
    );
    first.db.close();

    const again = await open(dir);
    expect(again.migratedFrom).toBeNull();
    expect(again.db.prepare('SELECT text FROM feedback').all()).toEqual([{ text: 'Keep me' }]);
    expect(existsSync(join(dir, SNAPSHOT_DIR))).toBe(false);
  });

  test('is migrated in order, after a snapshot of what it held before', async () => {
    const one = ['CREATE TABLE a (x INTEGER) STRICT'];
    const first = await open(dir, one);
    first.db.exec('INSERT INTO a VALUES (1)');
    first.db.close();

    const three = [...one, 'ALTER TABLE a ADD COLUMN y INTEGER', 'CREATE TABLE b (z TEXT); UPDATE a SET y = x + 1'];
    const migrated = await open(dir, three);
    expect(migrated).toMatchObject({ schema: 3, migratedFrom: 1 });
    expect(migrated.db.prepare('SELECT x, y FROM a').all()).toEqual([{ x: 1, y: 2 }]);
    expect(tables(migrated.db)).toEqual(['a', 'b']);
    expect(schemaVersion(migrated.db)).toBe(3);

    // The snapshot is whole, in one file, and holds the database as it was before.
    const name = 'reviewer2-20261009T133005Z-before-v3.db';
    expect(migrated.beforeMigration).toBe(join(dir, SNAPSHOT_DIR, name));
    expect(readdirSync(join(dir, SNAPSHOT_DIR))).toEqual([name]);
    const snapshot = new DatabaseSync(join(dir, SNAPSHOT_DIR, name), { readOnly: true });
    expect(schemaVersion(snapshot)).toBe(1);
    expect(snapshot.prepare('SELECT * FROM a').all()).toEqual([{ x: 1 }]);
    snapshot.close();
  });

  test('of the second release gets the records of matches, which go with the account', async () => {
    const second = await open(dir, MIGRATIONS.slice(0, 2));
    second.db.exec(
      "INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (1, 'Ann', 'ann', 'h', 'now')",
    );
    second.db.exec("INSERT INTO titles VALUES (NULL, 1, 'best_paper', NULL, 'now')");
    second.db.close();

    const { db } = await open(dir, MIGRATIONS.slice(0, 3));
    expect(schemaVersion(db)).toBe(3);
    db.exec("INSERT INTO match_records VALUES (NULL, 1, 'keywords', 'm', 'now', 3, 1, 4, 9, 'best_paper')");
    db.exec("INSERT INTO titles VALUES (NULL, 1, 'best_paper', 'm', 'now')");
    // A match awards a title once; titles without a match are left alone.
    expect(() => db.exec("INSERT INTO titles VALUES (NULL, 1, 'best_paper', 'm', 'now')")).toThrow(/UNIQUE/);
    db.exec("INSERT INTO titles VALUES (NULL, 1, 'best_paper', NULL, 'now')");
    db.exec('DELETE FROM accounts WHERE id = 1');
    for (const table of ['match_records', 'titles']) {
      expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).get(), table).toEqual({ count: 0 });
    }
  });

  test('of the third release keeps its feedback and accounts when it gets the acknowledgments', async () => {
    const third = await open(dir, MIGRATIONS.slice(0, 3));
    third.db.exec(
      "INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (1, 'Ann', 'ann', 'h', 'now')",
    );
    third.db.exec(
      "INSERT INTO feedback VALUES (7, 'now', 'idea', 'Keep me', 'me@example.com', 'v1', 'zh', 'room', NULL)",
    );
    third.db.exec("INSERT INTO titles VALUES (NULL, 1, 'best_paper', 'm', 'now')");
    third.db.exec("INSERT INTO match_records VALUES (NULL, 1, 'keywords', 'm', 'now', 3, 1, 4, 9, 'best_paper')");
    third.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 4));
    expect(migrated).toMatchObject({ schema: 4, migratedFrom: 3 });
    expect(migrated.beforeMigration).toBe(join(dir, SNAPSHOT_DIR, 'reviewer2-20261009T133005Z-before-v4.db'));
    const { db } = migrated;
    // The feedback that was there has no name and no account.
    expect(db.prepare('SELECT * FROM feedback').all()).toEqual([
      {
        id: 7,
        created_at: 'now',
        kind: 'idea',
        text: 'Keep me',
        contact: 'me@example.com',
        version: 'v1',
        language: 'zh',
        page: 'room',
        user_agent: null,
        credit: null,
        account_id: null,
      },
    ]);
    expect(db.prepare('SELECT username FROM accounts').all()).toEqual([{ username: 'Ann' }]);
    expect(db.prepare('SELECT count(*) AS n FROM titles').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM match_records').get()).toEqual({ n: 1 });

    // New feedback may name its account, and an acknowledgment its feedback and its account. A piece
    // of feedback is adopted once, and an acknowledgment is of one of the three kinds.
    db.exec("UPDATE feedback SET credit = 'Ann L', account_id = 1 WHERE id = 7");
    db.exec("INSERT INTO acknowledgments VALUES (NULL, 'Ann L', 'feedback', 'now', 7, 1)");
    db.exec("INSERT INTO acknowledgments VALUES (NULL, 'Bob', 'playtesting', 'now', NULL, NULL)");
    expect(() => db.exec("INSERT INTO acknowledgments VALUES (NULL, 'Again', 'feedback', 'now', 7, NULL)")).toThrow(
      /UNIQUE/,
    );
    expect(() => db.exec("INSERT INTO acknowledgments VALUES (NULL, 'Cat', 'praise', 'now', NULL, NULL)")).toThrow(
      /CHECK/,
    );
    expect(() => db.exec("INSERT INTO acknowledgments VALUES (NULL, 'Dan', 'words', 'now', NULL, 9)")).toThrow(
      /FOREIGN KEY/,
    );
    // The account goes from the feedback and the acknowledgment when it is deleted, and the name
    // stays. Feedback deleted by hand with sqlite3 would leave the acknowledgment its number.
    db.exec('DELETE FROM accounts WHERE id = 1');
    expect(db.prepare('SELECT account_id FROM feedback WHERE id = 7').get()).toEqual({ account_id: null });
    expect(db.prepare('SELECT name, account_id, feedback_id FROM acknowledgments ORDER BY id').all()).toEqual([
      { name: 'Ann L', account_id: null, feedback_id: 7 },
      { name: 'Bob', account_id: null, feedback_id: null },
    ]);
    db.exec('DELETE FROM feedback WHERE id = 7');
    expect(db.prepare('SELECT count(*) AS n FROM acknowledgments WHERE feedback_id = 7').get()).toEqual({ n: 1 });
  });

  test('of the fourth release has its feedback rebuilt, every row as it was, with links and issues', async () => {
    const fourth = await open(dir, MIGRATIONS.slice(0, 4));
    fourth.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (1, 'Ann', 'ann', 'h', 'now');
      INSERT INTO feedback VALUES (3, '2026-10-01T08:00:00.000Z', 'bug', 'Line one\nLine two', NULL, 'v0.0.20', 'en', 'room', 'UA', NULL, NULL);
      INSERT INTO feedback VALUES (7, '2026-10-02T09:00:00.000Z', 'idea', 'Keep me', 'me@example.com', 'v1', 'zh', 'room', NULL, 'Ann L', 1);
      INSERT INTO feedback VALUES (12, '2026-10-03T10:00:00.000Z', 'words', '\u{8bcd}\u{5e93}', 'wechat: r2', 'v2', 'zh', 'home', NULL, 'Bob', NULL);
      INSERT INTO acknowledgments VALUES (NULL, 'Ann L', 'feedback', 'now', 7, 1);
    `);
    // Ids up to 20 were given out once, as by rows that were deleted by hand.
    fourth.db.exec("UPDATE sqlite_sequence SET seq = 20 WHERE name = 'feedback'");
    const before = fourth.db.prepare('SELECT * FROM feedback ORDER BY id').all();
    fourth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 5));
    expect(migrated).toMatchObject({ schema: 5, migratedFrom: 4 });
    expect(migrated.beforeMigration).toBe(join(dir, SNAPSHOT_DIR, 'reviewer2-20261009T133005Z-before-v5.db'));
    const { db } = migrated;
    // Every row is as it was, with its id, and has no link, wasn't asked about an issue, and has none.
    expect(before.map((row) => row.id)).toEqual([3, 7, 12]);
    expect(db.prepare('SELECT * FROM feedback ORDER BY id').all()).toEqual(
      before.map((row) => ({ ...row, link: null, public_issue: null, issue: null })),
    );
    expect(db.prepare('SELECT name, feedback_id, account_id FROM acknowledgments').all()).toEqual([
      { name: 'Ann L', feedback_id: 7, account_id: 1 },
    ]);
    // The table is in its place, with its indexes, and the next id goes on from the old count.
    expect(tables(db)).not.toContain('new_feedback');
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'feedback' ORDER BY name").all(),
    ).toEqual([{ name: 'feedback_account' }, { name: 'feedback_contact_expiry' }]);
    expect(db.prepare("SELECT name, seq FROM sqlite_sequence WHERE name LIKE '%feedback'").all()).toEqual([
      { name: 'feedback', seq: 20 },
    ]);
    const add = (kind: string, language = 'en') =>
      db
        .prepare('INSERT INTO feedback (created_at, kind, text, version, language, page) VALUES (?, ?, ?, ?, ?, ?)')
        .run('now', kind, 'New', 'v3', language, 'home').lastInsertRowid;
    expect(add('game')).toBe(21);

    // The kind is the code's to check, and the rest is checked as before.
    expect(add('later')).toBe(22);
    expect(() => add('idea', 'fr')).toThrow(/CHECK/);
    expect(() =>
      db.exec(
        "INSERT INTO feedback (created_at, text, version, language, page) VALUES ('now', 'x', 'v3', 'en', 'home')",
      ),
    ).toThrow(/NOT NULL/);
    db.exec("UPDATE feedback SET link = 'https://ann.example/', public_issue = 1, issue = 40 WHERE id = 7");
    expect(() => db.exec('UPDATE feedback SET public_issue = 2 WHERE id = 7')).toThrow(/CHECK/);
    expect(() => db.exec('UPDATE feedback SET issue = 0 WHERE id = 7')).toThrow(/CHECK/);
    expect(() => db.exec('UPDATE feedback SET account_id = 9 WHERE id = 7')).toThrow(/FOREIGN KEY/);
    // The account still goes from its feedback when it is deleted.
    db.exec('DELETE FROM accounts WHERE id = 1');
    expect(db.prepare('SELECT credit, account_id FROM feedback WHERE id = 7').get()).toEqual({
      credit: 'Ann L',
      account_id: null,
    });
  });

  test('of the fourth release with no feedback at all gets the rebuilt table, which starts from 1', async () => {
    (await open(dir, MIGRATIONS.slice(0, 4))).db.close();
    const { db } = await open(dir);
    expect(db.prepare('SELECT count(*) AS n FROM feedback').get()).toEqual({ n: 0 });
    db.exec(
      "INSERT INTO feedback (created_at, kind, text, version, language, page) VALUES ('now', 'game', 'New', 'v3', 'en', 'home')",
    );
    expect(db.prepare('SELECT id, kind FROM feedback').all()).toEqual([{ id: 1, kind: 'game' }]);
  });

  test('of the fifth release keeps its accounts, feedback and acknowledgments when it gets the reports', async () => {
    const fifth = await open(dir, MIGRATIONS.slice(0, 5));
    fifth.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (1, 'Ann', 'ann', 'h', 'now'), (2, 'Bob', 'bob', 'h', 'now');
      INSERT INTO feedback VALUES (7, 'now', 'game', 'Keep me', 'me@example.com', 'v1', 'zh', 'room', NULL, 'Ann L', 1, 'https://ann.example/', 1, 40);
      INSERT INTO acknowledgments VALUES (NULL, 'Ann L', 'feedback', 'now', 7, 1);
    `);
    const feedback = fifth.db.prepare('SELECT * FROM feedback').all();
    fifth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 6));
    expect(migrated).toMatchObject({ schema: 6, migratedFrom: 5 });
    expect(migrated.beforeMigration).toBe(join(dir, SNAPSHOT_DIR, 'reviewer2-20261009T133005Z-before-v6.db'));
    const { db } = migrated;
    // The accounts that were there may enter public rooms, and everything else is as it was.
    expect(db.prepare('SELECT username, public_barred FROM accounts ORDER BY id').all()).toEqual([
      { username: 'Ann', public_barred: 0 },
      { username: 'Bob', public_barred: 0 },
    ]);
    expect(db.prepare('SELECT * FROM feedback').all()).toEqual(feedback);
    expect(db.prepare('SELECT name, feedback_id, account_id FROM acknowledgments').all()).toEqual([
      { name: 'Ann L', feedback_id: 7, account_id: 1 },
    ]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    // A report names accounts that exist, and stays, unlinked, when either is deleted.
    db.exec("INSERT INTO reports VALUES (NULL, 'now', 1, 2, 'Bob', 'K7QX', 'Rude')");
    expect(() => db.exec("INSERT INTO reports VALUES (NULL, 'now', 1, 9, 'Nobody', 'K7QX', NULL)")).toThrow(
      /FOREIGN KEY/,
    );
    expect(() => db.exec('UPDATE accounts SET public_barred = 2 WHERE id = 2')).toThrow(/CHECK/);
    db.exec('DELETE FROM accounts WHERE id = 2');
    expect(db.prepare('SELECT reporter_id, reported_id, reported_name FROM reports').all()).toEqual([
      { reporter_id: 1, reported_id: null, reported_name: 'Bob' },
    ]);
  });

  test('of the sixth release keeps its records when it gets the replays and the friendships', async () => {
    const sixth = await open(dir, MIGRATIONS.slice(0, 6));
    sixth.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (1, 'Ann', 'ann', 'h', 'now'), (2, 'Bob', 'bob', 'h', 'now');
      INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict)
        VALUES (1, 'keywords', 'g1', 'now', 'red', 'captain', 'red', 1, 'oral'), (2, 'keywords', 'g1', 'now', 'blue', 'guesser', 'red', 0, 'reject');
      INSERT INTO reports VALUES (NULL, 'now', 1, 2, 'Bob', 'K7QX', 'Rude');
    `);
    const reports = sixth.db.prepare('SELECT * FROM reports').all();
    sixth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 8));
    expect(migrated).toMatchObject({ schema: 8, migratedFrom: 6 });
    expect(migrated.beforeMigration).toBe(join(dir, SNAPSHOT_DIR, 'reviewer2-20261009T133005Z-before-v8.db'));
    const { db } = migrated;
    // The records that were there count as 0 points, and the rest is as it was.
    expect(db.prepare('SELECT account_id, game_id, points FROM game_records ORDER BY id').all()).toEqual([
      { account_id: 1, game_id: 'g1', points: 0 },
      { account_id: 2, game_id: 'g1', points: 0 },
    ]);
    expect(db.prepare('SELECT * FROM reports').all()).toEqual(reports);
    expect(tables(db)).toEqual(expect.arrayContaining(['replays', 'friendships']));
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // A replay is kept once for each game, and stays when a player who was in it is deleted.
    db.exec("INSERT INTO replays VALUES ('g1', 'keywords', 'now', '{}')");
    expect(() => db.exec("INSERT INTO replays VALUES ('g1', 'keywords', 'later', '{}')")).toThrow(/UNIQUE/);
    db.exec('DELETE FROM accounts WHERE id = 1');
    expect(db.prepare('SELECT game_id FROM replays').all()).toEqual([{ game_id: 'g1' }]);
    expect(db.prepare('SELECT account_id FROM game_records').all()).toEqual([{ account_id: 2 }]);
  });

  test('of the seventh release keeps its records and replays, which count for no points, when it gets the friendships', async () => {
    const seventh = await open(dir, MIGRATIONS.slice(0, 7));
    seventh.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (1, 'Ann', 'ann', 'h', 'now'), (2, 'Bob', 'bob', 'h', 'now'), (3, 'Cat', 'cat', 'h', 'now');
      INSERT INTO game_records VALUES (NULL, 1, 'keywords', 'g', 'now', 'red', 'captain', 'red', 1, 'oral');
      INSERT INTO replays VALUES ('g', 'keywords', 'now', '{}');
      INSERT INTO reports VALUES (NULL, 'now', 1, 2, 'Bob', 'K7QX', 'Rude');
    `);
    const reports = seventh.db.prepare('SELECT * FROM reports').all();
    seventh.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 8));
    expect(migrated).toMatchObject({ schema: 8, migratedFrom: 7 });
    expect(migrated.beforeMigration).toBe(join(dir, SNAPSHOT_DIR, 'reviewer2-20261009T133005Z-before-v8.db'));
    const { db } = migrated;
    // The record that was there counts as 0 points, and the rest is as it was.
    expect(db.prepare('SELECT game_id, verdict, points FROM game_records').all()).toEqual([
      { game_id: 'g', verdict: 'oral', points: 0 },
    ]);
    expect(db.prepare('SELECT game_id, data FROM replays').all()).toEqual([{ game_id: 'g', data: '{}' }]);
    expect(db.prepare('SELECT * FROM reports').all()).toEqual(reports);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.exec(
      "INSERT INTO game_records VALUES (NULL, 1, 'keywords', 'g2', 'now', 'blue', 'guesser', 'red', 0, 'reject', -2)",
    );
    expect(db.prepare('SELECT sum(points) AS points FROM game_records WHERE account_id = 1').get()).toEqual({
      points: -2,
    });

    // A pair of accounts has one row, whichever way round, of one of the three statuses, and never
    // an account with itself; the rows go with either account, and the replay stays.
    db.exec("INSERT INTO friendships VALUES (NULL, 1, 2, 'pending', 'now', NULL)");
    expect(() => db.exec("INSERT INTO friendships VALUES (NULL, 2, 1, 'pending', 'now', NULL)")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO friendships VALUES (NULL, 1, 1, 'pending', 'now', NULL)")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO friendships VALUES (NULL, 1, 3, 'maybe', 'now', NULL)")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO friendships VALUES (NULL, 1, 9, 'pending', 'now', NULL)")).toThrow(/FOREIGN KEY/);
    db.exec("INSERT INTO friendships VALUES (NULL, 3, 1, 'accepted', 'now', 'now')");
    db.exec('DELETE FROM accounts WHERE id = 1');
    expect(db.prepare('SELECT count(*) AS n FROM friendships').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT game_id FROM replays').all()).toEqual([{ game_id: 'g' }]);
  });

  test('of the eighth release keeps its feedback, open and out of the trash, when it gets the notes on it', async () => {
    const eighth = await open(dir, MIGRATIONS.slice(0, 8));
    eighth.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (1, 'Ann', 'ann', 'h', 'now');
      INSERT INTO feedback VALUES (3, '2026-10-01T08:00:00.000Z', 'bug', 'Line one\nLine two', NULL, 'v0.1.5', 'en', 'room', 'UA', NULL, NULL, NULL, 0, NULL);
      INSERT INTO feedback VALUES (7, '2026-10-02T09:00:00.000Z', 'idea', 'Keep me', 'me@example.com', 'v1', 'zh', 'room', NULL, 'Ann L', 1, 'https://ann.example/', 1, 40);
      INSERT INTO acknowledgments VALUES (NULL, 'Ann L', 'feedback', 'now', 7, 1);
    `);
    const before = eighth.db.prepare('SELECT * FROM feedback ORDER BY id').all();
    const acknowledgments = eighth.db.prepare('SELECT * FROM acknowledgments').all();
    eighth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 9));
    expect(migrated).toMatchObject({ schema: 9, migratedFrom: 8 });
    expect(migrated.beforeMigration).toBe(join(dir, SNAPSHOT_DIR, 'reviewer2-20261009T133005Z-before-v9.db'));
    const { db } = migrated;
    // Every row is as it was, with no pull request, not closed and not in the trash.
    expect(before.map((row) => row.id)).toEqual([3, 7]);
    expect(db.prepare('SELECT * FROM feedback ORDER BY id').all()).toEqual(
      before.map((row) => ({ ...row, resolved_pr: null, resolved_at: null, closed_at: null, deleted_at: null })),
    );
    expect(db.prepare('SELECT * FROM acknowledgments').all()).toEqual(acknowledgments);
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'feedback' ORDER BY name").all(),
    ).toEqual([{ name: 'feedback_account' }, { name: 'feedback_contact_expiry' }, { name: 'feedback_trash' }]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    // The notes take their values, and a pull request has a number from 1.
    db.exec(
      "UPDATE feedback SET resolved_pr = 41, resolved_at = 'now', closed_at = 'now', deleted_at = 'now' WHERE id = 3",
    );
    expect(
      db.prepare('SELECT resolved_pr, resolved_at, closed_at, deleted_at FROM feedback WHERE id = 3').get(),
    ).toEqual({ resolved_pr: 41, resolved_at: 'now', closed_at: 'now', deleted_at: 'now' });
    expect(() => db.exec('UPDATE feedback SET resolved_pr = 0 WHERE id = 7')).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE feedback SET resolved_pr = 'x' WHERE id = 7")).toThrow(/cannot store TEXT/);
    // New feedback has none of them.
    db.exec(
      "INSERT INTO feedback (created_at, kind, text, version, language, page) VALUES ('now', 'game', 'New', 'v3', 'en', 'home')",
    );
    expect(db.prepare('SELECT id, resolved_pr, closed_at, deleted_at FROM feedback WHERE id > 7').all()).toEqual([
      { id: 8, resolved_pr: null, closed_at: null, deleted_at: null },
    ]);
    // The account still goes from its feedback when it is deleted.
    db.exec('DELETE FROM accounts WHERE id = 1');
    expect(db.prepare('SELECT credit, account_id FROM feedback WHERE id = 7').get()).toEqual({
      credit: 'Ann L',
      account_id: null,
    });
  });

  test('of the ninth release works out the streaks of the records it has when it gets the table for them', async () => {
    const ninth = await open(dir, MIGRATIONS.slice(0, 9));
    ninth.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES
        (1, 'Ann', 'ann', 'h', 'now'), (2, 'Bob', 'bob', 'h', 'now'), (3, 'Cat', 'cat', 'h', 'now');
    `);
    // Ann won three, lost four, then won two; Bob lost one; Cat never played. The ids are the order
    // the games ended in, whichever game they were.
    const game = ninth.db.prepare(
      "INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict) VALUES (?, ?, ?, 'now', 's', 'r', 'w', ?, 'v')",
    );
    [...'WWWLLLLWW'].forEach((result, i) =>
      game.run(1, i % 2 === 0 ? 'keywords' : 'test', `g${i}`, result === 'W' ? 1 : 0),
    );
    game.run(2, 'keywords', 'g9', 0);
    ninth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 10));
    expect(migrated).toMatchObject({ schema: 10, migratedFrom: 9 });
    const { db } = migrated;
    expect(db.prepare('SELECT * FROM streaks ORDER BY account_id').all()).toEqual([
      { account_id: 1, best_wins: 3, best_losses: 4, run: 2, run_won: 1 },
      { account_id: 2, best_wins: 0, best_losses: 1, run: 1, run_won: 0 },
    ]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // The row goes with the account.
    db.exec('DELETE FROM accounts WHERE id = 1');
    expect(db.prepare('SELECT account_id FROM streaks').all()).toEqual([{ account_id: 2 }]);
    expect(() => db.exec('INSERT INTO streaks VALUES (9, 0, 0, 0, 0)')).toThrow(/FOREIGN KEY/);
    expect(() => db.exec('INSERT INTO streaks VALUES (3, 0, 0, 0, 2)')).toThrow(/CHECK/);
  });

  test('of the tenth release gives every account a handle of its own when it gets the profiles', async () => {
    const tenth = await open(dir, MIGRATIONS.slice(0, 10));
    tenth.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (1, 'Ann', 'ann', 'h', 'now');
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (2, 'Bob', 'bob', 'h', 'now');
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (3, 'Cy', 'cy', 'h', 'now');
    `);
    tenth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 11));
    expect(migrated).toMatchObject({ schema: 11, migratedFrom: 10 });
    expect(migrated.beforeMigration).toBe(join(dir, SNAPSHOT_DIR, 'reviewer2-20261009T133005Z-before-v11.db'));
    const { db } = migrated;
    // Each account has a handle of 12 hexadecimal digits, no two the same, and an empty profile.
    const rows = db
      .prepare('SELECT id, handle, link, bio, show_record, show_thanks, profile_banned FROM accounts ORDER BY id')
      .all() as { id: number; handle: string }[];
    expect(rows).toEqual(
      [1, 2, 3].map((id) => expect.objectContaining({ id, handle: expect.stringMatching(/^[0-9a-f]{12}$/) })),
    );
    expect(rows).toEqual(
      rows.map(() =>
        expect.objectContaining({ link: null, bio: null, show_record: 0, show_thanks: 0, profile_banned: 0 }),
      ),
    );
    expect(new Set(rows.map(({ handle }) => handle)).size).toBe(3);
    expect(() => db.exec(`UPDATE accounts SET handle = '${rows[0]?.handle}' WHERE id = 2`)).toThrow(/UNIQUE/);
    expect(() => db.exec('UPDATE accounts SET show_record = 2 WHERE id = 1')).toThrow(/CHECK/);

    // A like is one row for a pair, never an account with itself, and goes with either account.
    db.exec("INSERT INTO likes VALUES (1, 2, 'now')");
    expect(() => db.exec("INSERT INTO likes VALUES (1, 2, 'later')")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO likes VALUES (1, 1, 'now')")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO likes VALUES (1, 9, 'now')")).toThrow(/FOREIGN KEY/);
    db.exec("INSERT INTO likes VALUES (2, 1, 'now'); INSERT INTO likes VALUES (3, 1, 'now')");
    db.exec('DELETE FROM accounts WHERE id = 1');
    expect(db.prepare('SELECT count(*) AS n FROM likes').get()).toEqual({ n: 0 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  test('of the eleventh release keeps its replays, with no log, when it gets the record of who played', async () => {
    const eleventh = await open(dir, MIGRATIONS.slice(0, 11));
    eleventh.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (1, 'Ann', 'ann', 'h', 'now'), (2, 'Bob', 'bob', 'h', 'now');
      INSERT INTO game_records VALUES (NULL, 1, 'keywords', 'g', 'now', 'red', 'captain', 'red', 1, 'oral', 4);
      INSERT INTO replays VALUES ('g', 'keywords', 'now', '{"cards":[]}');
    `);
    eleventh.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 12));
    expect(migrated).toMatchObject({ schema: 12, migratedFrom: 11 });
    expect(migrated.beforeMigration).toBe(join(dir, SNAPSHOT_DIR, 'reviewer2-20261009T133005Z-before-v12.db'));
    const { db } = migrated;
    // The replay that was there is as it was, with no log, and the records too.
    expect(db.prepare('SELECT game_id, data, log FROM replays').all()).toEqual([
      { game_id: 'g', data: '{"cards":[]}', log: null },
    ]);
    expect(db.prepare('SELECT game_id, points FROM game_records').all()).toEqual([{ game_id: 'g', points: 4 }]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    // A player of a game is one account, once; the row goes with the account, and the game stays.
    db.exec("INSERT INTO game_players VALUES ('g', 'p1', 1), ('g', 'p2', 2), ('g', 'p3', 1)");
    expect(() => db.exec("INSERT INTO game_players VALUES ('g', 'p1', 2)")).toThrow(/UNIQUE|PRIMARY KEY/);
    expect(() => db.exec("INSERT INTO game_players VALUES ('g', 'p4', 9)")).toThrow(/FOREIGN KEY/);
    db.exec('DELETE FROM accounts WHERE id = 1');
    expect(db.prepare('SELECT player_id, account_id FROM game_players').all()).toEqual([
      { player_id: 'p2', account_id: 2 },
    ]);
    expect(db.prepare('SELECT game_id FROM replays').all()).toEqual([{ game_id: 'g' }]);
  });

  test('of the thirteenth release has its titles rebuilt for the titles of games, and its records kept outside matches', async () => {
    const thirteenth = await open(dir, MIGRATIONS.slice(0, 13));
    thirteenth.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (1, 'Ann', 'ann', 'h', 'now'), (2, 'Bob', 'bob', 'h', 'now');
      INSERT INTO titles VALUES (2, 1, 'best_paper', NULL, '2026-10-01T08:00:00.000Z');
      INSERT INTO titles VALUES (5, 1, 'best_paper', 'm1', '2026-10-02T08:00:00.000Z');
      INSERT INTO titles VALUES (9, 2, 'black_hole', 'm1', '2026-10-02T08:00:00.000Z');
      INSERT INTO game_records VALUES (NULL, 1, 'keywords', 'g0', 'now', 'red', 'captain', 'red', 1, 'oral', 4);
    `);
    // Ids up to 12 were given out once, as by the titles of an account that was deleted.
    thirteenth.db.exec("UPDATE sqlite_sequence SET seq = 12 WHERE name = 'titles'");
    const before = thirteenth.db.prepare('SELECT * FROM titles ORDER BY id').all();
    thirteenth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 14));
    expect(migrated).toMatchObject({ schema: 14, migratedFrom: 13 });
    expect(migrated.beforeMigration).toBe(join(dir, SNAPSHOT_DIR, 'reviewer2-20261009T133005Z-before-v14.db'));
    const { db } = migrated;
    // Every row is as it was, with its id, and from no game.
    expect(before.map((row) => row.id)).toEqual([2, 5, 9]);
    expect(db.prepare('SELECT * FROM titles ORDER BY id').all()).toEqual(
      before.map((row) => ({ ...row, game_id: null, turn: null })),
    );
    expect(tables(db)).not.toContain('new_titles');
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'titles' ORDER BY name").all(),
    ).toEqual([{ name: 'titles_account' }, { name: 'titles_game' }, { name: 'titles_match' }]);
    expect(db.prepare("SELECT name, seq FROM sqlite_sequence WHERE name LIKE '%titles'").all()).toEqual([
      { name: 'titles', seq: 12 },
    ]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    const award = (title: string, gameId: string | null, turn: number | null, matchId: string | null = null) =>
      db
        .prepare(
          'INSERT INTO titles (account_id, title, match_id, game_id, turn, awarded_at) VALUES (1, ?, ?, ?, ?, ?)',
        )
        .run(title, matchId, gameId, turn, 'now').lastInsertRowid;
    // The title is the code's to check; a turn of a game brings it once, and a match too.
    expect(award('missed_deadline', 'g1', 1)).toBe(13);
    expect(award('missed_deadline', 'g1', 2)).toBe(14);
    expect(() => award('missed_deadline', 'g1', 1)).toThrow(/UNIQUE/);
    expect(() => award('best_paper', null, null, 'm1')).toThrow(/UNIQUE/);
    expect(award('heavenly_hand', 'g1', 1)).toBe(15);
    // A game's title has its turn, from 1, and comes from no match.
    expect(() => award('opening_record', 'g1', null)).toThrow(/CHECK/);
    expect(() => award('opening_record', null, 3)).toThrow(/CHECK/);
    expect(() => award('opening_record', 'g1', 0)).toThrow(/CHECK/);
    expect(() => award('opening_record', 'g1', 3, 'm2')).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO titles (account_id, title, awarded_at) VALUES (9, 'best_paper', 'now')")).toThrow(
      /FOREIGN KEY/,
    );
    // The records from before are of no match; a game of a match has the match, its number in it
    // and how many games the match was to have, all three, and its number is one of them.
    expect(db.prepare('SELECT game_id, match_id, match_game, match_games FROM game_records').all()).toEqual([
      { game_id: 'g0', match_id: null, match_game: null, match_games: null },
    ]);
    const play = (gameId: string, match: [string | null, number | null, number | null]) =>
      db
        .prepare(
          'INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict, points, ' +
            "match_id, match_game, match_games) VALUES (2, 'keywords', ?, 'now', 'red', 'guesser', 'red', 1, 'oral', 4, ?, ?, ?)",
        )
        .run(gameId, ...match);
    play('g1', ['m2', 2, 3]);
    play('g2', [null, null, null]);
    for (const match of [
      ['m2', null, 3],
      ['m2', 2, null],
      [null, 2, 3],
      ['m2', 0, 3],
      ['m2', 4, 3],
    ] as const) {
      expect(() => play('g3', [...match]), JSON.stringify(match)).toThrow(/CHECK/);
    }
    // The titles still go with their account.
    db.exec('DELETE FROM accounts WHERE id = 1');
    expect(db.prepare('SELECT id, title FROM titles').all()).toEqual([{ id: 9, title: 'black_hole' }]);
  });

  test('of the fourteenth release keeps its accounts, records and replays when it gets AI players and every game', async () => {
    const fourteenth = await open(dir, MIGRATIONS.slice(0, 14));
    fourteenth.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (1, 'Ann', 'ann', 'h', 'now');
      INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict, points)
        VALUES (1, 'keywords', 'g', 'now', 'red', 'captain', 'red', 1, 'oral', 4);
      INSERT INTO replays VALUES ('g', 'keywords', 'now', '{"cards":[]}', '{"v":1}');
    `);
    fourteenth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 15));
    expect(migrated).toMatchObject({ schema: 15, migratedFrom: 14 });
    const { db } = migrated;
    // Nobody may have AI players until the operator lets them, no AI played in the games from
    // before, and their replays have no AI log.
    expect(db.prepare('SELECT id, agents FROM accounts').all()).toEqual([{ id: 1, agents: 0 }]);
    expect(db.prepare('SELECT game_id, points, agents FROM game_records').all()).toEqual([
      { game_id: 'g', points: 4, agents: 0 },
    ]);
    expect(db.prepare('SELECT game_id, log, agent_log FROM replays').all()).toEqual([
      { game_id: 'g', log: '{"v":1}', agent_log: null },
    ]);
    expect(() => db.exec('UPDATE accounts SET agents = 2 WHERE id = 1')).toThrow(/CHECK/);
    expect(() => db.exec('UPDATE game_records SET agents = 2')).toThrow(/CHECK/);
    // The replays from before, all of finished games, are kept whole, say so, and say nothing else
    // of what kind of game they were.
    expect(db.prepare('SELECT * FROM replays').all()).toEqual([
      {
        game_id: 'g',
        game: 'keywords',
        ended_at: 'now',
        data: '{"cards":[]}',
        log: '{"v":1}',
        agent_log: null,
        ending: 'finished',
        winner: null,
        reason: null,
        started_at: null,
        setup: null,
        accounts: null,
        guests: null,
        agents: null,
        takeover: null,
        in_match: null,
        language: null,
        fields: null,
        version: null,
        rules: null,
        words: null,
      },
    ]);
    // A game without a replay can be kept now, and an ending is one of four.
    db.exec("INSERT INTO replays (game_id, game, ended_at, ending) VALUES ('h', 'keywords', 'now', 'abandoned')");
    expect(() =>
      db.exec("INSERT INTO replays (game_id, game, ended_at, ending) VALUES ('i', 'keywords', 'now', 'lost')"),
    ).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE replays SET takeover = 2 WHERE game_id = 'h'")).toThrow(/CHECK/);
    // What an AI did for an account stays on its page once the account is gone, for nobody.
    db.exec(`
      INSERT INTO agent_plays (game_id, player_id, persona, takeover, account_id) VALUES ('g', 'p1', 'reviewer1', 1, 1);
      DELETE FROM accounts WHERE id = 1;
    `);
    expect(db.prepare('SELECT player_id, account_id FROM agent_plays').all()).toEqual([
      { player_id: 'p1', account_id: null },
    ]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  test('of the fifteenth release keeps its friendships, without lines and names, when they get them', async () => {
    const fifteenth = await open(dir, MIGRATIONS.slice(0, 15));
    fifteenth.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES
        (1, 'Ann', 'ann', 'h', 'now'), (2, 'Bob', 'bob', 'h', 'now'), (3, 'Cat', 'cat', 'h', 'now');
      INSERT INTO friendships (requester_id, addressee_id, status, created_at, answered_at) VALUES
        (1, 2, 'accepted', 'then', 'now'), (3, 1, 'pending', 'now', NULL);
    `);
    fifteenth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 16));
    expect(migrated).toMatchObject({ schema: 16, migratedFrom: 15 });
    const { db } = migrated;
    expect(
      db.prepare('SELECT status, note, requester_alias, addressee_alias FROM friendships ORDER BY id').all(),
    ).toEqual([
      { status: 'accepted', note: null, requester_alias: null, addressee_alias: null },
      { status: 'pending', note: null, requester_alias: null, addressee_alias: null },
    ]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  test('of the sixteenth release marks the feedback that was adopted, and leaves the acknowledgments behind', async () => {
    const sixteenth = await open(dir, MIGRATIONS.slice(0, 16));
    sixteenth.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (1, 'Ann', 'ann', 'h', 'now');
      INSERT INTO feedback (id, created_at, kind, text, version, language, page, credit, account_id, link, public_issue, issue)
        VALUES (1, '2026-10-01T08:00:00.000Z', 'idea', 'AI players', 'v1', 'en', 'home', 'Ann L', 1, 'https://ann.example/', 1, 57);
      INSERT INTO feedback (id, created_at, kind, text, version, language, page, public_issue)
        VALUES (2, '2026-10-02T08:00:00.000Z', 'bug', 'Stuck', 'v1', 'en', 'room', 0);
      INSERT INTO feedback (id, created_at, kind, text, version, language, page, deleted_at)
        VALUES (3, '2026-10-03T08:00:00.000Z', 'words', 'More words', 'v1', 'zh', 'home', '2026-10-04T08:00:00.000Z');
      INSERT INTO acknowledgments VALUES (NULL, 'Ann L', 'feedback', '2026-10-05T09:00:00.000Z', 1, 1);
      INSERT INTO acknowledgments VALUES (NULL, 'Bob', 'playtesting', '2026-10-06T09:00:00.000Z', NULL, 1);
      INSERT INTO acknowledgments VALUES (NULL, 'Cat', 'words', '2026-10-07T09:00:00.000Z', 3, NULL);
      INSERT INTO acknowledgments VALUES (NULL, 'Dan', 'feedback', '2026-10-08T09:00:00.000Z', 9, NULL);
    `);
    const before = sixteenth.db.prepare('SELECT * FROM feedback ORDER BY id').all();
    sixteenth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 17));
    expect(migrated).toMatchObject({ schema: 17, migratedFrom: 16 });
    const { db } = migrated;
    // The feedback that an acknowledgment adopted is adopted when it was, with nothing said yet of
    // what its player contributed, in the trash or not; every name may link to its profile; the
    // link and the answer about a public issue are gone; the rest is as it was. The
    // acknowledgments added by hand, and one whose feedback was deleted by hand, are gone with their
    // table.
    const adopted: Record<number, string> = { 1: '2026-10-05T09:00:00.000Z', 3: '2026-10-07T09:00:00.000Z' };
    expect(db.prepare('SELECT * FROM feedback ORDER BY id').all()).toEqual(
      before.map((row) => ({
        ...Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'link' && column !== 'public_issue')),
        link_profile: 1,
        adopted_at: adopted[row.id as number] ?? null,
        summary_zh: null,
        summary_en: null,
      })),
    );
    expect(before.map((row) => [row.link, row.public_issue])).toEqual([
      ['https://ann.example/', 1],
      [null, 0],
      [null, null],
    ]);
    // New feedback may link to its profile or not, and says no unless told.
    db.exec(
      "INSERT INTO feedback (created_at, kind, text, version, language, page) VALUES ('now', 'idea', 'New', 'v2', 'en', 'home')",
    );
    expect(db.prepare('SELECT link_profile FROM feedback WHERE id = 4').get()).toEqual({ link_profile: 0 });
    expect(() => db.exec('UPDATE feedback SET link_profile = 2 WHERE id = 4')).toThrow(/CHECK/);
    expect(tables(db)).not.toContain('acknowledgments');
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'feedback' ORDER BY name").all(),
    ).toEqual([
      { name: 'feedback_account' },
      { name: 'feedback_adopted' },
      { name: 'feedback_contact_expiry' },
      { name: 'feedback_trash' },
    ]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // The account still goes from its feedback when it is deleted, and the adoption stays.
    db.exec('DELETE FROM accounts WHERE id = 1');
    expect(db.prepare('SELECT credit, account_id, adopted_at FROM feedback WHERE id = 1').get()).toEqual({
      credit: 'Ann L',
      account_id: null,
      adopted_at: '2026-10-05T09:00:00.000Z',
    });
  });

  test('of the seventeenth release keeps its replays when they get whether a game was practice', async () => {
    const seventeenth = await open(dir, MIGRATIONS.slice(0, 17));
    seventeenth.db.exec(
      "INSERT INTO replays (game_id, game, ended_at, ending, agents) VALUES ('g', 'keywords', 'now', 'finished', 3)",
    );
    seventeenth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 18));
    expect(migrated).toMatchObject({ schema: 18, migratedFrom: 17 });
    const { db } = migrated;
    // A game from before says nothing of it, whether or not an AI played in it.
    expect(db.prepare('SELECT game_id, ending, agents, practice FROM replays').all()).toEqual([
      { game_id: 'g', ending: 'finished', agents: 3, practice: null },
    ]);
    db.exec("UPDATE replays SET practice = 1 WHERE game_id = 'g'");
    expect(() => db.exec("UPDATE replays SET practice = 2 WHERE game_id = 'g'")).toThrow(/CHECK/);
  });

  test('of the eighteenth release keeps its accounts when they get how they last set up a room', async () => {
    const eighteenth = await open(dir, MIGRATIONS.slice(0, 18));
    eighteenth.db.exec(
      "INSERT INTO accounts (id, username, username_key, password, handle, created_at) VALUES (1, 'Ann', 'ann', 'h', 'k', 'now')",
    );
    eighteenth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 19));
    expect(migrated).toMatchObject({ schema: 19, migratedFrom: 18 });
    const { db } = migrated;
    expect(db.prepare('SELECT username, room_setup FROM accounts').all()).toEqual([
      { username: 'Ann', room_setup: null },
    ]);
    db.exec(`UPDATE accounts SET room_setup = '{"practice":{"role":"captain","fields":["general"]}}' WHERE id = 1`);
    db.exec('DELETE FROM accounts WHERE id = 1');
    expect(db.prepare('SELECT count(*) AS n FROM accounts').get()).toEqual({ n: 0 });
  });

  test('of the nineteenth release loses the names its replays kept, and keeps the rest of them', async () => {
    const nineteenth = await open(dir, MIGRATIONS.slice(0, 19));
    const named = JSON.stringify({
      gameId: 'g',
      cards: [{ word: 'Model', color: 'red' }],
      history: [{ turn: 1, team: 'red', word: 'Hint', count: 1, guesses: [{ card: 0, color: 'red', player: 'p1' }] }],
      players: { p1: 'Ann', p2: '\u{6e38}\u{5ba2}' },
      agents: { p3: 'reviewer1' },
    });
    const kept = JSON.stringify({ gameId: 'h', cards: [], history: [], groups: [], members: { p1: { guest: 1 } } });
    // A game from after game_players, whose names say nothing more than its rows.
    const later = JSON.stringify({ gameId: 'j', cards: [], history: [], players: { p1: 'Ann', p9: 'Cy' } });
    nineteenth.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES
        (1, 'ann', 'ann', 'h', 'now'), (2, 'Bo', 'bo', 'h', 'now'), (3, 'Cy', 'cy', 'h', 'now');
      INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict) VALUES
        (1, 'keywords', 'g', 'now', 'red', 'guesser', 'red', 1, 'oral'),
        (2, 'keywords', 'g', 'now', 'red', 'captain', 'red', 1, 'oral'),
        (1, 'keywords', 'j', 'now', 'red', 'guesser', 'red', 1, 'oral'),
        (3, 'keywords', 'j', 'now', 'blue', 'guesser', 'red', 0, 'oral');
      INSERT INTO replays (game_id, game, ended_at, ending, data) VALUES ('g', 'keywords', 'now', 'finished', '${named}');
      INSERT INTO replays (game_id, game, ended_at, ending, data) VALUES ('h', 'keywords', 'now', 'finished', '${kept}');
      INSERT INTO replays (game_id, game, ended_at, ending, data) VALUES ('i', 'keywords', 'now', 'withdrawn', NULL);
      INSERT INTO replays (game_id, game, ended_at, ending, data) VALUES ('j', 'keywords', 'now', 'finished', '${later}');
      INSERT INTO game_players VALUES ('j', 'p1', 1);
    `);
    nineteenth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 20));
    expect(migrated).toMatchObject({ schema: 20, migratedFrom: 19 });
    const rows = migrated.db.prepare('SELECT game_id AS gameId, data FROM replays ORDER BY game_id').all() as {
      gameId: string;
      data: string | null;
    }[];
    expect(rows.map(({ gameId, data }) => [gameId, data === null ? null : JSON.parse(data)])).toEqual([
      ['g', { ...JSON.parse(named), players: undefined }],
      ['h', JSON.parse(kept)],
      ['i', null],
      ['j', { ...JSON.parse(later), players: undefined }],
    ]);
    expect(rows[0]?.data).not.toContain('Ann');
    // Ann revealed a card in the game from before as "Ann", now "ann"; the guest and Bo, a PI,
    // whom the replay never named, give no row, nor does Cy in the game that had its rows.
    expect(
      migrated.db.prepare('SELECT game_id, player_id, account_id FROM game_players ORDER BY game_id').all(),
    ).toEqual([
      { game_id: 'g', player_id: 'p1', account_id: 1 },
      { game_id: 'j', player_id: 'p1', account_id: 1 },
    ]);
  });

  test('of the twentieth release keeps its feedback in the three ways it is signed now', async () => {
    const twentieth = await open(dir, MIGRATIONS.slice(0, 20));
    twentieth.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, handle, created_at) VALUES (1, 'Ann', 'ann', 'h', 'k1', 'now');
      INSERT INTO accounts (id, username, username_key, password, handle, created_at) VALUES (2, 'Bob', 'bob', 'h', 'k2', 'now');
    `);
    const add = (id: number, credit: string | null, accountId: number | null, linkProfile: number) =>
      twentieth.db
        .prepare(
          'INSERT INTO feedback (id, created_at, kind, text, contact, version, language, page, credit, account_id, ' +
            "link_profile, issue, adopted_at, summary_zh, summary_en) VALUES (?, 'now', 'idea', ?, 'c', 'v1', 'en', " +
            "'home', ?, ?, ?, ?, 'then', '提出了', 'Suggested')",
        )
        .run(id, `Text ${id}`, credit, accountId, linkProfile, 40 + id);
    // Signed with the account, with the username it had then, or with a name its player typed
    // and let link to the profile; without a name, which migration 17 marked as signed with the
    // rest; a guest's name, marked so too; a name typed while logged in and not linked; anonymous
    // while logged in; and a guest's name and nothing at all, as they are now.
    add(1, 'Ann', 1, 1);
    add(2, 'Bobby', 2, 1);
    add(3, null, 1, 1);
    add(4, 'Cat', null, 1);
    add(5, 'Annie', 1, 0);
    add(6, null, 2, 0);
    add(7, 'Dan', null, 0);
    add(8, null, null, 0);
    const before = twentieth.db.prepare('SELECT * FROM feedback ORDER BY id').all();
    twentieth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 21));
    expect(migrated).toMatchObject({ schema: 21, migratedFrom: 20 });
    const { db } = migrated;
    // Feedback from an account is signed with it, keeping no name, or anonymous; a name is a
    // guest's alone; everything else, the rows themselves included, is as it was.
    const signed: Record<number, [string | null, number]> = {
      1: [null, 1],
      2: [null, 1],
      3: [null, 0],
      4: ['Cat', 0],
      5: [null, 1],
      6: [null, 0],
      7: ['Dan', 0],
      8: [null, 0],
    };
    expect(db.prepare('SELECT * FROM feedback ORDER BY id').all()).toEqual(
      before.map((row) => {
        const [credit, link] = signed[row.id as number] ?? [];
        return { ...row, credit, link_profile: link };
      }),
    );
    expect(
      db
        .prepare(
          'SELECT count(*) AS n FROM feedback WHERE NOT ((link_profile = 1 AND credit IS NULL AND account_id IS NOT NULL) ' +
            'OR (link_profile = 0 AND (credit IS NULL OR account_id IS NULL)))',
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  test('of the twenty-first release has every game in the newest format, and leaves behind what it can not complete', async () => {
    const twentyFirst = await open(dir, MIGRATIONS.slice(0, 21));
    const log = (gameId: string, more: Record<string, unknown> = {}) =>
      JSON.stringify({
        v: 2,
        game: 'keywords',
        gameId,
        start: {},
        entries: [{ t: 1, by: null, type: 'end' }],
        ...more,
      });
    const setup = JSON.stringify({ language: 'en', startingTeam: 'red', cards: [] });
    // A replay as the server kept it before the replays were worked out from the logs, with a guest's
    // number among who was who.
    const data = JSON.stringify({
      gameId: 'g',
      cards: [],
      history: [],
      members: { p1: { account: true }, p2: { guest: 4 } },
    });
    const kept = (gameId: string, endedAt: string, more = '') => `
      INSERT INTO replays (game_id, game, ended_at, data, log, ending, winner, reason, started_at, setup, accounts,
        guests, agents, takeover, in_match, practice, language, fields, version, rules, words)
      VALUES ('${gameId}', 'keywords', '${endedAt}', NULL, '${log(gameId)}', 'finished', 'red', 'found',
        '${endedAt}', '${setup}', 1, 0, 0, 0, 0, 0, 'en', '["general"]', 'v0', 4, 'abc') ${more};`;
    twentyFirst.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES
        (1, 'Ann', 'ann', 'h', 'now'), (2, 'Bob', 'bob', 'h', 'now');
      -- The games from before they were kept: records alone, which ended before the first game kept
      -- with its whole record, and a game with words of the chair's own, which ended after it.
      INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict) VALUES
        (1, 'keywords', 'early', '2026-10-01T10:00:00.000Z', 'red', 'captain', 'red', 1, 'oral'),
        (2, 'keywords', 'early', '2026-10-01T10:00:00.000Z', 'blue', 'captain', 'red', 0, 'reject');
      -- A game kept without a log, and one with a log of the first version, neither with what kind of
      -- game it was, each with a record, a title of the game and who was who.
      INSERT INTO replays (game_id, game, ended_at, data, ending) VALUES
        ('nolog', 'keywords', '2026-10-02T10:00:00.000Z', '{"gameId":"nolog"}', 'finished');
      INSERT INTO replays (game_id, game, ended_at, data, log, ending) VALUES
        ('first', 'keywords', '2026-10-02T11:00:00.000Z', '{"gameId":"first"}', '${log('first', { v: 1 })}', 'finished');
      INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict, points) VALUES
        (1, 'keywords', 'nolog', '2026-10-02T10:00:00.000Z', 'red', 'guesser', 'red', 1, 'oral', 30),
        (1, 'keywords', 'first', '2026-10-02T11:00:00.000Z', 'red', 'guesser', 'red', 1, 'oral', 20),
        (2, 'keywords', 'first', '2026-10-02T11:00:00.000Z', 'blue', 'captain', 'red', 0, 'reject', -5);
      INSERT INTO game_players VALUES ('first', 'p1', 1), ('first', 'p2', 2);
      INSERT INTO titles (account_id, title, game_id, turn, awarded_at) VALUES (1, 'deadline_hero', 'nolog', 1, 'now');
      -- A match of those days, which no record names, with its title, and a title from before the
      -- matches had IDs.
      INSERT INTO match_records (account_id, game, match_id, ended_at, games, rank, players, score, title) VALUES
        (1, 'keywords', 'm-old', '2026-10-02T12:00:00.000Z', 3, 1, 2, 40, 'best_paper'),
        (2, 'keywords', 'm-old', '2026-10-02T12:00:00.000Z', 3, 2, 2, 10, NULL);
      INSERT INTO titles (account_id, title, match_id, awarded_at) VALUES (1, 'best_paper', 'm-old', 'now');
      INSERT INTO titles (account_id, title, awarded_at) VALUES (2, 'black_hole', 'now');
      -- The games kept with their whole record: one from before the practice rooms, with the replay
      -- that the server kept, and a guest among who was who; one in a match of a single game, with
      -- its title; one an AI played in; and one abandoned. A game with words of the chair's own has
      -- a record alone.
      ${kept('whole', '2026-10-03T10:00:00.000Z')}
      UPDATE replays SET practice = NULL, guests = 1, data = '${data}' WHERE game_id = 'whole';
      ${kept('matched', '2026-10-03T11:00:00.000Z')}
      UPDATE replays SET in_match = 1 WHERE game_id = 'matched';
      ${kept('ai', '2026-10-03T12:00:00.000Z')}
      UPDATE replays SET agents = 1, agent_log = '{}' WHERE game_id = 'ai';
      ${kept('cut', '2026-10-03T13:00:00.000Z')}
      UPDATE replays SET ending = 'abandoned', winner = NULL, reason = NULL, practice = NULL WHERE game_id = 'cut';
      INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict, points,
        match_id, match_game, match_games, agents) VALUES
        (1, 'keywords', 'whole', '2026-10-03T10:00:00.000Z', 'red', 'captain', 'red', 1, 'oral', 12, NULL, NULL, NULL, 0),
        (1, 'keywords', 'matched', '2026-10-03T11:00:00.000Z', 'red', 'captain', 'blue', 0, 'reject', -3, 'm1', 1, 1, 0),
        (1, 'keywords', 'ai', '2026-10-03T12:00:00.000Z', 'red', 'captain', 'red', 1, 'oral', 0, NULL, NULL, NULL, 1),
        (1, 'keywords', 'custom', '2026-10-03T14:00:00.000Z', 'red', 'captain', 'red', 1, 'oral', 8, NULL, NULL, NULL, 0);
      INSERT INTO game_players VALUES ('whole', 'p1', 1), ('matched', 'p1', 1), ('ai', 'p1', 1);
      INSERT INTO agent_plays (game_id, player_id, persona, takeover) VALUES ('ai', 'r1', 'reviewer1', 0);
      INSERT INTO match_records (account_id, game, match_id, ended_at, games, rank, players, score, title) VALUES
        (1, 'keywords', 'm1', '2026-10-03T11:00:00.000Z', 1, 2, 2, -3, 'black_hole');
      INSERT INTO titles (account_id, title, match_id, awarded_at) VALUES (1, 'black_hole', 'm1', 'now');
      INSERT INTO titles (account_id, title, game_id, turn, awarded_at) VALUES (1, 'opening_record', 'whole', 1, 'now');
      -- A game played under the rules before today's (version 4), whose points and titles were
      -- counted under them, in a match of its own, with its titles.
      ${kept('older', '2026-10-03T14:10:00.000Z')}
      UPDATE replays SET rules = 3, in_match = 1 WHERE game_id = 'older';
      INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict, points,
        match_id, match_game, match_games) VALUES
        (2, 'keywords', 'older', '2026-10-03T14:10:00.000Z', 'red', 'captain', 'red', 1, 'oral', 25, 'm3', 1, 1);
      INSERT INTO game_players VALUES ('older', 'p1', 2);
      INSERT INTO match_records (account_id, game, match_id, ended_at, games, rank, players, score, title) VALUES
        (2, 'keywords', 'm3', '2026-10-03T14:10:00.000Z', 1, 1, 2, 25, 'best_paper');
      INSERT INTO titles (account_id, title, match_id, awarded_at) VALUES (2, 'best_paper', 'm3', 'now');
      INSERT INTO titles (account_id, title, game_id, turn, awarded_at) VALUES (2, 'deadline_hero', 'older', 2, 'now');
      -- A game kept with what kind of game it was, but a log of the first version.
      ${kept('oldlog', '2026-10-03T14:30:00.000Z')}
      UPDATE replays SET log = '${log('oldlog', { v: 1 })}' WHERE game_id = 'oldlog';
      -- A game kept with its whole record but a guest whose number nothing says, the first game of
      -- a match of two, whose second game is whole, with a title of that game.
      ${kept('guest', '2026-10-03T15:00:00.000Z')}
      UPDATE replays SET guests = 1, in_match = 1 WHERE game_id = 'guest';
      ${kept('paired', '2026-10-03T15:30:00.000Z')}
      UPDATE replays SET in_match = 1 WHERE game_id = 'paired';
      INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict, points,
        match_id, match_game, match_games) VALUES
        (2, 'keywords', 'guest', '2026-10-03T15:00:00.000Z', 'red', 'captain', 'red', 1, 'oral', 15, 'm2', 1, 2),
        (2, 'keywords', 'paired', '2026-10-03T15:30:00.000Z', 'red', 'captain', 'red', 1, 'oral', 10, 'm2', 2, 2);
      INSERT INTO game_players VALUES ('guest', 'p1', 2), ('paired', 'p1', 2);
      INSERT INTO match_records (account_id, game, match_id, ended_at, games, rank, players, score, title) VALUES
        (2, 'keywords', 'm2', '2026-10-03T15:30:00.000Z', 2, 1, 2, 25, 'best_paper');
      INSERT INTO titles (account_id, title, match_id, awarded_at) VALUES (2, 'best_paper', 'm2', 'now');
      INSERT INTO titles (account_id, title, game_id, turn, awarded_at) VALUES (2, 'opening_record', 'paired', 1, 'now');
      -- A game kept with two guests, of whom the replay that the server kept numbers one.
      ${kept('half', '2026-10-03T16:00:00.000Z')}
      UPDATE replays SET guests = 2, data = '${data}' WHERE game_id = 'half';
      INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict, points) VALUES
        (2, 'keywords', 'half', '2026-10-03T16:00:00.000Z', 'red', 'captain', 'red', 1, 'oral', 7);
      -- The streaks as they stood, counting everything, and Ann and Bob, friends, who played together
      -- in the games that go.
      INSERT INTO streaks VALUES (1, 9, 9, 9, 1), (2, 9, 9, 9, 1);
      INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (1, 2, 'accepted', 'now');
    `);
    twentyFirst.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 22));
    expect(migrated).toMatchObject({ schema: 22, migratedFrom: 21 });
    const { db } = migrated;
    const all = (sql: string) => db.prepare(sql).all();
    // The games that couldn't be completed are gone, with their records, titles and who was who, and
    // so is the whole game of the match that the game with the unnumbered guest was in.
    expect(all('SELECT game_id AS game, practice FROM replays ORDER BY game_id')).toEqual([
      { game: 'ai', practice: 0 },
      { game: 'cut', practice: 0 },
      { game: 'matched', practice: 0 },
      { game: 'whole', practice: 0 },
    ]);
    expect(all('SELECT account_id AS account, game_id AS game FROM game_records ORDER BY id')).toEqual([
      { account: 1, game: 'whole' },
      { account: 1, game: 'matched' },
      { account: 1, game: 'ai' },
      { account: 1, game: 'custom' },
    ]);
    expect(all('SELECT game_id AS game, player_id AS player FROM game_players ORDER BY game_id')).toEqual([
      { game: 'ai', player: 'p1' },
      { game: 'matched', player: 'p1' },
      { game: 'whole', player: 'p1' },
    ]);
    expect(all('SELECT game_id AS game FROM agent_plays')).toEqual([{ game: 'ai' }]);
    // The matches with them: the old one, which no record names, and the one a removed game was in.
    expect(all('SELECT match_id AS match FROM match_records')).toEqual([{ match: 'm1' }]);
    expect(
      all('SELECT account_id AS account, title, match_id AS match, game_id AS game FROM titles ORDER BY id'),
    ).toEqual([
      { account: 1, title: 'black_hole', match: 'm1', game: null },
      { account: 1, title: 'opening_record', match: null, game: 'whole' },
    ]);
    // The replay that the server kept is gone; the guest's number is in the log, for the replay
    // worked out from it.
    expect(
      (all("SELECT name FROM pragma_table_info('replays')") as { name: string }[]).map(({ name }) => name),
    ).not.toContain('data');
    const whole = db.prepare("SELECT log FROM replays WHERE game_id = 'whole'").get() as { log: string };
    expect(JSON.parse(whole.log)).toMatchObject({ guests: { p2: 4 } });
    // The streaks, counted again over the records that are left, without the game an AI played in:
    // Ann won, lost, and won with words of her own; Bob has no record left.
    expect(all('SELECT * FROM streaks')).toEqual([{ account_id: 1, best_wins: 1, best_losses: 1, run: 1, run_won: 1 }]);
    // The ranks and what friends played together are worked out from the records that are left.
    const records = new RecordStore(db);
    expect([records.points(1), records.points(2)]).toEqual([17, 0]);
    expect(records.duos(1)).toEqual(new Map());
    // Nothing in the old formats can come back.
    const refused = (sql: string) => expect(() => db.exec(sql), sql).toThrow(/constraint/i);
    refused("INSERT INTO titles (account_id, title, awarded_at) VALUES (1, 'black_hole', 'now')");
    refused(
      "INSERT INTO titles (account_id, title, match_id, game_id, turn, awarded_at) VALUES (1, 'x', 'm1', 'g', 1, 'now')",
    );
    refused("INSERT INTO replays (game_id, game, ended_at, ending) VALUES ('x', 'keywords', 'now', 'finished')");
    refused(
      'INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict) ' +
        "VALUES (1, 'keywords', 'x', 'now', 'red', 'captain', 'red', 1, 'oral')",
    );
    refused(
      'INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict, points, agents) ' +
        "VALUES (1, 'keywords', 'x', 'now', 'red', 'captain', 'red', 1, 'oral', 5, 1)",
    );
    refused(
      'INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict, points, agents, ' +
        "match_id) VALUES (1, 'keywords', 'x', 'now', 'red', 'captain', 'red', 1, 'oral', 5, 0, 'm1')",
    );
    expect(pragma(db, 'foreign_key_check')).toBeUndefined();
  });

  // A database of the twenty-second release: two accounts, one without a handle, with their games,
  // match, titles and what the AI did, and the streaks as the release kept them.
  async function twentySecond(streaks = '(1, 2, 1, 1, 0)') {
    const database = await open(dir, MIGRATIONS.slice(0, 22));
    database.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at, handle, show_record, room_setup) VALUES
        (1, 'Ann', 'ann', 'h', '2026-10-01T00:00:00.000Z', 'aaaaaaaaaaaa', 1, '{"room":{}}'),
        (2, 'Bob', 'bob', 'h', '2026-10-02T00:00:00.000Z', NULL, 0, NULL);
      INSERT INTO replays (game_id, game, ended_at, log, ending, winner, reason, started_at, accounts, guests,
        agents, takeover, in_match, practice, language, fields, version, words) VALUES
        ('g1', 'keywords', 'now', '{"v":2}', 'finished', 'red', 'found', 'now', 1, 0, 1, 1, 0, 1, 'en', '[]', 'v', 'w');
      -- Ann won twice and lost once, then played a game with an AI; the streaks say so.
      INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict, points,
        match_id, match_game, match_games, agents) VALUES
        (1, 'keywords', 'g1', 'now', 'red', 'captain', 'red', 1, 'oral', 0, NULL, NULL, NULL, 1),
        (1, 'keywords', 'g2', 'now', 'red', 'captain', 'red', 1, 'oral', 10, 'm1', 1, 1, 0),
        (1, 'keywords', 'g3', 'now', 'red', 'captain', 'red', 1, 'oral', 10, NULL, NULL, NULL, 0),
        (1, 'keywords', 'g4', 'now', 'red', 'captain', 'blue', 0, 'reject', -3, NULL, NULL, NULL, 0);
      INSERT INTO streaks VALUES ${streaks};
      INSERT INTO match_records (account_id, game, match_id, ended_at, games, rank, players, score, title) VALUES
        (1, 'keywords', 'm1', 'now', 1, 1, 2, 10, 'best_paper');
      INSERT INTO titles (id, account_id, title, match_id, game_id, turn, awarded_at) VALUES
        (5, 1, 'best_paper', 'm1', NULL, NULL, 'now'),
        (6, 1, 'opening_record', NULL, 'g3', 1, 'now'),
        (7, 1, 'black_hole', 'm9', NULL, NULL, 'now');
      INSERT INTO agent_plays (game_id, player_id, persona, takeover, account_id, side, role, won,
        clues, found, reviewer2, best_word, best_found) VALUES
        ('g1', 'a', 'reviewer1', 0, NULL, 'red', 'guesser', 1, 0, 0, 1, NULL, NULL),
        ('g1', 'b', 'reviewer1', 0, NULL, 'blue', 'captain', 0, 2, 3, 0, 'Pair', 2),
        ('g1', 'p2', 'reviewer1', 1, 2, 'blue', 'guesser', 0, 0, 0, 0, NULL, NULL),
        ('gone', 'c', 'reviewer1', 0, NULL, 'red', 'captain', 1, 1, 1, 0, 'One', 1);
    `);
    database.db.close();
  }

  test('of the twenty-second release names the game on every row, keeps what each account agreed to, and counts its streaks', async () => {
    await twentySecond();
    const migrated = await open(dir, MIGRATIONS.slice(0, 23));
    expect(migrated).toMatchObject({ schema: 23, migratedFrom: 22 });
    const { db } = migrated;
    const all = (sql: string) => db.prepare(sql).all();
    // Every account has a handle, and agreed to the first version of the records notice at the time
    // of the migration; the rest of each is as it was.
    const accounts = all(
      'SELECT id, handle, username, show_record AS showRecord, room_setup AS setup, consent_version AS consent, ' +
        'consented_at AS consentedAt, created_at AS createdAt FROM accounts ORDER BY id',
    );
    expect(accounts).toEqual([
      {
        id: 1,
        handle: 'aaaaaaaaaaaa',
        username: 'Ann',
        showRecord: 1,
        setup: '{"room":{}}',
        consent: 1,
        consentedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
        createdAt: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 2,
        handle: expect.stringMatching(/^[0-9a-f]{12}$/),
        username: 'Bob',
        showRecord: 0,
        setup: null,
        consent: 1,
        consentedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
        createdAt: '2026-10-02T00:00:00.000Z',
      },
    ]);
    // The titles name their game; the title of a match that no record names is gone; the ids go on
    // from where they were.
    expect(all('SELECT id, game, title, match_id AS match, game_id AS gameId FROM titles ORDER BY id')).toEqual([
      { id: 5, game: 'keywords', title: 'best_paper', match: 'm1', gameId: null },
      { id: 6, game: 'keywords', title: 'opening_record', match: null, gameId: 'g3' },
    ]);
    db.exec(
      "INSERT INTO titles (account_id, game, title, match_id, awarded_at) VALUES (2, 'keywords', 'best_paper', 'm2', 'now')",
    );
    expect(all('SELECT max(id) AS id FROM titles')).toEqual([{ id: 8 }]);
    // What the AI did names the game and keeps the game's counts as JSON, as the code writes them;
    // a row for someone it played for keeps none; a row of a game that isn't kept is gone.
    expect(all('SELECT player_id AS player, game, feats FROM agent_plays ORDER BY player_id')).toEqual([
      { player: 'a', game: 'keywords', feats: '{"clues":0,"found":0,"reviewer2":1,"best":null}' },
      { player: 'b', game: 'keywords', feats: '{"clues":2,"found":3,"reviewer2":0,"best":{"word":"Pair","found":2}}' },
      { player: 'p2', game: 'keywords', feats: null },
    ]);
    expect(all("SELECT account_id AS account FROM agent_plays WHERE player_id = 'p2'")).toEqual([{ account: 2 }]);
    // The streaks are counted from the records: the game with an AI counts for none.
    expect(tables(db)).not.toContain('streaks');
    const records = new RecordStore(db);
    expect(records.streaks(1)).toEqual({ wins: 2, losses: 1 });
    expect(records.streaks(2)).toEqual({ wins: 0, losses: 0 });
    // The ids of accounts go on from where they were, and everything of an account still goes with
    // it, the AI's row for it unlinked.
    const store = new AccountStore(db);
    expect(store.create('Cat', 'cat', 'h')?.id).toBe(3);
    db.exec('DELETE FROM accounts WHERE id = 1');
    expect(all('SELECT count(*) AS n FROM titles')).toEqual([{ n: 1 }]);
    expect(all('SELECT count(*) AS n FROM game_records')).toEqual([{ n: 0 }]);
    db.exec('DELETE FROM accounts WHERE id = 2');
    expect(all("SELECT account_id AS account FROM agent_plays WHERE player_id = 'p2'")).toEqual([{ account: null }]);
    // Nothing in the old formats can come back.
    const refused = (sql: string) => expect(() => db.exec(sql), sql).toThrow(/constraint/i);
    refused(
      "INSERT INTO accounts (username, username_key, password, created_at, handle) VALUES ('D', 'd', 'h', 'now', 'dddddddddddd')",
    );
    refused(
      'INSERT INTO accounts (username, username_key, password, created_at, consent_version, consented_at) ' +
        "VALUES ('D', 'd', 'h', 'now', 1, 'now')",
    );
    refused(
      'INSERT INTO accounts (username, username_key, password, created_at, handle, consent_version, consented_at) ' +
        "VALUES ('D', 'd', 'h', 'now', 'dddddddddddd', 0, 'now')",
    );
    refused("INSERT INTO titles (account_id, title, match_id, awarded_at) VALUES (3, 'best_paper', 'm3', 'now')");
    refused(
      "INSERT INTO agent_plays (game_id, player_id, game, persona, takeover, feats) VALUES ('g1', 'x', 'keywords', 'reviewer1', 0, '[1]')",
    );
    refused("INSERT INTO agent_plays (game_id, player_id, persona, takeover) VALUES ('g1', 'y', 'reviewer1', 0)");
    expect(pragma(db, 'foreign_key_check')).toBeUndefined();
  });

  test('of the twenty-second release is left as it was when its streaks differ from its records', async () => {
    await twentySecond('(1, 3, 1, 1, 0)');
    await expect(open(dir, MIGRATIONS.slice(0, 23))).rejects.toThrow('streaks_differ_from_the_records');
    const after = new DatabaseSync(join(dir, DATABASE_FILE));
    expect(schemaVersion(after)).toBe(22);
    expect(tables(after)).toContain('streaks');
    after.close();
  });

  test('of the first release keeps its feedback when it gets the tables of accounts', async () => {
    const first = await open(dir, MIGRATIONS.slice(0, 1));
    first.db.exec(
      "INSERT INTO feedback VALUES (7, 'now', 'bug', 'Keep me', 'me@example.com', 'v1', 'zh', 'room', 'UA')",
    );
    first.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 2));
    expect(migrated).toMatchObject({ schema: 2, migratedFrom: 1 });
    expect(migrated.beforeMigration).toBe(join(dir, SNAPSHOT_DIR, 'reviewer2-20261009T133005Z-before-v2.db'));
    expect(migrated.db.prepare('SELECT id, text, contact FROM feedback').all()).toEqual([
      { id: 7, text: 'Keep me', contact: 'me@example.com' },
    ]);
    expect(tables(migrated.db)).toEqual(expect.arrayContaining(['accounts', 'sessions', 'game_records', 'titles']));
    expect(migrated.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // Everything of an account goes with it.
    const { db } = migrated;
    db.exec(
      "INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (1, 'Ann', 'ann', 'h', 'now')",
    );
    db.exec("INSERT INTO sessions VALUES (x'01', 1, 'now', 'now')");
    db.exec("INSERT INTO email_tokens VALUES (x'02', 1, 'reset', NULL, 'later')");
    db.exec("INSERT INTO game_records VALUES (NULL, 1, 'keywords', 'g', 'now', 'red', 'captain', 'red', 1, 'oral')");
    db.exec("INSERT INTO titles VALUES (NULL, 1, 'best_paper', NULL, 'now')");
    db.exec('DELETE FROM accounts WHERE id = 1');
    for (const table of ['sessions', 'email_tokens', 'game_records', 'titles']) {
      expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).get(), table).toEqual({ count: 0 });
    }
  });

  test('is left as it was when a migration fails', async () => {
    const one = ['CREATE TABLE a (x INTEGER) STRICT'];
    (await open(dir, one)).db.close();

    const broken = [...one, 'CREATE TABLE b (y TEXT)', 'INSERT INTO nowhere VALUES (1)'];
    await expect(open(dir, broken)).rejects.toThrow(/no such table: nowhere/);

    // Not even the migration before the one that failed is kept: the server that ran it before
    // finds the version it knows.
    const after = new DatabaseSync(join(dir, DATABASE_FILE));
    expect(schemaVersion(after)).toBe(1);
    expect(tables(after)).toEqual(['a']);
    after.close();
  });

  test('keeps one snapshot from before a migration that fails on every start, the latest', async () => {
    const one = ['CREATE TABLE a (x INTEGER) STRICT'];
    const first = await open(dir, one);
    first.db.exec('INSERT INTO a VALUES (1)');
    first.db.close();

    // The service is started again every few seconds after a start that failed.
    const broken = [...one, 'INSERT INTO nowhere VALUES (1)'];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(open(dir, broken)).rejects.toThrow(/no such table: nowhere/);
      now += 3000;
    }
    expect(readdirSync(join(dir, SNAPSHOT_DIR))).toEqual(['reviewer2-20261009T133011Z-before-v2.db']);
    expect(logs).toEqual([]);
  });

  test("starts even when the old snapshots from before a migration can't be deleted", async () => {
    const one = ['CREATE TABLE a (x INTEGER) STRICT'];
    const first = await open(dir, one);
    first.db.exec('INSERT INTO a VALUES (1)');
    first.db.close();
    // A directory where an old snapshot should be can't be deleted with rmSync({ force }).
    const snapshots = join(dir, SNAPSHOT_DIR);
    mkdirSync(join(snapshots, 'reviewer2-20261009T120000Z-before-v2.db'), { recursive: true });

    const migrated = await open(dir, [...one, 'CREATE TABLE b (y)']);
    expect(migrated.schema).toBe(2);
    expect(readdirSync(snapshots).sort()).toEqual([
      'reviewer2-20261009T120000Z-before-v2.db',
      'reviewer2-20261009T133005Z-before-v2.db',
    ]);
    expect(logs).toEqual([
      { event: 'snapshots_not_pruned', fields: { message: expect.stringMatching(/EISDIR|EPERM/) } },
    ]);
  });

  test('runs a migration with foreign keys off, so that it can rebuild a table that others point at', async () => {
    const two = [
      'CREATE TABLE a (id INTEGER PRIMARY KEY) STRICT',
      'CREATE TABLE b (id INTEGER PRIMARY KEY, a INTEGER REFERENCES a (id) ON DELETE CASCADE) STRICT',
    ];
    const first = await open(dir, two);
    first.db.exec('INSERT INTO a VALUES (1); INSERT INTO b VALUES (10, 1)');
    first.db.close();

    // The steps of SQLite's guide to changing a table: with foreign keys on, dropping `a` would
    // cascade into `b`.
    const rebuild =
      'CREATE TABLE a_new (id INTEGER PRIMARY KEY, name TEXT) STRICT; ' +
      'INSERT INTO a_new (id) SELECT id FROM a; DROP TABLE a; ALTER TABLE a_new RENAME TO a';
    const migrated = await open(dir, [...two, rebuild]);
    expect(migrated.db.prepare('SELECT * FROM b').all()).toEqual([{ id: 10, a: 1 }]);
    expect(pragma(migrated.db, 'foreign_keys')).toBe(1);
    // Foreign keys are on again: a row that points at nothing is refused as before.
    expect(() => migrated.db.exec('INSERT INTO b VALUES (11, 2)')).toThrow(/FOREIGN KEY constraint failed/);
  });

  test('refuses a migration that leaves a row pointing at nothing', async () => {
    const two = [
      'CREATE TABLE a (id INTEGER PRIMARY KEY) STRICT',
      'CREATE TABLE b (id INTEGER PRIMARY KEY, a INTEGER REFERENCES a (id)) STRICT',
    ];
    const first = await open(dir, two);
    first.db.exec('INSERT INTO a VALUES (1); INSERT INTO b VALUES (10, 1)');
    first.db.close();

    await expect(open(dir, [...two, 'DELETE FROM a'])).rejects.toThrow(
      'the migration leaves 1 row(s) pointing at nothing, in "b" at "a"',
    );
    const after = new DatabaseSync(join(dir, DATABASE_FILE));
    expect(schemaVersion(after)).toBe(2);
    expect(after.prepare('SELECT count(*) AS n FROM a').get()).toEqual({ n: 1 });
    after.close();
  });

  test('is refused when a newer server has migrated it', async () => {
    (await open(dir, ['CREATE TABLE a (x)', 'CREATE TABLE b (y)'])).db.close();
    await expect(open(dir, ['CREATE TABLE a (x)'])).rejects.toThrow(
      'the database is at schema version 2, but this server knows only up to 1',
    );
  });

  test('clears away what a snapshot that never finished left behind', async () => {
    (await open(dir, ['CREATE TABLE a (x)'])).db.close();
    const snapshots = join(dir, SNAPSHOT_DIR);
    (await open(dir, ['CREATE TABLE a (x)', 'CREATE TABLE b (y)'])).db.close();
    const kept = readdirSync(snapshots);
    for (const leftover of ['reviewer2-20261009T120000Z.db.tmp', 'reviewer2-20261009T120000Z.db.tmp-wal']) {
      writeFileSync(join(snapshots, leftover), 'half a snapshot');
    }
    await open(dir, ['CREATE TABLE a (x)', 'CREATE TABLE b (y)']);
    expect(readdirSync(snapshots)).toEqual(kept);
  });

  test("is refused when DATA_DIR isn't a directory that is there", async () => {
    await expect(open(join(dir, 'missing'))).rejects.toThrow(/^cannot use DATA_DIR: ENOENT.*missing/);
    writeFileSync(join(dir, 'file'), '');
    await expect(open(join(dir, 'file'))).rejects.toThrow(/^DATA_DIR ".*file" is not a directory$/);
    expect(existsSync(join(dir, 'missing'))).toBe(false);
  });
});

describe('a database in memory', () => {
  test('has the same schema, and no file and no snapshots', async () => {
    const database = await open(null);
    expect(database).toMatchObject({
      file: null,
      snapshots: null,
      journal: 'memory',
      schema: MIGRATIONS.length,
      beforeMigration: null,
    });
    expect(tables(database.db)).toEqual([
      'accounts',
      'agent_plays',
      'email_tokens',
      'feedback',
      'friendships',
      'game_players',
      'game_records',
      'likes',
      'match_records',
      'replays',
      'reports',
      'sessions',
      'settings',
      'sqlite_sequence',
      'titles',
    ]);
    expect(readdirSync(dir)).toEqual([]);
    expect(truncateWal(database.db)).toBe(true);
  });
});
