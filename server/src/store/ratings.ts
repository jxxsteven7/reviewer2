import { RATINGS, RECENT_RECORDS, type Rating } from '@reviewer2/shared';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { PairRecord } from '../core/words';

// What players said of the games they played (docs/architecture.md#ratings, migration 27): how
// they rated a game that finished, and whom they guessed the AI players of a game were. Each is a
// row of the game, by the player ID they had in it, which goes with the record of the game.
//
// What is worked out of them, and of the records of the games, is never kept: how often the
// players in a room have had a pair of related terms, and how players rated it, for the next draw
// of a pair (drawPair in core/words.ts); how many games an account set the words of, and how
// many of those players rated good, for its page, with the latest of them, their ratings and
// whether words of them were adopted, for its own page alone; and how often an account guessed
// the AI players of a game right, for its page; and, for the operator alone (admin.cjs ratings), how
// players rated each pair of a game of pairs, or each of the latest games of another. A game says
// where its setup keeps the key of its pair and its setter (GameModule.setupPaths), and whether a
// guess was right (GameModule.guessedRight).

export interface SetterCounts {
  games: number;
  good: number;
}

// One of the latest games that finished whose words an account set: its ID, when it ended, how it
// began, as the record of the game keeps it, how many players rated it good, of how many rated it
// at all, and whether the operator adopted words of it (content_contributions).
export interface SetterGame {
  gameId: string;
  endedAt: string;
  setup: unknown;
  good: number;
  rated: number;
  adopted: boolean;
}

// What an account has guessed of the AI players of a game, in the games it made a guess in: how
// each began, as the record of the game keeps it, and the guess, in the game's shape.
export interface AgentGuess {
  setup: unknown;
  guess: unknown;
}

// How many people rated something each way, and how many dismissed the question (`skipped`),
// counted as the draw of a pair counts them (pairRecords): an account once, however many games of it
// it rated so, and a guest once for each game.
export type RatingCounts = Record<Rating | 'skipped', number>;

// A pair of a game of pairs that the word library gave, by its key: how many kept games drew it,
// however they ended, and how players rated them.
export interface PairRatings extends RatingCounts {
  pair: string;
  games: number;
}

// A game that players rated: its ID, when it ended, its language and fields, as the record of the
// game keeps them, how it began, and how they rated it.
export interface GameRatings extends RatingCounts {
  gameId: string;
  endedAt: string;
  language: string;
  fields: string[];
  setup: unknown;
}

// The counts of the ratings, as columns of a query that joins `ratings AS r` to `game_players AS p`.
const RATER = "coalesce('a' || p.account_id, 'g' || r.game_id || ':' || r.player_id)";
const COUNTS = [
  ...RATINGS.map((rating) => `count(DISTINCT ${RATER}) FILTER (WHERE r.rating = '${rating}') AS ${rating}`),
  `count(DISTINCT ${RATER}) FILTER (WHERE r.rating IS NULL) AS skipped`,
].join(', ');

