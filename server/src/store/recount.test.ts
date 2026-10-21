import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RECORDS_NOTICE_VERSION } from '@reviewer2/shared';
import { fakeGame } from '../../test/fakeGame';
import { newReplay } from '../../test/keptGame';
import type { AgentLogData } from '../core/agentLog';
import { knownTitles, type GameModule } from '../core/game';
import type { AgentPlay } from '../core/room';
import type { GameLogData } from '../core/gameLog';
import { AccountStore } from './accounts';
import { openDatabase } from './database';
import { RecordStore, ReplayStore, type NewReplay, TitleStore } from './records';
import { countedUnder, countGames, countMatches, hasGamesOf, keyFor, recountDue, recountRecords } from './recount';

// The records counted again from the record of every game (docs/architecture.md#game-records), with
// the fake game of the tests, whose recount gives everyone who came to play the game, with the
// presses in the verdict, a title for whoever said something, and no points.

// The certified versions of the AI, as the recount sees them (core/agentLog.ts): none, as in the
// code, but in the test that certifies one.
const versions = vi.hoisted(() => ({ certified: [] as { prompt: string; model: string }[] }));
vi.mock('../core/agentLog', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/agentLog')>();
  return { ...original, certifiedPlay: (log: AgentLogData | null) => original.certifiedPlay(log, versions.certified) };
});

let db: DatabaseSync;
let ann: number;
let bob: number;
let cat: number;

beforeEach(async () => {
  ({ db } = await openDatabase(null));
  const accounts = new AccountStore(db);
  const create = (name: string) => {
    const account = accounts.create(name, name.toLowerCase(), 'h', RECORDS_NOTICE_VERSION);
    if (!account) throw new Error(`${name} is taken`);
    return account.id;
  };
  ann = create('Ann');
  bob = create('Bob');
  cat = create('Cat');
});

afterEach(() => {
  db.close();
  versions.certified = [];
});

// A log of the fake game: everyone in `start` as a player, then what happened, then the end.
const logOf = (gameId: string, players: string[], entries: GameLogData['entries'], more: Partial<GameLogData> = {}) =>
  ({
    v: 2,
    game: 'test',
    gameId,
    start: Object.fromEntries(players.map((id) => [id, 'player'])),
    entries: [...entries, { t: 99, by: null, type: 'end' }],
    ...more,
  }) as GameLogData;

// Keeps a finished game of the fake game, with its players by account, and a record for each.
function keep(
  gameId: string,
  players: Record<string, number | null>,
  entries: GameLogData['entries'],
  more: { match?: { id: string; game: number; games: number }; log?: Partial<GameLogData> } = {},
) {
  const replays = new ReplayStore(db);
  const accounts = Object.entries(players).flatMap(([playerId, accountId]) =>
    accountId === null ? [] : [{ playerId, accountId }],
  );
  replays.add(
    newReplay(gameId, {
      game: 'test',
      outcome: { winner: 'all', reason: 'finish' },
      log: logOf(gameId, Object.keys(players), entries, more.log),
      players: accounts,
      counts: { accounts: accounts.length, guests: Object.keys(players).length - accounts.length, agents: 0 },
      match: more.match ?? null,
    }),
  );
  const records = new RecordStore(db);
  const presses = entries.filter(({ type }) => type === 'test:press').length;
  for (const { accountId } of accounts) {
    records.add(accountId, {
      game: 'test',
      gameId,
      side: 'all',
      role: 'player',
      result: 'won',
      place: 1,
      verdict: `pressed ${presses}`,
      points: 0,
    });
  }
}

const records = () =>
  db.prepare('SELECT account_id AS account, game_id AS game, verdict, points FROM game_records ORDER BY id').all();
const results = () =>
  db
    .prepare('SELECT account_id AS account, game_id AS game, result, place, detail FROM game_records ORDER BY id')
    .all();
const plays = () =>
  db
    .prepare(
      'SELECT game_id AS game, player_id AS player, result, place, feats FROM agent_plays ORDER BY game_id, player_id',
    )
    .all();
const titles = () =>
  db
    .prepare('SELECT account_id AS account, title, match_id AS match, game_id AS game, turn FROM titles ORDER BY id')
    .all();
