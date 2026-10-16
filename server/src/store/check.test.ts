import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { FRIEND_LIMITS, RECORDS_NOTICE_VERSION } from '@reviewer2/shared';
import { fakeGame } from '../../test/fakeGame';
import { keywordsGame } from '../games/keywords';
import { AccountStore } from './accounts';
import { checkData, IDS_SHOWN, type DataProblem } from './check';
import { openDatabase } from './database';
import { DEFAULT_FEEDBACK_LIMITS, FeedbackStore } from './feedback';
import { RecordStore, ReplayStore, TitleStore } from './records';
import { DEFAULT_SESSION_LIMITS } from './sessions';

// The check of the data (docs/rules/constraints.md#data): a database with a row of every kind, in
// the newest format, passes every rule, and each rule finds the rows that break it, by id alone.

const NOW = Date.UTC(2026, 9, 16, 12);
const DAY = 24 * 60 * 60_000;

let db: DatabaseSync;

beforeEach(async () => {
  ({ db } = await openDatabase(null));
  const accounts = new AccountStore(db, () => NOW);
  const ann = accounts.create('Ann', 'ann', 'h', RECORDS_NOTICE_VERSION);
  const bob = accounts.create('Bob', 'bob', 'h', RECORDS_NOTICE_VERSION);
  if (!ann || !bob) throw new Error('no account');
  accounts.setRoomSetup(ann.id, '{"room":{"game":"test"}}');
  const replays = new ReplayStore(db, () => NOW);
  const log = (gameId: string, more: object = {}) => ({
    v: 2 as const,
    game: 'test',
    gameId,
    start: { p1: 'player', p2: 'player' },
    entries: [
      { t: 1, by: 'p1', type: 'test:press' },
      { t: 2, by: 'p2', type: 'test:say', said: 'hi' },
      { t: 3, by: null, type: 'end' },
    ],
    ...more,
  });
  const kept = (gameId: string, more: object = {}) => ({
    game: 'test',
    gameId,
    ending: 'finished' as const,
    outcome: { winner: 'all', reason: 'finish' },
    durationMs: 1000,
    setup: { words: ['a', 'b', 'c'] },
    log: log(gameId),
    agentLog: null,
    players: [{ playerId: 'p1', accountId: ann.id }],
    counts: { accounts: 1, guests: 1, agents: 0 },
    takeover: false,
    agentPlays: [],
    match: false,
    practice: false,
    language: 'en',
    fields: ['general'],
    version: 'v',
    rules: 7,
    words: 'w',
    ...more,
  });
  // A game with a guest, one of a match, one with an AI in a seat and playing for Bob, one that was
  // abandoned, and a game with words of the chair's own, which leaves a record alone.
  replays.add(kept('g1', { log: log('g1', { guests: { p2: 1 } }) }));
  replays.add(kept('g2', { match: true, counts: { accounts: 2, guests: 0, agents: 0 } }));
  replays.add(
    kept('g3', {
      log: log('g3', { agents: { a: 'reviewer1' } }),
      agentLog: { steps: [] },
      counts: { accounts: 2, guests: 0, agents: 1 },
      takeover: true,
      agentPlays: [
        {
          playerId: 'a',
          persona: 'reviewer1' as const,
          takeover: false,
          accountId: null,
          side: 'all',
          role: 'player',
          won: true,
          feats: { presses: 2 } as never,
        },
        {
          playerId: 'p2',
          persona: 'reviewer1' as const,
          takeover: true,
          accountId: bob.id,
          side: 'all',
          role: 'player',
          won: true,
          feats: null,
        },
      ],
    }),
  );
  replays.add(
    kept('g4', {
      ending: 'abandoned',
      outcome: null,
      counts: { accounts: 1, guests: 0, agents: 0 },
      log: log('g4', { entries: [{ t: 1, by: null, type: 'end', data: { why: 'empty' } }] }),
    }),
  );
  const records = new RecordStore(db, () => NOW);
  const record = (gameId: string, more: object = {}) => ({
    game: 'test',
    gameId,
    side: 'all',
    role: 'player',
    winner: 'all',
    won: true,
    verdict: 'pressed 1',
    points: 5,
    ...more,
  });
  records.add(ann.id, record('g1'));
  records.add(ann.id, record('g2', { match: { id: 'm1', game: 1, games: 1 } }));
  records.add(bob.id, record('g2', { match: { id: 'm1', game: 1, games: 1 } }));
  records.add(ann.id, record('g3', { points: 0, agents: true }));
  records.add(ann.id, record('custom'));
  records.addMatch(ann.id, {
    game: 'test',
    matchId: 'm1',
    games: 1,
    rank: 1,
    players: 2,
    score: 5,
    title: 'best_paper',
  });
  records.addMatch(bob.id, { game: 'test', matchId: 'm1', games: 1, rank: 2, players: 2, score: 5, title: null });
  const titles = new TitleStore(db, () => NOW);
  titles.award(ann.id, 'test', 'best_paper', 'm1');
  titles.awardForGame(ann.id, 'test', 'opening_record', 'g1', 1);
  const feedback = new FeedbackStore(db, () => NOW);
  const piece = (more: object = {}) =>
    feedback.add({
      kind: 'idea',
      text: 'x',
      contact: null,
      credit: null,
      accountId: null,
      linkProfile: false,
      version: 'v',
      language: 'en',
      page: 'home',
      userAgent: null,
      ...more,
    });
  // Signed with an account and adopted; a guest's with a contact, in the trash; anonymous and
  // resolved by a pull request; closed.
  piece({ accountId: ann.id, linkProfile: true });
  piece({ credit: 'Zed', contact: 'zed@example.com' });
  piece({ accountId: bob.id });
  piece();
  db.exec(`
    UPDATE feedback SET issue = 5, adopted_at = 'now', summary_zh = 'z', summary_en = 'e' WHERE id = 1;
    UPDATE feedback SET deleted_at = 'now' WHERE id = 2;
    UPDATE feedback SET issue = 6, resolved_pr = 7, resolved_at = 'now' WHERE id = 3;
    UPDATE feedback SET closed_at = 'now' WHERE id = 4;
    INSERT INTO friendships (requester_id, addressee_id, status, created_at, note) VALUES (1, 2, 'pending', 'now', 'hi');
    INSERT INTO sessions VALUES (x'01', 1, '${new Date(NOW - DAY).toISOString()}', '${new Date(NOW).toISOString()}');
    INSERT INTO email_tokens VALUES (x'02', 1, 'reset', NULL, '${new Date(NOW + DAY).toISOString()}');
    INSERT INTO likes VALUES (1, 2, 'now');
  `);
  // Feedback signed with an account that was deleted since, which keeps neither the account nor a
  // name: a contribution from a deleted player.
  const cat = accounts.create('Cat', 'cat', 'h', RECORDS_NOTICE_VERSION);
  if (!cat) throw new Error('no account');
  piece({ accountId: cat.id, linkProfile: true });
  db.exec("UPDATE feedback SET issue = 9, adopted_at = 'now', summary_zh = 'z', summary_en = 'e' WHERE id = 5");
  accounts.delete(cat.id);
});

