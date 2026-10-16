import {
  RECENT_RECORDS,
  TITLES,
  type AgentProfileView,
  type BestStreaks,
  type DuoCounts,
  type GameRecord,
  type MatchRecord,
  type MatchTitle,
  type RecordCounts,
  type RecordsView,
  type Streak,
  type StreakKind,
  type Title,
  type TitleCount,
} from '@reviewer2/shared';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { markDeleted, type GameEnding, type GameLogData, type GameLogEntry } from '../core/gameLog';
import type { GameOutcome } from '../core/game';
import type { AgentPlay } from '../core/room';

// What accounts keep of the games: a row for each game that a player with an account finished in
// a seat (migration 2), with the match it was played in (migration 14), a row for each match that
// they finished ranked, and the titles that matches award (migration 3, docs/architecture.md#matches)
// and games bring (migration 14, docs/architecture.md#titles), and the record of every game,
// however it ended (migrations 7, 12 and 15, docs/architecture.md#game-records): what kind of game
// it was, how it began, its log, which of its players had which account, and the AI's own log of
// it with what the AI players did in it (docs/architecture.md#ai-players), from which a game that
// finished is watched again (migration 22, docs/architecture.md#replays). Every row of them names
// its game (migration 23). What the records can give is never kept beside them: the streaks of wins
// and of losses that the games make (docs/architecture.md#streaks) and what friends have played
// together (migration 13, docs/architecture.md#friend-duos) are worked out from the records
// whenever they are asked for.

// One player's part in one game, as the game module described it (GameModule.results()), with the
// points it brought them (migration 8), scored as a match scores a game, the titles it brought them,
// each with the turn it came in, and the match it was played in, if any (migration 14): the match's
// ID, which game of it this was, from 1, and how many games it was to have. A game that an AI played
// in (docs/architecture.md#ai-players) brings no points and no titles: it is on the record, marked
// by `agents` (migration 15), which keeps it out of the streaks and out of what friends have played
// together.
export interface NewRecord {
  game: string;
  gameId: string;
  side: string;
  role: string;
  winner: string;
  won: boolean;
  verdict: string;
  points: number;
  titles?: readonly { title: Title; turn: number }[];
  match?: { id: string; game: number; games: number } | null;
  agents?: boolean;
}

// What the account has played with each of its friends (shared/src/duos.ts): its records, by
// their own index, each with the friends' records of the same game. Those are found by the index
// on the game (migration 13), which the statement names: left to itself, SQLite looks each friend
// up in every one of the account's games instead, by the unique index on the account and the
// game, which takes ten times as long with a hundred friends. Teammates were on the same side,
// opponents on another. A game that an AI played in counts for no friend (migration 15), so that no
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
  title: MatchTitle | null;
}

// The streaks on a record, counted over its games in the order they were kept, won or lost
// (docs/architecture.md#streaks): the longest run of wins and of losses, and the run that the
// latest game is part of, which is a record when it is longer than every run of its kind before
// it, so that the first run of each kind is one. A record without games has no latest run. The
// games are those that count, which the caller picks: today every game that no AI played in,
// whichever game it was, and one game's alone whenever the pages come to show that.
export function streaksOf(won: readonly boolean[]): BestStreaks & { latest: Streak | null } {
  const best = { wins: 0, losses: 0 };
  let run = 0;
  let last: boolean | null = null;
  for (const result of won) {
    if (result === last) run += 1;
    else {
      if (last !== null) best[last ? 'wins' : 'losses'] = Math.max(best[last ? 'wins' : 'losses'], run);
      run = 1;
      last = result;
    }
  }
  if (last === null) return { ...best, latest: null };
  const kind: StreakKind = last ? 'wins' : 'losses';
  const latest = { kind, length: run, record: run > best[kind] };
  best[kind] = Math.max(best[kind], run);
  return { ...best, latest };
}

