import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { RECORDS_NOTICE_VERSION } from '@reviewer2/shared';
import { newReplay } from '../../test/keptGame';
import type { GameLogData } from '../core/gameLog';
import { AccountStore } from './accounts';
import { openDatabase } from './database';
import { ReplayStore } from './records';

// The record of a game (docs/architecture.md#game-records) as the store keeps it, and what the
// groups said after the end added to its log (Room.review()).

let db: DatabaseSync;
let ann: number;
let bob: number;

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
});

afterEach(() => db.close());

const logOf = (gameId: string) =>
  JSON.parse(
    (db.prepare('SELECT log FROM replays WHERE game_id = ?').get(gameId) as { log: string }).log,
  ) as GameLogData;
const playersOf = (gameId: string) =>
  db
    .prepare('SELECT player_id AS id, account_id AS account FROM game_players WHERE game_id = ? ORDER BY player_id')
    .all(gameId);

describe('what the groups said after the end', () => {
  test('goes into the log with the accounts of new player IDs, numbered in the match as they stand now', () => {
    const store = new ReplayStore(db);
    const match = { numbers: { p1: 1, p2: 2 }, merged: { 3: 1 } };
    store.add(
      newReplay('g1', {
        log: { v: 2, game: 'keywords', gameId: 'g1', start: null, match, entries: [{ t: 1, by: null, type: 'end' }] },
        players: [
          { playerId: 'p1', accountId: ann },
          { playerId: 'p2', accountId: bob },
        ],
        match: { id: 'm1', game: 1, games: 1 },
      }),
    );
    // Bob came back under a new ID, p3, with the same number, and Ann's guest line had gone into
    // her account's meanwhile.
    const said = [{ t: 9, by: 'p3', type: 'keywords:say', said: 'gg' }];
    expect(
      store.addToLog('g1', said, [{ playerId: 'p3', accountId: bob }], [], {
        numbers: { p1: 1, p3: 2 },
        merged: { 3: 1, 4: 1 },
      }),
    ).toBe(true);
    expect(logOf('g1')).toMatchObject({
      entries: [{ type: 'end' }, ...said],
      match: { numbers: { p1: 1, p2: 2, p3: 2 }, merged: { 3: 1, 4: 1 } },
    });
    expect(playersOf('g1')).toEqual([
      { id: 'p1', account: ann },
      { id: 'p2', account: bob },
      { id: 'p3', account: bob },
    ]);
    // Outside a match, the log has no numbers, and gets none.
    store.add(newReplay('g2', { players: [{ playerId: 'p1', accountId: ann }] }));
    expect(store.addToLog('g2', said, [], [], null)).toBe(true);
    expect(logOf('g2').match).toBeUndefined();
    // A game that isn't kept gets nothing, and nothing to add adds nothing.
    expect(store.addToLog('g9', said, [], [])).toBe(false);
    expect(store.addToLog('g1', [], [], [])).toBe(false);
  });
});
