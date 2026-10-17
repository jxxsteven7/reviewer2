import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { Language, MatchTitle } from '@reviewer2/shared';
import type { GameModule, GameTitle, Recount } from '../core/game';
import type { GameLogData } from '../core/gameLog';
import { rankings, titlesFor } from '../core/match';

// The records counted again from the record of every game (docs/architecture.md#game-records). What
// the records keep of a game that finished, each player's points, verdict and titles, and of a match
// that ran its course, each player's total, place and title, is counted under the rules of the
// game, from the moves in its log and how it began; the moves are facts, and what they count for is
// the rules'. So when a game's rules change (GameModule.rulesVersion), the server counts every kept
// game of that game again as it starts (recountRecords), in one transaction, after a snapshot, and
// the check of the data holds every record against the count (check.ts). The games are counted by
// the game itself (GameModule.recount), as its replays are worked out, with who was who from
// game_players, the log's guests and AI players; a match's games are added up here as the match
// adds them up (core/match.ts), by each player's number in the match, which the log of each game
// keeps (GameLogData.match).

// The setting that keeps the version of the rules that the records of a game are counted under.
export const countedUnderKey = (game: string): string => `rules_counted:${game}`;

// One account's part in a game, as the records keep it or as the log counts it.
export interface CountedRecord {
  side: string;
  role: string;
  won: boolean;
  verdict: string;
  points: number;
  titles: GameTitle[];
}

// A kept game that finished, counted: each account's record, and, for a game of a match, what the
// match adds up of it: the match's ID and its games, each player's points by their number in the
// match, the numbers of everyone in the room when the game ended, and the numbers that have gone
// into another by then (GameLogData.match), with the number of each account that played in it.
export interface CountedGame {
  gameId: string;
  game: string;
  records: Map<number, CountedRecord>;
  match: {
    id: string;
    game: number;
    games: number;
    points: Map<number, number>;
    present: Set<number>;
    merged: Map<number, number>;
    accounts: Map<number, number>;
  } | null;
}

// A match that ran its course, added up from its games: each account's place, total and title.
export interface Standing {
  rank: number;
  total: number;
  title: MatchTitle | null;
}

export interface CountedMatch {
  id: string;
  game: string;
  games: number;
  players: number;
  standings: Map<number, Standing>;
}

// Why a kept game that finished can't be counted from its record: its log doesn't tell how it came
// out, or can't be played through at all, or, in a match, numbers somebody who scored with no number
// at all; with the match it was scored in, if any, whose records can't be counted either then.
export type Uncounted = { gameId: string; matchId: string | null; reason: 'log' | 'numbers' };

interface GameRow {
  gameId: string;
  game: string;
  setup: string | null;
  log: string;
  language: Language;
  agents: number;
  takeover: number;
  matchId: string | null;
  matchGame: number | null;
  matchGames: number | null;
}

const GAME_COLUMNS =
  'game_id AS gameId, game, setup, log, language, agents, takeover, ' +
  'match_id AS matchId, match_game AS matchGame, match_games AS matchGames';

// Counts every kept game of `module` that finished, one at a time, since the logs are most of the
// database, and says which couldn't be counted.
export function countGames(db: DatabaseSync, module: GameModule): { counted: CountedGame[]; uncounted: Uncounted[] } {
  const counted: CountedGame[] = [];
  const uncounted: Uncounted[] = [];
  if (!module.recount) return { counted, uncounted };
  const players = db.prepare(
    'SELECT player_id AS playerId, account_id AS accountId FROM game_players WHERE game_id = ?',
  );
  const rows = db.prepare(
    `SELECT ${GAME_COLUMNS} FROM replays WHERE game = ? AND ending = 'finished' ORDER BY ended_at`,
  );
  for (const row of rows.iterate(module.id) as Iterable<GameRow>) {
    const who = new Map(
      (players.all(row.gameId) as { playerId: string; accountId: number }[]).map(({ playerId, accountId }) => [
        playerId,
        accountId,
      ]),
    );
    const result = countGame(module, row, who);
    if ('reason' in result) uncounted.push(result);
    else counted.push(result);
  }
  return { counted, uncounted };
}