export class RecordStore {
  readonly #insert: StatementSync;
  readonly #totals: StatementSync;
  readonly #roles: StatementSync;
  readonly #points: StatementSync;
  readonly #recent: StatementSync;
  readonly #insertMatch: StatementSync;
  readonly #matchCount: StatementSync;
  readonly #recentMatches: StatementSync;
  readonly #results: StatementSync;
  readonly #duos: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    // A game is recorded once for each account, however often the end of the game is reported.
    // Unlike OR IGNORE, ON CONFLICT passes over that alone, and still refuses a record that the
    // table's checks refuse (migration 22).
    this.#insert = db.prepare(
      'INSERT INTO game_records (account_id, game, game_id, ended_at, side, role, winner, won, verdict, ' +
        'points, match_id, match_game, match_games, agents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT DO NOTHING',
    );
    // The games outside matches and in them, each with how many were won.
    this.#totals = db.prepare(
      'SELECT count(*) FILTER (WHERE match_id IS NULL) AS ordinaryGames, ' +
        'count(*) FILTER (WHERE match_id IS NULL AND won = 1) AS ordinaryWins, ' +
        'count(*) FILTER (WHERE match_id IS NOT NULL) AS matchGames, ' +
        'count(*) FILTER (WHERE match_id IS NOT NULL AND won = 1) AS matchWins ' +
        'FROM game_records WHERE account_id = ?',
    );
    // The games in each role, with how many were won, counting every game as the totals do.
    this.#roles = db.prepare(
      'SELECT role, count(*) AS games, count(*) FILTER (WHERE won = 1) AS wins FROM game_records ' +
        'WHERE account_id = ? GROUP BY role',
    );
    this.#points = db.prepare('SELECT coalesce(sum(points), 0) AS points FROM game_records WHERE account_id = ?');
    // With each game, whether an AI played in it, and whether there is a replay of it to watch: a
    // game that finished, kept with its log.
    this.#recent = db.prepare(
      'SELECT game, game_id AS gameId, ended_at AS endedAt, side, role, winner, won, verdict, ' +
        'match_game AS matchGame, match_games AS matchGames, agents, ' +
        'EXISTS (SELECT 1 FROM replays WHERE replays.game_id = game_records.game_id AND ' +
        "ending = 'finished' AND log IS NOT NULL) AS replay " +
        'FROM game_records WHERE account_id = ? ORDER BY id DESC LIMIT ?',
    );
    // A match is recorded once for each account, as a game is.
    this.#insertMatch = db.prepare(
      'INSERT INTO match_records (account_id, game, match_id, ended_at, games, rank, players, score, title) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
    );
    // A match is won by finishing first, alone or level with others.
    this.#matchCount = db.prepare(
      'SELECT count(*) AS played, count(*) FILTER (WHERE rank = 1) AS won FROM match_records WHERE account_id = ?',
    );
    this.#recentMatches = db.prepare(
      'SELECT game, ended_at AS endedAt, games, rank, players, score, title FROM match_records ' +
        'WHERE account_id = ? ORDER BY id DESC LIMIT ?',
    );
    // The result of every game on the record that counts for a streak, in the order the games
    // were kept, which is the order they ended in: a game that an AI played in brings no streak
    // (migration 15). The streaks are counted from them whenever they are asked for (streaksOf),
    // which takes a moment for the longest record, and keeps nothing beside the records that could
    // fall behind them (migration 23).
    this.#results = db.prepare('SELECT won FROM game_records WHERE account_id = ? AND agents = 0 ORDER BY id');
    this.#duos = db.prepare(DUOS_SQL);
  }

  // Keeps the record, and the streak that the game brings the account to, or null when the game
  // was on the record already or an AI played in it. The caller runs it in a transaction
  // (Accounts.record), so that the streak is counted with the record in place.
  add(accountId: number, record: NewRecord): Streak | null {
    const { game, gameId, side, role, winner, won, verdict, points, match = null } = record;
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
      match?.id ?? null,
      match?.game ?? null,
      match?.games ?? null,
      record.agents ? 1 : 0,
    );
    return Number(changes) > 0 && !record.agents ? this.#streaks(accountId).latest : null;
  }

  // The longest streaks of wins and of losses on the account's record (shared/src/streaks.ts).
  streaks(accountId: number): BestStreaks {
    const { wins, losses } = this.#streaks(accountId);
    return { wins, losses };
  }

  #streaks(accountId: number): ReturnType<typeof streaksOf> {
    return streaksOf((this.#results.all(accountId) as { won: number }[]).map(({ won }) => won === 1));
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

  // How many games the account has played and won, outside matches and in them, and in each role
  // of the first game, and how many matches it has finished and won: the counts alone, as a public
  // profile shows them (docs/architecture.md#public-profiles). Every game counts, whichever game
  // it was, as the pages show them today; each record names its game, for the day they show each
  // game's own.
  counts(accountId: number): RecordCounts {
    type Totals = { ordinaryGames: number; ordinaryWins: number; matchGames: number; matchWins: number };
    const totals = this.#totals.get(accountId) as Totals;
    const roles: RecordCounts['roles'] = { captain: { games: 0, wins: 0 }, guesser: { games: 0, wins: 0 } };
    for (const { role, games, wins } of this.#roles.all(accountId) as { role: string; games: number; wins: number }[]) {
      if (role === 'captain' || role === 'guesser') roles[role] = { games, wins };
    }
    const { played, won } = this.#matchCount.get(accountId) as { played: number; won: number };
    return {
      ordinary: { games: totals.ordinaryGames, wins: totals.ordinaryWins },
      inMatches: { games: totals.matchGames, wins: totals.matchWins },
      roles,
      matches: { played, won },
    };
  }

  // The counts, and the latest games and matches.
  view(accountId: number, limit = RECENT_RECORDS): RecordsView {
    const counts = this.counts(accountId);
    type Row = Omit<GameRecord, 'won' | 'replay' | 'match' | 'agents'> & {
      won: number;
      replay: number;
      agents: number;
      matchGame: number | null;
      matchGames: number | null;
    };
    const recent = (this.#recent.all(accountId, limit) as Row[]).map(({ matchGame, matchGames, ...row }) => ({
      ...row,
      won: row.won === 1,
      replay: row.replay === 1,
      agents: row.agents === 1,
      match: matchGame === null || matchGames === null ? null : { game: matchGame, games: matchGames },
    }));
    const recentMatches = this.#recentMatches.all(accountId, limit) as unknown as MatchRecord[];
    return { ...counts, recent, matches: { ...counts.matches, recent: recentMatches } };
  }
}

