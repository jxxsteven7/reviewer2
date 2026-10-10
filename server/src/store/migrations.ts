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
];
