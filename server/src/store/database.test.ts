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
      'game_records',
      'match_records',
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
      "INSERT INTO feedback VALUES (1, 'now', 'idea', 'Keep me', NULL, 'v1', 'en', 'home', NULL, NULL, NULL)",
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

    const migrated = await open(dir);
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
    // stays. The feedback may go, by the operator's hand, and the acknowledgment keeps its number.
    db.exec('DELETE FROM accounts WHERE id = 1');
    expect(db.prepare('SELECT account_id FROM feedback WHERE id = 7').get()).toEqual({ account_id: null });
    expect(db.prepare('SELECT name, account_id, feedback_id FROM acknowledgments ORDER BY id').all()).toEqual([
      { name: 'Ann L', account_id: null, feedback_id: 7 },
      { name: 'Bob', account_id: null, feedback_id: null },
    ]);
    db.exec('DELETE FROM feedback WHERE id = 7');
    expect(db.prepare('SELECT count(*) AS n FROM acknowledgments WHERE feedback_id = 7').get()).toEqual({ n: 1 });
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
      'game_records',
      'match_records',
      'sessions',
      'settings',
      'sqlite_sequence',
      'titles',
    ]);
    expect(readdirSync(dir)).toEqual([]);
    expect(truncateWal(database.db)).toBe(true);
  });
});
