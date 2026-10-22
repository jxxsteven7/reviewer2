import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { Language, MatchTitle, RecordResult } from '@reviewer2/shared';
import { certifiedPlay, type AgentLogData } from '../core/agentLog';
import type { GameModule, GameOutcome, GameTitle, Recount } from '../core/game';
import type { GameLogData } from '../core/gameLog';
import { rankings, titlesFor } from '../core/match';
import { jsonOf } from './records';

// The records counted again from the record of every game (docs/architecture.md#game-records). What
// the record of a game that finished keeps of how it came out, who won and how, and what the
// records keep of it, how it came out for each player, their place, points, verdict, the game's own
// detail and titles, and what each AI player in a seat did, and of a match
// that ran its course, each player's total, place and title, is counted under the rules of the
// game, from the moves in its log and how it began; the moves are facts, and what they count for is
// the rules', but for who played for which side in which role, which is the game's as it was
// played. So when a game's rules change (GameModule.rulesVersion), the server counts every kept
// game of that game again as it starts (recountRecords), in one transaction, after a snapshot, and
// the check of the data holds every record against the count (check.ts). The games are counted by
// the game itself (GameModule.recount), as its replays are worked out, with who was who from
// game_players, the log's guests and AI players; a match's games are added up here as the match
// adds them up (core/match.ts), by each player's number in the match, which the log of each game
// keeps (GameLogData.match).

// The setting that keeps the version of the rules that the records of a game are counted under.
export const countedUnderKey = (game: string): string => `rules_counted:${game}`;

// One account's part in a game, as the records keep it or as the log counts it, with the game's own
// detail as JSON, as the records keep it, or null.
export interface CountedRecord {
  side: string;
  role: string;
  result: RecordResult;
  place: number;
  verdict: string;
  detail: string | null;
  points: number;
  titles: GameTitle[];
}

// What an AI did in a seat of a game, or for a person it played for, as agent_plays keeps it or as
// the log counts it: the side and the role of the seat at the end, how the game came out for it and
// its place, or none of them for a person who had no part in it by then, and what the game counts
// of an AI player in a seat, as JSON, or null.
export interface CountedPlay {
  side: string | null;
  role: string | null;
  result: RecordResult | null;
  place: number | null;
  feats: string | null;
}

// A kept game that finished, counted: how it came out, who won and how, or null when no one side
// won or the game can't say (`outcome`); whether it brought nobody points, a streak, a title or a
// friend title, for whatever reason (`scoresNothing`); each account's record; everyone's part in it
// at the end, by player ID, with what the game counts of each AI player in a seat (`seats`), from
// which what each AI did in it is held against agent_plays; and, for a game of a match, what the
// match adds up of it: the match's ID and its games, each player's points by their number in the
// match, the numbers of everyone in the room when the game ended, and the numbers that have gone
// into another by then (GameLogData.match), with the number of each account that played in it.
export interface CountedGame {
  gameId: string;
  game: string;
  outcome: GameOutcome | null;
  scoresNothing: boolean;
  records: Map<number, CountedRecord>;
  seats: Map<string, CountedPlay>;
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
  agentLog: string | null;
  agents: number;
  takeover: number;
  matchId: string | null;
  matchGame: number | null;
  matchGames: number | null;
}

const GAME_COLUMNS =
  'game_id AS gameId, game, setup, log, language, agent_log AS agentLog, agents, takeover, ' +
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
  // A game that counts something of an AI player in a seat as a game ends (GameModule.agentFeats)
  // counts it again here, and one that doesn't never does: a game that breaks this is a mistake in
  // the code, which would lose or make up what the AI did, and stops the count.
  if ((module.agentFeats === undefined) !== (count.feats === undefined)) {
    throw new Error(
      count.feats === undefined
        ? `the game ${module.id} counts what an AI player did as a game ends, but not when the game is counted again`
        : `the game ${module.id} counts what an AI player did when a game is counted again, but not as it ends`,
    );
  }
  // The same for whether the game counts for nothing for a reason of its own
  // (GameModule.scoresNothing).
  if ((module.scoresNothing === undefined) !== (count.scoresNothing === undefined)) {
    throw new Error(
      count.scoresNothing === undefined
        ? `the game ${module.id} says whether a game counts for nothing as it ends, but not when it is counted again`
        : `the game ${module.id} says whether a game counts for nothing when it is counted again, but not as it ends`,
    );
  }
  const keyOf = keyFor(who, log);
  // A game brings nobody points or titles, as the room decides it (Room.#scoresNothing), when an AI
  // played in it and not every answer the AI gave came from a certified version
  // (docs/architecture.md#ai-players), or when the game says so for a reason of its own, as a
  // removal (GameModule.scoresNothing).
  const unscored =
    count.scoresNothing === true || ((row.agents > 0 || row.takeover === 1) && !certifiedKept(row.agentLog));
  const points = new Map(count.scores.map(({ key, points: won }) => [key, won]));
  const records = new Map<number, CountedRecord>();
  const seats = new Map<string, CountedPlay>();
  for (const { playerId, side, role, result, place, verdict, detail, titles = [] } of count.results) {
    const feats = log.agents?.[playerId] === undefined ? null : jsonOf(count.feats?.(playerId));
    seats.set(playerId, { side, role, result, place, feats });
    const account = who.get(playerId);
    if (account === undefined) continue;
    records.set(account, {
      side,
      role,
      result,
      place,
      verdict,
      detail: jsonOf(detail),
      points: unscored ? 0 : (points.get(keyOf(playerId)) ?? 0),
      titles: unscored ? [] : titles,
    });
  }
  const { outcome } = count;
  if (row.matchId === null || row.matchGame === null || row.matchGames === null) {
    return { gameId: row.gameId, game: row.game, outcome, scoresNothing: unscored, records, seats, match: null };
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
    outcome,
    scoresNothing: unscored,
    records,
    seats,
    match: { id: row.matchId, game: row.matchGame, games: row.matchGames, points: scored, present, merged, accounts },
  };
}

