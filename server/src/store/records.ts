import {
  RECENT_RECORDS,
  type BestStreaks,
  type DuoCounts,
  type GameRecord,
  type MatchRecord,
  type RecordsView,
  type Streak,
  type StreakKind,
  type Title,
  type TitleCount,
} from '@reviewer2/shared';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

// What accounts keep of the games: a row for each game that a player with an account finished in
// a seat (migration 2), a row for each match that they finished ranked, and the titles that
// matches award (migration 3, docs/architecture.md#matches), the games themselves to watch again
// (migration 7, docs/architecture.md#replays), the streaks of wins and of losses that the games
// make (migration 10, docs/architecture.md#streaks), and the log of each game kept and which of
// its players had which account (migration 12, docs/architecture.md#game-records), with the AI's
// own log of it (migration 14, docs/architecture.md#ai-players). What friends have played together
// is worked out from the records (migration 13, docs/architecture.md#friend-duos).

// One player's part in one game, as the game module described it (GameModule.results()), with the
// points it brought them (migration 8), scored as a match scores a game. A game that an AI played
// in (docs/architecture.md#ai-players) brings no points: it is on the record, marked by `agents`
// (migration 14), which keeps it out of the streaks and out of what friends have played together.
export interface NewRecord {
  game: string;
  gameId: string;
  side: string;
  role: string;
  winner: string;
  won: boolean;
  verdict: string;
  points: number;
  agents?: boolean;
}

// What the account has played with each of its friends (shared/src/duos.ts): its records, by
// their own index, each with the friends' records of the same game. Those are found by the index
// on the game (migration 13), which the statement names: left to itself, SQLite looks each friend
// up in every one of the account's games instead, by the unique index on the account and the
// game, which takes ten times as long with a hundred friends. Teammates were on the same side,
// opponents on another. A game that an AI played in counts for no friend (migration 14), so that no
// two friends make titles together against AI players. Exported for the test that reads the query
// plan.
export const DUOS_SQL =
  'SELECT theirs.account_id AS friend, ' +
  'count(*) FILTER (WHERE theirs.side = mine.side AND mine.won = 1) AS wonTogether, ' +
  'count(*) FILTER (WHERE theirs.side = mine.side AND mine.won = 0) AS lostTogether, ' +
  'count(*) FILTER (WHERE theirs.side <> mine.side) AS against, ' +
  'count(*) FILTER (WHERE theirs.side <> mine.side AND mine.won = 1) AS beat, ' +
  'count(*) FILTER (WHERE theirs.side <> mine.side AND theirs.won = 1) AS beaten ' +
  'FROM game_records AS mine JOIN game_records AS theirs INDEXED BY game_records_game ' +
  'ON theirs.game_id = mine.game_id AND theirs.account_id <> mine.account_id ' +
  'WHERE mine.account_id = ? AND mine.agents = 0 AND theirs.account_id IN (' +
  'SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END FROM friendships ' +
  "WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)) " +
  'GROUP BY theirs.account_id';

// One player's part in one match that ran its course.
export interface NewMatchRecord {
  game: string;
  matchId: string;
  games: number;
  rank: number;
  players: number;
  score: number;
  title: Title | null;
}

