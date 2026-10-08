import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { DATABASE_FILE, openDatabase, schemaVersion, SNAPSHOT_DIR, type Database } from './database';
import { MIGRATIONS } from './migrations';

const NOW = Date.UTC(2026, 9, 9, 13, 30, 5);

let dir: string;
const opened: Database[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reviewer2-db-'));
});

afterEach(() => {
  for (const { db } of opened.splice(0)) if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function open(dataDir: string | null, migrations: readonly string[] = MIGRATIONS): Promise<Database> {
  const database = await openDatabase(dataDir, { migrations, now: () => NOW });
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
    expect(tables(database.db)).toEqual(['feedback']);
    expect(schemaVersion(database.db)).toBe(MIGRATIONS.length);
    expect(pragma(database.db, 'busy_timeout')).toBe(5000);
    expect(pragma(database.db, 'foreign_keys')).toBe(1);
    expect(pragma(database.db, 'secure_delete')).toBe(1);
    // A new database has nothing to lose, so it gets no snapshot.
    expect(existsSync(join(dir, SNAPSHOT_DIR))).toBe(false);
  });

  test('keeps its data, and is left alone when it is up to date', async () => {
    const first = await open(dir);
    first.db.exec("INSERT INTO feedback VALUES (1, 'now', 'idea', 'Keep me', NULL, 'v1', 'en', 'home', NULL)");
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
    expect(tables(database.db)).toEqual(['feedback']);
    expect(readdirSync(dir)).toEqual([]);
  });
});
