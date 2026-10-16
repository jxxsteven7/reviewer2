import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

// Snapshots of the database (docs/architecture.md): a copy every hour in DATA_DIR/snapshots, of
// which the last three are kept, and one before every migration, of which the latest for each
// version is kept for a week. A snapshot holds the contacts that players left, so none is kept
// for long: a contact outlives its 90 days by no more than the snapshots that were taken before
// it was cleared. A database in memory has none.

export const SNAPSHOT_MS = 60 * 60_000;
export const SNAPSHOTS_KEPT = 3;
// Long enough to notice what a migration broke, and to go back to the database from before it.
export const BEFORE_MIGRATION_MS = 7 * 24 * 60 * 60_000;

// The hourly snapshots, the snapshots from before a migration, which have the version that the
// migration went to after the time, and those from before the records were counted again under
// new rules (store/recount.ts), kept as the ones from before a migration are.
const STAMP = '(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z';
const HOURLY = new RegExp(`^reviewer2-${STAMP}\\.db$`);
const BEFORE_MIGRATION = new RegExp(`^reviewer2-${STAMP}-before-v(\\d+)\\.db$`);
const BEFORE_RECOUNT = new RegExp(`^reviewer2-${STAMP}-before-recount\\.db$`);
export const BEFORE_RECOUNT_SUFFIX = '-before-recount';
// What a snapshot is written to before it gets its name, and the files that SQLite keeps beside it
// while it is open.
const TEMPORARY = /\.tmp(-wal|-shm|-journal)?$/;

type Log = (event: string, fields?: Record<string, unknown>) => void;

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

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

// The time in the name of a snapshot of the kind, or null for any other file.
function timeOf(file: string, kind: RegExp): number | null {
  const match = kind.exec(file);
  if (!match) return null;
  const [year = 0, month = 1, day, hours, minutes, seconds] = match.slice(1, 7).map(Number);
  return Date.UTC(year, month - 1, day, hours, minutes, seconds);
}

// Deletes all but the latest `kept` hourly snapshots, and of the snapshots from before a
// migration those older than a week at `now` and those that a later one to the same version
// supersedes, all by the time in their names. An earlier snapshot to the same version comes from
// a start whose migration failed; the database hasn't moved on since, unless the service went
// back to the release before, and then the later snapshot is the one that has what it wrote. Of
// the snapshots from before a recount, those older than a week go.
export function pruneSnapshots(dir: string, now: number, kept = SNAPSHOTS_KEPT): void {
  const files = readdirSync(dir);
  const hourly = files.filter((file) => HOURLY.test(file)).sort();
  const latestByVersion = new Map<string, string>();
  for (const file of files.filter((file) => BEFORE_MIGRATION.test(file)).sort()) {
    latestByVersion.set(BEFORE_MIGRATION.exec(file)?.[7] ?? '', file);
  }
  const beforeMigration = files.filter((file) => {
    const match = BEFORE_MIGRATION.exec(file);
    if (!match) return false;
    const time = timeOf(file, BEFORE_MIGRATION) ?? 0;
    return time < now - BEFORE_MIGRATION_MS || latestByVersion.get(match[7] ?? '') !== file;
  });
  const beforeRecount = files.filter(
    (file) => BEFORE_RECOUNT.test(file) && (timeOf(file, BEFORE_RECOUNT) ?? 0) < now - BEFORE_MIGRATION_MS,
  );
  for (const file of [...hourly.slice(0, Math.max(0, hourly.length - kept)), ...beforeMigration, ...beforeRecount]) {
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

  // Whether the latest hourly snapshot is an hour old or older, or there is none. A server that is
  // restarted more often than once an hour, as on a day of many releases, would otherwise never
  // get to its first.
  due(): boolean {
    let files: string[];
    try {
      files = readdirSync(this.dir);
    } catch {
      return true;
    }
    const times = files.map((file) => timeOf(file, HOURLY)).filter((time) => time !== null);
    return times.length === 0 || Math.max(...times) <= this.now() - SNAPSHOT_MS;
  }

  // Settles once no snapshot is being written, so that the database can be closed.
  idle(): Promise<void> {
    return this.#running ?? Promise.resolve();
  }

  async #take(): Promise<void> {
    const started = performance.now();
    let file: string;
    try {
      file = await writeSnapshot(this.db, this.dir, snapshotName(this.now()));
    } catch (error) {
      this.log('snapshot_failed', { message: describe(error) });
      return;
    }
    this.log('snapshot_saved', { file: basename(file), ms: Math.round(performance.now() - started) });
    // The snapshot is there all the same when the old ones can't be deleted.
    try {
      pruneSnapshots(this.dir, this.now(), this.kept);
    } catch (error) {
      this.log('snapshots_not_pruned', { message: describe(error) });
    }
  }
}
