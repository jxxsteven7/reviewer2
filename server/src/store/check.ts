import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  AGENT_PERSONAS,
  CONTRIBUTION_KINDS,
  FEEDBACK_KINDS,
  FRIEND_LIMITS,
  GITHUB_ADVISORY,
  GITHUB_LOGIN,
  HANDLE,
  isContent,
  isLanguage,
  MATCH_TITLES,
  matchGamesValid,
  MAX_ROOM_SETUP,
  RECORDS_NOTICE_VERSION,
  usernameKey,
  type Language,
} from '@reviewer2/shared';
import { AVATAR_FILE } from '../accounts/avatars';
import type { AgentLogData } from '../core/agentLog';
import { knownTitles, type GameModule } from '../core/game';
import type { GameLogData } from '../core/gameLog';
import { DEFAULT_FEEDBACK_LIMITS } from './feedback';
import { countedUnder, countGames, countMatches, HeldRecords } from './recount';
import { DEFAULT_SESSION_LIMITS } from './sessions';
import { SNAPSHOT_MS } from './snapshots';

// The check of the data (docs/rules/constraints.md#data, `admin.cjs data check`): every rule that
// the code takes for granted of what the database holds, and that the schema alone can't make
// sure of, held against every row, so that the operator can see that every row is in the newest
// format before the first public release and after every migration since. It reads and never
// writes. A rule finds the rows that break it, by their ids and nothing else: no name, no text, no
// contact, so that what it prints can be passed on. What the schema makes sure of, as the foreign
// keys from every row of a game's data to the record of its game (migration 24), is checked by
// SQLite's own check alone.
//
// The shapes of a game's own, such as how one of its games began, are the game's to judge
// (GameModule.shapes), and what its records count, the game's to count again (GameModule.recount):
// nothing here names a game.
//
// The rules of time, which the server's housekeeping keeps (main.ts): a contact kept past its 90
// days, a login unused for 30 days or a year old, a link in a mail past its time, and a declined
// friend request past its wait. The housekeeping runs once an hour, so each rule allows an hour
// more than it does: on the server's own data they find nothing, and on a copy of the database
// taken days ago what the server would have cleared since.

// How long a row may be kept past its time before the housekeeping, which runs once an hour, with
// the snapshot (main.ts), clears it.
const HOUSEKEEPING_MS = SNAPSHOT_MS;

export interface DataProblem {
  // The rule, as a sentence.
  rule: string;
  // How many rows break it, and the first few, by id.
  count: number;
  ids: string[];
}

export interface CheckOptions {
  // The games that the server plays, which say what their records hold.
  games: readonly GameModule[];
  // The directory of the avatars, when the check runs where they are.
  avatarDir?: string | null;
  now?: () => number;
}

// How many ids of each rule are kept.
export const IDS_SHOWN = 10;
// How much of the name of an avatar file that no account shows is printed: enough to find the
// file, and not the whole hash of the image.
export const AVATAR_NAME_SHOWN = 8;

type Row = Record<string, unknown>;

