import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  AGENT_PERSONAS,
  FEEDBACK_KINDS,
  FRIEND_LIMITS,
  HANDLE,
  RECORDS_NOTICE_VERSION,
  usernameKey,
} from '@reviewer2/shared';
import type { GameModule } from '../core/game';
import type { GameLogData } from '../core/gameLog';
import { DEFAULT_FEEDBACK_LIMITS } from './feedback';
import { DEFAULT_SESSION_LIMITS } from './sessions';
import { SNAPSHOT_MS } from './snapshots';

// The check of the data (docs/rules/constraints.md#data, `admin.cjs data check`): every rule that
// the code takes for granted of what the database holds, and that the schema alone can't make
// sure of, held against every row, so that the operator can see that every row is in the newest
// format before the first public release and after every migration since. It reads and never
// writes. A rule finds the rows that break it, by their ids and nothing else: no name, no text, no
// contact, so that what it prints can be passed on.
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
    'accounts whose last room setup is not a JSON object',
    'SELECT id, room_setup AS setup FROM accounts WHERE room_setup IS NOT NULL',
    ({ setup }) => !isObject(parse(setup)),
  );
  sql(
    'accounts that agreed to no version of the records notice there is',
    'SELECT id FROM accounts WHERE consent_version < 1 OR consent_version > ?',
    RECORDS_NOTICE_VERSION,
  );
  if (avatarDir !== null) {
    each(
      'accounts whose avatar file is missing',
      'SELECT id, avatar FROM accounts WHERE avatar IS NOT NULL',
      ({ avatar }) => !existsSync(join(avatarDir, String(avatar))),
    );
  }

  // The record of every game (docs/architecture.md#game-records), and the replay of each that
  // finished (docs/architecture.md#replays): every rule of them in one pass, a game at a time, since
  // the logs are most of the database and all of them at once would be too much to hold.
  const known = new Map(games.map((game) => [game.id, game]));
  const unplayed: string[] = [];
  const badFields: string[] = [];
  const badJson: string[] = [];
  const badLogs: string[] = [];
  const fewGuests: string[] = [];
  const noReplay: string[] = [];
  const replays = db.prepare(
    'SELECT game_id AS id, game, ending, log, setup, agent_log AS agentLog, fields, guests FROM replays',
  );
  for (const row of replays.iterate() as Iterable<Row>) {
    const id = String(row.id);
    const module = known.get(String(row.game));
    if (module === undefined) unplayed.push(id);
    const fields = parse(row.fields);
    if (!Array.isArray(fields) || fields.some((field) => typeof field !== 'string')) badFields.push(id);
    const setup = parse(row.setup);
    if (setup === BAD || parse(row.agentLog) === BAD) badJson.push(id);
    if (row.log === null) continue;
    const log = parse(row.log);
    if (!isGameLog(log, String(row.game), id)) {
      badLogs.push(id);
      continue;
    }
    if (new Set(Object.values(log.guests ?? {})).size < Number(row.guests)) fewGuests.push(id);
    if (row.ending !== 'finished' || module?.showReplay === undefined) continue;
    try {
      if (module.showReplay({ setup, log, accounts: new Map(), viewer: new Set() }) === null) noReplay.push(id);
    } catch {
      noReplay.push(id);
    }
  }
  found('games of a game that this server does not play', unplayed);
  found('games whose fields are not a JSON list of names', badFields);
  found('games whose setup or AI log is not JSON', badJson);
  found('games whose log is not in the newest format', badLogs);
  found('games whose log numbers fewer guests than played in them', fewGuests);
  found('finished games whose replay cannot be worked out from their record', noReplay);

  // What accounts keep of the games (docs/architecture.md#accounts), each row against the record
  // of its game, where the game is kept: a game with words of the chair's own leaves records alone.
  sql(
    'records of games that disagree with the record of the game',
    'SELECT r.id FROM game_records AS r JOIN replays AS g ON g.game_id = r.game_id ' +
      "WHERE r.game <> g.game OR g.ending <> 'finished' OR r.winner IS NOT g.winner OR r.won <> (r.side = g.winner)",
  );
  sql(
    'records of games that disagree with the record of the game on whether an AI played',
    'SELECT r.id FROM game_records AS r JOIN replays AS g ON g.game_id = r.game_id ' +
      'WHERE r.agents <> (g.agents > 0 OR g.takeover = 1)',
  );
  sql(
    'records of games that disagree with the record of the game on whether it was in a match',
    'SELECT r.id FROM game_records AS r JOIN replays AS g ON g.game_id = r.game_id ' +
      'WHERE (r.match_id IS NOT NULL) <> (g.in_match = 1)',
  );
  // The roles of the first game, which its records name as the game names its seats: a group's PI
  // (`captain`) and its students (`guesser`), whose games the pages count apart (RecordCounts).
  sql(
    'records of the first game in a role it does not have',
    "SELECT id FROM game_records WHERE game = 'keywords' AND role NOT IN ('captain', 'guesser')",
  );
  sql(
    'players of games that are not kept',
    "SELECT game_id || ':' || player_id FROM game_players WHERE game_id NOT IN (SELECT game_id FROM replays)",
  );
  sql(
    'records of matches with no game of the match on the record',
    'SELECT m.id FROM match_records AS m WHERE NOT EXISTS (SELECT 1 FROM game_records AS r ' +
      'WHERE r.match_id = m.match_id AND r.account_id = m.account_id AND r.game = m.game)',
  );
  sql(
    'titles of matches that the record of the match does not award',
    'SELECT t.id FROM titles AS t WHERE t.match_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM match_records AS m ' +
      'WHERE m.match_id = t.match_id AND m.account_id = t.account_id AND m.game = t.game AND m.title = t.title)',
  );
  sql(
    'titles of games that are not on the record',
    'SELECT t.id FROM titles AS t WHERE t.game_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM game_records AS r ' +
      'WHERE r.game_id = t.game_id AND r.account_id = t.account_id AND r.game = t.game)',
  );

  // What the AI players did (docs/architecture.md#ai-players).
  const play = (statement: string) =>
    `SELECT game_id || ':' || player_id FROM agent_plays AS p ${statement}`.replace(/\s+/g, ' ');
  sql(
    'AI plays of games that are not kept, or of another game than the record says',
    play('WHERE NOT EXISTS (SELECT 1 FROM replays AS g WHERE g.game_id = p.game_id AND g.game = p.game)'),
  );
  found(
    'AI plays of a persona there is not',
    (
      db
        .prepare(play('WHERE persona NOT IN (' + AGENT_PERSONAS.map(() => '?').join(', ') + ')'))
        .all(...AGENT_PERSONAS) as Row[]
    ).map((row) => String(Object.values(row)[0])),
  );
  sql(
    'AI plays for someone offline that keep counts, or AI seats that keep none, or no side, role or result',
    play(
      'WHERE (takeover = 1 AND feats IS NOT NULL) OR ' +
        '(takeover = 0 AND (feats IS NULL OR side IS NULL OR role IS NULL OR won IS NULL))',
    ),
  );
  sql(
    'AI seats in a game whose record counts no AI player',
    play('WHERE takeover = 0 AND (SELECT agents FROM replays AS g WHERE g.game_id = p.game_id) = 0'),
  );
  // The counts of the first game (AgentFeats in core/game.ts), in its shape.
  sql(
    'AI seats of the first game whose counts are not in its shape',
    play(
      "WHERE takeover = 0 AND game = 'keywords' AND NOT (" +
        "json_type(feats, '$.clues') = 'integer' AND json_type(feats, '$.found') = 'integer' AND " +
        "json_type(feats, '$.reviewer2') = 'integer' AND (json_type(feats, '$.best') = 'null' OR " +
        "(json_type(feats, '$.best.word') = 'text' AND json_type(feats, '$.best.found') = 'integer')))",
    ),
  );
  sql(
    'AI plays of the first game in a role it does not have',
    play("WHERE game = 'keywords' AND role IS NOT NULL AND role NOT IN ('captain', 'guesser')"),
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

// Whether a log is in the newest format (gameLog.ts), of this game and this game id.
function isGameLog(data: unknown, game: string, gameId: string): data is GameLogData {
  if (!isObject(data) || data.v !== 2 || data.game !== game || data.gameId !== gameId) return false;
  if (!Array.isArray(data.entries) || !(data.start === null || isObject(data.start))) return false;
  const ids = (value: unknown, kind: 'string' | 'number') =>
    value === undefined || (isObject(value) && Object.values(value).every((each) => typeof each === kind));
  return (
    ids(data.agents, 'string') &&
    ids(data.guests, 'number') &&
    (data.deleted === undefined ||
      (Array.isArray(data.deleted) && data.deleted.every((id) => typeof id === 'string'))) &&
    data.entries.every((entry) => isObject(entry) && typeof entry.t === 'number' && typeof entry.type === 'string')
  );
}
