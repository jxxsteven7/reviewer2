import { statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations';
import { removeTemporary, snapshotName, writeSnapshot } from './snapshots';

// The server's database (docs/architecture.md): one SQLite file in DATA_DIR, or a database in
// memory when DATA_DIR is unset, with the same schema and the same code either way. node:sqlite
// is synchronous, so nothing can come between a read and the write that follows it, as nothing
// can between a handler's read of a room and its write.

export const DATABASE_FILE = 'reviewer2.db';
export const SNAPSHOT_DIR = 'snapshots';

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
  { migrations = MIGRATIONS, now = () => Date.now() }: { migrations?: readonly string[]; now?: () => number } = {},
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
// - WAL, so that reading never waits for writing, and a snapshot can be taken while the server
//   writes. With it, NORMAL is enough to keep the database whole through a crash; a power cut
//   may cost the last few writes.
// - A busy timeout, so that a write that finds someone else writing, such as the operator's own
//   sqlite3, waits for its turn rather than fail at once.
// - Foreign keys, which SQLite leaves off by default.
// - Secure delete, so that what is deleted or overwritten, such as a contact after 90 days, is
//   zeroed in the file instead of lingering in its free pages, and in the snapshots made from it.
function configure(db: DatabaseSync): string {
  const { journal_mode: journal } = db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode: string };
  db.exec(
    'PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON',
  );
  return journal;
}

export function schemaVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

// Runs the migrations after `from`, all in one transaction with the new version number, so that
// a database is either at the version it was at or at the latest, never in between. A server
// that has been rolled back then still finds the version it knows.
function migrate(db: DatabaseSync, migrations: readonly string[], from: number): void {
  if (from === migrations.length) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const migration of migrations.slice(from)) db.exec(migration);
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
}