export class RecordStore {
  readonly #insert: StatementSync;
  readonly #totals: StatementSync;
  readonly #points: StatementSync;
  readonly #recent: StatementSync;
  readonly #insertMatch: StatementSync;
  readonly #matchCount: StatementSync;
  readonly #recentMatches: StatementSync;
  readonly #streak: StatementSync;
  readonly #putStreak: StatementSync;
  readonly #duos: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    // A game is recorded once for each account, however often the end of the game is reported.
    this.#insert = db.prepare(
      'INSERT OR IGNORE INTO game_records ' +
        '(account_id, game, game_id, ended_at, side, role, winner, won, verdict, points, agents) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.#totals = db.prepare(
      'SELECT count(*) AS games, coalesce(sum(won), 0) AS wins FROM game_records WHERE account_id = ?',
    );
    this.#points = db.prepare('SELECT coalesce(sum(points), 0) AS points FROM game_records WHERE account_id = ?');
    // With each game, whether there is a replay of it to watch.
    this.#recent = db.prepare(
      'SELECT game, game_id AS gameId, ended_at AS endedAt, side, role, winner, won, verdict, ' +
        'EXISTS (SELECT 1 FROM replays WHERE replays.game_id = game_records.game_id) AS replay ' +
        'FROM game_records WHERE account_id = ? ORDER BY id DESC LIMIT ?',
    );
    // A match is recorded once for each account, as a game is.
    this.#insertMatch = db.prepare(
      'INSERT INTO match_records (account_id, game, match_id, ended_at, games, rank, players, score, title) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
    );
    this.#matchCount = db.prepare('SELECT count(*) AS played FROM match_records WHERE account_id = ?');
    this.#recentMatches = db.prepare(
      'SELECT game, ended_at AS endedAt, games, rank, players, score, title FROM match_records ' +
        'WHERE account_id = ? ORDER BY id DESC LIMIT ?',
    );
    // The account's streaks, one row kept up with every game, so that neither the account page nor
    // the end of a game reads the whole record (migration 10).
    this.#streak = db.prepare(
      'SELECT best_wins AS wins, best_losses AS losses, run, run_won AS runWon FROM streaks WHERE account_id = ?',
    );
    this.#putStreak = db.prepare(
      'INSERT INTO streaks (account_id, best_wins, best_losses, run, run_won) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT (account_id) DO UPDATE SET best_wins = excluded.best_wins, ' +
        'best_losses = excluded.best_losses, run = excluded.run, run_won = excluded.run_won',
    );
    this.#duos = db.prepare(DUOS_SQL);
  }

  // Keeps the record, and the streak that the game brings the account to, or null when the game
  // was on the record already or an AI played in it. The caller runs it in a transaction
  // (Accounts.record), so that the streaks can't fall behind the records.
  add(accountId: number, record: NewRecord): Streak | null {
    const { game, gameId, side, role, winner, won, verdict, points } = record;
    const endedAt = new Date(this.now()).toISOString();
    const { changes } = this.#insert.run(
      accountId,
      game,
      gameId,
      endedAt,
      side,
      role,
      winner,
      won ? 1 : 0,
      verdict,
      points,
      record.agents ? 1 : 0,
    );
    return Number(changes) > 0 && !record.agents ? this.#extend(accountId, won) : null;
  }

  // The streak that one more game, won or lost, brings the account to: one game longer when it went
  // the way of the game before, else a new one of one game. It is a record when it is longer than
  // every streak of its kind before it, so the first streak of each kind is one.
  #extend(accountId: number, won: boolean): Streak {
    type Row = { wins: number; losses: number; run: number; runWon: number };
    const before = (this.#streak.get(accountId) as Row | undefined) ?? { wins: 0, losses: 0, run: 0, runWon: 1 };
    const kind: StreakKind = won ? 'wins' : 'losses';
    const length = (before.runWon === 1) === won ? before.run + 1 : 1;
    const best = { ...before, [kind]: Math.max(before[kind], length) };
    this.#putStreak.run(accountId, best.wins, best.losses, length, won ? 1 : 0);
    return { kind, length, record: length > before[kind] };
  }

  // The longest streaks of wins and of losses on the account's record (shared/src/streaks.ts).
  streaks(accountId: number): BestStreaks {
    const row = this.#streak.get(accountId) as { wins: number; losses: number } | undefined;
    return { wins: row?.wins ?? 0, losses: row?.losses ?? 0 };
  }

  // What the account has played with each friend who shares a game with it, by the friend's
  // account ID, from every game on both their records but those that an AI played in
  // (docs/architecture.md#friend-duos).
  duos(accountId: number): Map<number, DuoCounts> {
    type Row = DuoCounts & { friend: number };
    const rows = this.#duos.all(accountId, accountId, accountId, accountId) as unknown as Row[];
    return new Map(rows.map(({ friend, ...counts }) => [friend, counts]));
  }

  // The points of every game on the account's record, from which its rank is told (ranks.ts).
  points(accountId: number): number {
    return (this.#points.get(accountId) as { points: number }).points;
  }

  // Keeps the match, and says whether it was new.
  addMatch(accountId: number, record: NewMatchRecord): boolean {
    const { game, matchId, games, rank, players, score, title } = record;
    const endedAt = new Date(this.now()).toISOString();
    return (
      Number(this.#insertMatch.run(accountId, game, matchId, endedAt, games, rank, players, score, title).changes) > 0
    );
  }

  // How many games the account has played and won, and how many matches: the counts alone, as a
  // public profile shows them (docs/architecture.md#public-profiles).
  counts(accountId: number): { games: number; wins: number; matches: number } {
    const { games, wins } = this.#totals.get(accountId) as { games: number; wins: number };
    const { played } = this.#matchCount.get(accountId) as { played: number };
    return { games, wins, matches: played };
  }

  // How many games the account has played and won, and the latest of them, and the same of its
  // matches.
  view(accountId: number, limit = RECENT_RECORDS): RecordsView {
    const { games, wins, matches } = this.counts(accountId);
    type Row = Omit<GameRecord, 'won' | 'replay'> & { won: number; replay: number };
    const recent = (this.#recent.all(accountId, limit) as Row[]).map((row) => ({
      ...row,
      won: row.won === 1,
      replay: row.replay === 1,
    }));
    return {
      games,
      wins,
      recent,
      matches: { played: matches, recent: this.#recentMatches.all(accountId, limit) as unknown as MatchRecord[] },
    };
  }
}

