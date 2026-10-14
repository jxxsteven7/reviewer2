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
  // 10: streaks (docs/architecture.md#streaks): for each account with a game on its record, the
  // longest run of games won in a row and of games lost in a row, and the run that its latest game
  // is part of, as long as it is and whether it is of wins. The runs are counted over the records
  // in the order they were kept, which is the order the games ended in, whichever game and in a
  // match or not. The row is kept up with every game that goes on the record, in the same
  // transaction, so that the account page and the end of a game read one row however long the
  // record is, and the rows for the records that are there are worked out here, once, from
  // game_records: each run is the games of one account with the same result between a change of
  // result, which the difference of the two row numbers tells apart. An account's row goes with it.
  `
  CREATE TABLE streaks (
    account_id INTEGER PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
    best_wins INTEGER NOT NULL,
    best_losses INTEGER NOT NULL,
    run INTEGER NOT NULL,
    run_won INTEGER NOT NULL CHECK (run_won IN (0, 1))
  ) STRICT;
  WITH ordered AS (
    SELECT account_id, id, won,
      row_number() OVER (PARTITION BY account_id ORDER BY id)
        - row_number() OVER (PARTITION BY account_id, won ORDER BY id) AS run_key
    FROM game_records
  ), runs AS (
    SELECT account_id, won, count(*) AS length, max(id) AS last_id
    FROM ordered GROUP BY account_id, won, run_key
  ), latest AS (
    SELECT account_id, won, length FROM runs
    WHERE last_id = (SELECT max(id) FROM game_records WHERE game_records.account_id = runs.account_id)
  )
  INSERT INTO streaks (account_id, best_wins, best_losses, run, run_won)
  SELECT runs.account_id,
    max(CASE WHEN runs.won = 1 THEN runs.length ELSE 0 END),
    max(CASE WHEN runs.won = 0 THEN runs.length ELSE 0 END),
    latest.length,
    latest.won
  FROM runs JOIN latest ON latest.account_id = runs.account_id
  GROUP BY runs.account_id;
  `,
  // 11: public profiles and likes (docs/architecture.md#public-profiles).
  //
  // - accounts get the handle by which a profile is opened, 12 hexadecimal digits drawn at random
  //   (HANDLE in shared/src/accounts.ts), given to every account that is there and to each new one
  //   as it is created; the link and the bio that the owner writes; whether the owner shows the
  //   record and the acknowledgments on the profile; and whether the operator has barred the
  //   account from writing a link or a bio. A column added by ALTER TABLE can't be NOT NULL without
  //   a constant default, so the handle is filled in right after, and the unique index makes sure
  //   that every account has one of its own.
  // - likes: one row for each account that likes a profile, by the account liked and the account
  //   that likes it, which may not be the same. It is a relationship, not an archive: a like that
  //   is taken back is deleted, and every row goes with either account.
  `
  ALTER TABLE accounts ADD COLUMN handle TEXT;
  UPDATE accounts SET handle = lower(hex(randomblob(6)));
  CREATE UNIQUE INDEX accounts_handle ON accounts (handle);
  ALTER TABLE accounts ADD COLUMN link TEXT;
  ALTER TABLE accounts ADD COLUMN bio TEXT;
  ALTER TABLE accounts ADD COLUMN show_record INTEGER NOT NULL DEFAULT 0 CHECK (show_record IN (0, 1));
  ALTER TABLE accounts ADD COLUMN show_thanks INTEGER NOT NULL DEFAULT 0 CHECK (show_thanks IN (0, 1));
  ALTER TABLE accounts ADD COLUMN profile_banned INTEGER NOT NULL DEFAULT 0 CHECK (profile_banned IN (0, 1));

  CREATE TABLE likes (
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    liker_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (account_id, liker_id),
    CHECK (account_id <> liker_id)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX likes_liker ON likes (liker_id);
  `,
  // 12: the record of each game (docs/architecture.md#game-records). A replay gets the log of
  // everything that happened in the game, as JSON, kept on the server alone; the replays from
  // before have none. game_players says which player, by the ID they had in the room, was which
  // account, for those with an account who played in the game, those who left it included. A
  // row goes with its account; the log keeps the player ID, and the replay the name the player
  // had in the game if they revealed a card.
  `
  ALTER TABLE replays ADD COLUMN log TEXT;

  CREATE TABLE game_players (
    game_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    PRIMARY KEY (game_id, player_id)
  ) STRICT;
  CREATE INDEX game_players_account ON game_players (account_id);
  `,
  // 13: friend duos (docs/architecture.md#friend-duos): the records of a game by the game, so that
  // the others who played in each game on an account's record are found without reading every
  // record. Nothing new is kept: the counts are worked out from the records whenever they are asked
  // for.
  `
  CREATE INDEX game_records_game ON game_records (game_id);
  `,
  // 14: the titles that games bring (docs/architecture.md#titles), and the games of matches on the
  // records (docs/architecture.md#accounts).
  //
  // - titles is rebuilt, once, as migration 5 rebuilt the feedback, so that its title is no longer
  //   fixed by a CHECK: the titles are in shared/src/accounts.ts alone (TitleStore checks them), and
  //   a new one is a change to the code. Every row is kept as it was, with its id, and the count that
  //   AUTOINCREMENT goes on from. A title comes from a match, by its ID, or from a turn of a game, by
  //   the game's ID and the turn, or, for titles from before matches had IDs, from neither; never
  //   from both. A turn of a game brings an account a title once, as a match does, however often its
  //   end is reported.
  // - game_records get the match that a game was played in, if any, which game of it the game was,
  //   from 1, and how many games the match was to have; all three or none. The records from before
  //   all count as games outside a match: nothing tells which were in one.
  `
  CREATE TABLE new_titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    match_id TEXT,
    game_id TEXT,
    turn INTEGER CHECK (turn > 0),
    awarded_at TEXT NOT NULL,
    CHECK ((game_id IS NULL) = (turn IS NULL)),
    CHECK (match_id IS NULL OR game_id IS NULL)
  ) STRICT;
  INSERT INTO new_titles (id, account_id, title, match_id, awarded_at)
    SELECT id, account_id, title, match_id, awarded_at FROM titles;
  DELETE FROM sqlite_sequence WHERE name = 'new_titles';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'new_titles', seq FROM sqlite_sequence WHERE name = 'titles';
  DROP TABLE titles;
  ALTER TABLE new_titles RENAME TO titles;
  CREATE INDEX titles_account ON titles (account_id);
  CREATE UNIQUE INDEX titles_match ON titles (account_id, title, match_id) WHERE match_id IS NOT NULL;
  CREATE UNIQUE INDEX titles_game ON titles (account_id, title, game_id, turn) WHERE game_id IS NOT NULL;

  ALTER TABLE game_records ADD COLUMN match_id TEXT;
  ALTER TABLE game_records ADD COLUMN match_game INTEGER;
  ALTER TABLE game_records ADD COLUMN match_games INTEGER CHECK (
    (match_id IS NULL) = (match_game IS NULL) AND (match_id IS NULL) = (match_games IS NULL)
    AND match_game BETWEEN 1 AND match_games
  );
  `,
  // 15: AI players (docs/architecture.md#ai-players), and a record of every game
  // (docs/architecture.md#game-records).
  //
  // - accounts get whether the operator has let them have AI players in the rooms they chair.
  // - game records get whether an AI played in the game, which brings no points, streak or title of
  //   friends, and the records from before none.
  // - replays become the record of every game, however it ended, with or without a replay to watch,
  //   which goes in `data` for a game that finished: SQLite can't make a column nullable, so the
  //   table is made again, with all it had. Each game gets what kind of game it was, for whoever
  //   studies the games to tell them apart: how it ended (`ending`), and who won and how
  //   (`winner`, `reason`) when it finished, when it began, how it began
  //   (`setup`, as JSON), how many played in it with an account, as guests and as AI players,
  //   whether an AI played for someone who was offline, whether it was a game of a match, its
  //   language and fields, and the versions of the server, of the game's rules and of the word
  //   lists. The replays from before, all of finished games, say `finished` and nothing else of
  //   these.
  // - replays get the AI's own log of the game beside the game's log, as JSON, kept on the server
  //   alone: how each AI came to each of its moves (server/src/core/agentLog.ts). A game that no AI
  //   played in has none, and neither do the replays from before.
  // - agent_plays keeps what each AI did in each game that finished, for its page: a row for each
  //   AI player in a seat at the end, with its side, role, result and what the game counted of it,
  //   and a row for each person it played for while they were offline, with their account, which
  //   is forgotten when the account is deleted.
  `
  ALTER TABLE accounts ADD COLUMN agents INTEGER NOT NULL DEFAULT 0 CHECK (agents IN (0, 1));
  ALTER TABLE game_records ADD COLUMN agents INTEGER NOT NULL DEFAULT 0 CHECK (agents IN (0, 1));

  CREATE TABLE games_kept (
    game_id TEXT PRIMARY KEY,
    game TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    data TEXT,
    log TEXT,
    agent_log TEXT,
    ending TEXT NOT NULL CHECK (ending IN ('finished', 'withdrawn', 'abandoned', 'interrupted')),
    winner TEXT,
    reason TEXT,
    started_at TEXT,
    setup TEXT,
    accounts INTEGER,
    guests INTEGER,
    agents INTEGER,
    takeover INTEGER CHECK (takeover IN (0, 1)),
    in_match INTEGER CHECK (in_match IN (0, 1)),
    language TEXT,
    fields TEXT,
    version TEXT,
    rules INTEGER,
    words TEXT
  ) STRICT;
  INSERT INTO games_kept (game_id, game, ended_at, data, log, ending)
    SELECT game_id, game, ended_at, data, log, 'finished' FROM replays;
  DROP TABLE replays;
  ALTER TABLE games_kept RENAME TO replays;

  CREATE TABLE agent_plays (
    game_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    persona TEXT NOT NULL,
    takeover INTEGER NOT NULL CHECK (takeover IN (0, 1)),
    account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
    side TEXT,
    role TEXT,
    won INTEGER CHECK (won IN (0, 1)),
    clues INTEGER NOT NULL DEFAULT 0,
    found INTEGER NOT NULL DEFAULT 0,
    reviewer2 INTEGER NOT NULL DEFAULT 0,
    best_word TEXT,
    best_found INTEGER,
    PRIMARY KEY (game_id, player_id)
  ) STRICT;
  CREATE INDEX agent_plays_persona ON agent_plays (persona);
  CREATE INDEX agent_plays_account ON agent_plays (account_id);
  `,
  // 16: the line that may come with a friend request, and the names that friends give each other
  // (docs/architecture.md#friends), each for one account alone. The line is for the account asked;
  // it is cleared once the request is answered, accepted or declined. Each side's name for the
  // other, the requester's and the addressee's, is theirs to set while the two are friends. All go
  // with the row when the request is withdrawn, the friendship ends or either account is deleted, so
  // that nobody reads them again. NULL for none, as for the rows that were there.
  `
  ALTER TABLE friendships ADD COLUMN note TEXT;
  ALTER TABLE friendships ADD COLUMN requester_alias TEXT;
  ALTER TABLE friendships ADD COLUMN addressee_alias TEXT;
  `,
  // 17: feedback contributions (docs/architecture.md#feedback-contributions). The players thanked
  // for their feedback are the feedback that the operator adopted, and nothing else, so adopting it
  // becomes one more of the operator's notes on the feedback, and the table of acknowledgments
  // goes: ACKNOWLEDGMENTS.md, which the maintainers write by hand, thanks everyone else.
  //
  // - feedback gets when it was adopted, which a row that is adopted has and keeps, and what the
  //   player contributed, as the operator writes it, in Chinese and in English, for the home page.
  //   The partial index finds the adopted rows quickly.
  // - feedback gets whether the player let the name they left link to the public profile of the
  //   account they sent it from, which the home page then does. The feedback that is there may,
  //   as its players agreed with the maintainers.
  // - the link that came with a name, and whether the player agreed to a public issue, go: every
  //   adopted piece of feedback is an issue now, and a name links to the player's profile, where
  //   they keep a link of their own. SQLite drops a column whose CHECK is its own.
  // - every acknowledgment that adopted feedback marks that feedback adopted when it was, with no
  //   sentences yet, which the operator writes afterwards. Its name and account were the
  //   feedback's own. Those added by hand, which point at no feedback, aren't kept: they are in
  //   ACKNOWLEDGMENTS.md.
  //
  // The archive's guard (archive.test.ts) allows the changes to the rows and the columns here alone.
  `
  ALTER TABLE feedback ADD COLUMN adopted_at TEXT;
  ALTER TABLE feedback ADD COLUMN summary_zh TEXT;
  ALTER TABLE feedback ADD COLUMN summary_en TEXT;
  ALTER TABLE feedback ADD COLUMN link_profile INTEGER NOT NULL DEFAULT 0 CHECK (link_profile IN (0, 1));
  UPDATE feedback SET link_profile = 1;
  ALTER TABLE feedback DROP COLUMN link;
  ALTER TABLE feedback DROP COLUMN public_issue;
  UPDATE feedback SET adopted_at = (SELECT credited_at FROM acknowledgments WHERE feedback_id = feedback.id)
    WHERE id IN (SELECT feedback_id FROM acknowledgments);
  DROP TABLE acknowledgments;
  CREATE INDEX feedback_adopted ON feedback (adopted_at) WHERE adopted_at IS NOT NULL;
  `,
];
