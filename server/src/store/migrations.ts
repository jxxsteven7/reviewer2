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
  // 18: practice rooms (docs/architecture.md#practice-rooms). Each game gets whether it was played
  // in a room made to play with AI players, apart from one where the chair invited them; the
  // records from before have nothing here.
  `
  ALTER TABLE replays ADD COLUMN practice INTEGER CHECK (practice IN (0, 1));
  `,
  // 19: how an account last set up a room and a practice room (RoomSetup in shared/src/accounts.ts,
  // docs/architecture.md#accounts), which the next room setup starts from: JSON that the server
  // writes as a room is created, and reads for the owner's summary alone. It goes with the account.
  `
  ALTER TABLE accounts ADD COLUMN room_setup TEXT;
  `,
  // 20: replays keep no names (docs/architecture.md#replays). The replays from before kept the name
  // that each player who revealed a card had in the game, by player ID (`players`): a guest's
  // nickname, or an account's username as it was then. Nothing shows them any more, and they go.
  // Before they go, they say who was who in the games from before game_players (migration 12),
  // which have no rows there: a name that is the username of just one account on the game's
  // records, ignoring case, makes that player ID the account's. A name no such account has, a
  // guest's or one changed since, gives nothing.
  `
  INSERT OR IGNORE INTO game_players (game_id, player_id, account_id)
  SELECT replays.game_id, named.key, min(accounts.id)
  FROM replays, json_each(replays.data, '$.players') AS named
  JOIN game_records ON game_records.game_id = replays.game_id
  JOIN accounts ON accounts.id = game_records.account_id AND lower(accounts.username) = lower(named.value)
  WHERE json_type(replays.data, '$.players') = 'object'
    AND NOT EXISTS (SELECT 1 FROM game_players WHERE game_players.game_id = replays.game_id)
  GROUP BY replays.game_id, named.key
  HAVING count(*) = 1;

  UPDATE replays SET data = json_remove(data, '$.players') WHERE json_type(data, '$.players') IS NOT NULL;
  `,
  // 21: feedback signed with an account keeps the account alone (docs/architecture.md#feedback):
  // the account's username and avatar are looked up whenever the feedback is shown, and once the
  // account is gone it is a deleted player's, by no name. Feedback is from then on in one of three
  // ways: signed with an account, with no name; anonymous, with the account if the player was
  // logged in; or a guest's, with the name they left. The feedback that is there is put in them:
  // - what migration 17 marked as signed but had no name was anonymous, and what had a name but no
  //   account is a guest's name, whether its player never had an account or deleted it since;
  // - a name typed while logged in to an account, which older pages sent, signs with the account,
  //   as its players agreed with the maintainers;
  // - the name that feedback signed with an account kept goes.
  //
  // The archive's guard (archive.test.ts) allows these changes here alone, as the maintainers agreed.
  `
  UPDATE feedback SET link_profile = 0 WHERE link_profile = 1 AND (credit IS NULL OR account_id IS NULL);
  UPDATE feedback SET link_profile = 1 WHERE link_profile = 0 AND credit IS NOT NULL AND account_id IS NOT NULL;
  UPDATE feedback SET credit = NULL WHERE link_profile = 1;
  `,
  // 22: every game kept in the newest format (docs/architecture.md#game-records), and replays worked
  // out from the record of the game as they are opened (docs/architecture.md#replays). What the
  // database holds can't complete, or counted under other rules, goes, as the maintainers decided
  // before the first public release:
  //
  // - the games kept from before the record of every game (migration 15), which keep nothing of what
  //   kind of game they were, `started_at` and the rest, and so most of them have no log, or a log
  //   of the first version; any other game whose log isn't of the second version (gameLog.ts); the
  //   games kept with a guest whose number nothing says; the games of the first game played under
  //   rules before version 4, those of today (RULES_VERSION in server/src/games/keywords/index.ts),
  //   whose points and titles were counted under other rules; and the records that have no kept
  //   game and ended before the first game kept under today's rules, from before games were kept
  //   or under those other rules. A game with words of the chair's own, which leaves no record of
  //   the game, keeps its records since. Each goes with its records, the titles that it brought, who
  //   was who in it and what the AI players did in it.
  // - the matches from before the records of games named their match (migration 14), which no
  //   record names, and those that a game that goes was played in, with their other games and the
  //   titles that they awarded; and the titles from before the matches had IDs, of neither a match
  //   nor a game.
  //
  // The rest is completed: a game from before the practice rooms (migration 18) wasn't played in
  // one. The replays that the server kept go (`data`): a replay is worked out from how the game began
  // and its log, as the game is opened, and the log gets the number of each guest who played in it
  // (`guests`), from the replay that kept it, which numbered those in the groups at the end and
  // those who gave a clue or revealed a card: a game with a guest that it doesn't number goes, as
  // above. The tables of the games, their records and the titles
  // are rebuilt, as migration 14 rebuilt the titles, every row kept with its id and the count that
  // AUTOINCREMENT goes on from, so that nothing in an old format comes back: a kept game has
  // everything that the record of every game keeps, and a winner only when it finished; a title
  // comes from one match or one turn of one game; a game record has its points and whether an AI
  // played in it, which brings no points and is never a game of a match. The streaks are counted
  // again, as migration 10 counted them, over the records that are left, without the games that an
  // AI played in (migration 15).
  `
  UPDATE replays SET log = json_set(log, '$.guests', json((
    SELECT json_group_object(member.key, json_extract(member.value, '$.guest'))
    FROM json_each(replays.data, '$.members') AS member
    WHERE json_type(member.value, '$.guest') = 'integer'
  )))
  WHERE log IS NOT NULL AND json_type(log, '$.guests') IS NULL AND EXISTS (
    SELECT 1 FROM json_each(replays.data, '$.members') AS member WHERE json_type(member.value, '$.guest') = 'integer'
  );

  CREATE TEMP TABLE gone_games (game_id TEXT PRIMARY KEY);
  INSERT INTO gone_games SELECT game_id FROM replays
    WHERE started_at IS NULL OR (log IS NOT NULL AND json_extract(log, '$.v') IS NOT 2)
      OR (guests > 0 AND log IS NOT NULL
        AND (SELECT count(DISTINCT member.value) FROM json_each(replays.log, '$.guests') AS member) < guests)
      OR (game = 'keywords' AND rules IS NOT 4);
  INSERT OR IGNORE INTO gone_games SELECT game_id FROM game_records
    WHERE game_id NOT IN (SELECT game_id FROM replays) AND ended_at < coalesce(
      (SELECT min(ended_at) FROM replays WHERE started_at IS NOT NULL AND game = 'keywords' AND rules = 4), '9999'
    );

  CREATE TEMP TABLE gone_matches (match_id TEXT PRIMARY KEY);
  INSERT OR IGNORE INTO gone_matches SELECT match_id FROM game_records
    WHERE match_id IS NOT NULL AND game_id IN (SELECT game_id FROM gone_games);
  INSERT OR IGNORE INTO gone_matches SELECT match_id FROM match_records
    WHERE match_id NOT IN (SELECT match_id FROM game_records WHERE match_id IS NOT NULL);
  INSERT OR IGNORE INTO gone_games SELECT game_id FROM game_records
    WHERE match_id IN (SELECT match_id FROM gone_matches);

  DELETE FROM game_records WHERE game_id IN (SELECT game_id FROM gone_games);
  DELETE FROM replays WHERE game_id IN (SELECT game_id FROM gone_games);
  DELETE FROM game_players WHERE game_id NOT IN (SELECT game_id FROM replays);
  DELETE FROM agent_plays WHERE game_id NOT IN (SELECT game_id FROM replays);
  DELETE FROM match_records WHERE match_id IN (SELECT match_id FROM gone_matches);
  DELETE FROM titles WHERE match_id IS NULL AND game_id IS NULL;
  DELETE FROM titles WHERE match_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM match_records WHERE match_records.match_id = titles.match_id AND match_records.account_id = titles.account_id
  );
  DELETE FROM titles WHERE game_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM game_records WHERE game_records.game_id = titles.game_id AND game_records.account_id = titles.account_id
  );
  DROP TABLE gone_games;
  DROP TABLE gone_matches;
  UPDATE replays SET practice = 0 WHERE practice IS NULL;

  CREATE TABLE new_replays (
    game_id TEXT PRIMARY KEY,
    game TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    log TEXT,
    agent_log TEXT,
    ending TEXT NOT NULL CHECK (ending IN ('finished', 'withdrawn', 'abandoned', 'interrupted')),
    winner TEXT,
    reason TEXT,
    started_at TEXT NOT NULL,
    setup TEXT,
    accounts INTEGER NOT NULL,
    guests INTEGER NOT NULL,
    agents INTEGER NOT NULL,
    takeover INTEGER NOT NULL CHECK (takeover IN (0, 1)),
    in_match INTEGER NOT NULL CHECK (in_match IN (0, 1)),
    practice INTEGER NOT NULL CHECK (practice IN (0, 1)),
    language TEXT NOT NULL,
    fields TEXT NOT NULL,
    version TEXT NOT NULL,
    rules INTEGER,
    words TEXT NOT NULL,
    CHECK (ending = 'finished' OR (winner IS NULL AND reason IS NULL))
  ) STRICT;
  INSERT INTO new_replays (game_id, game, ended_at, log, agent_log, ending, winner, reason, started_at, setup,
      accounts, guests, agents, takeover, in_match, practice, language, fields, version, rules, words)
    SELECT game_id, game, ended_at, log, agent_log, ending, winner, reason, started_at, setup,
      accounts, guests, agents, takeover, in_match, practice, language, fields, version, rules, words FROM replays;
  DROP TABLE replays;
  ALTER TABLE new_replays RENAME TO replays;

  CREATE TABLE new_titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    match_id TEXT,
    game_id TEXT,
    turn INTEGER CHECK (turn > 0),
    awarded_at TEXT NOT NULL,
    CHECK ((game_id IS NULL) = (turn IS NULL)),
    CHECK ((match_id IS NULL) <> (game_id IS NULL))
  ) STRICT;
  INSERT INTO new_titles (id, account_id, title, match_id, game_id, turn, awarded_at)
    SELECT id, account_id, title, match_id, game_id, turn, awarded_at FROM titles;
  DELETE FROM sqlite_sequence WHERE name = 'new_titles';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'new_titles', seq FROM sqlite_sequence WHERE name = 'titles';
  DROP TABLE titles;
  ALTER TABLE new_titles RENAME TO titles;
  CREATE INDEX titles_account ON titles (account_id);
  CREATE UNIQUE INDEX titles_match ON titles (account_id, title, match_id) WHERE match_id IS NOT NULL;
  CREATE UNIQUE INDEX titles_game ON titles (account_id, title, game_id, turn) WHERE game_id IS NOT NULL;

  CREATE TABLE new_game_records (
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
    points INTEGER NOT NULL,
    match_id TEXT,
    match_game INTEGER,
    match_games INTEGER,
    agents INTEGER NOT NULL CHECK (agents IN (0, 1)),
    UNIQUE (account_id, game_id),
    CHECK ((match_id IS NULL) = (match_game IS NULL) AND (match_id IS NULL) = (match_games IS NULL)),
    CHECK (match_game BETWEEN 1 AND match_games),
    CHECK (agents = 0 OR (points = 0 AND match_id IS NULL))
  ) STRICT;
  INSERT INTO new_game_records (id, account_id, game, game_id, ended_at, side, role, winner, won, verdict, points,
      match_id, match_game, match_games, agents)
    SELECT id, account_id, game, game_id, ended_at, side, role, winner, won, verdict, points,
      match_id, match_game, match_games, agents FROM game_records;
  DELETE FROM sqlite_sequence WHERE name = 'new_game_records';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'new_game_records', seq FROM sqlite_sequence WHERE name = 'game_records';
  DROP TABLE game_records;
  ALTER TABLE new_game_records RENAME TO game_records;
  CREATE INDEX game_records_recent ON game_records (account_id, id DESC);
  CREATE INDEX game_records_game ON game_records (game_id);

  DELETE FROM streaks;
  WITH ordered AS (
    SELECT account_id, id, won,
      row_number() OVER (PARTITION BY account_id ORDER BY id)
        - row_number() OVER (PARTITION BY account_id, won ORDER BY id) AS run_key
    FROM game_records WHERE agents = 0
  ), runs AS (
    SELECT account_id, won, count(*) AS length, max(id) AS last_id
    FROM ordered GROUP BY account_id, won, run_key
  ), latest AS (
    SELECT account_id, won, length FROM runs
    WHERE last_id = (SELECT max(id) FROM game_records WHERE game_records.account_id = runs.account_id AND agents = 0)
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
  // 23: every row of a game's data names its game, nothing is kept that the records can give, and
  // every account says what it agreed to, as the maintainers decided before the first public
  // release (docs/rules/constraints.md#data). The tables are rebuilt as migration 22 rebuilt the
  // records, every row kept with its id and the count that AUTOINCREMENT goes on from, so that
  // nothing in an old format comes back:
  //
  // - streaks go (docs/architecture.md#streaks): they are counted from the records whenever they
  //   are asked for, which the records allow, since every game on them says whether it was won and
  //   in which order it came. Before the table goes, the rows in it are held against the count,
  //   and a row that differs stops the migration: the count is the one that migration 22 made,
  //   over the games that no AI played in, and the two can only differ where the records were
  //   changed by hand.
  // - accounts are rebuilt with the handle no longer nullable, which the code alone made sure of
  //   since migration 11 (an account without one, which there shouldn't be, draws one), and with
  //   which version of the notice on how games are recorded the account agreed to and when
  //   (RECORDS_NOTICE_VERSION in shared/src/accounts.ts, docs/architecture.md#accounts). The
  //   accounts that are there agreed to the first version, as the maintainers confirmed with
  //   their players, at the time of the migration.
  // - titles get the game that the match or the game of each was of, from its record; a title
  //   that no record answers for, which migration 22 left none of, goes.
  // - agent_plays get the game too, from the record of the game, and what the game counts of an
  //   AI player in a seat, which was five columns of the first game's own counts, becomes one
  //   column of JSON (`feats`) in the game's own shape, as the game gives it
  //   (GameModule.agentFeats), as how a game began and its log are kept: a second game keeps its
  //   own counts there without a change to the table. A row for someone the AI played for keeps
  //   none, as the code never gave it any. A row of a game that isn't kept, which migration 22
  //   left none of, goes.
  `
  CREATE TEMP TABLE streaks_counted (
    account_id INTEGER PRIMARY KEY,
    best_wins INTEGER NOT NULL,
    best_losses INTEGER NOT NULL,
    run INTEGER NOT NULL,
    run_won INTEGER NOT NULL
  );
  WITH ordered AS (
    SELECT account_id, id, won,
      row_number() OVER (PARTITION BY account_id ORDER BY id)
        - row_number() OVER (PARTITION BY account_id, won ORDER BY id) AS run_key
    FROM game_records WHERE agents = 0
  ), runs AS (
    SELECT account_id, won, count(*) AS length, max(id) AS last_id
    FROM ordered GROUP BY account_id, won, run_key
  ), latest AS (
    SELECT account_id, won, length FROM runs
    WHERE last_id = (SELECT max(id) FROM game_records WHERE game_records.account_id = runs.account_id AND agents = 0)
  )
  INSERT INTO streaks_counted (account_id, best_wins, best_losses, run, run_won)
  SELECT runs.account_id,
    max(CASE WHEN runs.won = 1 THEN runs.length ELSE 0 END),
    max(CASE WHEN runs.won = 0 THEN runs.length ELSE 0 END),
    latest.length,
    latest.won
  FROM runs JOIN latest ON latest.account_id = runs.account_id
  GROUP BY runs.account_id;
  CREATE TEMP TABLE streaks_differ (
    account_id INTEGER CONSTRAINT streaks_differ_from_the_records CHECK (account_id IS NULL)
  );
  INSERT INTO streaks_differ
    SELECT account_id FROM (
      SELECT account_id, best_wins, best_losses, run, run_won FROM streaks
      EXCEPT SELECT account_id, best_wins, best_losses, run, run_won FROM streaks_counted
    )
    UNION SELECT account_id FROM (
      SELECT account_id, best_wins, best_losses, run, run_won FROM streaks_counted
      EXCEPT SELECT account_id, best_wins, best_losses, run, run_won FROM streaks
    );
  DROP TABLE streaks_differ;
  DROP TABLE streaks_counted;
  DROP TABLE streaks;

  CREATE TABLE new_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handle TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    username_key TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    email_fp BLOB UNIQUE,
    avatar TEXT,
    avatar_banned INTEGER NOT NULL DEFAULT 0 CHECK (avatar_banned IN (0, 1)),
    public_barred INTEGER NOT NULL DEFAULT 0 CHECK (public_barred IN (0, 1)),
    profile_banned INTEGER NOT NULL DEFAULT 0 CHECK (profile_banned IN (0, 1)),
    agents INTEGER NOT NULL DEFAULT 0 CHECK (agents IN (0, 1)),
    link TEXT,
    bio TEXT,
    show_record INTEGER NOT NULL DEFAULT 0 CHECK (show_record IN (0, 1)),
    show_thanks INTEGER NOT NULL DEFAULT 0 CHECK (show_thanks IN (0, 1)),
    room_setup TEXT,
    consent_version INTEGER NOT NULL CHECK (consent_version > 0),
    consented_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  INSERT INTO new_accounts (id, handle, username, username_key, password, email_fp, avatar, avatar_banned,
      public_barred, profile_banned, agents, link, bio, show_record, show_thanks, room_setup,
      consent_version, consented_at, created_at)
    SELECT id, coalesce(handle, lower(hex(randomblob(6)))), username, username_key, password, email_fp, avatar,
      avatar_banned, public_barred, profile_banned, agents, link, bio, show_record, show_thanks, room_setup,
      1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), created_at FROM accounts;
  DELETE FROM sqlite_sequence WHERE name = 'new_accounts';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'new_accounts', seq FROM sqlite_sequence WHERE name = 'accounts';
  DROP TABLE accounts;
  ALTER TABLE new_accounts RENAME TO accounts;
  CREATE INDEX accounts_avatar ON accounts (avatar) WHERE avatar IS NOT NULL;

  DELETE FROM titles WHERE match_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM match_records WHERE match_records.match_id = titles.match_id AND match_records.account_id = titles.account_id
  );
  DELETE FROM titles WHERE game_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM game_records WHERE game_records.game_id = titles.game_id AND game_records.account_id = titles.account_id
  );
  CREATE TABLE new_titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    title TEXT NOT NULL,
    match_id TEXT,
    game_id TEXT,
    turn INTEGER CHECK (turn > 0),
    awarded_at TEXT NOT NULL,
    CHECK ((game_id IS NULL) = (turn IS NULL)),
    CHECK ((match_id IS NULL) <> (game_id IS NULL))
  ) STRICT;
  INSERT INTO new_titles (id, account_id, game, title, match_id, game_id, turn, awarded_at)
    SELECT id, account_id,
      CASE WHEN match_id IS NOT NULL
        THEN (SELECT game FROM match_records WHERE match_records.match_id = titles.match_id
              AND match_records.account_id = titles.account_id)
        ELSE (SELECT game FROM game_records WHERE game_records.game_id = titles.game_id
              AND game_records.account_id = titles.account_id)
      END,
      title, match_id, game_id, turn, awarded_at FROM titles;
  DELETE FROM sqlite_sequence WHERE name = 'new_titles';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'new_titles', seq FROM sqlite_sequence WHERE name = 'titles';
  DROP TABLE titles;
  ALTER TABLE new_titles RENAME TO titles;
  CREATE INDEX titles_account ON titles (account_id);
  CREATE UNIQUE INDEX titles_match ON titles (account_id, title, match_id) WHERE match_id IS NOT NULL;
  CREATE UNIQUE INDEX titles_game ON titles (account_id, title, game_id, turn) WHERE game_id IS NOT NULL;

  DELETE FROM agent_plays WHERE game_id NOT IN (SELECT game_id FROM replays);
  CREATE TABLE new_agent_plays (
    game_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    game TEXT NOT NULL,
    persona TEXT NOT NULL,
    takeover INTEGER NOT NULL CHECK (takeover IN (0, 1)),
    account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
    side TEXT,
    role TEXT,
    won INTEGER CHECK (won IN (0, 1)),
    feats TEXT CHECK (feats IS NULL OR json_type(feats) = 'object'),
    PRIMARY KEY (game_id, player_id)
  ) STRICT;
  INSERT INTO new_agent_plays (game_id, player_id, game, persona, takeover, account_id, side, role, won, feats)
    SELECT game_id, player_id,
      (SELECT game FROM replays WHERE replays.game_id = agent_plays.game_id),
      persona, takeover, account_id, side, role, won,
      CASE WHEN takeover = 1 THEN NULL ELSE json_object(
        'clues', clues, 'found', found, 'reviewer2', reviewer2,
        'best', CASE WHEN best_word IS NULL THEN NULL ELSE json_object('word', best_word, 'found', best_found) END
      ) END
    FROM agent_plays;
  DROP TABLE agent_plays;
  ALTER TABLE new_agent_plays RENAME TO agent_plays;
  CREATE INDEX agent_plays_persona ON agent_plays (persona);
  CREATE INDEX agent_plays_account ON agent_plays (account_id);
  `,
  // 24: every row of a game's data goes with the record of its game, every game is kept, what the
  // records can give is kept once, and the records are counted again from the record of the game
  // when the rules change (docs/architecture.md#game-records, docs/rules/constraints.md#data), as
  // the maintainers decided before the first public release. The tables are rebuilt as migration 22
  // rebuilt the records, every row kept with its id and the count that AUTOINCREMENT goes on from,
  // so that nothing in an old format comes back. First the rows are held against each other, and a
  // row that differs stops the migration, so that nothing is lost unnoticed:
  //
  // - a match's title, which the records of matches and the titles both kept, must be the same in
  //   both;
  // - the records of a game must agree with the record of the game, and with each other, on the
  //   game, who won, whether an AI played, its place in its match and when it ended, within a
  //   minute, since the records were written just before the record of the game;
  // - how the first game began (`setup`) must name the language of the record of the game, which
  //   it goes on naming alone;
  // - every kept game must have its log, which the records are counted again from;
  // - the games of a match must be ones whose players can be numbered (below): no guest and no
  //   account deleted since among them, and everyone on the record of the match among the players
  //   of its games, as the maintainers' own data has them. Other data would need a hand.
  //
  // Then what can't be brought over goes, with whatever depends on it, which the maintainers' own
  // data has none of: the records of games that have no record of the game, from before every game
  // was kept, whose start and players nothing says any more, with their titles; and the records of
  // matches left with no game of theirs on the record, with their titles. Then:
  //
  // - replays (the record of every game) gets a unique index on the game and its ID, which every
  //   row of a game's data points at (FOREIGN KEY ... ON DELETE CASCADE): game_records, game_players,
  //   which gets the game too, and agent_plays. It gets the place of a game in its match, which the
  //   records of the game kept one copy of each: the match's ID, the number of the game in it and
  //   how many games the match was to have, for a game that a match scored, which finished with no
  //   AI; `in_match` stays, for the games of a match room that weren't scored. Its log is never
  //   null: a game of a match gets everyone's number in the match into its log (GameLogData.match),
  //   by player ID, as the room writes it from now on, the numbers given here to every account that
  //   played in a game of the match, also one that left before the end and has no record of the
  //   game, since the match scored them all the same, in the order of the accounts' ids, which
  //   changes no place and no total; how the first game began
  //   loses the language and marks every card as a word of the lists (`custom`), since no game with
  //   the chair's own words was kept before this migration. The AI log of a game that no AI made a
  //   move in, as of one asked for someone who was back before it answered, goes: the room keeps
  //   none such any more (Room.record), and the check of the data takes none.
  // - game_records keeps what is the player's alone: the side, the role, whether they won, the
  //   verdict and the points. The winner, the time, whether an AI played and the place in the match
  //   are the record of the game's.
  // - match_records loses the title, which the titles keep, one for each account and match.
  // - titles point at the record of the game or of the match that each goes with, by the account
  //   and the game or the match, and lose the time of the award, which the record of the game or
  //   the match has.
  // - accounts' last room setup is kept by game (RoomSetup in shared/src/accounts.ts), with the
  //   game taken out of the room's part, which is the first game's, and the room's language
  //   required: a room setup without one, which nothing has, would go.
  `
  CREATE TEMP TABLE match_titles_differ (
    id INTEGER CONSTRAINT match_titles_differ_between_the_records_and_the_titles CHECK (id IS NULL)
  );
  INSERT INTO match_titles_differ
    SELECT m.id FROM match_records AS m WHERE m.title IS NOT (
      SELECT t.title FROM titles AS t WHERE t.match_id = m.match_id AND t.account_id = m.account_id
    )
    UNION SELECT t.id FROM titles AS t WHERE t.match_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM match_records AS m
      WHERE m.match_id = t.match_id AND m.account_id = t.account_id AND m.title = t.title
    );
  DROP TABLE match_titles_differ;

  CREATE TEMP TABLE records_differ (
    id INTEGER CONSTRAINT records_differ_from_the_record_of_the_game CHECK (id IS NULL)
  );
  INSERT INTO records_differ
    SELECT r.id FROM game_records AS r JOIN replays AS g ON g.game_id = r.game_id
    WHERE r.game <> g.game OR g.ending <> 'finished' OR r.winner IS NOT g.winner OR r.won <> (r.side = g.winner)
      OR r.agents <> (g.agents > 0 OR g.takeover = 1)
      OR (r.match_id IS NOT NULL) <> (g.in_match = 1)
      OR abs(julianday(r.ended_at) - julianday(g.ended_at)) > 1.0 / 1440
    UNION SELECT r.id FROM game_records AS r WHERE EXISTS (
      SELECT 1 FROM game_records AS o WHERE o.game_id = r.game_id AND (
        o.match_id IS NOT r.match_id OR o.match_game IS NOT r.match_game OR o.match_games IS NOT r.match_games
      )
    );
  DROP TABLE records_differ;

  CREATE TEMP TABLE setup_language_differs (
    id TEXT CONSTRAINT setup_language_differs_from_the_record_of_the_game CHECK (id IS NULL)
  );
  INSERT INTO setup_language_differs
    SELECT game_id FROM replays WHERE setup IS NOT NULL AND json_extract(setup, '$.language') IS NOT language;
  DROP TABLE setup_language_differs;

  CREATE TEMP TABLE games_without_log (id TEXT CONSTRAINT games_kept_without_their_log CHECK (id IS NULL));
  INSERT INTO games_without_log SELECT game_id FROM replays WHERE log IS NULL;
  DROP TABLE games_without_log;

  CREATE TEMP TABLE match_games_unnumbered (
    id TEXT CONSTRAINT match_games_whose_players_cannot_be_numbered CHECK (id IS NULL)
  );
  INSERT INTO match_games_unnumbered
    SELECT g.game_id FROM replays AS g
    WHERE EXISTS (SELECT 1 FROM game_records AS r WHERE r.game_id = g.game_id AND r.match_id IS NOT NULL)
      AND (g.guests > 0 OR json_array_length(g.log, '$.deleted') > 0)
    UNION SELECT m.match_id FROM match_records AS m
    WHERE EXISTS (
      SELECT 1 FROM game_records AS r WHERE r.match_id = m.match_id AND r.game_id IN (SELECT game_id FROM replays)
    ) AND NOT EXISTS (
      SELECT 1 FROM game_players AS p JOIN game_records AS r ON r.game_id = p.game_id
      WHERE r.match_id = m.match_id AND p.account_id = m.account_id
    );
  DROP TABLE match_games_unnumbered;

  DELETE FROM titles WHERE game_id IS NOT NULL AND game_id NOT IN (SELECT game_id FROM replays);
  DELETE FROM game_records WHERE game_id NOT IN (SELECT game_id FROM replays);
  DELETE FROM titles WHERE match_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM game_records AS r WHERE r.match_id = titles.match_id AND r.account_id = titles.account_id
  );
  DELETE FROM match_records WHERE NOT EXISTS (
    SELECT 1 FROM game_records AS r WHERE r.match_id = match_records.match_id AND r.account_id = match_records.account_id
  );

  CREATE TABLE new_replays (
    game_id TEXT PRIMARY KEY,
    game TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    log TEXT NOT NULL,
    agent_log TEXT,
    ending TEXT NOT NULL CHECK (ending IN ('finished', 'withdrawn', 'abandoned', 'interrupted')),
    winner TEXT,
    reason TEXT,
    started_at TEXT NOT NULL,
    setup TEXT,
    accounts INTEGER NOT NULL,
    guests INTEGER NOT NULL,
    agents INTEGER NOT NULL,
    takeover INTEGER NOT NULL CHECK (takeover IN (0, 1)),
    in_match INTEGER NOT NULL CHECK (in_match IN (0, 1)),
    practice INTEGER NOT NULL CHECK (practice IN (0, 1)),
    language TEXT NOT NULL,
    fields TEXT NOT NULL,
    version TEXT NOT NULL,
    rules INTEGER,
    words TEXT NOT NULL,
    match_id TEXT,
    match_game INTEGER,
    match_games INTEGER,
    CHECK (ending = 'finished' OR (winner IS NULL AND reason IS NULL)),
    CHECK ((match_id IS NULL) = (match_game IS NULL) AND (match_id IS NULL) = (match_games IS NULL)),
    CHECK (match_game BETWEEN 1 AND match_games),
    CHECK (match_id IS NULL OR (in_match = 1 AND ending = 'finished' AND agents = 0 AND takeover = 0))
  ) STRICT;
  INSERT INTO new_replays (game_id, game, ended_at, log, agent_log, ending, winner, reason, started_at, setup,
      accounts, guests, agents, takeover, in_match, practice, language, fields, version, rules, words,
      match_id, match_game, match_games)
    SELECT game_id, game, ended_at, log, CASE WHEN agents > 0 OR takeover = 1 THEN agent_log END, ending, winner, reason,
      started_at,
      CASE WHEN game = 'keywords' AND setup IS NOT NULL THEN json_set(json_remove(setup, '$.language'), '$.cards', (
        SELECT json_group_array(json_set(card.value, '$.custom', json('false')) ORDER BY card.key)
        FROM json_each(replays.setup, '$.cards') AS card
      )) ELSE setup END,
      accounts, guests, agents, takeover, in_match, practice, language, fields, version, rules, words,
      (SELECT match_id FROM game_records WHERE game_records.game_id = replays.game_id),
      (SELECT match_game FROM game_records WHERE game_records.game_id = replays.game_id),
      (SELECT match_games FROM game_records WHERE game_records.game_id = replays.game_id)
    FROM replays;
  DROP TABLE replays;
  ALTER TABLE new_replays RENAME TO replays;
  CREATE UNIQUE INDEX replays_game ON replays (game_id, game);

  CREATE TEMP TABLE match_numbers AS
    SELECT match_id, account_id, dense_rank() OVER (PARTITION BY match_id ORDER BY account_id) AS number
    FROM (SELECT DISTINCT g.match_id, p.account_id FROM replays AS g
      JOIN game_players AS p ON p.game_id = g.game_id WHERE g.match_id IS NOT NULL);
  UPDATE replays SET log = json_set(log, '$.match', json_object('numbers', (
    SELECT json_group_object(p.player_id, n.number) FROM game_players AS p
    JOIN match_numbers AS n ON n.match_id = replays.match_id AND n.account_id = p.account_id
    WHERE p.game_id = replays.game_id
  ))) WHERE match_id IS NOT NULL;
  DROP TABLE match_numbers;

  CREATE TABLE new_game_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    game_id TEXT NOT NULL,
    side TEXT NOT NULL,
    role TEXT NOT NULL,
    won INTEGER NOT NULL CHECK (won IN (0, 1)),
    verdict TEXT NOT NULL,
    points INTEGER NOT NULL,
    UNIQUE (account_id, game_id),
    FOREIGN KEY (game_id, game) REFERENCES replays (game_id, game) ON DELETE CASCADE
  ) STRICT;
  INSERT INTO new_game_records (id, account_id, game, game_id, side, role, won, verdict, points)
    SELECT id, account_id, game, game_id, side, role, won, verdict, points FROM game_records;
  DELETE FROM sqlite_sequence WHERE name = 'new_game_records';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'new_game_records', seq FROM sqlite_sequence WHERE name = 'game_records';
  DROP TABLE game_records;
  ALTER TABLE new_game_records RENAME TO game_records;
  CREATE INDEX game_records_recent ON game_records (account_id, id DESC);
  CREATE INDEX game_records_game ON game_records (game_id);

  CREATE TABLE new_match_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    match_id TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    games INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    players INTEGER NOT NULL,
    score INTEGER NOT NULL,
    UNIQUE (account_id, match_id)
  ) STRICT;
  INSERT INTO new_match_records (id, account_id, game, match_id, ended_at, games, rank, players, score)
    SELECT id, account_id, game, match_id, ended_at, games, rank, players, score FROM match_records;
  DELETE FROM sqlite_sequence WHERE name = 'new_match_records';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'new_match_records', seq FROM sqlite_sequence WHERE name = 'match_records';
  DROP TABLE match_records;
  ALTER TABLE new_match_records RENAME TO match_records;
  CREATE INDEX match_records_recent ON match_records (account_id, id DESC);

  CREATE TABLE new_titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    title TEXT NOT NULL,
    match_id TEXT,
    game_id TEXT,
    turn INTEGER CHECK (turn > 0),
    CHECK ((game_id IS NULL) = (turn IS NULL)),
    CHECK ((match_id IS NULL) <> (game_id IS NULL)),
    FOREIGN KEY (account_id, game_id) REFERENCES game_records (account_id, game_id) ON DELETE CASCADE,
    FOREIGN KEY (account_id, match_id) REFERENCES match_records (account_id, match_id) ON DELETE CASCADE
  ) STRICT;
  INSERT INTO new_titles (id, account_id, game, title, match_id, game_id, turn)
    SELECT id, account_id, game, title, match_id, game_id, turn FROM titles;
  DELETE FROM sqlite_sequence WHERE name = 'new_titles';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'new_titles', seq FROM sqlite_sequence WHERE name = 'titles';
  DROP TABLE titles;
  ALTER TABLE new_titles RENAME TO titles;
  CREATE INDEX titles_account ON titles (account_id);
  CREATE UNIQUE INDEX titles_match ON titles (account_id, match_id) WHERE match_id IS NOT NULL;
  CREATE UNIQUE INDEX titles_game ON titles (account_id, title, game_id, turn) WHERE game_id IS NOT NULL;

  CREATE TABLE new_game_players (
    game_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    game TEXT NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    PRIMARY KEY (game_id, player_id),
    FOREIGN KEY (game_id, game) REFERENCES replays (game_id, game) ON DELETE CASCADE
  ) STRICT;
  INSERT INTO new_game_players (game_id, player_id, game, account_id)
    SELECT p.game_id, p.player_id, g.game, p.account_id FROM game_players AS p JOIN replays AS g ON g.game_id = p.game_id;
  DROP TABLE game_players;
  ALTER TABLE new_game_players RENAME TO game_players;
  CREATE INDEX game_players_account ON game_players (account_id);

  CREATE TABLE new_agent_plays (
    game_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    game TEXT NOT NULL,
    persona TEXT NOT NULL,
    takeover INTEGER NOT NULL CHECK (takeover IN (0, 1)),
    account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
    side TEXT,
    role TEXT,
    won INTEGER CHECK (won IN (0, 1)),
    feats TEXT CHECK (feats IS NULL OR json_type(feats) = 'object'),
    PRIMARY KEY (game_id, player_id),
    FOREIGN KEY (game_id, game) REFERENCES replays (game_id, game) ON DELETE CASCADE
  ) STRICT;
  INSERT INTO new_agent_plays (game_id, player_id, game, persona, takeover, account_id, side, role, won, feats)
    SELECT game_id, player_id, game, persona, takeover, account_id, side, role, won, feats FROM agent_plays;
  DROP TABLE agent_plays;
  ALTER TABLE new_agent_plays RENAME TO agent_plays;
  CREATE INDEX agent_plays_persona ON agent_plays (persona);
  CREATE INDEX agent_plays_account ON agent_plays (account_id);

  UPDATE accounts SET room_setup = json_object(
    coalesce(json_extract(room_setup, '$.room.game'), 'keywords'),
    json_patch(
      CASE WHEN json_type(room_setup, '$.room.language') = 'text'
        THEN json_object('room', json_remove(json_extract(room_setup, '$.room'), '$.game'))
        ELSE json_object() END,
      CASE WHEN json_type(room_setup, '$.practice') = 'object'
        THEN json_object('practice', json_extract(room_setup, '$.practice'))
        ELSE json_object() END
    )
  ) WHERE room_setup IS NOT NULL;
  UPDATE accounts SET room_setup = NULL
    WHERE room_setup IS NOT NULL AND (SELECT count(*) FROM json_tree(room_setup) WHERE type <> 'object') = 0;
  `,
  // 25: the contributions from GitHub (docs/architecture.md#feedback-contributions): the issues
  // that developers opened on GitHub and the operator adopted, listed on the home page beside the
  // adopted feedback, which stays in the feedback table as it is. One row for each: the issue, or
  // for a security problem reported privately the advisory that was published once it was fixed,
  // one of the two and never both; the kind, checked by the code alone as the feedback's is, so
  // that a new kind needs no migration; the author's GitHub username and account id as they were
  // when it was adopted, both or, once the author has asked to be forgotten, neither; whether the
  // home page names the author, which it can't without the username; when it was adopted; and
  // what they contributed, in Chinese and in English, written as it is adopted. Nothing else of
  // the issue is kept: the issue itself is its record. The rows are an archive, as the feedback is
  // (archive.test.ts): no row is deleted, and only the two sentences, the naming and the username
  // are ever changed. The rows need no id or index of their own: each is named by its issue or
  // its advisory, and the home page reads them all at once. No other table changes.
  `
  CREATE TABLE github_contributions (
    issue INTEGER UNIQUE CHECK (issue > 0),
    advisory TEXT UNIQUE CHECK (advisory GLOB 'GHSA-????-????-????'),
    kind TEXT NOT NULL,
    login TEXT,
    github_id INTEGER CHECK (github_id > 0),
    named INTEGER NOT NULL CHECK (named IN (0, 1)),
    adopted_at TEXT NOT NULL,
    summary_zh TEXT NOT NULL,
    summary_en TEXT NOT NULL,
    CHECK ((issue IS NULL) <> (advisory IS NULL)),
    CHECK ((login IS NULL) = (github_id IS NULL)),
    CHECK (login IS NOT NULL OR named = 0)
  ) STRICT;
  `,
  // 26: how a game came out for each player is more than whether they won
  // (docs/architecture.md#game-records), so that a game where each plays for themselves, one that can
  // be drawn and one that everyone plays together are kept as the first game is, as the maintainers
  // decided before the second game. The tables are rebuilt as migration 24 rebuilt them, every row
  // kept with its id and the count that AUTOINCREMENT goes on from:
  //
  // - game_records keeps how the game came out for the player, won, drawn or lost, in place of
  //   whether they won; their place, 1 and one more for each player who did better; and what the
  //   game counts of their game, as JSON in the game's own shape (GameShapes.detail), such as where
  //   their points came from. The first game, the only one there is, has two sides, one of which
  //   wins: a record that was won is won in the first place, one that wasn't is lost in the second.
  //   The detail is left for the count of every game below.
  // - agent_plays keeps the same of each AI player in a seat and each person an AI played for, both
  //   or neither: a person who had no part in the game at its end has neither.
  // - accounts' last room setup keeps the rules of a match as a match of any game has them
  //   (MatchRules in shared/src/match.ts): the number of games, and the game's own options, which
  //   are how the first game's groups are made.
  // - The settings forget the rules that every game's records were counted under, so that the
  //   server counts every kept game again as it starts (recount.ts), right after this migration:
  //   how each game came out for each player, their place, their points, the verdict, the detail
  //   and the titles, and what each AI player did, are the count's, and only who played where is
  //   held against the log. Nothing that the records showed changes but the detail they gain.
  `
  CREATE TABLE new_game_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    game_id TEXT NOT NULL,
    side TEXT NOT NULL,
    role TEXT NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('won', 'drawn', 'lost')),
    place INTEGER NOT NULL CHECK (place >= 1),
    verdict TEXT NOT NULL,
    detail TEXT CHECK (detail IS NULL OR json_type(detail) = 'object'),
    points INTEGER NOT NULL,
    UNIQUE (account_id, game_id),
    FOREIGN KEY (game_id, game) REFERENCES replays (game_id, game) ON DELETE CASCADE
  ) STRICT;
  INSERT INTO new_game_records (id, account_id, game, game_id, side, role, result, place, verdict, detail, points)
    SELECT id, account_id, game, game_id, side, role,
      CASE won WHEN 1 THEN 'won' ELSE 'lost' END, CASE won WHEN 1 THEN 1 ELSE 2 END, verdict, NULL, points
    FROM game_records;
  DELETE FROM sqlite_sequence WHERE name = 'new_game_records';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'new_game_records', seq FROM sqlite_sequence WHERE name = 'game_records';
  DROP TABLE game_records;
  ALTER TABLE new_game_records RENAME TO game_records;
  CREATE INDEX game_records_recent ON game_records (account_id, id DESC);
  CREATE INDEX game_records_game ON game_records (game_id);

  CREATE TABLE new_agent_plays (
    game_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    game TEXT NOT NULL,
    persona TEXT NOT NULL,
    takeover INTEGER NOT NULL CHECK (takeover IN (0, 1)),
    account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
    side TEXT,
    role TEXT,
    result TEXT CHECK (result IN ('won', 'drawn', 'lost')),
    place INTEGER CHECK (place >= 1),
    feats TEXT CHECK (feats IS NULL OR json_type(feats) = 'object'),
    CHECK ((result IS NULL) = (place IS NULL)),
    PRIMARY KEY (game_id, player_id),
    FOREIGN KEY (game_id, game) REFERENCES replays (game_id, game) ON DELETE CASCADE
  ) STRICT;
  INSERT INTO new_agent_plays (game_id, player_id, game, persona, takeover, account_id, side, role, result, place,
      feats)
    SELECT game_id, player_id, game, persona, takeover, account_id, side, role,
      CASE won WHEN 1 THEN 'won' WHEN 0 THEN 'lost' END, CASE won WHEN 1 THEN 1 WHEN 0 THEN 2 END, feats
    FROM agent_plays;
  DROP TABLE agent_plays;
  ALTER TABLE new_agent_plays RENAME TO agent_plays;
  CREATE INDEX agent_plays_persona ON agent_plays (persona);
  CREATE INDEX agent_plays_account ON agent_plays (account_id);

  UPDATE accounts SET room_setup = json_set(room_setup, '$.keywords.room.match', json_object(
    'games', json_extract(room_setup, '$.keywords.room.match.games'),
    'options', json_object(
      'teams', json_extract(room_setup, '$.keywords.room.match.teams'),
      'grouping', json_extract(room_setup, '$.keywords.room.match.grouping')
    )
  )) WHERE json_type(room_setup, '$.keywords.room.match') = 'object';

  DELETE FROM settings WHERE key GLOB 'rules_counted:*';
  `,
  // 27: the second game (docs/games/impostor.md), and what players say of the games they played,
  // for both games (docs/architecture.md#ratings), as the maintainers decided before its beta:
  //
  // - ratings keeps how a player rated a game that finished, by the player ID they had in it: one
  //   of the game's options, which the code checks, as the feedback's kinds, so that a new one needs
  //   no migration, or NULL for a player who dismissed the question; with when. One row for each
  //   player of a game, which goes with the record of the game.
  // - ai_guesses keeps a player's guess of who the AI players of a game were, as the numbers they
  //   picked, a JSON list in the game's shape (GameShapes.guess), or NULL for a player who skipped
  //   it; with when. One row for each player of a game, which goes with the record of the game.
  // - content_contributions keeps what players gave the word library and the operator adopted
  //   (docs/architecture.md#content-contributions): a setter's pair or the chair's own words of a
  //   game, of a kind that the code checks, as JSON in the game's own shape; the game they came
  //   from, which the row outlives, as the feedback outlives its account; the account that gave
  //   them, which the row outlives as well, and whether it is named, which it can't be without the
  //   account; when it was adopted; and what was adopted, in Chinese and in English. It is an
  //   archive (archive.test.ts), as the contributions from GitHub are: no row is deleted.
  // - feedback is rebuilt, as migration 5 rebuilt it, every row kept with its id and the count that
  //   AUTOINCREMENT goes on from, so that it can name the game it was sent about, by the record of
  //   the game, both or neither, which forgets the game rather than the feedback if the record goes.
  //   No feedback that is there was about a game.
  // - The setup of every game of the first game with words of the chair's own names who gave them
  //   (`customAuthor`, KeywordsSetup), by the player ID they had in the room. The games kept before
  //   this migration don't say, and name nobody (null).
  // - replays keeps whether the game brought nobody points, a streak, a title or a friend title
  //   (`scores_nothing`), for whatever reason: an AI that played in it, as an AI player or for
  //   someone who was offline, without every answer from a certified version of the AI, or a reason
  //   of the game's own (GameModule.scoresNothing), as a removal in the second game; the streaks
  //   and the friend duos leave it out by this alone. No version of the AI is certified yet, and
  //   the first game has no reason of its own, so of the games that are there, those that an AI
  //   played in brought nothing, and the others did.
  //
  // Who set the words of a game of the second game has a row in game_players beside its players,
  // with which they watch it again; the code writes it, and no row that is there changes.
  `
  CREATE TABLE ratings (
    game_id TEXT NOT NULL,
    game TEXT NOT NULL,
    player_id TEXT NOT NULL,
    rating TEXT,
    rated_at TEXT NOT NULL,
    PRIMARY KEY (game_id, player_id),
    FOREIGN KEY (game_id, game) REFERENCES replays (game_id, game) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE ai_guesses (
    game_id TEXT NOT NULL,
    game TEXT NOT NULL,
    player_id TEXT NOT NULL,
    guess TEXT CHECK (guess IS NULL OR json_type(guess) = 'array'),
    guessed_at TEXT NOT NULL,
    PRIMARY KEY (game_id, player_id),
    FOREIGN KEY (game_id, game) REFERENCES replays (game_id, game) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE content_contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    game TEXT NOT NULL,
    game_id TEXT REFERENCES replays (game_id) ON DELETE SET NULL,
    content TEXT NOT NULL CHECK (json_type(content) = 'object'),
    account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
    named INTEGER NOT NULL CHECK (named IN (0, 1)),
    adopted_at TEXT NOT NULL,
    summary_zh TEXT NOT NULL,
    summary_en TEXT NOT NULL,
    CHECK (account_id IS NOT NULL OR named = 0)
  ) STRICT;
  CREATE INDEX content_contributions_account ON content_contributions (account_id) WHERE account_id IS NOT NULL;

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
    issue INTEGER CHECK (issue > 0),
    resolved_pr INTEGER CHECK (resolved_pr > 0),
    resolved_at TEXT,
    closed_at TEXT,
    deleted_at TEXT,
    adopted_at TEXT,
    summary_zh TEXT,
    summary_en TEXT,
    link_profile INTEGER NOT NULL DEFAULT 0 CHECK (link_profile IN (0, 1)),
    game TEXT,
    game_id TEXT,
    CHECK ((game IS NULL) = (game_id IS NULL)),
    FOREIGN KEY (game_id, game) REFERENCES replays (game_id, game) ON DELETE SET NULL
  ) STRICT;
  INSERT INTO new_feedback (id, created_at, kind, text, contact, version, language, page, user_agent, credit,
      account_id, issue, resolved_pr, resolved_at, closed_at, deleted_at, adopted_at, summary_zh, summary_en,
      link_profile)
    SELECT id, created_at, kind, text, contact, version, language, page, user_agent, credit, account_id, issue,
      resolved_pr, resolved_at, closed_at, deleted_at, adopted_at, summary_zh, summary_en, link_profile
    FROM feedback;
  DELETE FROM sqlite_sequence WHERE name = 'new_feedback';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'new_feedback', seq FROM sqlite_sequence WHERE name = 'feedback';
  DROP TABLE feedback;
  ALTER TABLE new_feedback RENAME TO feedback;
  CREATE INDEX feedback_contact_expiry ON feedback (created_at) WHERE contact IS NOT NULL;
  CREATE INDEX feedback_account ON feedback (account_id) WHERE account_id IS NOT NULL;
  CREATE INDEX feedback_trash ON feedback (deleted_at) WHERE deleted_at IS NOT NULL;
  CREATE INDEX feedback_adopted ON feedback (adopted_at) WHERE adopted_at IS NOT NULL;
  CREATE INDEX feedback_game ON feedback (game_id) WHERE game_id IS NOT NULL;

  UPDATE replays SET setup = json_set(setup, '$.customAuthor', json('null'))
    WHERE game = 'keywords' AND setup IS NOT NULL AND EXISTS (
      SELECT 1 FROM json_each(replays.setup, '$.cards') AS card WHERE json_extract(card.value, '$.custom') = 1
    );

  ALTER TABLE replays ADD COLUMN scores_nothing INTEGER NOT NULL DEFAULT 0 CHECK (scores_nothing IN (0, 1));
  UPDATE replays SET scores_nothing = 1 WHERE agents > 0 OR takeover = 1;
  `,
  // 28: the AI's log of a game, at version 2 (agentLog.ts), says in every note how long the model was
  // let think (AgentNote in shared/src/agent.ts), and keeps what it thought, and the rehearsals of a
  // clue of the first game as a list. No model was let think before, so every note that is there
  // says it wasn't; none has what a model thought, and none a rehearsal, which no AI player made.
  `
  UPDATE replays SET agent_log = json_set(agent_log, '$.v', 2, '$.steps', json((
    SELECT json_group_array(
      CASE WHEN json_type(step.value, '$.note') = 'object'
        THEN json_set(step.value, '$.note.reasoning', 'off')
        ELSE json(step.value) END
      ORDER BY step.key)
    FROM json_each(replays.agent_log, '$.steps') AS step
  ))) WHERE agent_log IS NOT NULL;
  `,
];