export class TitleStore {
  readonly #insert: StatementSync;
  readonly #insertForGame: StatementSync;
  readonly #counts: StatementSync;
  readonly #count: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    // A match awards an account a title once (the titles_match index), and a turn of a game brings
    // it once (titles_game). Unlike OR IGNORE, ON CONFLICT passes over that alone, and still
    // refuses a row that the table's checks refuse. Each title names the game that the match or
    // the game was of (migration 23).
    this.#insert = db.prepare(
      'INSERT INTO titles (account_id, game, title, match_id, awarded_at) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT DO NOTHING',
    );
    this.#insertForGame = db.prepare(
      'INSERT INTO titles (account_id, game, title, game_id, turn, awarded_at) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT DO NOTHING',
    );
    this.#counts = db.prepare(
      'SELECT title, count(*) AS count FROM titles WHERE account_id = ? GROUP BY title ORDER BY title',
    );
    this.#count = db.prepare('SELECT count(*) AS count FROM titles WHERE account_id = ? AND title = ?');
  }

  // Awards a title from a match of the game `game`, and says whether it was new. The same title can
  // be awarded many times, but a match awards it to an account once.
  award(accountId: number, game: string, title: Title, matchId: string): boolean {
    known(title);
    const at = new Date(this.now()).toISOString();
    return Number(this.#insert.run(accountId, game, title, matchId, at).changes) > 0;
  }

  // Awards a title that a game brought, in one of its turns, and says whether it was new: a turn of
  // a game brings an account a title once, however often the end of the game is reported.
  awardForGame(accountId: number, game: string, title: Title, gameId: string, turn: number): boolean {
    known(title);
    const at = new Date(this.now()).toISOString();
    return Number(this.#insertForGame.run(accountId, game, title, gameId, turn, at).changes) > 0;
  }

  // How often the account has been awarded one title.
  count(accountId: number, title: Title): number {
    return (this.#count.get(accountId, title) as { count: number }).count;
  }

  // How often the account has been awarded each of its titles.
  counts(accountId: number): TitleCount[] {
    return (this.#counts.all(accountId) as { title: Title; count: number }[]).map(({ title, count }) => ({
      title,
      count,
    }));
  }
}