// Checks the database, and returns the rules broken, with the rows that break each, or nothing when
// every rule holds.
export function checkData(db: DatabaseSync, { games, avatarDir = null, now = () => Date.now() }: CheckOptions) {
  const problems: DataProblem[] = [];
  const found = (rule: string, ids: readonly (string | number)[]) => {
    if (ids.length > 0) problems.push({ rule, count: ids.length, ids: ids.slice(0, IDS_SHOWN).map(String) });
  };
  // A rule as SQL: the ids of the rows that break it, from a statement that selects them alone.
  const sql = (rule: string, statement: string, ...values: (string | number)[]) =>
    found(
      rule,
      (db.prepare(statement).all(...values) as Row[]).map((row) => Object.values(row)[0] as string | number),
    );
  // A rule in code: the ids of the rows, read whole, that `broken` finds.
  const each = (rule: string, statement: string, broken: (row: Row) => boolean) =>
    found(
      rule,
      (db.prepare(statement).all() as Row[]).filter((row) => broken(row)).map((row) => row.id as string | number),
    );
  const iso = (ms: number) => new Date(ms).toISOString();
  const moment = now();
  const known = new Map(games.map((game) => [game.id, game]));

  // SQLite's own checks.
  const integrity = (db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]).map(
    (row) => row.integrity_check,
  );
  if (integrity.join() !== 'ok') found('the file fails the integrity check', integrity);
  found(
    'rows point at nothing',
    (db.prepare('PRAGMA foreign_key_check').all() as { table: string; rowid: number | null }[]).map(
      ({ table, rowid }) => (rowid === null ? table : `${table}#${rowid}`),
    ),
  );

  // Accounts.
  each(
    'accounts whose handle is not twelve hexadecimal digits',
    'SELECT id, handle FROM accounts',
    ({ handle }) => !HANDLE.test(String(handle)),
  );
  each(
    'accounts whose key is not that of their username',
    'SELECT id, username, username_key AS key FROM accounts',
    ({ username, key }) => usernameKey(String(username)) !== key,
  );
  each(
    'accounts whose last room setup is not in its shape',
    'SELECT id, room_setup AS setup FROM accounts WHERE room_setup IS NOT NULL',
    ({ setup }) => !isRoomSetup(parse(setup), known),
  );
  sql(
    'accounts that agreed to no version of the records notice there is',
    'SELECT id FROM accounts WHERE consent_version < 1 OR consent_version > ?',
    RECORDS_NOTICE_VERSION,
  );
  each(
    'accounts whose avatar is not named as an avatar file is',
    'SELECT id, avatar FROM accounts WHERE avatar IS NOT NULL',
    ({ avatar }) => !AVATAR_FILE.test(String(avatar)),
  );
  if (avatarDir !== null) {
    each(
      'accounts whose avatar file is missing',
      'SELECT id, avatar FROM accounts WHERE avatar IS NOT NULL',
      ({ avatar }) => !existsSync(join(avatarDir, String(avatar))),
    );
    // A file that no account shows, which the server clears away as it starts (Accounts.clearAvatars),
    // named by the start of its name alone.
    const shown = new Set(
      (db.prepare('SELECT avatar FROM accounts WHERE avatar IS NOT NULL').all() as Row[]).map((row) =>
        String(row.avatar),
      ),
    );
    found(
      'avatar files that no account shows',
      readdirSync(avatarDir)
        .filter((name) => AVATAR_FILE.test(name) && !shown.has(name))
        .map((name) => name.slice(0, AVATAR_NAME_SHOWN)),
    );
  }

  // The record of every game (docs/architecture.md#game-records), and the replay of each that
  // finished (docs/architecture.md#replays): every rule of them in one pass, a game at a time, since
  // the logs are most of the database and all of them at once would be too much to hold.
  const unplayed: string[] = [];
  const badFields: string[] = [];
  const badJson: string[] = [];
  const badSetup: string[] = [];
  const badLogs: string[] = [];
  const fewGuests: string[] = [];
  const unnumbered: string[] = [];
  const badAgentLogs: string[] = [];
  const agentLogsWithoutAgents: string[] = [];
  const noReplay: string[] = [];
  const replays = db.prepare(
    'SELECT game_id AS id, game, ending, log, setup, agent_log AS agentLog, fields, guests, agents, takeover, ' +
      'match_id AS matchId, language FROM replays',
  );
  const players = db.prepare('SELECT player_id AS playerId FROM game_players WHERE game_id = ?');
  for (const row of replays.iterate() as Iterable<Row>) {
    const id = String(row.id);
    const module = known.get(String(row.game));
    if (module === undefined) unplayed.push(id);
    const fields = parse(row.fields);
    if (!Array.isArray(fields) || fields.some((field) => typeof field !== 'string')) badFields.push(id);
    const setup = parse(row.setup);
    const agentLog = parse(row.agentLog);
    if (setup === BAD || agentLog === BAD) badJson.push(id);
    else if (module?.shapes && !module.shapes.setup(setup)) badSetup.push(id);
    if (agentLog !== BAD && agentLog !== null) {
      if (!isAgentLog(agentLog, id)) badAgentLogs.push(id);
      if (Number(row.agents) === 0 && Number(row.takeover) === 0) agentLogsWithoutAgents.push(id);
    }
    const log = parse(row.log);
    if (!isGameLog(log, String(row.game), id)) {
      badLogs.push(id);
      continue;
    }
    if (new Set(Object.values(log.guests ?? {})).size < Number(row.guests)) fewGuests.push(id);
    if (row.matchId !== null) {
      const numbers = log.match?.numbers ?? {};
      const ids = (players.all(id) as { playerId: string }[]).map(({ playerId }) => playerId);
      if (log.match === undefined || ids.some((playerId) => numbers[playerId] === undefined)) unnumbered.push(id);
    }
    if (row.ending !== 'finished' || module?.showReplay === undefined) continue;
    try {
      const kept = { setup, log, language: row.language as Language, accounts: new Map(), viewer: new Set<string>() };
      if (module.showReplay(kept) === null) noReplay.push(id);
    } catch {
      noReplay.push(id);
    }
  }
  found('games of a game that this server does not play', unplayed);
  each(
    'games whose language is not one there is',
    'SELECT game_id AS id, language FROM replays',
    ({ language }) => !isLanguage(language),
  );
  found('games whose fields are not a JSON list of names', badFields);
  found('games whose setup or AI log is not JSON', badJson);
  found("games whose setup is not in the game's shape", badSetup);
  found('games whose log is not in the newest format', badLogs);
  found('games whose log numbers fewer guests than played in them', fewGuests);
  found('games of a match whose log does not number every player in it', unnumbered);
  found('games whose AI log is not in the newest format', badAgentLogs);
  found('games with an AI log that no AI played in', agentLogsWithoutAgents);
  found('finished games whose replay cannot be worked out from their record', noReplay);

  // What accounts keep of the games (docs/architecture.md#accounts), each row against the record
  // of its game, which the foreign keys tie it to, and against what the game counts of the record
  // of the game under the rules of today (recount.ts): who won and how, and whether it brought
  // anybody anything, as the record of the game says it came out, how the game came out for each
  // account, the place, the points, the verdict, the game's own detail and the titles of each
  // record of a game, what each AI did in it, and the place, the total and the title of each record
  // of a match. A game that one side won has its records won on that side and not won on any other;
  // one that no one side won says nothing of its records, and one that brought nobody points has
  // none on its records.
  sql(
    'records of games that disagree with the record of the game',
    'SELECT r.id FROM game_records AS r JOIN replays AS g ON g.game_id = r.game_id ' +
      "WHERE g.ending <> 'finished' OR (g.winner IS NOT NULL AND (r.result = 'won') <> (r.side = g.winner))",
  );
  sql(
    'records of games that brought nobody points, with points',
    'SELECT r.id FROM game_records AS r JOIN replays AS g ON g.game_id = r.game_id ' +
      'WHERE g.scores_nothing = 1 AND r.points <> 0',
  );
  each(
    'records of games in a role the game does not have',
    'SELECT id, game, role FROM game_records',
    ({ game, role }) => {
      const shapes = known.get(String(game))?.shapes;
      return shapes !== undefined && !shapes.role(String(role));
    },
  );
  each(
    "records of games whose detail is not in the game's shape",
    'SELECT id, game, detail FROM game_records',
    ({ game, detail }) => {
      const shapes = known.get(String(game))?.shapes;
      return shapes !== undefined && !shapes.detail(parse(detail));
    },
  );
  sql(
    'records of matches with no game of the match kept',
    'SELECT m.id FROM match_records AS m WHERE NOT EXISTS (SELECT 1 FROM replays AS g ' +
      'WHERE g.match_id = m.match_id AND g.game = m.game)',
  );
  const titles = knownTitles(games);
  found(
    'titles that are not ones there are',
    (
      db
        .prepare('SELECT id FROM titles WHERE title NOT IN (' + titles.map(() => '?').join(', ') + ')')
        .all(...titles) as Row[]
    ).map((row) => String(row.id)),
  );
  each(
    'titles of a game that the game does not bring',
    'SELECT id, game, title FROM titles WHERE game_id IS NOT NULL',
    ({ game, title }) => {
      const module = known.get(String(game));
      return module !== undefined && !(module.titles ?? []).includes(String(title));
    },
  );
  sql(
    "titles of a match that are not a match's",
    'SELECT id FROM titles WHERE match_id IS NOT NULL AND title NOT IN (' +
      MATCH_TITLES.map(() => '?').join(', ') +
      ')',
    ...MATCH_TITLES,
  );
  sql(
    'titles of another game than the record they go with',
    'SELECT t.id FROM titles AS t WHERE ' +
      '(t.match_id IS NOT NULL AND t.game <> (SELECT game FROM match_records AS m ' +
      'WHERE m.match_id = t.match_id AND m.account_id = t.account_id)) OR ' +
      '(t.game_id IS NOT NULL AND t.game <> (SELECT game FROM game_records AS r ' +
      'WHERE r.game_id = t.game_id AND r.account_id = t.account_id))',
  );
  const otherRules: string[] = [];
  const uncounted: string[] = [];
  const miscounted: number[] = [];
  const wrongTitles: number[] = [];
  const misranked: number[] = [];
  const wrongMatchTitles: number[] = [];
  const misplayed: string[] = [];
  const wrongOutcomes: string[] = [];
  const held = new HeldRecords(db);
  for (const module of games) {
    if (module.recount === undefined) continue;
    const counted = countGames(db, module);
    const gameCount = counted.counted.length + counted.uncounted.length;
    if (gameCount > 0 && module.rulesVersion !== undefined && countedUnder(db, module.id) !== module.rulesVersion) {
      otherRules.push(module.id);
    }
    uncounted.push(...counted.uncounted.map(({ gameId }) => gameId));
    for (const game of counted.counted) {
      if (held.outcomeDiffers(game)) wrongOutcomes.push(game.gameId);
      for (const { id, count, fact, counted: differs, titles } of held.game(game)) {
        if (!count || fact || differs) miscounted.push(id);
        if (titles) wrongTitles.push(id);
      }
      for (const { playerId, count, fact, counted: differs } of held.plays(game)) {
        if (!count || fact || differs) misplayed.push(`${game.gameId}:${playerId}`);
      }
    }
    // The records of a match whose games are all kept and counted, against what they add up to; a
    // match with no game kept, or with a game that can't be counted, is reported as such above.
    const matches = countMatches(counted.counted);
    const uncountable = new Set(counted.uncounted.map(({ matchId }) => matchId));
    const kept = new Set(
      (
        db
          .prepare('SELECT DISTINCT match_id AS id FROM replays WHERE game = ? AND match_id IS NOT NULL')
          .all(module.id) as Row[]
      ).map((row) => String(row.id)),
    );
    const matchIds = new Set(
      (db.prepare('SELECT DISTINCT match_id AS id FROM match_records WHERE game = ?').all(module.id) as Row[]).map(
        (row) => String(row.id),
      ),
    );
    for (const matchId of matchIds) {
      if (!kept.has(matchId) || uncountable.has(matchId)) continue;
      for (const { id, standing, counted: differs, title } of held.match(matchId, matches.get(matchId) ?? null)) {
        if (!standing || differs) misranked.push(id);
        else if (title) wrongMatchTitles.push(id);
      }
    }
  }
  found("games whose records are counted under other rules than today's", otherRules);
  found('finished games whose records cannot be counted again from their record', uncounted);
  found('finished games whose outcome is not what their record counts', wrongOutcomes);
  found('records of games that are not what their record counts', miscounted);
  found('records of games whose titles are not what their record brings', wrongTitles);
  found('AI plays that are not what the record of their game counts', misplayed);
  found('records of matches that are not what their games add up to', misranked);
  found('records of matches whose title is not what their games award', wrongMatchTitles);

  // What the AI players did (docs/architecture.md#ai-players).
  const play = (statement: string) =>
    `SELECT game_id || ':' || player_id FROM agent_plays AS p ${statement}`.replace(/\s+/g, ' ');
  found(
    'AI plays of a persona there is not',
    (
      db
        .prepare(play('WHERE persona NOT IN (' + AGENT_PERSONAS.map(() => '?').join(', ') + ')'))
        .all(...AGENT_PERSONAS) as Row[]
    ).map((row) => String(Object.values(row)[0])),
  );
  sql(
    'AI plays for someone offline that keep counts, or AI seats with no side, role or result',
    play(
      'WHERE (takeover = 1 AND feats IS NOT NULL) OR ' +
        '(takeover = 0 AND (side IS NULL OR role IS NULL OR result IS NULL))',
    ),
  );
  sql(
    'AI seats in a game whose record counts no AI player',
    play('WHERE takeover = 0 AND (SELECT agents FROM replays AS g WHERE g.game_id = p.game_id) = 0'),
  );
  const plays = "SELECT game_id || ':' || player_id AS id, game, role, feats, takeover FROM agent_plays";
  each("AI seats whose counts are not in the game's shape", plays, ({ game, feats, takeover }) => {
    const shapes = known.get(String(game))?.shapes;
    if (shapes === undefined || Number(takeover) !== 0) return false;
    return shapes.feats ? !shapes.feats(parse(feats)) : feats !== null;
  });
  each('AI plays in a role the game does not have', plays, ({ game, role }) => {
    const shapes = known.get(String(game))?.shapes;
    return shapes !== undefined && role !== null && !shapes.role(String(role));
  });

  // What players said of the games they played (docs/architecture.md#ratings): a rating is one of
  // its game's, of a game that finished, and a guess of who the AI players were is in the game's
  // shape, of a game that finished with AI players in it. A player's rating or guess is named by
  // the game and the player ID.
  const said = (table: string, column: string) =>
    `SELECT game_id || ':' || player_id AS id, game, ${column} AS value FROM ${table}`;
  each("ratings that are not one of their game's", said('ratings', 'rating'), ({ game, value }) => {
    const module = known.get(String(game));
    return module !== undefined && !(value === null || (module.ratings ?? []).includes(String(value)));
  });
  sql(
    'ratings of games that did not finish',
    "SELECT r.game_id || ':' || r.player_id FROM ratings AS r JOIN replays AS g ON g.game_id = r.game_id " +
      "WHERE g.ending <> 'finished'",
  );
  each("guesses of the AI players not in the game's shape", said('ai_guesses', 'guess'), ({ game, value }) => {
    const shapes = known.get(String(game))?.shapes;
    if (shapes === undefined) return false;
    return value !== null && !(shapes.guess?.(parse(value)) ?? false);
  });
  sql(
    'guesses of the AI players of games that did not finish or had none',
    "SELECT a.game_id || ':' || a.player_id FROM ai_guesses AS a JOIN replays AS g ON g.game_id = a.game_id " +
      "WHERE g.ending <> 'finished' OR g.agents = 0",
  );

  // The words that the operator adopted from the games into the word library
  // (docs/architecture.md#content-contributions): of a kind there is, in its shape, of a game that
  // the server plays and that the game they came from is a game of, with what they were in both
  // languages.
  each(
    'adopted words of a kind there is not, or not in its shape',
    'SELECT id, kind, content FROM content_contributions',
    ({ kind, content }) => !isContent(String(kind), parse(content)),
  );
  each(
    'adopted words of a game that this server does not play',
    'SELECT id, game FROM content_contributions',
    ({ game }) => !known.has(String(game)),
  );
  sql(
    'adopted words of another game than the one they came from',
    'SELECT c.id FROM content_contributions AS c JOIN replays AS g ON g.game_id = c.game_id WHERE g.game <> c.game',
  );
  sql(
    'adopted words without what they were in both languages',
    "SELECT id FROM content_contributions WHERE trim(summary_zh) = '' OR trim(summary_en) = ''",
  );

  // The feedback (docs/architecture.md#feedback): what it may be, and what it may have become.
  found(
    'feedback of a kind there is not',
    (
      db
        .prepare('SELECT id FROM feedback WHERE kind NOT IN (' + FEEDBACK_KINDS.map(() => '?').join(', ') + ')')
        .all(...FEEDBACK_KINDS) as Row[]
    ).map((row) => String(row.id)),
  );
  sql(
    'feedback adopted without being an open issue',
    'SELECT id FROM feedback WHERE adopted_at IS NOT NULL AND (issue IS NULL OR closed_at IS NOT NULL OR deleted_at IS NOT NULL)',
  );
  sql(
    'feedback in the trash that is an issue',
    'SELECT id FROM feedback WHERE deleted_at IS NOT NULL AND issue IS NOT NULL',
  );
  // Feedback signed with an account keeps the account and no name, and once the account is deleted
  // neither, since the account goes from it (ON DELETE SET NULL): a contribution from a deleted
  // player (docs/architecture.md#feedback-contributions).
  sql(
    'feedback signed with an account that keeps a name',
    'SELECT id FROM feedback WHERE link_profile = 1 AND credit IS NOT NULL',
  );
  sql(
    'feedback with a pull request but no time for it, or the other way round',
    'SELECT id FROM feedback WHERE (resolved_pr IS NULL) <> (resolved_at IS NULL)',
  );
  sql(
    'feedback with the sentences of a contribution in one language, or without them though adopted, or with them though not',
    'SELECT id FROM feedback WHERE (summary_zh IS NULL) <> (summary_en IS NULL) OR (adopted_at IS NULL) <> (summary_zh IS NULL)',
  );
  // What the housekeeping clears, with the hour it may be behind.
  const cleared = (ms: number) => iso(moment - ms - HOUSEKEEPING_MS);
  sql(
    'feedback with a contact kept past its time',
    'SELECT id FROM feedback WHERE contact IS NOT NULL AND created_at < ?',
    cleared(DEFAULT_FEEDBACK_LIMITS.contactMs),
  );

  // The contributions from GitHub (docs/architecture.md#feedback-contributions), each named by its
  // issue or its advisory: what the code checks as one is adopted, the kind, the username and the
  // advisory's number, and that an issue is a player's feedback or a developer's, never both. The
  // schema makes sure of the rest: one of issue and advisory, the username and the id together, and
  // no name without a username.
  const github = (where: string, column = '') =>
    `SELECT coalesce('#' || issue, advisory) AS id${column} FROM github_contributions ${where}`;
  sql(
    'GitHub contributions of a kind there is not',
    github('WHERE kind NOT IN (' + CONTRIBUTION_KINDS.map(() => '?').join(', ') + ')'),
    ...CONTRIBUTION_KINDS,
  );
  each(
    'GitHub contributions whose username is not a GitHub username',
    github('WHERE login IS NOT NULL', ', login'),
    ({ login }) => !GITHUB_LOGIN.test(String(login)),
  );
  each(
    'GitHub contributions whose advisory is not numbered as one',
    github('WHERE advisory IS NOT NULL', ', advisory'),
    ({ advisory }) => !GITHUB_ADVISORY.test(String(advisory)),
  );
  sql(
    "GitHub contributions of an issue that is a player's feedback",
    github('WHERE issue IN (SELECT issue FROM feedback WHERE issue IS NOT NULL)'),
  );

  // Friends (docs/architecture.md#friends): the line comes with a request and goes with its answer,
  // and the names friends give each other are friends' alone.
  sql(
    'friend requests answered while open, or open though answered',
    "SELECT id FROM friendships WHERE (status = 'pending') <> (answered_at IS NULL)",
  );
  sql(
    'friendships that keep the line of a request answered',
    "SELECT id FROM friendships WHERE status <> 'pending' AND note IS NOT NULL",
  );
  sql(
    'friendships that keep names without being friends',
    "SELECT id FROM friendships WHERE status <> 'accepted' AND (requester_alias IS NOT NULL OR addressee_alias IS NOT NULL)",
  );
  sql(
    'declined friend requests kept past their wait',
    "SELECT id FROM friendships WHERE status = 'declined' AND answered_at <= ?",
    cleared(FRIEND_LIMITS.declineCooldownMs),
  );

  // Logins and the links in mails, which end (docs/architecture.md#accounts). Their rows are
  // named by the account that each is of, never by the hash of the token that is their key: the
  // hashes stand for the tokens in the database, and no command prints them.
  sql(
    'accounts with a login kept past its time',
    'SELECT DISTINCT account_id FROM sessions WHERE used_at <= ? OR created_at <= ?',
    cleared(DEFAULT_SESSION_LIMITS.idleMs),
    cleared(DEFAULT_SESSION_LIMITS.lifetimeMs),
  );
  sql(
    'accounts with a link in a mail kept past its time',
    'SELECT DISTINCT account_id FROM email_tokens WHERE expires_at <= ?',
    cleared(0),
  );

  return problems;
}