// Who each player ID was in a kept game, for its count (KeptCount.keyOf), from the accounts of its
// player IDs (`who`, as game_players has them) and its log: an account by its ID, whichever IDs it
// had in the game, a guest by their number, an AI player by its persona, and anyone else, as an
// account deleted since, by their number in the match, so that the IDs they had in a game of a
// match are one player still, or else by the ID alone.
export const keyFor =
  (who: ReadonlyMap<string, number>, log: GameLogData) =>
  (playerId: string): string => {
    const account = who.get(playerId);
    if (account !== undefined) return `account:${account}`;
    const guest = log.guests?.[playerId];
    if (guest !== undefined) return `guest:${guest}`;
    const agent = log.agents?.[playerId];
    if (agent !== undefined) return `agent:${agent}`;
    const number = log.match?.numbers[playerId];
    return number === undefined ? playerId : `number:${number}`;
  };

// Counts one kept game that finished, with the accounts of its player IDs (`who`). A game that the
// module can't play through, as one whose record is broken, or whose record isn't even JSON, counts
// as one whose log doesn't tell.
function countGame(module: GameModule, row: GameRow, who: ReadonlyMap<string, number>): CountedGame | Uncounted {
  const played = ((): { log: GameLogData; count: Recount | null } | null => {
    try {
      const log = JSON.parse(row.log) as GameLogData;
      const setup = row.setup === null ? null : (JSON.parse(row.setup) as unknown);
      const keyOf = keyFor(who, log);
      const recount = module.recount as NonNullable<GameModule['recount']>;
      return { log, count: recount({ setup, log, language: row.language, keyOf }) };
    } catch {
      return null;
    }
  })();
  if (played === null || played.count === null) return { gameId: row.gameId, matchId: row.matchId, reason: 'log' };
  const { log, count } = played;
  const keyOf = keyFor(who, log);
  // A game that an AI played in brings nobody points or titles (docs/architecture.md#ai-players).
  const agents = row.agents > 0 || row.takeover === 1;
  const points = new Map(count.scores.map(({ key, points: won }) => [key, won]));
  const records = new Map<number, CountedRecord>();
  for (const { playerId, side, role, won, verdict, titles = [] } of count.results) {
    const account = who.get(playerId);
    if (account === undefined) continue;
    records.set(account, {
      side,
      role,
      won,
      verdict,
      points: agents ? 0 : (points.get(keyOf(playerId)) ?? 0),
      titles: agents ? [] : titles,
    });
  }
  if (row.matchId === null || row.matchGame === null || row.matchGames === null) {
    return { gameId: row.gameId, game: row.game, records, match: null };
  }
  // The match knows everyone by their number: the points of each key go to the number of a player
  // ID that has that key, and the numbers of those in the room at the end are those of the
  // player IDs that came and didn't leave.
  const numbers = log.match?.numbers ?? {};
  const byKey = new Map<string, number>();
  for (const [playerId, number] of Object.entries(numbers)) byKey.set(keyOf(playerId), number);
  const scored = new Map<number, number>();
  for (const [key, won] of points) {
    const number = byKey.get(key);
    if (number === undefined) return { gameId: row.gameId, matchId: row.matchId, reason: 'numbers' };
    scored.set(number, (scored.get(number) ?? 0) + won);
  }
  const present = new Set<number>();
  for (const playerId of membersAtEnd(log)) {
    const number = numbers[playerId];
    if (number !== undefined) present.add(number);
  }
  const accounts = new Map<number, number>();
  for (const [playerId, account] of who) {
    const number = numbers[playerId];
    if (number !== undefined) accounts.set(account, number);
  }
  const merged = new Map(Object.entries(log.match?.merged ?? {}).map(([from, into]) => [Number(from), into]));
  return {
    gameId: row.gameId,
    game: row.game,
    records,
    match: { id: row.matchId, game: row.matchGame, games: row.matchGames, points: scored, present, merged, accounts },
  };
}