export class RatingStore {
  readonly #rate: StatementSync;
  readonly #guess: StatementSync;
  readonly #pairsSeen: StatementSync;
  readonly #pairsRated: StatementSync;
  readonly #setter: StatementSync;
  readonly #setterGames: StatementSync;
  readonly #guesses: StatementSync;
  readonly #byPair: StatementSync;
  readonly #byGame: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    // A player may change their rating, but not take back a dismissal (Room.rate). A game that
    // isn't kept has nothing to rate, which the foreign key refuses.
    this.#rate = db.prepare(
      'INSERT INTO ratings (game_id, game, player_id, rating, rated_at) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT (game_id, player_id) DO UPDATE SET rating = excluded.rating, rated_at = excluded.rated_at ' +
        'WHERE ratings.rating IS NOT NULL',
    );
    // A guess is made once.
    this.#guess = db.prepare(
      'INSERT INTO ai_guesses (game_id, game, player_id, guess, guessed_at) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT DO NOTHING',
    );
    // For each game of pairs that these accounts played in, its pair and how many of them played
    // in it. The setup's path comes from the game, not from a player.
    this.#pairsSeen = db.prepare(
      'SELECT json_extract(g.setup, ?) AS pair, count(DISTINCT p.account_id) AS players FROM replays AS g ' +
        'JOIN game_players AS p ON p.game_id = g.game_id ' +
        'WHERE g.game = ? AND p.account_id IN (SELECT value FROM json_each(?)) AND json_extract(g.setup, ?) IS NOT NULL ' +
        'GROUP BY g.game_id',
    );
    // How many people rated each pair good, and how many said it had a problem: an account once,
    // however many games with the pair it rated, and a guest once for each game, which is all that
    // is known of them.
    this.#pairsRated = db.prepare(
      `SELECT json_extract(g.setup, ?) AS pair, count(DISTINCT ${RATER}) FILTER (WHERE r.rating = 'good') AS good, ` +
        `count(DISTINCT ${RATER}) FILTER (WHERE r.rating = 'problem') AS problems FROM ratings AS r ` +
        'JOIN replays AS g ON g.game_id = r.game_id ' +
        'LEFT JOIN game_players AS p ON p.game_id = r.game_id AND p.player_id = r.player_id ' +
        'WHERE g.game = ? AND json_extract(g.setup, ?) IS NOT NULL GROUP BY pair',
    );
    // The games that finished whose words the account set, by the player ID it had as the setter,
    // and the good ratings of them.
    this.#setter = db.prepare(
      'WITH words_set AS (SELECT DISTINCT g.game_id FROM replays AS g ' +
        'JOIN game_players AS p ON p.game_id = g.game_id AND p.player_id = json_extract(g.setup, ?) ' +
        "WHERE g.game = ? AND g.ending = 'finished' AND p.account_id = ?) " +
        'SELECT (SELECT count(*) FROM words_set) AS games, (SELECT count(*) FROM ratings ' +
        "WHERE game_id IN (SELECT game_id FROM words_set) AND rating = 'good') AS good",
    );
    // The latest of them, the latest first, each with the good ratings and all the ratings of it,
    // which leave out the players who dismissed the question (null), and whether words of it were
    // adopted.
    this.#setterGames = db.prepare(
      'SELECT g.game_id AS gameId, g.ended_at AS endedAt, g.setup, ' +
        "(SELECT count(*) FROM ratings WHERE game_id = g.game_id AND rating = 'good') AS good, " +
        '(SELECT count(rating) FROM ratings WHERE game_id = g.game_id) AS rated, ' +
        'EXISTS (SELECT 1 FROM content_contributions WHERE game_id = g.game_id) AS adopted FROM replays AS g ' +
        'JOIN game_players AS p ON p.game_id = g.game_id AND p.player_id = json_extract(g.setup, ?) ' +
        "WHERE g.game = ? AND g.ending = 'finished' AND p.account_id = ? " +
        'ORDER BY g.ended_at DESC, g.rowid DESC LIMIT ?',
    );
    // The guesses that an account made of the AI players of a game's games, by the player IDs it
    // had, skips left out: one a game, as a player guesses once.
    this.#guesses = db.prepare(
      'SELECT g.setup, min(a.guess) AS guess FROM ai_guesses AS a ' +
        'JOIN game_players AS p ON p.game_id = a.game_id AND p.player_id = a.player_id ' +
        'JOIN replays AS g ON g.game_id = a.game_id ' +
        'WHERE a.game = ? AND p.account_id = ? AND a.guess IS NOT NULL GROUP BY a.game_id',
    );
    // Every pair of a game that the kept games drew from the word library, with how many drew it and
    // the counts of its ratings, the pair drawn most first.
    this.#byPair = db.prepare(
      'WITH drawn AS (SELECT json_extract(setup, ?) AS pair, count(*) AS games FROM replays ' +
        'WHERE game = ? AND json_extract(setup, ?) IS NOT NULL GROUP BY pair), ' +
        `rated AS (SELECT json_extract(g.setup, ?) AS pair, ${COUNTS} FROM ratings AS r ` +
        'JOIN replays AS g ON g.game_id = r.game_id ' +
        'LEFT JOIN game_players AS p ON p.game_id = r.game_id AND p.player_id = r.player_id ' +
        'WHERE g.game = ? AND json_extract(g.setup, ?) IS NOT NULL GROUP BY pair) ' +
        `SELECT drawn.pair, drawn.games, ${[...RATINGS, 'skipped'].map((key) => `coalesce(rated.${key}, 0) AS ${key}`).join(', ')} ` +
        'FROM drawn LEFT JOIN rated ON rated.pair = drawn.pair ORDER BY drawn.games DESC, drawn.pair',
    );
    // The latest games of a game that players rated or dismissed the question of, the latest first.
    this.#byGame = db.prepare(
      `SELECT g.game_id AS gameId, g.ended_at AS endedAt, g.language, g.fields, g.setup, ${COUNTS} ` +
        'FROM ratings AS r JOIN replays AS g ON g.game_id = r.game_id ' +
        'LEFT JOIN game_players AS p ON p.game_id = r.game_id AND p.player_id = r.player_id ' +
        'WHERE g.game = ? GROUP BY g.game_id ORDER BY g.ended_at DESC, g.rowid DESC LIMIT ?',
    );
  }

  // Keeps a player's rating of a game, or their dismissal, by null. Says whether it did: not for a
  // game that isn't kept, nor once they dismissed it.
  rate(game: string, gameId: string, playerId: string, rating: string | null): boolean {
    try {
      const at = new Date(this.now()).toISOString();
      return Number(this.#rate.run(gameId, game, playerId, rating, at).changes) > 0;
    } catch (error) {
      if (error instanceof Error && error.message.includes('FOREIGN KEY')) return false;
      throw error;
    }
  }

  // Keeps a player's guess of who the AI players were, as the game took it, or their skip, by null.
  guess(game: string, gameId: string, playerId: string, guess: unknown): boolean {
    try {
      const at = new Date(this.now()).toISOString();
      const kept = guess === null ? null : JSON.stringify(guess);
      return Number(this.#guess.run(gameId, game, playerId, kept, at).changes) > 0;
    } catch (error) {
      if (error instanceof Error && error.message.includes('FOREIGN KEY')) return false;
      throw error;
    }
  }

  // What the records say of each pair of a game that these accounts have had or players have rated,
  // by its key, as drawPair() reads them.
  pairRecords(game: string, path: string, accountIds: readonly number[]): Map<string, PairRecord> {
    const records = new Map<string, PairRecord>();
    const of = (pair: string) => {
      let record = records.get(pair);
      if (!record) records.set(pair, (record = { seen: 0, together: false, good: 0, problems: 0 }));
      return record;
    };
    if (accountIds.length > 0) {
      const ids = JSON.stringify([...new Set(accountIds)]);
      for (const { pair, players } of this.#pairsSeen.all(path, game, ids, path) as {
        pair: unknown;
        players: number;
      }[]) {
        if (typeof pair !== 'string') continue;
        const record = of(pair);
        record.seen += players;
        record.together ||= players >= 2;
      }
    }
    for (const { pair, good, problems } of this.#pairsRated.all(path, game, path) as {
      pair: unknown;
      good: number;
      problems: number;
    }[]) {
      if (typeof pair !== 'string') continue;
      Object.assign(of(pair), { good, problems });
    }
    return records;
  }

  // How many games that finished an account set the words of, and how many players rated them good.
  setterCounts(game: string, path: string, accountId: number): SetterCounts {
    const row = this.#setter.get(path, game, accountId) as unknown as SetterCounts;
    return { games: row.games, good: row.good };
  }

  // The latest games that finished whose words an account set, the latest first, how players rated
  // them and whether words of them were adopted.
  setterGames(game: string, path: string, accountId: number, limit = RECENT_RECORDS): SetterGame[] {
    type Row = Omit<SetterGame, 'setup' | 'adopted'> & { setup: string; adopted: number };
    return (this.#setterGames.all(path, game, accountId, limit) as Row[]).map((row) => ({
      ...row,
      setup: JSON.parse(row.setup) as unknown,
      adopted: row.adopted === 1,
    }));
  }

  // How players rated each pair of a game of pairs that the word library gave (admin.cjs ratings).
  pairRatings(game: string, path: string): PairRatings[] {
    return this.#byPair.all(path, game, path, path, game, path) as unknown as PairRatings[];
  }

  // How players rated the latest games of a game that they rated (admin.cjs ratings).
  gameRatings(game: string, limit: number): GameRatings[] {
    type Row = Omit<GameRatings, 'fields' | 'setup'> & { fields: string; setup: string | null };
    return (this.#byGame.all(game, limit) as Row[]).map((row) => ({
      ...row,
      fields: JSON.parse(row.fields) as string[],
      setup: row.setup === null ? null : (JSON.parse(row.setup) as unknown),
    }));
  }

  // The guesses that an account made of the AI players of a game's games, one a game, skips left
  // out, each with how its game began, from which the game tells whether it was right
  // (GameModule.guessedRight).
  guesses(game: string, accountId: number): AgentGuess[] {
    type Row = { setup: string | null; guess: string };
    return (this.#guesses.all(game, accountId) as Row[]).map(({ setup, guess }) => ({
      setup: setup === null ? null : (JSON.parse(setup) as unknown),
      guess: JSON.parse(guess) as unknown,
    }));
  }
}