// The titles are the code's to check (migration 14), as they are for the whole table: a title that
// isn't one is a mistake in the code, and is never kept.
function known(title: Title): void {
  if (!TITLES.includes(title)) throw new Error(`Unknown title: ${String(title)}`);
}

// A game to keep (docs/architecture.md#game-records), once for each game, however often its end is
// reported: how it ended, who won and how if it finished, and what kind of game it was
// (Room.record()); how it began (GameModule.setup), if the game says; the log of everything that
// happened in it, or null when it grew too long to keep; the AI's own log of it, or null when no AI
// played in it (agentLog.ts); and which player, by the ID they had in the room, was which account.
export interface NewReplay {
  game: string;
  gameId: string;
  ending: GameEnding;
  outcome: GameOutcome | null;
  durationMs: number;
  setup: unknown;
  log: GameLogData | null;
  agentLog: unknown;
  players: readonly { playerId: string; accountId: number }[];
  counts: { accounts: number; guests: number; agents: number };
  takeover: boolean;
  agentPlays: readonly AgentPlay[];
  match: boolean;
  practice: boolean;
  language: string;
  fields: readonly string[];
  version: string;
  rules: number | null;
  words: string;
}

// A kept game for an account to watch again (ReplayStore.read): the game, how it began, its log, and
// which player ID was which account, for those still there.
export interface KeptGame {
  game: string;
  setup: unknown;
  log: GameLogData;
  players: { playerId: string; accountId: number }[];
}

