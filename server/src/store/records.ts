import {
  RECENT_RECORDS,
  type GameRecord,
  type MatchRecord,
  type RecordsView,
  type Title,
  type TitleCount,
} from '@reviewer2/shared';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

// What accounts keep of the games: a row for each game that a player with an account finished in
// a seat (migration 2), a row for each match that they finished ranked, and the titles that
// matches award (migration 3, docs/architecture.md#matches).

// One player's part in one game, as the game module described it (GameModule.results()).
export interface NewRecord {
  game: string;
  gameId: string;
  side: string;
  role: string;
  winner: string;
  won: boolean;
  verdict: string;
}

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
  readonly #recent: StatementSync;
  readonly #insertMatch: StatementSync;
  readonly #matchCount: StatementSync;
  readonly #recentMatches: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    // A game is recorded once for each account, however often the end of the game is reported.
    this.#insert = db.prepare(
      'INSERT OR IGNORE INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.#totals = db.prepare(
      'SELECT count(*) AS games, coalesce(sum(won), 0) AS wins FROM game_records WHERE account_id = ?',
    );
    this.#recent = db.prepare(
      'SELECT game, ended_at AS endedAt, side, role, winner, won, verdict FROM game_records ' +
        'WHERE account_id = ? ORDER BY id DESC LIMIT ?',
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
  }

  // Keeps the record, and says whether it was new.
  add(accountId: number, record: NewRecord): boolean {
    const { game, gameId, side, role, winner, won, verdict } = record;
    const endedAt = new Date(this.now()).toISOString();
    return (
      Number(this.#insert.run(accountId, game, gameId, endedAt, side, role, winner, won ? 1 : 0, verdict).changes) > 0
    );
  }

  // Keeps the match, and says whether it was new.
  addMatch(accountId: number, record: NewMatchRecord): boolean {
    const { game, matchId, games, rank, players, score, title } = record;
    const endedAt = new Date(this.now()).toISOString();
    return (
      Number(this.#insertMatch.run(accountId, game, matchId, endedAt, games, rank, players, score, title).changes) > 0
    );
  }

  // How many games the account has played and won, and the latest of them, and the same of its
  // matches.
  view(accountId: number, limit = RECENT_RECORDS): RecordsView {
    const { games, wins } = this.#totals.get(accountId) as { games: number; wins: number };
    const recent = (this.#recent.all(accountId, limit) as (Omit<GameRecord, 'won'> & { won: number })[]).map((row) => ({
      ...row,
      won: row.won === 1,
    }));
    const { played } = this.#matchCount.get(accountId) as { played: number };
    return {
      games,
      wins,
      recent,
      matches: { played, recent: this.#recentMatches.all(accountId, limit) as unknown as MatchRecord[] },
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
