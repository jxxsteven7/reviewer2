import { statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations';
import { pruneSnapshots, removeTemporary, snapshotName, writeSnapshot } from './snapshots';

// The server's database (docs/architecture.md): one SQLite file in DATA_DIR, or a database in
// memory when DATA_DIR is unset, with the same schema and the same code either way. node:sqlite
// is synchronous, so nothing can come between a read and the write that follows it, as nothing
// can between a handler's read of a room and its write.

export const DATABASE_FILE = 'reviewer2.db';
export const SNAPSHOT_DIR = 'snapshots';
// How long a write waits for a lock that another connection holds, such as the operator's own
// sqlite3, before it fails. The one Node thread waits with it, so it is not long.
export const BUSY_TIMEOUT_MS = 5000;

type Log = (event: string, fields?: Record<string, unknown>) => void;

export interface OpenOptions {
  migrations?: readonly string[];
  now?: () => number;
  // Hears what went wrong without stopping the start, such as old snapshots that can't be deleted.
  log?: Log;
}

export interface Database {
  db: DatabaseSync;
  // The file, or null for a database in memory, which ends with the process.
  file: string | null;
  // Where its snapshots go, or null for a database in memory, which has none.
  snapshots: string | null;
  // The journal mode that SQLite took: "wal" for a file, "memory" in memory.
  journal: string;
  // The version of the schema, and the version it was at before, when it had to be migrated.
  schema: number;
  migratedFrom: number | null;
  // The snapshot taken before migrating, if one was.
  beforeMigration: string | null;
}

// Opens the database in `dataDir`, or one in memory when that is null, and brings its schema up
// to date. When there are migrations to run on a database that has data in it, a snapshot is
// taken first. Throws when the directory isn't there, when the database is newer than this
// server, or when a migration fails, which leaves the database as it was.
export async function openDatabase(
  dataDir: string | null,
  { migrations = MIGRATIONS, now = () => Date.now(), log = () => {} }: OpenOptions = {},
): Promise<Database> {
  const file = dataDir === null ? null : join(directory(dataDir), DATABASE_FILE);
  const snapshots = dataDir === null ? null : join(dataDir, SNAPSHOT_DIR);
  const db = new DatabaseSync(file ?? ':memory:');
  try {
    const journal = configure(db);
    const from = schemaVersion(db);
    if (from > migrations.length) {
      throw new Error(
        `the database is at schema version ${from}, but this server knows only up to ${migrations.length}: ` +
          'run a newer server, or restore the snapshot from before the upgrade',
      );
    }
    let beforeMigration: string | null = null;
    if (snapshots !== null) {
      removeTemporary(snapshots);
      // A database that is new has nothing to lose.
      if (from > 0 && from < migrations.length) {
        beforeMigration = await writeSnapshot(db, snapshots, snapshotName(now(), `-before-v${migrations.length}`));
        // A migration that fails ends the process, and the service is started again and again,
        // with a snapshot like this one each time. Pruning keeps the latest alone, so that a
        // migration that keeps failing can't fill the disk with them.
        try {
          pruneSnapshots(snapshots, now());
        } catch (error) {
          log('snapshots_not_pruned', { message: (error as Error).message });
        }
      }
    }
    migrate(db, migrations, from);
    return {
      db,
      file,
      snapshots,
      journal,
      schema: migrations.length,
      migratedFrom: from < migrations.length ? from : null,
      beforeMigration,
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

// The directory must be there. One that isn't is a mistake in how the server was set up, and
// making it would quietly start an empty database somewhere nobody looks. The system's message
// names the directory.
function directory(dataDir: string): string {
  let isDirectory: boolean;
  try {
    isDirectory = statSync(dataDir).isDirectory();
  } catch (error) {
    throw new Error(`cannot use DATA_DIR: ${(error as Error).message}`, { cause: error });
  }
  if (!isDirectory) throw new Error(`DATA_DIR "${dataDir}" is not a directory`);
  return dataDir;
}

// Settings that hold for one connection, so they are made every time it opens:
//
// - The busy timeout, so that a write that finds someone else writing, such as the operator's
//   own sqlite3, waits for its turn rather than fail at once. It comes first, because the switch
//   to WAL needs a lock too.
// - WAL, so that reading never waits for writing, and a snapshot can be taken while the server
//   writes. With it, NORMAL is enough to keep the database whole through a crash; a power cut
//   may cost the last few writes.
// - Foreign keys, which SQLite leaves off by default.
// - Secure delete, so that what is deleted or overwritten, such as a contact after 90 days, is
//   zeroed in the file instead of lingering in its free pages, and in the snapshots made from it.
function configure(db: DatabaseSync): string {
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  const { journal_mode: journal } = db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode: string };
  db.exec('PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON');
  return journal;
}

// The largest the database may grow (docs/architecture.md). Past it, the server keeps nothing new:
// no feedback, no new accounts and no records of games, so that nothing can fill the disk. What
// is there already goes on working.
export const MAX_DATABASE_BYTES = 2 ** 30;

// The size of the database file, in bytes, as SQLite counts its pages. A database in memory has
// one too.
export function databaseBytes(db: DatabaseSync): number {
  const { bytes } = db
    .prepare('SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()')
    .get() as {
    bytes: number;
  };
  return bytes;
}

export function schemaVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

// Writes the WAL back into the database file and truncates it, so that the pages as they were
// before a change, such as a contact that was cleared, are no longer anywhere on disk. Returns
// whether that was done. It can't be while another connection, such as the operator's sqlite3,
// is in the middle of reading or writing; then it returns false at once, rather than wait the
// busy timeout out with the whole server, and the caller tries again later. A database in memory
// has no WAL, and gets true.
export function truncateWal(db: DatabaseSync): boolean {
  db.exec('PRAGMA busy_timeout = 0');
  try {
    const { busy } = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number };
    return busy === 0;
  } finally {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  }
}

// Runs the migrations after `from`, all in one transaction with the new version number, so that
// a database is either at the version it was at or at the latest, never in between. A server
// that has been rolled back then still finds the version it knows.
//
// Foreign keys are off while the migrations run, as SQLite's guide to changing a table asks: a
// migration that rebuilds a table (a new table, the rows copied over, the old one dropped and the
// new one renamed) would otherwise cascade the drop into every row that points at it. The pragma
// does nothing inside a transaction, so it is set before and after. What a migration leaves
// pointing at nothing is found before the commit, and rolls it back.
function migrate(db: DatabaseSync, migrations: readonly string[], from: number): void {
  if (from === migrations.length) return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const migration of migrations.slice(from)) db.exec(migration);
      const dangling = db.prepare('PRAGMA foreign_key_check').all() as { table: string; parent: string }[];
      if (dangling.length > 0) {
        const [{ table, parent }] = dangling as [{ table: string; parent: string }];
        throw new Error(
          `the migration leaves ${dangling.length} row(s) pointing at nothing, in "${table}" at "${parent}"`,
        );
      }
      db.exec(`PRAGMA user_version = ${migrations.length}`);
      db.exec('COMMIT');
    } catch (error) {
      // SQLite may have rolled back by itself already, as it does when the disk is full.
      try {
        db.exec('ROLLBACK');
      } catch {
        // Nothing left to roll back.
      }
      throw error;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