const outcomes = () => db.prepare('SELECT game_id AS game, winner, reason FROM replays ORDER BY game_id').all();
const matches = () =>
  db
    .prepare(
      'SELECT account_id AS account, match_id AS match, games, rank, players, score FROM match_records ORDER BY id',
    )
    .all();

describe('counting a game again', () => {
  test('gives each account its part in the game, and skips games that did not finish or cannot be counted', () => {
    keep('g1', { p1: ann, p2: null }, [
      { t: 1, by: 'p1', type: 'test:press' },
      { t: 2, by: 'p2', type: 'test:say', said: 'hi' },
    ]);
    keep('g2', { p1: ann, p2: bob }, [{ t: 2, by: 'p2', type: 'test:say', said: 'hi' }]);
    new ReplayStore(db).add(newReplay('g3', { game: 'test', ending: 'withdrawn', outcome: null }));
    new ReplayStore(db).add(
      newReplay('g4', {
        game: 'test',
        outcome: { winner: 'all', reason: 'finish' },
        log: logOf('g4', ['p1'], [], { entries: [] }),
      }),
    );
    const { counted, uncounted } = countGames(db, fakeGame);
    const won = { side: 'all', role: 'player', result: 'won', place: 1, detail: null, points: 0 };
    expect(counted.map(({ gameId, records: parts, match }) => [gameId, [...parts], match])).toEqual([
      ['g1', [[ann, { ...won, verdict: 'pressed 1', titles: [] }]], null],
      [
        'g2',
        [
          [ann, { ...won, verdict: 'pressed 0', titles: [] }],
          [bob, { ...won, verdict: 'pressed 0', titles: [{ title: 'deadline_hero', turn: 1 }] }],
        ],
        null,
      ],
    ]);
    // Everyone's part at the end, guests too, and nothing that a person counts as an AI player would.
    const seat = { side: 'all', role: 'player', result: 'won', place: 1, feats: null };
    expect([...(counted[0]?.seats ?? [])]).toEqual([
      ['p1', seat],
      ['p2', seat],
    ]);
    expect(uncounted).toEqual([{ gameId: 'g4', matchId: null, reason: 'log' }]);
  });

  test('gives nobody points or titles in a game that an AI played in', () => {
    new ReplayStore(db).add(
      newReplay('g1', {
        game: 'test',
        outcome: { winner: 'all', reason: 'finish' },
        log: logOf('g1', ['p1', 'a'], [{ t: 1, by: 'p1', type: 'test:say', said: 'hi' }], {
          agents: { a: 'reviewer1' },
        }),
        players: [{ playerId: 'p1', accountId: ann }],
        counts: { accounts: 1, guests: 0, agents: 1 },
      }),
    );
    const { counted } = countGames(db, fakeGame);
    expect(counted[0]?.records.get(ann)).toEqual({
      side: 'all',
      role: 'player',
      result: 'won',
      place: 1,
      verdict: 'pressed 0',
      detail: null,
      points: 0,
      titles: [],
    });
    // What the game counts of the AI player in its seat, as JSON, and nothing of the person.
    expect(counted[0]?.seats.get('a')?.feats).toBe('{"presses":0}');
    expect(counted[0]?.seats.get('p1')?.feats).toBeNull();
  });

  test('knows a game of a match by the numbers in its log, and who was in the room at its end', () => {
    keep(
      'g1',
      { p1: ann, p2: bob, p3: null },
      [
        { t: 1, by: 'p3', type: 'leave' },
        { t: 2, by: 'p4', type: 'join', data: { play: false } },
      ],
      {
        match: { id: 'm1', game: 1, games: 2 },
        log: { guests: { p3: 1, p4: 2 }, match: { numbers: { p1: 1, p2: 2, p3: 3, p4: 4 }, merged: { 3: 4 } } },
      },
    );
    const { counted } = countGames(db, fakeGame);
    expect(counted[0]?.match).toEqual({
      id: 'm1',
      game: 1,
      games: 2,
      points: new Map([
        [1, 0],
        [2, 0],
        [3, 0],
      ]),
      present: new Set([1, 2, 4]),
      merged: new Map([[3, 4]]),
      accounts: new Map([
        [ann, 1],
        [bob, 2],
      ]),
    });
  });

  test('knows an account deleted since by its number in the match, under every ID it had', () => {
    // p2 and p3 were one account, which left and came back, and has deleted itself since; p4 was a
    // guest, whose line went into p5's account.
    keep('g1', { p1: ann, p2: null, p3: null, p4: null, p5: bob }, [{ t: 1, by: 'p3', type: 'test:say', said: 'hi' }], {
      match: { id: 'm1', game: 1, games: 1 },
      log: {
        guests: { p4: 1 },
        match: { numbers: { p1: 1, p2: 2, p3: 2, p4: 3, p5: 4 }, merged: { 3: 4 } },
        deleted: ['p2', 'p3'],
      },
    });
    const log = JSON.parse(db.prepare("SELECT log FROM replays WHERE game_id = 'g1'").get()?.log as string);
    const keyOf = keyFor(
      new Map([
        ['p1', ann],
        ['p5', bob],
      ]),
      log as GameLogData,
    );
    expect(['p1', 'p2', 'p3', 'p4', 'p5', 'p9'].map(keyOf)).toEqual([
      `account:${ann}`,
      'number:2',
      'number:2',
      'guest:1',
      `account:${bob}`,
      'p9',
    ]);
    const { counted } = countGames(db, fakeGame);
    expect(counted[0]?.match?.points).toEqual(
      new Map([
        [1, 0],
        [2, 0],
        [3, 0],
        [4, 0],
      ]),
    );
  });

  test('cannot count a game that cannot be played through, as one whose log does not tell', () => {
    keep('g1', { p1: ann }, []);
    const broken: GameModule = {
      ...fakeGame,
      recount: () => {
        throw new TypeError('no such card');
      },
    };
    expect(countGames(db, broken).uncounted).toEqual([{ gameId: 'g1', matchId: null, reason: 'log' }]);
    // So does one whose record isn't even JSON.
    db.exec("UPDATE replays SET log = '{' WHERE game_id = 'g1'");
    expect(countGames(db, fakeGame).uncounted).toEqual([{ gameId: 'g1', matchId: null, reason: 'log' }]);
  });

  test('cannot count a game of a match whose log numbers nobody who scored', () => {
    keep('g1', { p1: ann, p2: bob }, [], {
      match: { id: 'm1', game: 1, games: 1 },
      log: { match: { numbers: { p1: 1 } } },
    });
    expect(countGames(db, fakeGame).uncounted).toEqual([{ gameId: 'g1', matchId: 'm1', reason: 'numbers' }]);
  });
});

