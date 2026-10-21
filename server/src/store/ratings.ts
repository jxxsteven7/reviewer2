import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { PairRecord } from '../core/words';

// What players said of the games they played (docs/architecture.md#ratings, migration 27): how
// they rated a game that finished, and whom they guessed the AI players of a game were. Each is a
// row of the game, by the player ID they had in it, which goes with the record of the game.
//
// What is worked out of them, and of the records of the games, is never kept: how often the
// players in a room have had a pair of related terms, and how players rated it, for the next draw
// of a pair (drawPair in core/words.ts); and how many games an account set the words of, and how
// many of those players rated good, for its page. A game says where its setup keeps the key of its
// pair and its setter (GameModule.setupPaths).

export interface SetterCounts {
  games: number;
  good: number;
}

export class RatingStore {
  readonly #rate: StatementSync;
  readonly #guess: StatementSync;
  readonly #pairsSeen: StatementSync;
  readonly #pairsRated: StatementSync;
  readonly #setter: StatementSync;

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
    this.#pairsRated = db.prepare(
      "SELECT json_extract(g.setup, ?) AS pair, count(*) FILTER (WHERE r.rating = 'good') AS good, " +
        "count(*) FILTER (WHERE r.rating = 'problem') AS problems FROM ratings AS r " +
        'JOIN replays AS g ON g.game_id = r.game_id ' +
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
}
