// The schema of the database, one migration at a time (docs/architecture.md). Migration n takes
// the database from version n - 1 to version n, and `PRAGMA user_version` records the version
// that a database is at. A migration that has been released never changes: a change to the
// schema is a new migration at the end.

export const MIGRATIONS: readonly string[] = [
  // 1: feedback from players. The server never deletes a row, but the operator may, to make room
  // (docs/architecture.md); AUTOINCREMENT keeps a deleted id from being given out again, so that
  // an id in the log names one piece of feedback for good. The contact is cleared 90 days after
  // the feedback came, which the partial index finds quickly.
  `
  CREATE TABLE feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('idea', 'bug', 'words')),
    text TEXT NOT NULL,
    contact TEXT,
    version TEXT NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('zh', 'en')),
    page TEXT NOT NULL CHECK (page IN ('home', 'room')),
    user_agent TEXT
  ) STRICT;
  CREATE INDEX feedback_contact_expiry ON feedback (created_at) WHERE contact IS NOT NULL;
  `,
];