describe('adding up a match', () => {
  // A game of the fake game scores nothing, so the points of each game are given here.
  const game = (
    id: string,
    match: { id: string; game: number; games: number },
    points: [number, number][],
    present: number[],
    accounts: [number, number][],
    merged: [number, number][] = [],
  ) => ({
    gameId: id,
    game: 'test',
    outcome: null,
    scoresNothing: false,
    records: new Map(),
    seats: new Map(),
    match: {
      ...match,
      points: new Map(points),
      present: new Set(present),
      merged: new Map(merged),
      accounts: new Map(accounts),
    },
  });

  test('ranks those who scored and were there at the end by their totals, and awards the titles', () => {
    const counted = countMatches([
      game(
        'g2',
        { id: 'm1', game: 2, games: 2 },
        [
          [1, 2],
          [2, 5],
          [3, -1],
        ],
        [1, 2, 3, 5],
        [
          [ann, 1],
          [bob, 2],
          [cat, 3],
        ],
      ),
      game(
        'g1',
        { id: 'm1', game: 1, games: 2 },
        [
          [1, 4],
          [2, 1],
          [3, 2],
          [4, 9],
        ],
        [1, 2, 3, 4],
        [
          [ann, 1],
          [bob, 2],
          [cat, 3],
        ],
      ),
    ]);
    // Number 4 scored and left; number 5 came and never scored.
    expect([...counted.values()]).toEqual([
      {
        id: 'm1',
        game: 'test',
        games: 2,
        players: 3,
        standings: new Map([
          [ann, { rank: 1, total: 6, title: 'best_paper' }],
          [bob, { rank: 1, total: 6, title: 'best_paper' }],
          [cat, { rank: 3, total: 1, title: 'black_hole' }],
        ]),
      },
    ]);
  });

  test("adds a guest's games to the account's that their line went into", () => {
    const counted = countMatches([
      // Ann played the first game as a guest, number 1, and the second logged in, as number 3,
      // which her guest's line then went into.
      game(
        'g1',
        { id: 'm1', game: 1, games: 2 },
        [
          [1, 4],
          [2, 1],
        ],
        [1, 2],
        [[bob, 2]],
      ),
      game(
        'g2',
        { id: 'm1', game: 2, games: 2 },
        [
          [3, 2],
          [2, 5],
        ],
        [3, 2],
        [
          [ann, 3],
          [bob, 2],
        ],
        [[1, 3]],
      ),
    ]);
    // Level at the top, which awards nobody a title.
    expect(counted.get('m1')?.standings).toEqual(
      new Map([
        [ann, { rank: 1, total: 6, title: null }],
        [bob, { rank: 1, total: 6, title: null }],
      ]),
    );
  });

  test('leaves out a match with fewer games kept than it was to have', () => {
    expect(countMatches([game('g1', { id: 'm1', game: 1, games: 3 }, [[1, 4]], [1], [[ann, 1]])]).size).toBe(0);
  });
});