// Whether every answer the AI gave in a kept game came from a certified version (certifiedPlay),
// by the AI's log of it, as the record keeps it. A log that can't be read, which the check of the
// data reports (check.ts), certifies nothing, and stops no count.
function certifiedKept(agentLog: string | null): boolean {
  if (agentLog === null) return false;
  try {
    return certifiedPlay(JSON.parse(agentLog) as AgentLogData);
  } catch {
    return false;
  }
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
// titles go to the top and, with three or more ranked, the bottom, for a game whose matches award
// them (`titles`, MatchHooks.titles). A match with fewer games kept than it was to have didn't run
// its course, and counts for no record: it is left out.
export function countMatches(games: readonly CountedGame[], titles = true): Map<string, CountedMatch> {
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
    const awarded = titles ? titlesFor(ranked) : new Map<string, MatchTitle>();
    const standings = new Map<number, Standing>();
    for (const [account, number] of accounts) {
      const rank = ranks.get(String(number));
      if (rank === undefined) continue;
      standings.set(account, { rank, total: totals.get(number) ?? 0, title: awarded.get(String(number)) ?? null });
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
  // The games counted again, those whose outcome changed, the records of games, the games' titles
  // and the AI's seats that changed, and the matches whose records or titles changed.
  games: number;
  outcomes: number;
  records: number;
  titles: number;
  plays: number;
  matches: number;
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((item) => b.has(item));

// Whether two values of the game's own, as JSON or null, are the same, whatever the order of their
// keys: SQLite keeps JSON as it was written, which a migration may have written in another order.
const sameJson = (a: string | null, b: string | null): boolean =>
  a === b || (a !== null && b !== null && canonical(JSON.parse(a)) === canonical(JSON.parse(b)));

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );

// A record of a game held against the count of the game: whether it is of an account the count
// seats at the end (`count`, or null), and where it has one, whether it disagrees with the count on
// a fact, the side and the role (`fact`), on what the count gives, how the game came out for them,
// their place, the points, the verdict and the game's own detail (`counted`), or on the titles that
// the game brought the account (`titles`).
export interface HeldRecord {
  id: number;
  account: number;
  count: CountedRecord | null;
  fact: boolean;
  counted: boolean;
  titles: boolean;
}

// What an AI did in a game, as agent_plays keeps it, held against the count of the game, by the
// player ID it played as or for: what the count gives it (`count`), which is null for an AI player
// that the count doesn't seat at the end; whether it disagrees with the count on a fact, the side
// and the role (`fact`); and whether on what the count gives, how the game came out and the place,
// and what the game counts of an AI player in a seat (`counted`). A person whom the AI played for
// has no part in the count when they weren't in a seat at the end, and none of what an AI player
// in a seat has.
export interface HeldPlay {
  playerId: string;
  takeover: boolean;
  count: CountedPlay | null;
  fact: boolean;
  counted: boolean;
}

const NO_PART: CountedPlay = { side: null, role: null, result: null, place: null, feats: null };

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

// Holds the records of games and matches, and how the record of each game says it came out, as the
// database has them, against what the games count again (countGames, countMatches), one rule for
// the recount (recountRecords), which sets them right by it, and for the check of the data
// (check.ts), which reports what differs.
export class HeldRecords {
  readonly #outcome: StatementSync;
  readonly #records: StatementSync;
  readonly #titles: StatementSync;
  readonly #plays: StatementSync;
  readonly #matchRecords: StatementSync;

  constructor(db: DatabaseSync) {
    this.#outcome = db.prepare('SELECT winner, reason, scores_nothing AS unscored FROM replays WHERE game_id = ?');
    this.#records = db.prepare(
      'SELECT id, account_id AS account, side, role, result, place, verdict, detail, points FROM game_records ' +
        'WHERE game_id = ?',
    );
    this.#plays = db.prepare(
      'SELECT player_id AS playerId, takeover, side, role, result, place, feats FROM agent_plays WHERE game_id = ?',
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
      result: RecordResult;
      place: number;
      verdict: string;
      detail: string | null;
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
        fact: count !== null && (count.side !== row.side || count.role !== row.role),
        counted:
          count !== null &&
          (count.result !== row.result ||
            count.place !== row.place ||
            count.points !== row.points ||
            count.verdict !== row.verdict ||
            !sameJson(count.detail, row.detail)),
        titles:
          count !== null &&
          !sameSet(titleSet(stored.filter(({ account }) => account === row.account)), titleSet(count.titles)),
      };
    });
  }

  // Whether the record of a counted game disagrees with the count on how the game came out: who won
  // and how, and whether it brought anybody anything.
  outcomeDiffers(game: CountedGame): boolean {
    const kept = this.#outcome.get(game.gameId) as { winner: string | null; reason: string | null; unscored: number };
    return (
      kept.winner !== (game.outcome?.winner ?? null) ||
      kept.reason !== (game.outcome?.reason ?? null) ||
      (kept.unscored === 1) !== game.scoresNothing
    );
  }

  // What the AI did in a counted game, each seat and each person it played for held against the
  // count.
  plays(game: CountedGame): HeldPlay[] {
    type Row = CountedPlay & { playerId: string; takeover: number };
    return (this.#plays.all(game.gameId) as unknown as Row[]).map(({ playerId, takeover, ...row }) => {
      const seat = game.seats.get(playerId);
      const count = takeover === 1 ? { ...(seat ?? NO_PART), feats: null } : seat === undefined ? null : seat;
      return {
        playerId,
        takeover: takeover === 1,
        count,
        fact: count !== null && (count.side !== row.side || count.role !== row.role),
        counted:
          count !== null &&
          (count.result !== row.result || count.place !== row.place || !sameJson(count.feats, row.feats)),
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
// transaction: the record of each game gets who won and how, and whether it brought anybody
// anything, as the log counts it; each record gets how the game came out for the account, their
// place, the points, the verdict and the game's own detail that the log counts, and the titles that
// the game brought are those that the log brings; what each AI did in a seat gets how the game came
// out for it, its place and what the game counts of it, and what it did for a person how the game
// came out for them; each record of a match gets the place and the total that its games add up to,
// and the title that they award. Nothing is added or taken away: a record is of the account whose
// game it is, and a deleted account's are gone. Who played for which side in which role is a fact
// of the game, which the records keep too: a record that disagrees with the log on it, or that the
// log doesn't give at all, stops the recount, as does a game that finished but can't be counted,
// and the database is left as it was, for the operator to look at. Then the settings note the
// version counted under. The caller takes a snapshot first.
export function recountRecords(db: DatabaseSync, games: readonly GameModule[]): RecountReport {
  const report: RecountReport = { games: 0, outcomes: 0, records: 0, titles: 0, plays: 0, matches: 0 };
  db.exec('BEGIN IMMEDIATE');
  try {
    const held = new HeldRecords(db);
    const updateOutcome = db.prepare('UPDATE replays SET winner = ?, reason = ?, scores_nothing = ? WHERE game_id = ?');
    const update = db.prepare(
      'UPDATE game_records SET result = ?, place = ?, points = ?, verdict = ?, detail = ? WHERE id = ?',
    );
    const updatePlay = db.prepare(
      'UPDATE agent_plays SET result = ?, place = ?, feats = ? WHERE game_id = ? AND player_id = ?',
    );
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
        if (held.outcomeDiffers(game)) {
          updateOutcome.run(
            game.outcome?.winner ?? null,
            game.outcome?.reason ?? null,
            game.scoresNothing ? 1 : 0,
            game.gameId,
          );
          report.outcomes += 1;
        }
        const records = held.game(game);
        for (const { id, count, fact, counted: differs } of records) {
          if (!count) throw new Error(`record ${id} of game ${game.gameId} is of nobody the log seats at its end`);
          if (fact) throw new Error(`record ${id} of game ${game.gameId} disagrees with the log on who played where`);
          if (differs) {
            update.run(count.result, count.place, count.points, count.verdict, count.detail, id);
            report.records += 1;
          }
        }
        for (const { playerId, count, fact, counted: differs } of held.plays(game)) {
          if (!count)
            throw new Error(`the AI player ${playerId} of game ${game.gameId} is in no seat the log ends with`);
          if (fact) {
            throw new Error(
              `what the AI did as or for ${playerId} in game ${game.gameId} disagrees with the log on where`,
            );
          }
          if (differs) {
            updatePlay.run(count.result, count.place, count.feats, game.gameId, playerId);
            report.plays += 1;
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
      for (const match of countMatches(counted, module.match?.titles !== false).values()) {
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