// The player IDs in the room when the game ended: those there as it began, and those who came,
// but those who left.
function membersAtEnd(log: GameLogData): Set<string> {
  const members = new Set(Object.keys(log.start ?? {}));
  for (const { by, type } of log.entries) {
    if (type === 'end') break;
    if (by === null) continue;
    if (type === 'join') members.add(by);
    else if (type === 'leave') members.delete(by);
  }
  return members;
}

// Adds up the matches that the counted games were scored in, as the match adds them up
// (core/match.ts): everyone's total over the match's games, by their number, with the numbers that
// went into another counted for the one they went into; the players ranked are those who scored in
// a game and were in the room when the last game ended, by their totals, ties sharing a place; the
// titles go to the top and, with three or more ranked, the bottom. A match with fewer games kept
// than it was to have didn't run its course, and counts for no record: it is left out.
export function countMatches(games: readonly CountedGame[]): Map<string, CountedMatch> {
  const matches = new Map<string, CountedGame[]>();
  for (const game of games) {
    if (game.match === null) continue;
    matches.set(game.match.id, [...(matches.get(game.match.id) ?? []), game]);
  }
  const counted = new Map<string, CountedMatch>();
  for (const [id, played] of matches) {
    played.sort((a, b) => (a.match?.game ?? 0) - (b.match?.game ?? 0));
    const last = played.at(-1)?.match;
    if (!last || played.length < last.games) continue;
    const fold = (number: number): number => {
      let into = number;
      for (let step = 0; step < last.merged.size && last.merged.has(into); step += 1)
        into = last.merged.get(into) as number;
      return into;
    };
    const totals = new Map<number, number>();
    const accounts = new Map<number, number>();
    for (const game of played) {
      const match = game.match as NonNullable<CountedGame['match']>;
      for (const [number, points] of match.points) {
        const into = fold(number);
        totals.set(into, (totals.get(into) ?? 0) + points);
      }
      for (const [account, number] of match.accounts) accounts.set(account, fold(number));
    }
    const present = new Set([...last.present].map(fold));
    const ranked = [...totals]
      .filter(([number]) => present.has(number))
      .map(([key, total]) => ({ key: String(key), total }));
    const ranks = rankings(ranked);
    const titles = titlesFor(ranked);
    const standings = new Map<number, Standing>();
    for (const [account, number] of accounts) {
      const rank = ranks.get(String(number));
      if (rank === undefined) continue;
      standings.set(account, { rank, total: totals.get(number) ?? 0, title: titles.get(String(number)) ?? null });
    }
    const game = played[0] as CountedGame;
    counted.set(id, { id, game: game.game, games: played.length, players: ranked.length, standings });
  }
  return counted;
}

// The version of the rules that the records of a game are counted under, as the settings keep it
// (countedUnderKey), or null when they haven't been counted since the setting was kept, as for a
// database from before it.
export function countedUnder(db: DatabaseSync, game: string): number | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(countedUnderKey(game)) as
    { value: string } | undefined;
  return row === undefined ? null : Number(row.value);
}

// The games whose records are to be counted again: those with rules of their own that count their
// games, whose records are counted under other rules than today's.
export const recountDue = (db: DatabaseSync, games: readonly GameModule[]): GameModule[] =>
  games.filter(
    (game) =>
      game.recount !== undefined && game.rulesVersion !== undefined && countedUnder(db, game.id) !== game.rulesVersion,
  );