describe('counting the records again', () => {
  // The fake game under other rules: everyone gets a point for each press, nobody a title.
  const otherRules: GameModule = {
    ...fakeGame,
    rulesVersion: 8,
    recount: (kept) => {
      const count = fakeGame.recount?.(kept) ?? null;
      if (!count) return null;
      const presses = kept.log.entries.filter(({ type }) => type === 'test:press').length;
      return {
        results: count.results.map((result) => ({ ...result, titles: [] })),
        scores: count.scores.map((score) => ({ ...score, points: presses })),
        outcome: count.outcome,
        feats: count.feats,
      };
    },
  };

  test('is due for a game whose records were counted under other rules, or never', () => {
    expect(recountDue(db, [fakeGame])).toEqual([fakeGame]);
    expect(hasGamesOf(db, [fakeGame])).toBe(false);
    expect(recountRecords(db, [fakeGame])).toEqual({
      games: 0,
      outcomes: 0,
      records: 0,
      titles: 0,
      plays: 0,
      matches: 0,
    });
    expect(countedUnder(db, 'test')).toBe(7);
    expect(recountDue(db, [fakeGame])).toEqual([]);
    expect(recountDue(db, [otherRules])).toEqual([otherRules]);
    // A game that counts nothing again is never due.
    expect(recountDue(db, [{ ...fakeGame, recount: undefined }])).toEqual([]);
  });

  test('changes the points, the verdicts and the titles to what the rules of today count, in one transaction', () => {
    keep('g1', { p1: ann, p2: bob }, [
      { t: 1, by: 'p1', type: 'test:press' },
      { t: 2, by: 'p1', type: 'test:press' },
      { t: 3, by: 'p2', type: 'test:say', said: 'hi' },
    ]);
    keep('g2', { p1: ann }, [{ t: 1, by: 'p1', type: 'test:say', said: 'hi' }]);
    new TitleStore(db, knownTitles([fakeGame])).awardForGame(bob, 'test', 'deadline_hero', 'g1', 1);
    // A title that the game no longer brings, and one it never did.
    new TitleStore(db, ['opening_record']).awardForGame(ann, 'test', 'opening_record', 'g2', 2);
    expect(hasGamesOf(db, [fakeGame])).toBe(true);
    expect(recountRecords(db, [otherRules])).toEqual({
      games: 2,
      outcomes: 0,
      records: 2,
      titles: 2,
      plays: 0,
      matches: 0,
    });
    expect(records()).toEqual([
      { account: ann, game: 'g1', verdict: 'pressed 2', points: 2 },
      { account: bob, game: 'g1', verdict: 'pressed 2', points: 2 },
      { account: ann, game: 'g2', verdict: 'pressed 0', points: 0 },
    ]);
    expect(titles()).toEqual([]);
    expect(countedUnder(db, 'test')).toBe(8);
    // Back under the rules of the fake game: the title comes back, with the one Ann's game brings.
    expect(recountRecords(db, [fakeGame])).toEqual({
      games: 2,
      outcomes: 0,
      records: 2,
      titles: 2,
      plays: 0,
      matches: 0,
    });
    expect(titles()).toEqual([
      { account: bob, title: 'deadline_hero', match: null, game: 'g1', turn: 1 },
      { account: ann, title: 'deadline_hero', match: null, game: 'g2', turn: 1 },
    ]);
    expect(records().map(({ points }) => points)).toEqual([0, 0, 0]);
    // Nothing to change leaves everything, and says so.
    expect(recountRecords(db, [fakeGame])).toEqual({
      games: 2,
      outcomes: 0,
      records: 0,
      titles: 0,
      plays: 0,
      matches: 0,
    });
  });

  test('counts the records of matches again from their games, titles included', () => {
    const match = (game: number) => ({ id: 'm1', game, games: 2 });
    keep('g1', { p1: ann, p2: bob }, [{ t: 1, by: 'p1', type: 'test:press' }], {
      match: match(1),
      log: { match: { numbers: { p1: 1, p2: 2 } } },
    });
    keep('g2', { p1: ann, p2: bob, p3: cat }, [{ t: 1, by: 'p1', type: 'test:press' }], {
      match: match(2),
      log: { match: { numbers: { p1: 1, p2: 2, p3: 3 } } },
    });
    const store = new RecordStore(db);
    for (const account of [ann, bob, cat]) {
      store.addMatch(account, { game: 'test', matchId: 'm1', games: 2, rank: 1, players: 3, score: 0 });
    }
    // Under rules that give a point for each press, Ann and Bob have two, Cat one.
    expect(recountRecords(db, [otherRules])).toEqual({
      games: 2,
      outcomes: 0,
      records: 5,
      titles: 0,
      plays: 0,
      matches: 1,
    });
    expect(matches()).toEqual([
      { account: ann, match: 'm1', games: 2, rank: 1, players: 3, score: 2 },
      { account: bob, match: 'm1', games: 2, rank: 1, players: 3, score: 2 },
      { account: cat, match: 'm1', games: 2, rank: 3, players: 3, score: 1 },
    ]);
    expect(titles()).toEqual([
      { account: ann, title: 'best_paper', match: 'm1', game: null, turn: null },
      { account: bob, title: 'best_paper', match: 'm1', game: null, turn: null },
      { account: cat, title: 'black_hole', match: 'm1', game: null, turn: null },
    ]);
    expect(recountRecords(db, [fakeGame])).toEqual({
      games: 2,
      outcomes: 0,
      records: 5,
      titles: 0,
      plays: 0,
      matches: 1,
    });
    expect(matches().map(({ rank, score }) => [rank, score])).toEqual([
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
    expect(titles()).toEqual([]);
  });

  test.each([
    [
      'a record that the log does not give',
      () => db.exec('UPDATE game_records SET account_id = 3 WHERE account_id = 2'),
      /nobody the log seats/,
    ],
    [
      'a record that disagrees with the log on a fact',
      () => db.exec("UPDATE game_records SET role = 'watcher' WHERE account_id = 1"),
      /disagrees with the log on who played where/,
    ],
    [
      'a record that disagrees with the log on the side',
      () => db.exec("UPDATE game_records SET side = 'red' WHERE account_id = 2"),
      /record \d+ of game g1 disagrees with the log on who played where/,
    ],
    [
      'a finished game that cannot be counted',
      () => db.exec(`UPDATE replays SET log = json_set(log, '$.entries', json('[]')) WHERE game_id = 'g1'`),
      /cannot be counted again/,
    ],
    [
      'a record of a match of nobody its games rank',
      () => new RecordStore(db).addMatch(cat, { game: 'test', matchId: 'm1', games: 1, rank: 1, players: 2, score: 0 }),
      /nobody its games rank/,
    ],
  ])('stops, with the database as it was, on %s', (_what, breakIt, message) => {
    keep('g1', { p1: ann, p2: bob }, [{ t: 1, by: 'p1', type: 'test:press' }], {
      match: { id: 'm1', game: 1, games: 1 },
      log: { match: { numbers: { p1: 1, p2: 2 } } },
    });
    const store = new RecordStore(db);
    for (const account of [ann, bob]) {
      store.addMatch(account, { game: 'test', matchId: 'm1', games: 1, rank: 1, players: 2, score: 0 });
    }
    db.exec('PRAGMA foreign_keys = OFF');
    breakIt();
    db.exec('PRAGMA foreign_keys = ON');
    const before = { outcomes: outcomes(), records: records(), matches: matches(), titles: titles() };
    expect(() => recountRecords(db, [otherRules])).toThrow(message);
    expect({ outcomes: outcomes(), records: records(), matches: matches(), titles: titles() }).toEqual(before);
    expect(countedUnder(db, 'test')).toBeNull();
  });

  // The fake game under rules by which no one side wins, the game being level, and it is drawn for
  // everyone, who share the first place, with what each pressed in the detail, and an AI player
  // counts the presses twice.
  const drawnRules: GameModule = {
    ...fakeGame,
    rulesVersion: 9,
    recount: (kept) => {
      const count = fakeGame.recount?.(kept) ?? null;
      if (!count) return null;
      const presses = (playerId: string) =>
        kept.log.entries.filter(({ by, type }) => by === playerId && type === 'test:press').length;
      return {
        results: count.results.map((result) => ({
          ...result,
          result: 'drawn' as const,
          place: 1,
          detail: { mine: presses(result.playerId), all: presses(result.playerId) },
        })),
        scores: count.scores,
        outcome: { winner: null, reason: 'level' },
        feats: (playerId) => ({ presses: 2 * presses(playerId) }),
      };
    },
  };

  test('changes who won and how, how the game came out for each, the place and the detail to what the rules of today count', () => {
    keep('g1', { p1: ann, p2: bob }, [
      { t: 1, by: 'p1', type: 'test:press' },
      { t: 2, by: 'p1', type: 'test:press' },
    ]);
    expect(recountRecords(db, [drawnRules])).toEqual({
      games: 1,
      outcomes: 1,
      records: 2,
      titles: 0,
      plays: 0,
      matches: 0,
    });
    expect(outcomes()).toEqual([{ game: 'g1', winner: null, reason: 'level' }]);
    expect(results()).toEqual([
      { account: ann, game: 'g1', result: 'drawn', place: 1, detail: '{"mine":2,"all":2}' },
      { account: bob, game: 'g1', result: 'drawn', place: 1, detail: '{"mine":0,"all":0}' },
    ]);
    // Back under the rules of the fake game, which counts no detail.
    expect(recountRecords(db, [fakeGame])).toEqual({
      games: 1,
      outcomes: 1,
      records: 2,
      titles: 0,
      plays: 0,
      matches: 0,
    });
    expect(outcomes()).toEqual([{ game: 'g1', winner: 'all', reason: 'finish' }]);
    expect(results()).toEqual([
      { account: ann, game: 'g1', result: 'won', place: 1, detail: null },
      { account: bob, game: 'g1', result: 'won', place: 1, detail: null },
    ]);
  });

  test('takes the same JSON in another order of its keys for no change', () => {
    keep('g1', { p1: ann }, [{ t: 1, by: 'p1', type: 'test:press' }]);
    db.exec(`UPDATE game_records SET result = 'drawn', detail = '{"all":1,"mine":1}'`);
    db.exec("UPDATE replays SET winner = NULL, reason = 'level'");
    expect(recountRecords(db, [drawnRules])).toEqual({
      games: 1,
      outcomes: 0,
      records: 0,
      titles: 0,
      plays: 0,
      matches: 0,
    });
    expect(results()).toEqual([{ account: ann, game: 'g1', result: 'drawn', place: 1, detail: '{"all":1,"mine":1}' }]);
    // A value that is not the same, in whatever order, is a change.
    db.exec(`UPDATE game_records SET detail = '{"all":1,"mine":2}'`);
    expect(recountRecords(db, [drawnRules])).toMatchObject({ records: 1 });
    expect(results()).toEqual([{ account: ann, game: 'g1', result: 'drawn', place: 1, detail: '{"mine":1,"all":1}' }]);
  });

  // A game in which an AI player sat as `a` and pressed once, and an AI played for Bob, `p2`,
  // offline, with what the fake game counted of them.
  function keepWithAgents(changes: Partial<AgentPlay>[] = [], more: Partial<NewReplay> = {}) {
    const won = { side: 'all', role: 'player', result: 'won' as const, place: 1 };
    const agentPlays: AgentPlay[] = [
      { playerId: 'a', persona: 'reviewer1' as const, takeover: false, accountId: null, ...won, feats: { presses: 1 } },
      { playerId: 'p2', persona: 'reviewer1' as const, takeover: true, accountId: bob, ...won, feats: null },
    ].map((play, i) => ({ ...play, ...changes[i] }));
    new ReplayStore(db).add(
      newReplay('g1', {
        game: 'test',
        outcome: { winner: 'all', reason: 'finish' },
        log: logOf('g1', ['p1', 'p2', 'a'], [{ t: 1, by: 'a', type: 'test:press' }], { agents: { a: 'reviewer1' } }),
        players: [
          { playerId: 'p1', accountId: ann },
          { playerId: 'p2', accountId: bob },
        ],
        counts: { accounts: 2, guests: 0, agents: 1 },
        takeover: true,
        agentPlays,
        ...more,
      }),
    );
    const store = new RecordStore(db);
    for (const account of [ann, bob]) {
      store.add(account, {
        game: 'test',
        gameId: 'g1',
        side: 'all',
        role: 'player',
        result: 'won',
        place: 1,
        verdict: 'pressed 1',
        points: 0,
      });
    }
  }

  test('brings points and titles to a game that an AI played in once every answer it gave came from a certified version', () => {
    const version = { prompt: 'test-1', model: 'script' };
    const answered = (note: { prompt: string; model: string }): AgentLogData['steps'][number] => ({
      t: 1,
      by: 'a',
      persona: 'reviewer1',
      kind: 'press',
      answer: { pressed: true },
      note: { ...note, ms: 1 },
    });
    const agentLog = (...notes: { prompt: string; model: string }[]): AgentLogData => ({
      v: 1,
      gameId: 'g1',
      steps: notes.map(answered),
    });
    // Ann said something, and the AI pressed once.
    keepWithAgents([], {
      log: logOf(
        'g1',
        ['p1', 'p2', 'a'],
        [
          { t: 1, by: 'p1', type: 'test:say' },
          { t: 2, by: 'a', type: 'test:press' },
        ],
        { agents: { a: 'reviewer1' } },
      ),
      agentLog: agentLog(version),
    });
    // No version is certified: the game brings nobody a point under rules that give one for each
    // press, nor Ann the title for what she said.
    expect(recountRecords(db, [otherRules])).toMatchObject({ records: 0, titles: 0 });
    expect(records().map(({ points }) => points)).toEqual([0, 0]);
    expect(recountRecords(db, [fakeGame])).toMatchObject({ records: 0, titles: 0 });
    expect(titles()).toEqual([]);
    // The version the AI answered with is certified: the same game brings each a point for the
    // press, and Ann her title.
    versions.certified = [version];
    expect(recountRecords(db, [otherRules])).toMatchObject({ records: 2, titles: 0 });
    expect(records().map(({ points }) => points)).toEqual([1, 1]);
    expect(recountRecords(db, [fakeGame])).toMatchObject({ records: 2, titles: 1 });
    expect(records().map(({ points }) => points)).toEqual([0, 0]);
    expect(titles()).toEqual([{ account: ann, title: 'deadline_hero', match: null, game: 'g1', turn: 1 }]);
    // An answer from another version in the same game takes it all back.
    db.prepare('UPDATE replays SET agent_log = ? WHERE game_id = ?').run(
      JSON.stringify(agentLog(version, { ...version, prompt: 'test-2' })),
      'g1',
    );
    expect(recountRecords(db, [otherRules])).toMatchObject({ records: 0, titles: 1 });
    expect(records().map(({ points }) => points)).toEqual([0, 0]);
    expect(titles()).toEqual([]);
    // An AI log that can't be read certifies nothing, and stops no count.
    db.prepare('UPDATE replays SET agent_log = ? WHERE game_id = ?').run('{"v":1,', 'g1');
    expect(recountRecords(db, [fakeGame])).toMatchObject({ games: 1, records: 0, titles: 0 });
    expect(records().map(({ points }) => points)).toEqual([0, 0]);
    expect(titles()).toEqual([]);
  });

  test('changes how the game came out for each AI seat and each person it played for, and what it counts of a seat', () => {
    keepWithAgents();
    expect(recountRecords(db, [fakeGame])).toEqual({
      games: 1,
      outcomes: 0,
      records: 0,
      titles: 0,
      plays: 0,
      matches: 0,
    });
    expect(recountRecords(db, [drawnRules])).toEqual({
      games: 1,
      outcomes: 1,
      records: 2,
      titles: 0,
      plays: 2,
      matches: 0,
    });
    expect(plays()).toEqual([
      { game: 'g1', player: 'a', result: 'drawn', place: 1, feats: '{"presses":2}' },
      { game: 'g1', player: 'p2', result: 'drawn', place: 1, feats: null },
    ]);
    // The same written another way is no change.
    db.exec(`UPDATE agent_plays SET feats = '{ "presses": 2 }' WHERE player_id = 'a'`);
    expect(recountRecords(db, [drawnRules])).toMatchObject({ plays: 0 });
    expect(recountRecords(db, [fakeGame])).toEqual({
      games: 1,
      outcomes: 1,
      records: 2,
      titles: 0,
      plays: 2,
      matches: 0,
    });
    expect(plays()).toEqual([
      { game: 'g1', player: 'a', result: 'won', place: 1, feats: '{"presses":1}' },
      { game: 'g1', player: 'p2', result: 'won', place: 1, feats: null },
    ]);
  });

  test('gives a person whom the AI played for and who had no part at the end neither result nor place', () => {
    // Cat came to play as p3 and left; the AI played for her before she did.
    keepWithAgents();
    db.exec(
      "INSERT INTO agent_plays (game_id, player_id, game, persona, takeover, account_id) VALUES ('g1', 'p3', 'test', 'reviewer1', 1, 3)",
    );
    expect(recountRecords(db, [drawnRules])).toMatchObject({ plays: 2 });
    expect(plays()).toContainEqual({ game: 'g1', player: 'p3', result: null, place: null, feats: null });
  });

  test.each([
    [
      'as a game ends, but not when the game is counted again',
      {
        ...fakeGame,
        recount: (kept) => {
          const count = fakeGame.recount?.(kept) ?? null;
          if (!count) return null;
          return { results: count.results, scores: count.scores, outcome: count.outcome };
        },
      } satisfies GameModule,
    ],
    ['when a game is counted again, but not as it ends', { ...fakeGame, agentFeats: undefined }],
  ])('stops, with the database as it was, on a game that counts what an AI player did %s', (way, module) => {
    keepWithAgents();
    const before = { outcomes: outcomes(), records: results(), plays: plays() };
    expect(() => recountRecords(db, [module])).toThrow(`the game test counts what an AI player did ${way}`);
    expect({ outcomes: outcomes(), records: results(), plays: plays() }).toEqual(before);
    expect(countedUnder(db, 'test')).toBeNull();
  });

  test.each([
    [
      'an AI seat that disagrees with the log on the side',
      [{ side: 'red' }],
      /what the AI did as or for a in game g1 disagrees with the log on where/,
    ],
    [
      'a person the AI played for who disagrees with the log on the role',
      [{}, { role: 'watcher' }],
      /what the AI did as or for p2 in game g1 disagrees with the log on where/,
    ],
    [
      'an AI player whom the log does not seat at the end',
      [{ playerId: 'z' }],
      /the AI player z of game g1 is in no seat the log ends with/,
    ],
  ])('stops, with the database as it was, on %s', (_what, changes: Partial<AgentPlay>[], message) => {
    keepWithAgents(changes);
    const before = { outcomes: outcomes(), records: results(), plays: plays() };
    expect(() => recountRecords(db, [drawnRules])).toThrow(message);
    expect({ outcomes: outcomes(), records: results(), plays: plays() }).toEqual(before);
    expect(countedUnder(db, 'test')).toBeNull();
  });
});
