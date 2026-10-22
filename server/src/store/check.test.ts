import type { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { FRIEND_LIMITS, RECORDS_NOTICE_VERSION } from '@reviewer2/shared';
import { fakeGame } from '../../test/fakeGame';
import { impostorGame } from '../games/impostor';
import { keywordsGame } from '../games/keywords';
import { AccountStore } from './accounts';
import { checkData, IDS_SHOWN, type DataProblem } from './check';
import { ContentStore } from './content';
import { ContributionStore } from './contributions';
import { openDatabase } from './database';
import { DEFAULT_FEEDBACK_LIMITS, FeedbackStore } from './feedback';
import { RecordStore, ReplayStore, TitleStore } from './records';
import { countedUnderKey } from './recount';
import { RatingStore } from './ratings';
import { DEFAULT_SESSION_LIMITS } from './sessions';
import { knownTitles } from '../core/game';

// The check of the data (docs/rules/constraints.md#data): a database with a row of every kind, in
// the newest format, passes every rule, and each rule finds the rows that break it, by id alone.

const NOW = Date.UTC(2026, 9, 16, 12);
const DAY = 24 * 60 * 60_000;
const AVATAR = `${'a'.repeat(64)}.webp`;

let db: DatabaseSync;

beforeEach(async () => {
  ({ db } = await openDatabase(null));
  const accounts = new AccountStore(db, () => NOW);
  const ann = accounts.create('Ann', 'ann', 'h', RECORDS_NOTICE_VERSION);
  const bob = accounts.create('Bob', 'bob', 'h', RECORDS_NOTICE_VERSION);
  if (!ann || !bob) throw new Error('no account');
  accounts.setRoomSetup(
    ann.id,
    JSON.stringify({
      test: {
        room: {
          language: 'en',
          fields: ['general'],
          randomFields: false,
          settings: { level: 2 },
          match: null,
          public: false,
          play: true,
        },
        practice: { role: 'player', fields: ['general'] },
      },
      // A match room of the first game, whose rules of a match have the game's own options.
      keywords: {
        room: {
          language: 'en',
          fields: ['general'],
          randomFields: false,
          match: { games: 3, options: { teams: 'switch', grouping: 'random' } },
          public: false,
          play: true,
        },
      },
    }),
  );
  // Bob has only played with friends, which names no role.
  accounts.setRoomSetup(bob.id, JSON.stringify({ test: { practice: { fields: ['general'] } } }));
  accounts.setAvatar(ann.id, AVATAR);
  const replays = new ReplayStore(db, () => NOW);
  // Ann (p1) and someone else (p2) play; p1 presses once, p2 says something.
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
    scoresNothing: false,
    agentPlays: [],
    match: null,
    inMatch: false,
    practice: false,
    language: 'en',
    fields: ['general'],
    version: 'v',
    rules: 7,
    words: 'w',
    ...more,
  });
  // A game with a guest; the one game of a match, which Bob (p2) played in too, both numbered; a
  // game with an AI in a seat and playing for Bob; and a game that was abandoned.
  replays.add(kept('g1', { log: log('g1', { guests: { p2: 1 } }) }));
  replays.add(
    kept('g2', {
      log: log('g2', { match: { numbers: { p1: 1, p2: 2 } } }),
      players: [
        { playerId: 'p1', accountId: ann.id },
        { playerId: 'p2', accountId: bob.id },
      ],
      match: { id: 'm1', game: 1, games: 1 },
      inMatch: true,
      counts: { accounts: 2, guests: 0, agents: 0 },
    }),
  );
  replays.add(
    kept('g3', {
      log: log('g3', { start: { p1: 'player', p2: 'player', a: 'player' }, agents: { a: 'reviewer1' } }),
      agentLog: { v: 1, gameId: 'g3', steps: [{ t: 1, by: 'a', persona: 'reviewer1', kind: 'press', answer: {} }] },
      counts: { accounts: 2, guests: 0, agents: 1 },
      takeover: true,
      scoresNothing: true,
      agentPlays: [
        {
          playerId: 'a',
          persona: 'reviewer1' as const,
          takeover: false,
          accountId: null,
          side: 'all',
          role: 'player',
          result: 'won' as const,
          place: 1,
          feats: { presses: 1 },
        },
        {
          playerId: 'p2',
          persona: 'reviewer1' as const,
          takeover: true,
          accountId: bob.id,
          side: 'all',
          role: 'player',
          result: 'won' as const,
          place: 1,
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
    result: 'won' as const,
    place: 1,
    verdict: 'pressed 1',
    points: 0,
    ...more,
  });
  records.add(ann.id, record('g1'));
  records.add(ann.id, record('g2'));
  records.add(bob.id, record('g2'));
  records.add(ann.id, record('g3'));
  // Both scored nothing in the match, so both finished first, and the match awarded no title.
  records.addMatch(ann.id, { game: 'test', matchId: 'm1', games: 1, rank: 1, players: 2, score: 0 });
  records.addMatch(bob.id, { game: 'test', matchId: 'm1', games: 1, rank: 1, players: 2, score: 0 });
  // Bob said something in the game of the match, which brings him the title.
  new TitleStore(db, knownTitles([fakeGame, keywordsGame])).awardForGame(bob.id, 'test', 'deadline_hero', 'g2', 1);
  // The records of both games are counted under the rules of today.
  const counted = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const game of [fakeGame, keywordsGame]) counted.run(countedUnderKey(game.id), String(game.rulesVersion));
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
  // The contributions from GitHub: an issue by a named author, and an advisory by one listed
  // anonymously.
  const contributions = new ContributionStore(db, () => NOW);
  contributions.adopt({ ref: { issue: 14 }, kind: 'code', login: 'octocat', githubId: 583231, named: true, summary });
  contributions.adopt({
    ref: { advisory: 'GHSA-24fc-5gmw-5x4j' },
    kind: 'bug',
    login: 'hubot',
    githubId: 2,
    named: false,
    summary,
  });
  // Ann rated the game with a guest good, and the guest dismissed the question; Ann guessed who
  // the AI player of the game with one was, and Bob skipped it.
  const ratings = new RatingStore(db, () => NOW);
  ratings.rate('test', 'g1', 'p1', 'good');
  ratings.rate('test', 'g1', 'p2', null);
  ratings.guess('test', 'g3', 'p1', ['a']);
  ratings.guess('test', 'g3', 'p2', null);
  // Words from the game with a guest, adopted with Ann's name, and others from no game, without.
  const content = new ContentStore(db, () => NOW);
  content.adopt({
    kind: 'words',
    game: 'test',
    gameId: 'g1',
    content: { words: ['Lamp', 'Kite'] },
    accountId: ann.id,
    named: true,
    summary,
  });
  content.adopt({
    kind: 'pair',
    game: 'test',
    gameId: null,
    content: { words: ['Apple', 'Pear'], field: 'general' },
    accountId: null,
    named: false,
    summary,
  });
});

const summary = { zh: 'z', en: 'e' };

afterEach(() => db.close());

// The fake game of the tests, with ratings and guesses of its AI players, as the check reads them.
const ratedGame: typeof fakeGame = {
  ...fakeGame,
  ratings: ['good', 'meh'],
  // Practice rooms, for a player alone.
  practice: (role) => (role === 'player' ? { seat: { type: 'test:sit', payload: null }, agents: [null] } : null),
  shapes: {
    ...(fakeGame.shapes as NonNullable<typeof fakeGame.shapes>),
    guess: (value) => Array.isArray(value) && value.every((id) => typeof id === 'string'),
  },
};

// The server plays the first game and the fake one of the tests.
const check = () => checkData(db, { games: [keywordsGame, ratedGame], now: () => NOW });

// Breaks the data with `sql`, with foreign keys off as a hand's edit might, and gives the problems
// that the check then finds.
function brokenBy(sql: string): DataProblem[] {
  db.exec(`PRAGMA foreign_keys = OFF; ${sql}; PRAGMA foreign_keys = ON`);
  return check();
}

// Breaks the data so that the check finds one problem, and gives it.
function broken(sql: string): DataProblem {
  const problems = brokenBy(sql);
  expect(problems).toHaveLength(1);
  return problems[0] as DataProblem;
}

describe('the check of the data', () => {
  test('passes a database with a row of every kind in the newest format', () => {
    expect(check()).toEqual([]);
  });

  test('finds rows that point at nothing, and a file that fails the integrity check', () => {
    expect(brokenBy('DELETE FROM accounts WHERE id = 2')[0]).toMatchObject({
      rule: 'rows point at nothing',
      ids: expect.arrayContaining(['game_records#3', 'match_records#2', 'titles#1', 'friendships#1', 'likes']),
    });
    expect(brokenBy("DELETE FROM replays WHERE game_id = 'g2'")[0]).toMatchObject({
      rule: 'rows point at nothing',
      ids: expect.arrayContaining(['game_records#2', 'game_records#3', 'game_players#2', 'game_players#3']),
    });
  });

  test.each([
    [
      'accounts whose handle is not twelve hexadecimal digits',
      "UPDATE accounts SET handle = 'ABC' WHERE id = 2",
      ['2'],
    ],
    ['accounts whose key is not that of their username', "UPDATE accounts SET username = 'Bobby' WHERE id = 2", ['2']],
    ['accounts whose last room setup is not in its shape', "UPDATE accounts SET room_setup = '[1' WHERE id = 1", ['1']],
    [
      'accounts whose last room setup is not in its shape',
      `UPDATE accounts SET room_setup = '{"chess":{"room":{}}}' WHERE id = 1`,
      ['1'],
    ],
    [
      'accounts whose last room setup is not in its shape',
      `UPDATE accounts SET room_setup = json_remove(room_setup, '$.test.room.language') WHERE id = 1`,
      ['1'],
    ],
    [
      'accounts whose last room setup is not in its shape',
      `UPDATE accounts SET room_setup = json_set(room_setup, '$.test.room.settings.level', 9) WHERE id = 1`,
      ['1'],
    ],
    [
      'accounts whose last room setup is not in its shape',
      `UPDATE accounts SET room_setup = json_set(room_setup, '$.test.practice.role', 'painter') WHERE id = 1`,
      ['1'],
    ],
    [
      'accounts whose last room setup is not in its shape',
      `UPDATE accounts SET room_setup = json_set(room_setup, '$.test.room.game', 'test') WHERE id = 1`,
      ['1'],
    ],
    [
      'accounts whose last room setup is not in its shape',
      `UPDATE accounts SET room_setup = json_set(room_setup, '$.test.room.fields', json('["${'x'.repeat(4100)}"]')) WHERE id = 1`,
      ['1'],
    ],
    // The rules of a match, whose options the game checks (MatchHooks.options): options it doesn't
    // take, the old shape with the groups beside the games, a number of games there is not, and a
    // match of a game that plays none.
    [
      'accounts whose last room setup is not in its shape',
      `UPDATE accounts SET room_setup = json_set(room_setup, '$.keywords.room.match.options.teams', 'mixed') WHERE id = 1`,
      ['1'],
    ],
    [
      'accounts whose last room setup is not in its shape',
      `UPDATE accounts SET room_setup = json_set(room_setup, '$.keywords.room.match.options.rounds', 2) WHERE id = 1`,
      ['1'],
    ],
    [
      'accounts whose last room setup is not in its shape',
      `UPDATE accounts SET room_setup = json_remove(room_setup, '$.keywords.room.match.options') WHERE id = 1`,
      ['1'],
    ],
    [
      'accounts whose last room setup is not in its shape',
      `UPDATE accounts SET room_setup = json_set(room_setup, '$.keywords.room.match', json('{"games":3,"teams":"switch","grouping":"random"}')) WHERE id = 1`,
      ['1'],
    ],
    [
      'accounts whose last room setup is not in its shape',
      `UPDATE accounts SET room_setup = json_set(room_setup, '$.keywords.room.match.games', 11) WHERE id = 1`,
      ['1'],
    ],
    [
      'accounts whose last room setup is not in its shape',
      `UPDATE accounts SET room_setup = json_set(room_setup, '$.keywords.room.match.rounds', 2) WHERE id = 1`,
      ['1'],
    ],
    [
      'accounts whose last room setup is not in its shape',
      `UPDATE accounts SET room_setup = json_set(room_setup, '$.test.room.match', json('{"games":1}')) WHERE id = 1`,
      ['1'],
    ],
    [
      'accounts that agreed to no version of the records notice there is',
      'UPDATE accounts SET consent_version = 9 WHERE id = 1',
      ['1'],
    ],
    [
      'accounts whose avatar is not named as an avatar file is',
      "UPDATE accounts SET avatar = 'me.png' WHERE id = 1",
      ['1'],
    ],
    [
      'games of a game that this server does not play',
      `UPDATE replays SET game = 'chess', log = json_set(log, '$.game', 'chess') WHERE game_id = 'g4'; ` +
        "UPDATE game_players SET game = 'chess' WHERE game_id = 'g4'",
      ['g4'],
    ],
    [
      'games whose fields are not a JSON list of names',
      "UPDATE replays SET fields = '[1]' WHERE game_id = 'g4'",
      ['g4'],
    ],
    ['games whose setup or AI log is not JSON', "UPDATE replays SET agent_log = '{' WHERE game_id = 'g3'", ['g3']],
    [
      "games whose setup is not in the game's shape",
      `UPDATE replays SET setup = '{"words":[1]}' WHERE game_id = 'g4'`,
      ['g4'],
    ],
    ['games whose log is not in the newest format', `UPDATE replays SET log = '{"v":1}' WHERE game_id = 'g4'`, ['g4']],
    [
      'games whose log is not in the newest format',
      `UPDATE replays SET log = json_set(log, '$.match', json('{"numbers":{"p1":"one"}}')) WHERE game_id = 'g4'`,
      ['g4'],
    ],
    [
      'games whose log numbers fewer guests than played in them',
      `UPDATE replays SET log = json_remove(log, '$.guests') WHERE game_id = 'g1'`,
      ['g1'],
    ],
    [
      'games whose AI log is not in the newest format',
      `UPDATE replays SET agent_log = '{"v":1,"gameId":"g3","steps":[{"t":1}]}' WHERE game_id = 'g3'`,
      ['g3'],
    ],
    [
      'games with an AI log that no AI played in',
      `UPDATE replays SET agent_log = '{"v":1,"gameId":"g4","steps":[]}' WHERE game_id = 'g4'`,
      ['g4'],
    ],
    [
      'records of matches with no game of the match kept',
      "UPDATE match_records SET match_id = 'm2' WHERE id = 2",
      ['2'],
    ],
    ['titles of another game than the record they go with', "UPDATE titles SET game = 'keywords' WHERE id = 1", ['1']],
    [
      'AI plays of a persona there is not',
      "UPDATE agent_plays SET persona = 'reviewer3' WHERE player_id = 'a'",
      ['g3:a'],
    ],
    [
      'AI seats in a game whose record counts no AI player',
      "UPDATE replays SET agents = 0 WHERE game_id = 'g3'; DELETE FROM ai_guesses",
      ['g3:a'],
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
    // A rating or a guess is named by its game and the player ID.
    [
      "ratings that are not one of their game's",
      "UPDATE ratings SET rating = 'awful' WHERE player_id = 'p1'",
      ['g1:p1'],
    ],
    ['ratings of games that did not finish', "UPDATE ratings SET game_id = 'g4' WHERE player_id = 'p1'", ['g4:p1']],
    [
      "guesses of the AI players not in the game's shape",
      "UPDATE ai_guesses SET guess = '[1]' WHERE player_id = 'p1'",
      ['g3:p1'],
    ],
    [
      'guesses of the AI players of games that did not finish or had none',
      "UPDATE ai_guesses SET game_id = 'g1' WHERE player_id = 'p2'",
      ['g1:p2'],
    ],
    [
      'adopted words of a kind there is not, or not in its shape',
      "UPDATE content_contributions SET kind = 'riddle' WHERE id = 1",
      ['1'],
    ],
    [
      'adopted words of a kind there is not, or not in its shape',
      `UPDATE content_contributions SET content = '{"words":["Apple"],"field":"general"}' WHERE id = 2`,
      ['2'],
    ],
    [
      'adopted words of a game that this server does not play',
      "UPDATE content_contributions SET game = 'chess' WHERE id = 2",
      ['2'],
    ],
    [
      'adopted words of another game than the one they came from',
      "UPDATE content_contributions SET game = 'keywords' WHERE id = 1",
      ['1'],
    ],
    [
      'adopted words without what they were in both languages',
      "UPDATE content_contributions SET summary_en = ' ' WHERE id = 2",
      ['2'],
    ],
    // The contributions from GitHub are named by their issue or their advisory.
    [
      'GitHub contributions of a kind there is not',
      "UPDATE github_contributions SET kind = 'rant' WHERE issue = 14",
      ['#14'],
    ],
    [
      'GitHub contributions whose username is not a GitHub username',
      "UPDATE github_contributions SET login = '-octo-' WHERE advisory IS NOT NULL",
      ['GHSA-24fc-5gmw-5x4j'],
    ],
    [
      'GitHub contributions whose advisory is not numbered as one',
      "UPDATE github_contributions SET advisory = 'GHSA-aaaa-bbbb-cccc' WHERE advisory IS NOT NULL",
      ['GHSA-aaaa-bbbb-cccc'],
    ],
    [
      "GitHub contributions of an issue that is a player's feedback",
      'UPDATE github_contributions SET issue = 5 WHERE issue = 14',
      ['#5'],
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
    // Two logins of one account past their time name the account once, and never a token's hash.
    [
      'accounts with a login kept past its time',
      "UPDATE sessions SET used_at = '2026-09-01T00:00:00.000Z'; " +
        "INSERT INTO sessions VALUES (x'03', 1, '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')",
      ['1'],
    ],
    [
      'accounts with a link in a mail kept past its time',
      "UPDATE email_tokens SET expires_at = '2026-10-16T09:00:00.000Z'",
      ['1'],
    ],
  ])('finds %s', (rule, sql, ids) => {
    expect(broken(sql)).toEqual({ rule, count: ids.length, ids });
  });

  // The records against what the games count again from the record of each game (recount.ts).
  test.each([
    [
      "games whose records are counted under other rules than today's",
      `UPDATE settings SET value = '6' WHERE key = '${countedUnderKey('test')}'`,
      ['test'],
    ],
    [
      'records of games that are not what their record counts',
      'UPDATE game_records SET points = 5 WHERE id = 1',
      ['1'],
    ],
    [
      'records of games that are not what their record counts',
      "UPDATE game_records SET verdict = 'pressed 2' WHERE id = 1",
      ['1'],
    ],
    ['records of games whose titles are not what their record brings', 'DELETE FROM titles WHERE id = 1', ['3']],
    [
      'records of games whose titles are not what their record brings',
      "INSERT INTO titles (account_id, game, title, game_id, turn) VALUES (1, 'test', 'deadline_hero', 'g1', 1)",
      ['1'],
    ],
    [
      'records of matches that are not what their games add up to',
      'UPDATE match_records SET rank = 2 WHERE id = 2',
      ['2'],
    ],
    [
      'records of matches whose title is not what their games award',
      "INSERT INTO titles (account_id, game, title, match_id) VALUES (1, 'test', 'best_paper', 'm1')",
      ['1'],
    ],
  ])('finds %s', (rule, sql, ids) => {
    expect(broken(sql)).toEqual({ rule, count: ids.length, ids });
  });

  test("finds a game of a match whose log leaves a player unnumbered, which also can't be counted again", () => {
    for (const path of ['$.match.numbers.p2', '$.match']) {
      expect(brokenBy(`UPDATE replays SET log = json_remove(log, '${path}') WHERE game_id = 'g2'`)).toEqual([
        { rule: 'games of a match whose log does not number every player in it', count: 1, ids: ['g2'] },
        { rule: 'finished games whose records cannot be counted again from their record', count: 1, ids: ['g2'] },
      ]);
    }
  });

  // A record that disagrees with the record of the game, or with the game, on a fact disagrees with
  // what the game counts of it too.
  test.each([
    [
      'records of games that disagree with the record of the game',
      "UPDATE game_records SET result = 'lost', place = 2 WHERE id = 1",
      ['1'],
    ],
    [
      'records of games that brought nobody points, with points',
      'UPDATE game_records SET points = 3 WHERE id = 4',
      ['4'],
    ],
    [
      'records of games in a role the game does not have',
      "UPDATE game_records SET role = 'spectator' WHERE id = 1",
      ['1'],
    ],
  ])('finds %s, and the record not what its record counts', (rule, sql, ids) => {
    expect(brokenBy(sql)).toEqual([
      { rule, count: ids.length, ids },
      { rule: 'records of games that are not what their record counts', count: ids.length, ids },
    ]);
  });

  // What an AI did that is not in the form that agent_plays keeps it in is not what the game
  // counts of it either.
  test.each([
    [
      'AI plays for someone offline that keep counts, or AI seats with no side, role or result',
      "UPDATE agent_plays SET feats = '{}' WHERE player_id = 'p2'",
      ['g3:p2'],
    ],
    [
      'AI plays for someone offline that keep counts, or AI seats with no side, role or result',
      "UPDATE agent_plays SET side = NULL WHERE player_id = 'a'",
      ['g3:a'],
    ],
    [
      "AI seats whose counts are not in the game's shape",
      "UPDATE agent_plays SET feats = NULL WHERE player_id = 'a'",
      ['g3:a'],
    ],
    [
      "AI seats whose counts are not in the game's shape",
      `UPDATE agent_plays SET feats = '{"presses":"two"}' WHERE player_id = 'a'`,
      ['g3:a'],
    ],
    [
      'AI plays in a role the game does not have',
      "UPDATE agent_plays SET role = 'spectator' WHERE player_id = 'a'",
      ['g3:a'],
    ],
  ])('finds %s, and the AI play not what its record counts', (rule, sql, ids) => {
    expect(brokenBy(sql)).toEqual([
      { rule: 'AI plays that are not what the record of their game counts', count: ids.length, ids },
      { rule, count: ids.length, ids },
    ]);
  });

  // What the game counts of each AI player in a seat, and how the game came out for it and for each
  // person it played for, against the count of the game (recount.ts).
  test.each([
    ["UPDATE agent_plays SET result = 'lost', place = 2 WHERE player_id = 'a'", ['g3:a']],
    ["UPDATE agent_plays SET place = 2 WHERE player_id = 'p2'", ['g3:p2']],
    [`UPDATE agent_plays SET feats = '{"presses":3}' WHERE player_id = 'a'`, ['g3:a']],
    ["UPDATE agent_plays SET side = 'other' WHERE player_id = 'a'", ['g3:a']],
    // An AI player in a seat that the log doesn't seat at the end.
    [`UPDATE replays SET log = json_remove(log, '$.start.a') WHERE game_id = 'g3'`, ['g3:a']],
  ])('finds AI plays that are not what the record of their game counts: %s', (sql, ids) => {
    expect(broken(sql)).toEqual({
      rule: 'AI plays that are not what the record of their game counts',
      count: ids.length,
      ids,
    });
  });

  test("finds records whose detail is not in the game's shape, which is not what the record counts either", () => {
    expect(brokenBy(`UPDATE game_records SET detail = '{"presses":1}' WHERE id = 1`)).toEqual([
      { rule: "records of games whose detail is not in the game's shape", count: 1, ids: ['1'] },
      { rule: 'records of games that are not what their record counts', count: 1, ids: ['1'] },
    ]);
  });

  test('finds records of games that are not what their record counts in how the game came out or the place', () => {
    expect(broken('UPDATE game_records SET place = 2 WHERE id = 1')).toEqual({
      rule: 'records of games that are not what their record counts',
      count: 1,
      ids: ['1'],
    });
    // A game that no one side won says nothing of who won it, but its count still does, of the game
    // and of its records.
    expect(
      brokenBy(
        "UPDATE replays SET winner = NULL WHERE game_id = 'g1'; UPDATE game_records SET result = 'drawn' WHERE id = 1",
      ),
    ).toEqual([
      { rule: 'finished games whose outcome is not what their record counts', count: 1, ids: ['g1'] },
      { rule: 'records of games that are not what their record counts', count: 1, ids: ['1'] },
    ]);
  });

  test.each([
    ["UPDATE replays SET winner = NULL WHERE game_id = 'g1'", 'g1'],
    ["UPDATE replays SET reason = 'level' WHERE game_id = 'g1'", 'g1'],
    // An AI played in g3 with no certified version, so it brought nobody anything.
    ["UPDATE replays SET scores_nothing = 0 WHERE game_id = 'g3'", 'g3'],
  ])('finds finished games whose outcome is not what their record counts: %s', (sql, id) => {
    expect(broken(sql)).toEqual({
      rule: 'finished games whose outcome is not what their record counts',
      count: 1,
      ids: [id],
    });
  });

  test('holds no record against a game that no one side won', () => {
    // The fake game under rules by which no one side wins, so that the records say nothing of who
    // won, and the record of each game says so too.
    const level: typeof fakeGame = {
      ...ratedGame,
      recount: (kept) => {
        const count = fakeGame.recount?.(kept) ?? null;
        return count && { ...count, outcome: null };
      },
    };
    const checkLevel = () => checkData(db, { games: [keywordsGame, level], now: () => NOW });
    db.exec("UPDATE replays SET winner = NULL, reason = NULL WHERE game = 'test' AND ending = 'finished'");
    expect(checkLevel()).toEqual([]);
    db.exec("UPDATE game_records SET result = 'drawn' WHERE id = 1");
    expect(checkLevel()).toEqual([
      { rule: 'records of games that are not what their record counts', count: 1, ids: ['1'] },
    ]);
  });

  test("finds titles of a game that the game does not bring, and match titles that are not a match's", () => {
    expect(
      brokenBy(
        "INSERT INTO titles (account_id, game, title, game_id, turn) VALUES (1, 'test', 'opening_record', 'g1', 1)",
      ),
    ).toEqual([
      { rule: 'titles of a game that the game does not bring', count: 1, ids: ['2'] },
      { rule: 'records of games whose titles are not what their record brings', count: 1, ids: ['1'] },
    ]);
    db.exec('DELETE FROM titles WHERE id = 2');
    expect(
      brokenBy("INSERT INTO titles (account_id, game, title, match_id) VALUES (1, 'test', 'deadline_hero', 'm1')"),
    ).toEqual([
      { rule: "titles of a match that are not a match's", count: 1, ids: ['3'] },
      { rule: 'records of matches whose title is not what their games award', count: 1, ids: ['1'] },
    ]);
  });

  test("takes the role of a practice room that the game has, though its records don't name it", () => {
    // The second game's one role in a practice room is a player's; its records name the role that
    // each player was dealt.
    const checked = () => checkData(db, { games: [keywordsGame, ratedGame, impostorGame], now: () => NOW });
    const practice = (role: string) =>
      db.exec(
        `UPDATE accounts SET room_setup = json_set(room_setup, '$.impostor', json('{"practice":{"role":"${role}","fields":["general"]}}')) WHERE id = 1`,
      );
    practice('player');
    expect(checked()).toEqual([]);
    practice('pi');
    expect(checked()).toEqual([{ rule: 'accounts whose last room setup is not in its shape', count: 1, ids: ['1'] }]);
    // A game without practice rooms has no practice role at all.
    const without = { ...ratedGame, practice: undefined };
    expect(checkData(db, { games: [keywordsGame, without], now: () => NOW })).toEqual([
      { rule: 'accounts whose last room setup is not in its shape', count: 1, ids: ['1'] },
    ]);
  });

  test('takes the rules of a match without options for a game whose matches have none, and only those', () => {
    const plain = { ...ratedGame, match: { setup: (data: unknown) => data, score: () => null, lineup: () => [] } };
    const checked = () => checkData(db, { games: [keywordsGame, plain], now: () => NOW });
    db.exec(
      `UPDATE accounts SET room_setup = json_set(room_setup, '$.test.room.match', json('{"games":2}')) WHERE id = 1`,
    );
    expect(checked()).toEqual([]);
    db.exec(
      `UPDATE accounts SET room_setup = json_set(room_setup, '$.test.room.match.options', json('{}')) WHERE id = 1`,
    );
    expect(checked()).toEqual([{ rule: 'accounts whose last room setup is not in its shape', count: 1, ids: ['1'] }]);
  });

  test('finds a game whose language is none', () => {
    expect(brokenBy("UPDATE replays SET language = 'xx' WHERE game_id = 'g1'")).toEqual([
      { rule: 'games whose language is not one there is', count: 1, ids: ['g1'] },
    ]);
  });

  test('finds a game whose record is not JSON, which cannot be counted again', () => {
    expect(brokenBy("UPDATE replays SET log = '{' WHERE game_id = 'g1'")).toEqual([
      { rule: 'games whose log is not in the newest format', count: 1, ids: ['g1'] },
      { rule: 'finished games whose records cannot be counted again from their record', count: 1, ids: ['g1'] },
    ]);
  });

  test('finds a finished game whose replay cannot be worked out, which cannot be counted again either', () => {
    expect(brokenBy(`UPDATE replays SET log = json_set(log, '$.entries', json('[]')) WHERE game_id = 'g1'`)).toEqual([
      { rule: 'finished games whose replay cannot be worked out from their record', count: 1, ids: ['g1'] },
      { rule: 'finished games whose records cannot be counted again from their record', count: 1, ids: ['g1'] },
    ]);
  });

  test('finds a title that is not one, which the record does not bring either', () => {
    expect(brokenBy("UPDATE titles SET title = 'worst_paper'")).toEqual([
      { rule: 'titles that are not ones there are', count: 1, ids: ['1'] },
      { rule: 'titles of a game that the game does not bring', count: 1, ids: ['1'] },
      { rule: 'records of games whose titles are not what their record brings', count: 1, ids: ['3'] },
    ]);
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
    const many = Array.from(
      { length: 15 },
      (_, i) =>
        `('g3', 'x${String(i).padStart(2, '0')}', 'test', 'reviewer3', 0, NULL, 'all', 'player', 'won', 1, '{"presses":1}')`,
    ).join(', ');
    // Players the log doesn't seat either.
    const ids = Array.from({ length: IDS_SHOWN }, (_, i) => `g3:x${String(i).padStart(2, '0')}`);
    expect(brokenBy(`INSERT INTO agent_plays VALUES ${many}`)).toEqual([
      { rule: 'AI plays that are not what the record of their game counts', count: 15, ids },
      { rule: 'AI plays of a persona there is not', count: 15, ids },
    ]);
  });

  test('looks for the avatar files where it is told to, and names a file that no account shows by its start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r2-avatars-'));
    try {
      expect(check()).toEqual([]);
      const found = (problems: DataProblem[]) => problems.filter(({ rule }) => rule.includes('avatar'));
      expect(found(checkData(db, { games: [keywordsGame, ratedGame], avatarDir: dir, now: () => NOW }))).toEqual([
        { rule: 'accounts whose avatar file is missing', count: 1, ids: ['1'] },
      ]);
      writeFileSync(join(dir, AVATAR), '');
      writeFileSync(join(dir, `${'b'.repeat(64)}.jpg`), '');
      writeFileSync(join(dir, 'notes.txt'), '');
      expect(found(checkData(db, { games: [keywordsGame, ratedGame], avatarDir: dir, now: () => NOW }))).toEqual([
        { rule: 'avatar files that no account shows', count: 1, ids: ['bbbbbbbb'] },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