export class ReplayStore {
  readonly #insert: StatementSync;
  readonly #player: StatementSync;
  readonly #read: StatementSync;
  readonly #players: StatementSync;
  readonly #played: StatementSync;
  readonly #setLog: StatementSync;
  readonly #log: StatementSync;
  readonly #agentPlay: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {
    // A game is kept once, and, as for the records, never in a form that the table's checks refuse.
    this.#insert = db.prepare(
      'INSERT INTO replays (game_id, game, ended_at, log, agent_log, ending, winner, reason, ' +
        'started_at, setup, accounts, guests, agents, takeover, in_match, practice, language, fields, version, rules, ' +
        'words) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
    );
    // An account that is gone by now, deleted while the game was on, is left out.
    this.#player = db.prepare(
      'INSERT OR IGNORE INTO game_players (game_id, player_id, account_id) SELECT ?, ?, id FROM accounts WHERE id = ?',
    );
    // Only an account that has the game on its record may read it, and only a game that finished,
    // kept with its log, has a replay.
    this.#read = db.prepare(
      "SELECT game, setup, log FROM replays WHERE game_id = ? AND ending = 'finished' AND log IS NOT NULL AND " +
        'EXISTS (SELECT 1 FROM game_records WHERE account_id = ? AND game_id = replays.game_id)',
    );
    this.#players = db.prepare(
      'SELECT player_id AS playerId, account_id AS accountId FROM game_players WHERE game_id = ? ORDER BY rowid',
    );
    // The logs of the games that an account played in, with the IDs it had in each.
    this.#played = db.prepare(
      'SELECT replays.game_id AS gameId, log, json_group_array(player_id) AS playerIds FROM game_players ' +
        'JOIN replays ON replays.game_id = game_players.game_id ' +
        'WHERE account_id = ? AND log IS NOT NULL GROUP BY replays.game_id',
    );
    this.#setLog = db.prepare('UPDATE replays SET log = ? WHERE game_id = ?');
    this.#log = db.prepare('SELECT log FROM replays WHERE game_id = ? AND log IS NOT NULL');
    // The account of a person an AI played for, if it is still there. What the game counts of an
    // AI player in a seat goes as JSON in the game's own shape (`feats`, migration 23).
    this.#agentPlay = db.prepare(
      'INSERT OR IGNORE INTO agent_plays (game_id, player_id, game, persona, takeover, account_id, side, role, won, ' +
        'feats) VALUES (?, ?, ?, ?, ?, (SELECT id FROM accounts WHERE id = ?), ?, ?, ?, ?)',
    );
  }

  // Keeps a game, with its logs as JSON, if any, and which player was which account, and says whether
  // it was new. A game that is kept already keeps what it had. The caller runs this in one
  // transaction.
  add(game: NewReplay): boolean {
    const endedAt = this.now();
    const json = (value: unknown) => (value === undefined || value === null ? null : JSON.stringify(value));
    const flag = (value: boolean) => (value ? 1 : 0);
    const added =
      Number(
        this.#insert.run(
          game.gameId,
          game.game,
          new Date(endedAt).toISOString(),
          json(game.log),
          json(game.agentLog),
          game.ending,
          game.outcome?.winner ?? null,
          game.outcome?.reason ?? null,
          new Date(endedAt - game.durationMs).toISOString(),
          json(game.setup),
          game.counts.accounts,
          game.counts.guests,
          game.counts.agents,
          flag(game.takeover),
          flag(game.match),
          flag(game.practice),
          game.language,
          JSON.stringify(game.fields),
          game.version,
          game.rules,
          game.words,
        ).changes,
      ) > 0;
    if (!added) return false;
    for (const { playerId, accountId } of game.players) this.#player.run(game.gameId, playerId, accountId);
    for (const play of game.agentPlays) {
      this.#agentPlay.run(
        game.gameId,
        play.playerId,
        game.game,
        play.persona,
        play.takeover ? 1 : 0,
        play.accountId,
        play.side,
        play.role,
        play.won === null ? null : play.won ? 1 : 0,
        json(play.feats),
      );
    }
    return true;
  }

  // Adds to the log of a game that is kept what the groups said after its end, as they talked it
  // over (Room.review()), with the accounts of the player IDs it doesn't know yet, such as of
  // someone who came back to the room after the end, and marks the player IDs of the accounts
  // deleted meanwhile (`deleted`). A game kept without a log, as one whose log grew too long, keeps
  // none; one that isn't kept, nothing. Says whether the log grew. The caller runs this in one
  // transaction.
  addToLog(
    gameId: string,
    entries: readonly GameLogEntry[],
    players: readonly { playerId: string; accountId: number }[],
    deleted: Iterable<string> = [],
  ): boolean {
    const row = this.#log.get(gameId) as { log: string } | undefined;
    if (row === undefined || entries.length === 0) return false;
    const kept = JSON.parse(row.log) as GameLogData;
    const truncated = kept.truncated === true || entries.some(({ type }) => type === 'truncated');
    const log: GameLogData = markDeleted(
      { ...kept, entries: [...kept.entries, ...entries], ...(truncated ? { truncated } : {}) },
      deleted,
    );
    this.#setLog.run(JSON.stringify(log), gameId);
    for (const { playerId, accountId } of players) this.#player.run(gameId, playerId, accountId);
    return true;
  }

  // What it takes to show the replay of a game that finished, for an account that played in it, or
  // null.
  read(accountId: number, gameId: string): KeptGame | null {
    const row = this.#read.get(gameId, accountId) as { game: string; setup: string | null; log: string } | undefined;
    if (row === undefined) return null;
    return {
      game: row.game,
      setup: row.setup === null ? null : (JSON.parse(row.setup) as unknown),
      log: JSON.parse(row.log) as GameLogData,
      players: this.#players.all(gameId) as { playerId: string; accountId: number }[],
    };
  }

  // Forgets who the account was in the games it played in, for an account that is being deleted:
  // its rows in game_players go with it, by their foreign key, and the rest of each game stays.
  // Each log marks the player IDs it had (markDeleted), with what it said kept, as nobody's, and a
  // replay worked out from it shows them as a deleted account. The caller runs this in the
  // transaction that deletes the account.
  forget(accountId: number): void {
    const rows = this.#played.all(accountId) as { gameId: string; log: string; playerIds: string }[];
    for (const { gameId, log, playerIds } of rows) {
      const kept = JSON.parse(log) as GameLogData;
      const marked = markDeleted(kept, JSON.parse(playerIds) as string[]);
      if (marked !== kept) this.#setLog.run(JSON.stringify(marked), gameId);
    }
  }
}

// What the AI players have done in the games that finished (agent_plays, migration 15), for the
// page of each (docs/architecture.md#ai-players), as counts, and what one account has played with
// it. Who else played with it is never read here. What the game counted of each seat is JSON in
// the game's own shape (`feats`, migration 23): the counts of the first game (AgentFeats in
// core/game.ts) are read out of it by their names, and a row of another game, which has none of
// them, adds nothing to them.
export class AgentPlayStore {
  readonly #totals: StatementSync;
  readonly #roles: StatementSync;
  readonly #best: StatementSync;
  readonly #takeovers: StatementSync;
  readonly #withYou: StatementSync;
  readonly #forYou: StatementSync;