// What JSON that can't be read parses to.
const BAD = Symbol('not JSON');

function parse(text: unknown): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(String(text));
  } catch {
    return BAD;
  }
}

const isObject = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

// Whether a value is a map of player IDs to values of one kind, as the log keeps its guests, AI
// players and numbers, or missing.
const ids = (value: unknown, kind: 'string' | 'number') =>
  value === undefined || (isObject(value) && Object.values(value).every((each) => typeof each === kind));

// Whether a log is in the newest format (gameLog.ts), of this game and this game id.
function isGameLog(data: unknown, game: string, gameId: string): data is GameLogData {
  if (!isObject(data) || data.v !== 2 || data.game !== game || data.gameId !== gameId) return false;
  if (!Array.isArray(data.entries) || !(data.start === null || isObject(data.start))) return false;
  const match = data.match;
  return (
    ids(data.agents, 'string') &&
    ids(data.guests, 'number') &&
    (match === undefined ||
      (isObject(match) &&
        match.numbers !== undefined &&
        ids(match.numbers, 'number') &&
        ids(match.merged, 'number') &&
        Object.keys(match).every((key) => key === 'numbers' || key === 'merged'))) &&
    (data.deleted === undefined || isStrings(data.deleted)) &&
    data.entries.every((entry) => isObject(entry) && typeof entry.t === 'number' && typeof entry.type === 'string')
  );
}

