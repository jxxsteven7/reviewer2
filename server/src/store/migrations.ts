// The schema of the database, one migration at a time (docs/architecture.md). Migration n takes
// the database from version n - 1 to version n, and `PRAGMA user_version` records the version
// that a database is at. A migration that has been released never changes: a change to the
// schema is a new migration at the end.

export const MIGRATIONS: readonly string[] = [
  // 1: feedback from players. It is an archive (docs/architecture.md), and nothing deleted a row
  // until migration 9 gave it a trash; AUTOINCREMENT keeps a deleted id from being given out
  // again, so that an id in the log names one piece of feedback for good. The contact is cleared
  // 90 days after the feedback came, which the partial index finds quickly.
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
  // 2: accounts (docs/architecture.md). Everything that belongs to an account goes when the account
  // does, through ON DELETE CASCADE, and secure delete overwrites it in the file. No table holds an
  // address, a browser's user agent, an email address or a token: tokens are kept as their SHA-256
  // and email addresses as an HMAC with the server's secret.
  //
  // - accounts: the username as it is shown, and its key (usernameKey() in shared/src/accounts.ts),
  //   which is what makes two names the same; the password's scrypt hash with its parameters; the
  //   fingerprint of the confirmed email address; the file name of the avatar, if one was uploaded;
  //   and whether the operator has barred the account from uploading another. AUTOINCREMENT keeps an
  //   id from being given out again after an account is deleted.
  // - sessions: one row for each browser that is logged in, by the hash of the token in its cookie.
  // - email_tokens: the links in the mails that confirm an address and reset a password, by the
  //   hash of their token. A link to confirm an address carries the fingerprint of that address.
  // - game_records: one row for each game that a player with an account finished in a seat, as the
  //   game module described their part in it. A game is recorded once for each account.
  // - titles: one row for each title a match awarded.
  // - settings: what the server must remember between starts and that fits no other table, such as
  //   the fingerprint of a fixed text, by which it tells that the key for fingerprints has changed.
  `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    username_key TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    email_fp BLOB UNIQUE,
    avatar TEXT,
    avatar_banned INTEGER NOT NULL DEFAULT 0 CHECK (avatar_banned IN (0, 1)),
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX accounts_avatar ON accounts (avatar) WHERE avatar IS NOT NULL;

  CREATE TABLE sessions (
    token_hash BLOB PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    used_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX sessions_account ON sessions (account_id);
  CREATE INDEX sessions_used ON sessions (used_at);

  CREATE TABLE email_tokens (
    token_hash BLOB PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('bind', 'reset')),
    email_fp BLOB,
    expires_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX email_tokens_account ON email_tokens (account_id);
  CREATE INDEX email_tokens_expiry ON email_tokens (expires_at);

  CREATE TABLE game_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    game_id TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    side TEXT NOT NULL,
    role TEXT NOT NULL,
    winner TEXT NOT NULL,
    won INTEGER NOT NULL CHECK (won IN (0, 1)),
    verdict TEXT NOT NULL,
    UNIQUE (account_id, game_id)
  ) STRICT;
  CREATE INDEX game_records_recent ON game_records (account_id, id DESC);

  CREATE TABLE titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (title IN ('best_paper', 'black_hole')),
    match_id TEXT,
    awarded_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX titles_account ON titles (account_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
  `,
  // 3: matches (docs/architecture.md#matches).
  //
  // - match_records: one row for each match that a player with an account finished ranked: how
  //   many games it had, the place they finished in among how many ranked players, their total and
  //   their title. A match is recorded once for each account.
  // - titles_match: a match awards an account a title once, however often its end is reported.
  //   Titles from before matches had IDs, if any, stay as they are.
  `
  CREATE TABLE match_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    match_id TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    games INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    players INTEGER NOT NULL,
    score INTEGER NOT NULL,
    title TEXT CHECK (title IN ('best_paper', 'black_hole')),
    UNIQUE (account_id, match_id)
  ) STRICT;
  CREATE INDEX match_records_recent ON match_records (account_id, id DESC);

  CREATE UNIQUE INDEX titles_match ON titles (account_id, title, match_id) WHERE match_id IS NOT NULL;
  `,
  // 4: acknowledgments (docs/architecture.md#acknowledgments).
  //
  // - feedback gets the name that the player wants to be thanked by, if they gave one, and the
  //   account they were logged in to when they did, which the acknowledgment is counted for. The
  //   account goes from the feedback when it is deleted.
  // - acknowledgments: whom the operator thanked; the public list is ACKNOWLEDGMENTS.md. Each row is
  //   the name, what it is for, when it was given, the feedback it came from, if any, and the
  //   account it is counted for, if any. The name stays when the account is deleted: it is the
  //   public name its owner gave, not the account. The feedback's number is kept as a number and
  //   not as a foreign key, so that a row of feedback deleted by hand with sqlite3, which runs with
  //   foreign keys off, wouldn't leave a row that the next migration refuses. A piece of feedback is
  //   adopted once.
  `
  ALTER TABLE feedback ADD COLUMN credit TEXT;
  ALTER TABLE feedback ADD COLUMN account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL;
  CREATE INDEX feedback_account ON feedback (account_id) WHERE account_id IS NOT NULL;

  CREATE TABLE acknowledgments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('feedback', 'words', 'playtesting')),
    credited_at TEXT NOT NULL,
    feedback_id INTEGER UNIQUE,
    account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL
  ) STRICT;
  CREATE INDEX acknowledgments_account ON acknowledgments (account_id) WHERE account_id IS NOT NULL;
  `,
  // 5: the feedback table rebuilt, once, so that its kind is no longer fixed by a CHECK: the kinds
  // are in shared/src/feedback.ts alone, and a new one is a change to the code. Every row is kept as
  // it was. It is done as SQLite's guide to changing a table says, with foreign keys off
  // (migrate() in database.ts): a new table, every row copied with its id, the count that
  // AUTOINCREMENT goes on from carried over, the old table dropped, the new one renamed and the
  // indexes made again. The archive's guard (archive.test.ts) allows this here alone; any other
  // migration only adds to the table. The new table has the columns of the old one, and three more:
  // the link that the player gave with their name, whether they agreed to the feedback being
  // published as a GitHub issue, which is NULL for feedback from before they were asked, and the
  // number of that issue, once the operator has published it.
  `
  CREATE TABLE new_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    contact TEXT,
    version TEXT NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('zh', 'en')),
    page TEXT NOT NULL CHECK (page IN ('home', 'room')),
    user_agent TEXT,
    credit TEXT,
    account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
    link TEXT,
    public_issue INTEGER CHECK (public_issue IN (0, 1)),
    issue INTEGER CHECK (issue > 0)
  ) STRICT;
  INSERT INTO new_feedback (id, created_at, kind, text, contact, version, language, page, user_agent, credit, account_id)
    SELECT id, created_at, kind, text, contact, version, language, page, user_agent, credit, account_id FROM feedback;
  DELETE FROM sqlite_sequence WHERE name = 'new_feedback';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'new_feedback', seq FROM sqlite_sequence WHERE name = 'feedback';
  DROP TABLE feedback;
  ALTER TABLE new_feedback RENAME TO feedback;
  CREATE INDEX feedback_contact_expiry ON feedback (created_at) WHERE contact IS NOT NULL;
  CREATE INDEX feedback_account ON feedback (account_id) WHERE account_id IS NOT NULL;
  `,
  // 6: public rooms (docs/architecture.md#public-rooms).
  //
  // - accounts get whether the operator has barred them from public rooms.
  // - reports: what players reported of each other, for the operator, beside the feedback. Each row
  //   is when, the account that reported, the account reported, if the player had one, the name the
  //   player had in the room, the room's code and the note, if any. Reports are an archive, as the
  //   feedback is (archive.test.ts): no row is deleted or changed, and a deleted account is only
  //   unlinked from them.
  `
  ALTER TABLE accounts ADD COLUMN public_barred INTEGER NOT NULL DEFAULT 0 CHECK (public_barred IN (0, 1));

  CREATE TABLE reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    reporter_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
    reported_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
    reported_name TEXT NOT NULL,
    room_code TEXT NOT NULL,
    text TEXT
  ) STRICT;
  CREATE INDEX reports_reporter ON reports (reporter_id) WHERE reporter_id IS NOT NULL;
  CREATE INDEX reports_reported ON reports (reported_id) WHERE reported_id IS NOT NULL;
  `,
  // 7: replays (docs/architecture.md#replays): one row for each finished game that a player with
  // an account took part in, as the game module gave it to watch again, as JSON. It belongs to no
  // one account, since several may have played in it: only an account with a row for the game in
  // game_records may read it, and it stays when an account is deleted.
  `
  CREATE TABLE replays (
    game_id TEXT PRIMARY KEY,
    game TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    data TEXT NOT NULL
  ) STRICT;
  `,
  // 8: friends and academic ranks (docs/architecture.md#friends, docs/architecture.md#academic-ranks).
  //
  // - game_records get the points of the game, scored as a match scores it, which add up to the
  //   account's rank. The records from before count as 0.
  // - friendships: one row for each pair of accounts between which a request is open, was declined
  //   or was accepted: who asked whom, how it stands, when it was asked and when it was answered. A
  //   pair has one row whichever way it was asked, by the index on the ordered pair. It is a
  //   relationship, not an archive: a friendship that is removed is deleted, a declined request once
  //   its wait is over, and everything goes with either account.
  `
  ALTER TABLE game_records ADD COLUMN points INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    addressee_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TEXT NOT NULL,
    answered_at TEXT,
    CHECK (requester_id <> addressee_id)
  ) STRICT;
  CREATE UNIQUE INDEX friendships_pair ON friendships (min(requester_id, addressee_id), max(requester_id, addressee_id));
  CREATE INDEX friendships_requester ON friendships (requester_id);
  CREATE INDEX friendships_addressee ON friendships (addressee_id);
  `,
  // 9: what became of the feedback (docs/architecture.md#feedback), as the operator's notes
  // beside the issue: the pull request that resolved it and when that was recorded, when it was
  // closed without being adopted, and when it was put in the trash, from which it is deleted for
  // good 30 days later, the one way a row ever goes (archive.test.ts). The partial index finds what
  // is in the trash quickly. Every column is nullable, and the rows that were there get NULL: open,
  // not resolved, not in the trash.
  `
  ALTER TABLE feedback ADD COLUMN resolved_pr INTEGER CHECK (resolved_pr > 0);
  ALTER TABLE feedback ADD COLUMN resolved_at TEXT;
  ALTER TABLE feedback ADD COLUMN closed_at TEXT;
  ALTER TABLE feedback ADD COLUMN deleted_at TEXT;
  CREATE INDEX feedback_trash ON feedback (deleted_at) WHERE deleted_at IS NOT NULL;
  `,
];