  constructor(db: DatabaseSync) {
    // A game counts once; the seats it took in them count one by one, each won or not, since the AI
    // may sit in both groups of one game, as it does in a practice room, where a game won by either
    // of its groups would be won by it.
    this.#totals = db.prepare(
      'SELECT count(DISTINCT game_id) AS games, count(*) AS seats, count(*) FILTER (WHERE won = 1) AS wins, ' +
        "coalesce(sum(json_extract(feats, '$.clues')), 0) AS clues, " +
        "coalesce(sum(json_extract(feats, '$.found')), 0) AS found, " +
        "coalesce(sum(json_extract(feats, '$.reviewer2')), 0) AS reviewer2 " +
        'FROM agent_plays WHERE persona = ? AND takeover = 0',
    );
    this.#roles = db.prepare(
      'SELECT role, count(*) AS seats, count(*) FILTER (WHERE won = 1) AS wins ' +
        'FROM agent_plays WHERE persona = ? AND takeover = 0 GROUP BY role',
    );
    // The earliest of the clues that found the most.
    this.#best = db.prepare(
      "SELECT json_extract(feats, '$.best.word') AS word, json_extract(feats, '$.best.found') AS found " +
        "FROM agent_plays WHERE persona = ? AND takeover = 0 AND json_type(feats, '$.best') = 'object' " +
        'ORDER BY found DESC, rowid LIMIT 1',
    );
    // Games, not people: an AI may play for two people who are offline in one game.
    this.#takeovers = db.prepare(
      'SELECT count(DISTINCT game_id) AS count FROM agent_plays WHERE persona = ? AND takeover = 1',
    );
    // The account's games with the AI in a seat, by whether it was in the account's group.
    this.#withYou = db.prepare(
      'SELECT ' +
        'count(DISTINCT mine.game_id) FILTER (WHERE ai.side = mine.side AND mine.won = 1) AS wonTogether, ' +
        'count(DISTINCT mine.game_id) FILTER (WHERE ai.side = mine.side AND mine.won = 0) AS lostTogether, ' +
        'count(DISTINCT mine.game_id) FILTER (WHERE ai.side <> mine.side AND mine.won = 1) AS beat, ' +
        'count(DISTINCT mine.game_id) FILTER (WHERE ai.side <> mine.side AND mine.won = 0) AS beaten ' +
        'FROM game_records AS mine JOIN agent_plays AS ai ' +
        'ON ai.game_id = mine.game_id AND ai.persona = ? AND ai.takeover = 0 WHERE mine.account_id = ?',
    );
    this.#forYou = db.prepare(
      'SELECT count(DISTINCT game_id) AS count FROM agent_plays WHERE persona = ? AND takeover = 1 AND account_id = ?',
    );
  }

  // What the AI has done, without who played with it, and what it has played with the account, if
  // one asks.
  profile(persona: string, accountId: number | null): Omit<AgentProfileView, 'persona' | 'number' | 'live'> {
    const totals = this.#totals.get(persona) as {
      games: number;
      seats: number;
      wins: number;
      clues: number;
      found: number;
      reviewer2: number;
    };
    const roles: AgentProfileView['roles'] = { captain: { seats: 0, wins: 0 }, guesser: { seats: 0, wins: 0 } };
    for (const { role, seats, wins } of this.#roles.all(persona) as { role: string; seats: number; wins: number }[]) {
      if (role === 'captain' || role === 'guesser') roles[role] = { seats, wins };
    }
    const best = (this.#best.get(persona) as { word: string; found: number } | undefined) ?? null;
    const takeovers = (this.#takeovers.get(persona) as { count: number }).count;
    let you: AgentProfileView['you'] = null;
    if (accountId !== null) {
      const together = this.#withYou.get(persona, accountId) as Omit<NonNullable<AgentProfileView['you']>, 'takenOver'>;
      const takenOver = (this.#forYou.get(persona, accountId) as { count: number }).count;
      you = { ...together, takenOver };
    }
    return { ...totals, roles, takeovers, best, you };
  }
}