// Whether any kept game of these games finished, so that there is anything to count again.
export const hasGamesOf = (db: DatabaseSync, games: readonly GameModule[]): boolean =>
  games.some(
    (game) =>
      db.prepare("SELECT 1 FROM replays WHERE game = ? AND ending = 'finished' LIMIT 1").get(game.id) !== undefined,
  );

export interface RecountReport {
  // The games counted again, the records of games and the games' titles that changed, and the
  // matches whose records or titles changed.
  games: number;
  records: number;
  titles: number;
  matches: number;
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((item) => b.has(item));

// A record of a game held against the count of the game: whether it is of an account the count
// seats at the end (`count`, or null), and where it has one, whether it disagrees with the count on
// a fact, the side, the role and whether they won (`fact`), on what the count gives, the points and
// the verdict (`counted`), or on the titles that the game brought the account (`titles`).
export interface HeldRecord {
  id: number;
  account: number;
  count: CountedRecord | null;
  fact: boolean;
  counted: boolean;
  titles: boolean;
}

// A record of a match held against what its games add up to: whether it is of an account they
// rank (`standing`, or null), and where it has one, whether it disagrees with it on the games, the
// place, the players ranked or the total (`counted`), or on the title (`title`).
export interface HeldMatchRecord {
  id: number;
  account: number;
  standing: Standing | null;
  counted: boolean;
  title: boolean;
}

// Holds the records of games and matches, as the database has them, against what the games count
// again (countGames, countMatches), one rule for the recount (recountRecords), which sets them
// right by it, and for the check of the data (check.ts), which reports what differs.
export class HeldRecords {
  readonly #records: StatementSync;
  readonly #titles: StatementSync;
  readonly #matchRecords: StatementSync;

  constructor(db: DatabaseSync) {
    this.#records = db.prepare(
      'SELECT id, account_id AS account, side, role, won, verdict, points FROM game_records WHERE game_id = ?',
    );
    this.#titles = db.prepare('SELECT account_id AS account, title, turn FROM titles WHERE game_id = ?');
    this.#matchRecords = db.prepare(
      'SELECT m.id, m.account_id AS account, m.games, m.rank, m.players, m.score, t.title FROM match_records AS m ' +
        'LEFT JOIN titles AS t ON t.account_id = m.account_id AND t.match_id = m.match_id WHERE m.match_id = ?',
    );
  }

  // The records of a counted game, each held against the count.
  game(game: CountedGame): HeldRecord[] {
    type Row = {
      id: number;
      account: number;
      side: string;
      role: string;
      won: number;
      verdict: string;
      points: number;
    };
    type Stored = { account: number; title: string; turn: number };
    const stored = this.#titles.all(game.gameId) as Stored[];
    const titleSet = (titles: readonly { title: string; turn: number | null }[]) =>
      new Set(titles.map(({ title, turn }) => `${title}:${turn ?? ''}`));
    return (this.#records.all(game.gameId) as Row[]).map((row) => {
      const count = game.records.get(row.account) ?? null;
      return {
        id: row.id,
        account: row.account,
        count,
        fact: count !== null && (count.side !== row.side || count.role !== row.role || count.won !== (row.won === 1)),
        counted: count !== null && (count.points !== row.points || count.verdict !== row.verdict),
        titles:
          count !== null &&
          !sameSet(titleSet(stored.filter(({ account }) => account === row.account)), titleSet(count.titles)),
      };
    });
  }

  // The records of a match, each held against what its games add up to, or against nothing, for a
  // match whose games don't add up (`counted` null): each is then of nobody they rank.
  match(matchId: string, counted: CountedMatch | null): HeldMatchRecord[] {
    type Row = {
      id: number;
      account: number;
      games: number;
      rank: number;
      players: number;
      score: number;
      title: string | null;
    };
    return (this.#matchRecords.all(matchId) as Row[]).map((row) => {
      const standing = counted?.standings.get(row.account) ?? null;
      return {
        id: row.id,
        account: row.account,
        standing,
        counted:
          standing !== null &&
          counted !== null &&
          (row.games !== counted.games ||
            row.rank !== standing.rank ||
            row.players !== counted.players ||
            row.score !== standing.total),
        title: standing !== null && row.title !== standing.title,
      };
    });
  }
}

