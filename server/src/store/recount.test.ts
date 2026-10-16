import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { RECORDS_NOTICE_VERSION } from '@reviewer2/shared';
import { fakeGame } from '../../test/fakeGame';
import { newReplay } from '../../test/keptGame';
import type { GameModule } from '../core/game';
import type { GameLogData } from '../core/gameLog';
import { AccountStore } from './accounts';
import { openDatabase } from './database';
import { RecordStore, ReplayStore, TitleStore } from './records';
import { countedUnder, countGames, countMatches, hasGamesOf, recountDue, recountRecords } from './recount';

// The records counted again from the record of every game (docs/architecture.md#game-records), with
// the fake game of the tests, whose recount gives everyone who came to play the game, with the
// presses in the verdict, a title for whoever said something, and no points.

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

afterEach(() => db.close());

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
      won: true,
      verdict: `pressed ${presses}`,
      points: 0,
    });
  }
}

const records = () =>
  db.prepare('SELECT account_id AS account, game_id AS game, verdict, points FROM game_records ORDER BY id').all();
const titles = () =>
  db
    .prepare('SELECT account_id AS account, title, match_id AS match, game_id AS game, turn FROM titles ORDER BY id')
    .all();
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
    expect(counted.map(({ gameId, records: parts, match }) => [gameId, [...parts], match])).toEqual([
      ['g1', [[ann, { side: 'all', role: 'player', won: true, verdict: 'pressed 1', points: 0, titles: [] }]], null],
      [
        'g2',
        [
          [ann, { side: 'all', role: 'player', won: true, verdict: 'pressed 0', points: 0, titles: [] }],
          [
            bob,
            {
              side: 'all',
              role: 'player',
              won: true,
              verdict: 'pressed 0',
              points: 0,
              titles: [{ title: 'deadline_hero', turn: 1 }],
            },
          ],
        ],
        null,
      ],
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
      won: true,
      verdict: 'pressed 0',
      points: 0,
      titles: [],
    });
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
    records: new Map(),
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
      };
    },
  };

  test('is due for a game whose records were counted under other rules, or never', () => {
    expect(recountDue(db, [fakeGame])).toEqual([fakeGame]);
    expect(hasGamesOf(db, [fakeGame])).toBe(false);
    expect(recountRecords(db, [fakeGame])).toEqual({ games: 0, records: 0, titles: 0, matches: 0 });
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
    new TitleStore(db).awardForGame(bob, 'test', 'deadline_hero', 'g1', 1);
    // A title that the game no longer brings, and one it never did.
    new TitleStore(db).awardForGame(ann, 'test', 'opening_record', 'g2', 2);
    expect(hasGamesOf(db, [fakeGame])).toBe(true);
    expect(recountRecords(db, [otherRules])).toEqual({ games: 2, records: 2, titles: 2, matches: 0 });
    expect(records()).toEqual([
      { account: ann, game: 'g1', verdict: 'pressed 2', points: 2 },
      { account: bob, game: 'g1', verdict: 'pressed 2', points: 2 },
      { account: ann, game: 'g2', verdict: 'pressed 0', points: 0 },
    ]);
    expect(titles()).toEqual([]);
    expect(countedUnder(db, 'test')).toBe(8);
    // Back under the rules of the fake game: the title comes back, with the one Ann's game brings.
    expect(recountRecords(db, [fakeGame])).toEqual({ games: 2, records: 2, titles: 2, matches: 0 });
    expect(titles()).toEqual([
      { account: bob, title: 'deadline_hero', match: null, game: 'g1', turn: 1 },
      { account: ann, title: 'deadline_hero', match: null, game: 'g2', turn: 1 },
    ]);
    expect(records().map(({ points }) => points)).toEqual([0, 0, 0]);
    // Nothing to change leaves everything, and says so.
    expect(recountRecords(db, [fakeGame])).toEqual({ games: 2, records: 0, titles: 0, matches: 0 });
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
    expect(recountRecords(db, [otherRules])).toEqual({ games: 2, records: 5, titles: 0, matches: 1 });
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
    expect(recountRecords(db, [fakeGame])).toEqual({ games: 2, records: 5, titles: 0, matches: 1 });
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
      /disagrees with the log/,
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
    const before = { records: records(), matches: matches(), titles: titles() };
    expect(() => recountRecords(db, [otherRules])).toThrow(message);
    expect({ records: records(), matches: matches(), titles: titles() }).toEqual(before);
    expect(countedUnder(db, 'test')).toBeNull();
  });
});
