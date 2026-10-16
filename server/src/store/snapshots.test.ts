import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  BEFORE_MIGRATION_MS,
  BEFORE_RECOUNT_SUFFIX,
  pruneSnapshots,
  snapshotName,
  Snapshots,
  writeSnapshot,
} from './snapshots';

const HOUR = 60 * 60_000;
const START = Date.UTC(2026, 9, 9, 1, 0, 0);

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reviewer2-snapshots-'));
  db = new DatabaseSync(join(dir, 'reviewer2.db'));
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (n INTEGER)');
});

afterEach(() => {
  db.close();
  chmodSync(dir, 0o700);
  rmSync(dir, { recursive: true, force: true });
});

const rows = (file: string) => {
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    return copy
      .prepare('SELECT n FROM t ORDER BY n')
      .all()
      .map(({ n }) => n);
  } finally {
    copy.close();
  }
};

test('a snapshot is named by the time in UTC, so that the names sort by time', () => {
  expect(snapshotName(Date.UTC(2026, 9, 9, 13, 5, 9, 450))).toBe('reviewer2-20261009T130509Z.db');
  expect(snapshotName(START, '-before-v2')).toBe('reviewer2-20261009T010000Z-before-v2.db');
});

describe('a snapshot', () => {
  test('is one whole file, which holds what was written up to then', async () => {
    db.exec('INSERT INTO t VALUES (1), (2)');
    const file = await writeSnapshot(db, join(dir, 'snapshots'), 'one.db');
    db.exec('INSERT INTO t VALUES (3)');
    expect(readdirSync(join(dir, 'snapshots'))).toEqual(['one.db']);
    expect(rows(file)).toEqual([1, 2]);
    const copy = new DatabaseSync(file);
    expect(copy.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' });
    expect(copy.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    copy.close();
  });

  test('leaves nothing behind when it fails', async () => {
    const snapshots = join(dir, 'snapshots');
    mkdirSync(snapshots);
    writeFileSync(join(snapshots, 'one.db'), 'an older snapshot');
    chmodSync(snapshots, 0o500);
    await expect(writeSnapshot(db, snapshots, 'two.db')).rejects.toThrow();
    chmodSync(snapshots, 0o700);
    expect(readdirSync(snapshots)).toEqual(['one.db']);
  });
});

describe('the hourly snapshots', () => {
  test('keep the latest three, and the snapshots from before a migration', async () => {
    const snapshots = join(dir, 'snapshots');
    mkdirSync(snapshots);
    const before = snapshotName(START - HOUR, '-before-v2');
    writeFileSync(join(snapshots, before), '');
    writeFileSync(join(snapshots, 'notes.txt'), '');
    let now = START;
    const logs: { event: string; fields?: Record<string, unknown> }[] = [];
    const hourly = new Snapshots(
      db,
      snapshots,
      (event, fields) => logs.push({ event, fields }),
      () => now,
    );
    for (let hour = 0; hour < 5; hour += 1) {
      db.exec(`INSERT INTO t VALUES (${hour})`);
      await hourly.take();
      now += HOUR;
    }
    expect(readdirSync(snapshots).sort()).toEqual([
      'notes.txt',
      before,
      'reviewer2-20261009T030000Z.db',
      'reviewer2-20261009T040000Z.db',
      'reviewer2-20261009T050000Z.db',
    ]);
    expect(rows(join(snapshots, 'reviewer2-20261009T050000Z.db'))).toEqual([0, 1, 2, 3, 4]);
    expect(logs).toHaveLength(5);
    expect(logs[4]).toEqual({
      event: 'snapshot_saved',
      fields: { file: 'reviewer2-20261009T050000Z.db', ms: expect.any(Number) },
    });
  });

  test("don't start another while one is being written", async () => {
    const hourly = new Snapshots(
      db,
      join(dir, 'snapshots'),
      () => {},
      () => START,
    );
    const first = hourly.take();
    expect(hourly.take()).toBe(first);
    expect(hourly.idle()).toBe(first);
    await first;
    await expect(hourly.idle()).resolves.toBeUndefined();
    expect(readdirSync(join(dir, 'snapshots'))).toEqual(['reviewer2-20261009T010000Z.db']);
  });

  test('log a snapshot that fails, and try again the next time', async () => {
    const logs: { event: string; fields?: Record<string, unknown> }[] = [];
    // The place for the snapshots is a file, so none can be written.
    writeFileSync(join(dir, 'snapshots'), '');
    const hourly = new Snapshots(db, join(dir, 'snapshots'), (event, fields) => logs.push({ event, fields }));
    await hourly.take();
    expect(logs).toEqual([{ event: 'snapshot_failed', fields: { message: expect.stringMatching(/EEXIST/) } }]);
    rmSync(join(dir, 'snapshots'));
    await hourly.take();
    expect(logs[1]?.event).toBe('snapshot_saved');
  });

  test('are due when the latest is an hour old, or there is none', () => {
    let now = START;
    const snapshots = join(dir, 'snapshots');
    const hourly = new Snapshots(
      db,
      snapshots,
      () => {},
      () => now,
    );
    expect(hourly.due()).toBe(true);
    mkdirSync(snapshots);
    // A snapshot from before a migration isn't an hourly one.
    writeFileSync(join(snapshots, snapshotName(START, '-before-v2')), '');
    expect(hourly.due()).toBe(true);
    writeFileSync(join(snapshots, snapshotName(START)), '');
    expect(hourly.due()).toBe(false);
    now = START + HOUR - 1000;
    expect(hourly.due()).toBe(false);
    now = START + HOUR;
    expect(hourly.due()).toBe(true);
  });

  test('log a snapshot that was written as saved, even when the old ones stay', async () => {
    const snapshots = join(dir, 'snapshots');
    mkdirSync(snapshots);
    // A directory where an old snapshot should be can't be deleted with rmSync({ force }).
    mkdirSync(join(snapshots, snapshotName(START - 3 * HOUR)));
    for (let hour = 2; hour >= 1; hour -= 1) writeFileSync(join(snapshots, snapshotName(START - hour * HOUR)), '');
    const logs: { event: string; fields?: Record<string, unknown> }[] = [];
    await new Snapshots(
      db,
      snapshots,
      (event, fields) => logs.push({ event, fields }),
      () => START,
    ).take();
    expect(logs.map(({ event }) => event)).toEqual(['snapshot_saved', 'snapshots_not_pruned']);
    expect(readdirSync(snapshots)).toContain(snapshotName(START));
  });

  test('pruning leaves a directory with fewer than three alone', () => {
    const snapshots = join(dir, 'snapshots');
    mkdirSync(snapshots);
    writeFileSync(join(snapshots, snapshotName(START)), '');
    pruneSnapshots(snapshots, START);
    expect(readdirSync(snapshots)).toEqual([snapshotName(START)]);
  });

  test('keep a snapshot from before a migration for a week, since it holds contacts too', () => {
    const snapshots = join(dir, 'snapshots');
    mkdirSync(snapshots);
    const migrated = snapshotName(START, '-before-v2');
    writeFileSync(join(snapshots, migrated), '');
    pruneSnapshots(snapshots, START + BEFORE_MIGRATION_MS);
    expect(readdirSync(snapshots)).toEqual([migrated]);
    pruneSnapshots(snapshots, START + BEFORE_MIGRATION_MS + 1000);
    expect(readdirSync(snapshots)).toEqual([]);
    expect(BEFORE_MIGRATION_MS).toBe(7 * 24 * HOUR);
  });

  test('keep only the latest snapshot from before a recount, for a week, as one from before a migration', () => {
    const snapshots = join(dir, 'snapshots');
    mkdirSync(snapshots);
    // Three starts whose recount failed, seconds apart.
    const attempts = [0, 3000, 6000].map((ms) => snapshotName(START + ms, BEFORE_RECOUNT_SUFFIX));
    for (const file of attempts) writeFileSync(join(snapshots, file), '');
    pruneSnapshots(snapshots, START + 6000 + BEFORE_MIGRATION_MS);
    expect(readdirSync(snapshots)).toEqual([attempts[2]]);
    pruneSnapshots(snapshots, START + 6000 + BEFORE_MIGRATION_MS + 1000);
    expect(readdirSync(snapshots)).toEqual([]);
  });

  test('keep only the latest snapshot from before a migration to each version', () => {
    const snapshots = join(dir, 'snapshots');
    mkdirSync(snapshots);
    // Three starts whose migration to version 2 failed, seconds apart, then the migration to 3.
    const attempts = [0, 3000, 6000].map((ms) => snapshotName(START + ms, '-before-v2'));
    const toThree = snapshotName(START + HOUR, '-before-v3');
    for (const file of [...attempts, toThree]) writeFileSync(join(snapshots, file), '');
    pruneSnapshots(snapshots, START + 2 * HOUR);
    expect(readdirSync(snapshots).sort()).toEqual([attempts[2], toThree]);
  });
});