// Counts the records of every kept game of these games again, under the rules of today, in one
// transaction: each record gets the points and the verdict that the log counts, and the titles that
// the game brought are those that the log brings; each record of a match gets the place and the
// total that its games add up to, and the title that they award. Nothing is added or taken away: a
// record is of the account whose game it is, and a deleted account's are gone. The side, the role
// and who won are facts of the game, which the records keep too: a record that disagrees with the
// log on them, or that the log doesn't give at all, stops the recount, as does a game that finished
// but can't be counted, and the database is left as it was, for the operator to look at. Then the
// settings note the version counted under. The caller takes a snapshot first.
export function recountRecords(db: DatabaseSync, games: readonly GameModule[]): RecountReport {
  const report: RecountReport = { games: 0, records: 0, titles: 0, matches: 0 };
  db.exec('BEGIN IMMEDIATE');
  try {
    const held = new HeldRecords(db);
    const update = db.prepare('UPDATE game_records SET points = ?, verdict = ? WHERE id = ?');
    const dropTitles = db.prepare('DELETE FROM titles WHERE game_id = ?');
    const addTitle = db.prepare('INSERT INTO titles (account_id, game, title, game_id, turn) VALUES (?, ?, ?, ?, ?)');
    const updateMatch = db.prepare('UPDATE match_records SET games = ?, rank = ?, players = ?, score = ? WHERE id = ?');
    const dropMatchTitles = db.prepare('DELETE FROM titles WHERE match_id = ?');
    const addMatchTitle = db.prepare('INSERT INTO titles (account_id, game, title, match_id) VALUES (?, ?, ?, ?)');
    for (const module of games) {
      const version = module.rulesVersion;
      if (version === undefined) continue;
      const { counted, uncounted } = countGames(db, module);
      if (uncounted.length > 0) {
        const [{ gameId, reason }] = uncounted as [Uncounted];
        throw new Error(
          `the record of game ${gameId} cannot be counted again: ${reason === 'log' ? 'its log does not tell how it came out' : 'its log does not number everyone who scored in its match'}`,
        );
      }
      for (const game of counted) {
        const records = held.game(game);
        for (const { id, count, fact, counted: differs } of records) {
          if (!count) throw new Error(`record ${id} of game ${game.gameId} is of nobody the log seats at its end`);
          if (fact)
            throw new Error(`record ${id} of game ${game.gameId} disagrees with the log on who played where and won`);
          if (differs) {
            update.run(count.points, count.verdict, id);
            report.records += 1;
          }
        }
        if (records.some(({ titles }) => titles)) {
          dropTitles.run(game.gameId);
          for (const { account, count } of records) {
            for (const { title, turn } of count?.titles ?? [])
              addTitle.run(account, game.game, title, game.gameId, turn);
          }
          report.titles += 1;
        }
        report.games += 1;
      }
      for (const match of countMatches(counted).values()) {
        const records = held.match(match.id, match);
        let changed = false;
        for (const { id, standing, counted: differs } of records) {
          if (!standing) throw new Error(`record ${id} of match ${match.id} is of nobody its games rank`);
          if (differs) {
            updateMatch.run(match.games, standing.rank, match.players, standing.total, id);
            changed = true;
          }
        }
        if (records.some(({ title }) => title)) {
          dropMatchTitles.run(match.id);
          for (const { account, standing } of records) {
            if (standing?.title) addMatchTitle.run(account, match.game, standing.title, match.id);
          }
          changed = true;
        }
        if (changed) report.matches += 1;
      }
      db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      ).run(countedUnderKey(module.id), String(version));
    }
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // SQLite may have rolled back by itself already.
    }
    throw error;
  }
  return report;
}
