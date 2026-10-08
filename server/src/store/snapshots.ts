import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

// Snapshots of the database (docs/architecture.md): a copy every hour in DATA_DIR/snapshots, of
// which the last three are kept, and one before every migration, which is kept for a week. A
// snapshot holds the contacts that players left, so none is kept for long: a contact outlives its
// 90 days by no more than the snapshots that were taken before it was cleared. A database in
// memory has none.

export const SNAPSHOT_MS = 60 * 60_000;
export const SNAPSHOTS_KEPT = 3;
// Long enough to notice what a migration broke, and to go back to the database from before it.
export const BEFORE_MIGRATION_MS = 7 * 24 * 60 * 60_000;

// The hourly snapshots, and the snapshots from before a migration, which have the version that
// the migration went to after the time.
const HOURLY = /^reviewer2-\d{8}T\d{6}Z\.db$/;
const BEFORE_MIGRATION = /^reviewer2-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-before-v\d+\.db$/;
// What a snapshot is written to before it gets its name, and the files that SQLite keeps beside it
// while it is open.
const TEMPORARY = /\.tmp(-wal|-shm|-journal)?$/;

type Log = (event: string, fields?: Record<string, unknown>) => void;

// "reviewer2-20261009T130000Z.db", with the time in UTC, so that the names sort by time.
export function snapshotName(time: number, suffix = ''): string {
  const stamp = new Date(time)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  return `reviewer2-${stamp}${suffix}.db`;
}

// Writes a snapshot of the database to `dir`, under `name`. It goes to a temporary file first and
// is renamed once it is whole, so that a file with a snapshot's name is always a whole snapshot.
// backup() copies the database a few pages at a time, between which the server goes on as usual,
// and the copy has what was written in the meantime. The copy comes in the WAL mode of its source,
// in which merely opening it would make two more files beside it; in the mode of an ordinary
// rollback journal, a snapshot is one file that can be copied into place as it is.
export async function writeSnapshot(db: DatabaseSync, dir: string, name: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  const temporary = `${file}.tmp`;
  try {
    await backup(db, temporary);
    const copy = new DatabaseSync(temporary);
    try {
      copy.exec('PRAGMA journal_mode = DELETE');
    } finally {
      copy.close();
    }
    renameSync(temporary, file);
  } catch (error) {
    removeTemporary(dir);
    throw error;
  }
  return file;
}

// Deletes what a snapshot that never finished left behind, such as when the server stopped
// in the middle of one.
export function removeTemporary(dir: string): void {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return;
  }
  for (const file of files) if (TEMPORARY.test(file)) rmSync(join(dir, file), { force: true });
}

// Deletes all but the latest `kept` hourly snapshots, and the snapshots from before a migration
// that are older than a week at `now`, by the time in their names.
export function pruneSnapshots(dir: string, now: number, kept = SNAPSHOTS_KEPT): void {
  const files = readdirSync(dir);
  const hourly = files.filter((file) => HOURLY.test(file)).sort();
  const expired = files.filter((file) => {
    const [, ...parts] = BEFORE_MIGRATION.exec(file) ?? [];
    if (parts.length === 0) return false;
    const [year, month, day, hours, minutes, seconds] = parts.map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    return Date.UTC(year, month - 1, day, hours, minutes, seconds) < now - BEFORE_MIGRATION_MS;
  });
  for (const file of [...hourly.slice(0, Math.max(0, hourly.length - kept)), ...expired]) {
    rmSync(join(dir, file), { force: true });
  }
}

// The hourly snapshots of one database. A snapshot that fails is logged and the server goes on:
// the game needs no snapshot, and the next hour tries again. The clock tells only the names.
export class Snapshots {
  #running: Promise<void> | null = null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly dir: string,
    private readonly log: Log,
    private readonly now: () => number = () => Date.now(),
    private readonly kept = SNAPSHOTS_KEPT,
  ) {}

  // Writes a snapshot and deletes the old ones. While one is being written, another isn't started:
  // the promise of the one under way is returned.
  take(): Promise<void> {
    this.#running ??= this.#take().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  // Settles once no snapshot is being written, so that the database can be closed.
  idle(): Promise<void> {
    return this.#running ?? Promise.resolve();
  }

  async #take(): Promise<void> {
    const started = performance.now();
    try {
      const file = await writeSnapshot(this.db, this.dir, snapshotName(this.now()));
      pruneSnapshots(this.dir, this.now(), this.kept);
      this.log('snapshot_saved', { file: basename(file), ms: Math.round(performance.now() - started) });
    } catch (error) {
      this.log('snapshot_failed', { message: error instanceof Error ? error.message : String(error) });
    }
  }
}
