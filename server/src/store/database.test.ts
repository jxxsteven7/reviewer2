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
      'acknowledgments',
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
      'streaks',
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

  test('of the thirteenth release keeps its accounts, records and replays when it gets AI players and every game', async () => {
    const thirteenth = await open(dir, MIGRATIONS.slice(0, 13));
    thirteenth.db.exec(`
      INSERT INTO accounts (id, username, username_key, password, created_at) VALUES (1, 'Ann', 'ann', 'h', 'now');
      INSERT INTO game_records VALUES (NULL, 1, 'keywords', 'g', 'now', 'red', 'captain', 'red', 1, 'oral', 4);
      INSERT INTO replays VALUES ('g', 'keywords', 'now', '{"cards":[]}', '{"v":1}');
    `);
    thirteenth.db.close();

    const migrated = await open(dir, MIGRATIONS.slice(0, 14));
    expect(migrated).toMatchObject({ schema: 14, migratedFrom: 13 });
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
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
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
      'acknowledgments',
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
      'streaks',
      'titles',
    ]);
    expect(readdirSync(dir)).toEqual([]);
    expect(truncateWal(database.db)).toBe(true);
  });
});