afterEach(() => db.close());

// The server plays the first game and the fake one of the tests.
const check = () => checkData(db, { games: [keywordsGame, fakeGame], now: () => NOW });

// Breaks the data with `sql`, with foreign keys off as a hand's edit might, and gives the one
// problem that the check then finds.
function broken(sql: string): DataProblem {
  db.exec(`PRAGMA foreign_keys = OFF; ${sql}; PRAGMA foreign_keys = ON`);
  const problems = check();
  expect(problems).toHaveLength(1);
  return problems[0] as DataProblem;
}

describe('the check of the data', () => {
  test('passes a database with a row of every kind in the newest format', () => {
    expect(check()).toEqual([]);
  });

  test('finds rows that point at nothing, and a file that fails the integrity check', () => {
    expect(broken('DELETE FROM accounts WHERE id = 2')).toMatchObject({
      rule: 'rows point at nothing',
      ids: expect.arrayContaining(['game_records#3', 'match_records#2', 'friendships#1', 'likes']),
    });
  });

  test.each([
    [
      'accounts whose handle is not twelve hexadecimal digits',
      "UPDATE accounts SET handle = 'ABC' WHERE id = 2",
      ['2'],
    ],
    ['accounts whose key is not that of their username', "UPDATE accounts SET username = 'Bobby' WHERE id = 2", ['2']],
    [
      'accounts whose last room setup is not a JSON object',
      "UPDATE accounts SET room_setup = '[1' WHERE id = 1",
      ['1'],
    ],
    [
      'accounts that agreed to no version of the records notice there is',
      'UPDATE accounts SET consent_version = 9 WHERE id = 1',
      ['1'],
    ],
    [
      'games of a game that this server does not play',
      `UPDATE replays SET game = 'chess', log = json_set(log, '$.game', 'chess') WHERE game_id = 'g4'`,
      ['g4'],
    ],
    [
      'games whose fields are not a JSON list of names',
      "UPDATE replays SET fields = '[1]' WHERE game_id = 'g4'",
      ['g4'],
    ],
    ['games whose setup or AI log is not JSON', "UPDATE replays SET agent_log = '{' WHERE game_id = 'g3'", ['g3']],
    ['games whose log is not in the newest format', `UPDATE replays SET log = '{"v":1}' WHERE game_id = 'g4'`, ['g4']],
    [
      'games whose log numbers fewer guests than played in them',
      `UPDATE replays SET log = json_remove(log, '$.guests') WHERE game_id = 'g1'`,
      ['g1'],
    ],
    [
      'finished games whose replay cannot be worked out from their record',
      `UPDATE replays SET log = json_set(log, '$.entries', json('[]')) WHERE game_id = 'g1'`,
      ['g1'],
    ],
    [
      'records of games that disagree with the record of the game',
      'UPDATE game_records SET won = 0 WHERE id = 1',
      ['1'],
    ],
    [
      'records of games that disagree with the record of the game on whether an AI played',
      'UPDATE game_records SET agents = 0, points = 3 WHERE id = 4',
      ['4'],
    ],
    [
      'records of games that disagree with the record of the game on whether it was in a match',
      "UPDATE replays SET in_match = 1 WHERE game_id = 'g1'",
      ['1'],
    ],
    [
      'records of the first game in a role it does not have',
      "UPDATE game_records SET game = 'keywords', role = 'spectator' WHERE id = 5",
      ['5'],
    ],
    ['players of games that are not kept', "INSERT INTO game_players VALUES ('g9', 'p1', 1)", ['g9:p1']],
    [
      'records of matches with no game of the match on the record',
      "UPDATE match_records SET match_id = 'm2' WHERE id = 2",
      ['2'],
    ],
    [
      'titles of matches that the record of the match does not award',
      "UPDATE match_records SET title = 'black_hole' WHERE id = 1",
      ['1'],
    ],
    ['titles of games that are not on the record', "UPDATE titles SET game_id = 'g9' WHERE id = 2", ['2']],
    [
      'AI plays of games that are not kept, or of another game than the record says',
      "UPDATE agent_plays SET game = 'chess' WHERE player_id = 'p2'",
      ['g3:p2'],
    ],
    [
      'AI plays of a persona there is not',
      "UPDATE agent_plays SET persona = 'reviewer3' WHERE player_id = 'a'",
      ['g3:a'],
    ],
    [
      'AI plays for someone offline that keep counts, or AI seats that keep none, or no side, role or result',
      "UPDATE agent_plays SET feats = '{}' WHERE player_id = 'p2'",
      ['g3:p2'],
    ],
    [
      'AI seats in a game whose record counts no AI player',
      "UPDATE replays SET agents = 0 WHERE game_id = 'g3'",
      ['g3:a'],
    ],
    [
      'AI seats of the first game whose counts are not in its shape',
      'INSERT INTO replays (game_id, game, ended_at, ending, winner, reason, started_at, accounts, guests, agents, ' +
        "takeover, in_match, practice, language, fields, version, rules, words) VALUES ('k1', 'keywords', 'now', " +
        "'finished', 'red', 'found', 'now', 1, 0, 1, 0, 0, 1, 'en', '[]', 'v', 4, 'w'); " +
        "INSERT INTO agent_plays VALUES ('k1', 'z', 'keywords', 'reviewer1', 0, NULL, 'red', 'captain', 1, " +
        `'{"clues":"two","found":0,"reviewer2":0,"best":null}')`,
      ['k1:z'],
    ],
    [
      'AI plays of the first game in a role it does not have',
      'INSERT INTO replays (game_id, game, ended_at, ending, winner, reason, started_at, accounts, guests, agents, ' +
        "takeover, in_match, practice, language, fields, version, rules, words) VALUES ('k1', 'keywords', 'now', " +
        "'finished', 'red', 'found', 'now', 1, 0, 1, 0, 0, 1, 'en', '[]', 'v', 4, 'w'); " +
        "INSERT INTO agent_plays VALUES ('k1', 'z', 'keywords', 'reviewer1', 0, NULL, 'red', 'spectator', 1, " +
        `'{"clues":0,"found":0,"reviewer2":0,"best":null}')`,
      ['k1:z'],
    ],
    ['feedback of a kind there is not', "UPDATE feedback SET kind = 'rant' WHERE id = 4", ['4']],
    ['feedback adopted without being an open issue', 'UPDATE feedback SET issue = NULL WHERE id = 1', ['1']],
    ['feedback in the trash that is an issue', 'UPDATE feedback SET issue = 8 WHERE id = 2', ['2']],
    ['feedback signed with an account that keeps a name', "UPDATE feedback SET credit = 'Ann' WHERE id = 1", ['1']],
    [
      'feedback with a pull request but no time for it, or the other way round',
      'UPDATE feedback SET resolved_at = NULL WHERE id = 3',
      ['3'],
    ],
    [
      'feedback with the sentences of a contribution in one language, or without them though adopted, or with them though not',
      'UPDATE feedback SET summary_en = NULL WHERE id = 1',
      ['1'],
    ],
    [
      'feedback with a contact kept past its time',
      "UPDATE feedback SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = 2",
      ['2'],
    ],
    [
      'friend requests answered while open, or open though answered',
      "UPDATE friendships SET answered_at = 'now' WHERE id = 1",
      ['1'],
    ],
    [
      'friendships that keep the line of a request answered',
      "UPDATE friendships SET status = 'accepted', answered_at = 'now' WHERE id = 1",
      ['1'],
    ],
    [
      'friendships that keep names without being friends',
      "UPDATE friendships SET requester_alias = 'B' WHERE id = 1",
      ['1'],
    ],
    [
      'declined friend requests kept past their wait',
      "UPDATE friendships SET status = 'declined', note = NULL, answered_at = '2026-10-01T00:00:00.000Z' WHERE id = 1",
      ['1'],
    ],
    ['logins kept past their time', "UPDATE sessions SET used_at = '2026-09-01T00:00:00.000Z'", ['01']],
    ['links in mails kept past their time', "UPDATE email_tokens SET expires_at = '2026-10-16T09:00:00.000Z'", ['02']],
  ])('finds %s', (rule, sql, ids) => {
    expect(broken(sql)).toEqual({ rule, count: ids.length, ids });
  });

  test('leaves what ended less than an hour ago to the housekeeping, which runs once an hour', () => {
    const ago = (ms: number) => new Date(NOW - ms - 30 * 60_000).toISOString();
    db.exec(`
      UPDATE feedback SET created_at = '${ago(DEFAULT_FEEDBACK_LIMITS.contactMs)}' WHERE id = 2;
      UPDATE friendships SET status = 'declined', note = NULL, answered_at = '${ago(FRIEND_LIMITS.declineCooldownMs)}';
      UPDATE sessions SET used_at = '${ago(DEFAULT_SESSION_LIMITS.idleMs)}';
      UPDATE email_tokens SET expires_at = '${ago(0)}';
    `);
    expect(check()).toEqual([]);
  });

  test('says how many rows break a rule, and names the first few', () => {
    const many = Array.from({ length: 15 }, (_, i) => `('x${String(i).padStart(2, '0')}', 'p', ${1 + (i % 2)})`).join(
      ', ',
    );
    expect(broken(`INSERT INTO game_players VALUES ${many}`)).toEqual({
      rule: 'players of games that are not kept',
      count: 15,
      ids: Array.from({ length: IDS_SHOWN }, (_, i) => `x${String(i).padStart(2, '0')}:p`),
    });
  });

  test('looks for the avatar files where it is told to', () => {
    db.exec("UPDATE accounts SET avatar = 'missing.webp' WHERE id = 1");
    expect(check()).toEqual([]);
    expect(checkData(db, { games: [keywordsGame, fakeGame], avatarDir: '/nonexistent', now: () => NOW })).toEqual([
      { rule: 'accounts whose avatar file is missing', count: 1, ids: ['1'] },
    ]);
  });
});