export class TitleStore {
  readonly #insert: StatementSync;
  readonly #counts: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    // A match awards an account a title once (the titles_match index). Unlike OR IGNORE, ON CONFLICT
    // passes over that alone, and still refuses a title that isn't one.
    this.#insert = db.prepare(
      'INSERT INTO titles (account_id, title, match_id, awarded_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
    );
    this.#counts = db.prepare(
      'SELECT title, count(*) AS count FROM titles WHERE account_id = ? GROUP BY title ORDER BY title',
    );
  }

  // Awards a title from a match, and says whether it was new. The same title can be awarded many
  // times, but a match awards it to an account once.
  award(accountId: number, title: Title, matchId: string | null = null): boolean {
    return Number(this.#insert.run(accountId, title, matchId, new Date(this.now()).toISOString()).changes) > 0;
  }

  // How often the account has been awarded each of its titles.
  counts(accountId: number): TitleCount[] {
    return (this.#counts.all(accountId) as { title: Title; count: number }[]).map(({ title, count }) => ({
      title,
      count,
    }));
  }
}

// A finished game to keep, once for each game, however often the end of the game is reported: the
// replay, as the game module gave it (GameModule.replay()), kept as JSON; the log of everything
// that happened in it, or null when it grew too long to keep; the AI's own log of it, or null when
// no AI played in it (agentLog.ts); and which player, by the ID they had in the room, was which
// account.
export interface NewReplay {
  game: string;
  gameId: string;
  replay: unknown;
  log?: unknown;
  agentLog?: unknown;
  players?: readonly { playerId: string; accountId: number }[];
}

export class ReplayStore {
  readonly #insert: StatementSync;
  readonly #player: StatementSync;
  readonly #read: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.#insert = db.prepare(
      'INSERT OR IGNORE INTO replays (game_id, game, ended_at, data, log, agent_log) VALUES (?, ?, ?, ?, ?, ?)',
    );
    // An account that is gone by now, deleted while the game was on, is left out.
    this.#player = db.prepare(
      'INSERT OR IGNORE INTO game_players (game_id, player_id, account_id) SELECT ?, ?, id FROM accounts WHERE id = ?',
    );
    // Only an account that has the game on its record may read it.
    this.#read = db.prepare(
      'SELECT data FROM replays WHERE game_id = ? AND ' +
        'EXISTS (SELECT 1 FROM game_records WHERE account_id = ? AND game_id = replays.game_id)',
    );
  }

  // Keeps the replay, as `data`, which the caller has made into JSON of a size it allows, with its
  // logs as JSON, if any, and which player was which account, and says whether it was new. A game
  // that is kept already keeps what it had. The caller runs this in one transaction.
  add({ game, gameId, log = null, agentLog = null, players = [] }: NewReplay, data: string): boolean {
    const endedAt = new Date(this.now()).toISOString();
    const logged = log === null ? null : JSON.stringify(log);
    const agentLogged = agentLog === null ? null : JSON.stringify(agentLog);
    const added = Number(this.#insert.run(gameId, game, endedAt, data, logged, agentLogged).changes) > 0;
    if (added) for (const { playerId, accountId } of players) this.#player.run(gameId, playerId, accountId);
    return added;
  }

  // The replay of a game, for an account that played in it, or null.
  read(accountId: number, gameId: string): unknown {
    const row = this.#read.get(gameId, accountId) as { data: string } | undefined;
    return row === undefined ? null : (JSON.parse(row.data) as unknown);
  }
}