// Whether an AI's log is in the newest format (agentLog.ts), of this game id: every step says
// when, which seat, which persona and what it was to do.
function isAgentLog(data: unknown, gameId: string): data is AgentLogData {
  if (!isObject(data) || data.v !== 1 || data.gameId !== gameId || !Array.isArray(data.steps)) return false;
  if (!(data.truncated === undefined || data.truncated === true)) return false;
  return data.steps.every(
    (step) =>
      isObject(step) &&
      typeof step.t === 'number' &&
      typeof step.by === 'string' &&
      AGENT_PERSONAS.includes(step.persona as (typeof AGENT_PERSONAS)[number]) &&
      typeof step.kind === 'string' &&
      (step.takeover === undefined || step.takeover === true) &&
      (step.late === undefined || step.late === true) &&
      (step.error === undefined || typeof step.error === 'string'),
  );
}

// Whether a value is how an account last set up its rooms (RoomSetup in shared/src/accounts.ts): by
// game, each with a room, a practice room or both, in their shapes and no larger than a game's
// setup may be, the game's settings as the game judges them, and the practice room's role, if
// there is one, as one that the game has practice rooms for (GameModule.practice), which need not
// be a role that its records name.
function isRoomSetup(value: unknown, games: ReadonlyMap<string, GameModule>): boolean {
  if (!isObject(value)) return false;
  return Object.entries(value).every(([id, setup]) => {
    const game = games.get(id);
    if (game === undefined || !isObject(setup) || JSON.stringify(setup).length > MAX_ROOM_SETUP) return false;
    const keys = Object.keys(setup);
    if (keys.length === 0 || !keys.every((key) => key === 'room' || key === 'practice')) return false;
    const { room, practice } = setup;
    if (room !== undefined) {
      if (!isObject(room) || !isLanguage(room.language) || !isStrings(room.fields)) return false;
      if (
        typeof room.randomFields !== 'boolean' ||
        typeof room.public !== 'boolean' ||
        typeof room.play !== 'boolean'
      ) {
        return false;
      }
      if (!(room.match === null || isMatchRules(room.match, game))) return false;
      if (room.settings !== undefined && game.shapes !== undefined && !game.shapes.settings(room.settings))
        return false;
      const fields = ['language', 'fields', 'randomFields', 'settings', 'match', 'public', 'play'];
      if (!Object.keys(room).every((key) => fields.includes(key))) return false;
    }
    if (practice !== undefined) {
      if (!isObject(practice) || !isStrings(practice.fields)) return false;
      if (practice.role !== undefined) {
        if (typeof practice.role !== 'string') return false;
        if (game.practice === undefined || game.practice(practice.role) === null) return false;
      }
      if (!Object.keys(practice).every((key) => key === 'role' || key === 'fields')) return false;
    }
    return true;
  });
}

// Whether a value is the rules of a match of the game (MatchRules): the number of games, and the
// game's own options, as the game takes them (MatchHooks.options), or none for a game that has
// none.
const isMatchRules = (value: unknown, game: GameModule): boolean => {
  const hooks = game.match;
  if (!isObject(value) || hooks === undefined || !matchGamesValid(value.games)) return false;
  if (!Object.keys(value).every((key) => key === 'games' || key === 'options')) return false;
  return hooks.options ? hooks.options(value.options) !== null : value.options === undefined;
};
