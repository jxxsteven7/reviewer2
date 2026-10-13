import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AccountStore } from './accounts';
import { openDatabase } from './database';
import { FriendStore } from './friends';
import { RecordStore } from './records';

// What friends have played together (docs/architecture.md#friend-duos), counted from the records
// of the games that both played in: teammates on the same side, opponents on another, friends
// alone, whenever the two played.

let db: DatabaseSync;
let accounts: AccountStore;
let friends: FriendStore;
let records: RecordStore;

beforeEach(async () => {
  ({ db } = await openDatabase(null));
  accounts = new AccountStore(db);
  friends = new FriendStore(db);
  records = new RecordStore(db);
});

afterEach(() => db.close());

const account = (name: string) => {
  const created = accounts.create(name, name.toLowerCase(), 'h');
  if (!created) throw new Error(`${name} is taken`);
  return created.id;
};

const befriend = (a: number, b: number) => {
  friends.request(a, b);
  const row = friends.between(a, b);
  if (row) friends.accept(row.id);
};

let games = 0;
// One game of two sides, red and blue, with the accounts on each, which `winner` won.
function game(red: number[], blue: number[], winner: 'red' | 'blue', name = 'keywords') {
  games += 1;
  const gameId = `game-${games}`;
  for (const [side, players] of [
    ['red', red],
    ['blue', blue],
  ] as const) {
    for (const accountId of players) {
      records.add(accountId, {
        game: name,
        gameId,
        side,
        role: 'guesser',
        winner,
        won: side === winner,
        verdict: 'v',
        points: 0,
      });
    }
  }
}

const NONE = { wonTogether: 0, lostTogether: 0, against: 0, beat: 0, beaten: 0 };

describe('friend duos', () => {
  test('count the games two friends played together and against each other', () => {
    const [ann, bob, cat] = [account('Ann'), account('Bob'), account('Cat')];
    befriend(ann, bob);
    befriend(cat, ann);
    game([ann, bob], [cat], 'red');
    game([ann, bob], [cat], 'blue');
    game([ann, cat], [bob], 'red');
    game([ann], [bob, cat], 'blue');
    // A game of another kind counts the same.
    game([bob], [ann], 'red', 'test');
    expect(records.duos(ann)).toEqual(
      new Map([
        [bob, { wonTogether: 1, lostTogether: 1, against: 3, beat: 1, beaten: 2 }],
        [cat, { wonTogether: 1, lostTogether: 0, against: 3, beat: 1, beaten: 2 }],
      ]),
    );
    // From Bob's side: Ann is his only friend, and Cat isn't counted.
    expect(records.duos(bob)).toEqual(
      new Map([[ann, { wonTogether: 1, lostTogether: 1, against: 3, beat: 2, beaten: 1 }]]),
    );
  });

  test('count friends alone, and games from before they became friends', () => {
    const [ann, bob, cat, dan] = [account('Ann'), account('Bob'), account('Cat'), account('Dan')];
    game([ann, bob, cat, dan], [], 'red');
    // A request that is open, or was declined, makes nobody a friend.
    friends.request(ann, cat);
    friends.request(dan, ann);
    const declined = friends.between(dan, ann);
    if (declined) friends.decline(declined.id);
    expect(records.duos(ann)).toEqual(new Map());
    // Friends since the game: it counts.
    befriend(bob, ann);
    expect(records.duos(ann)).toEqual(new Map([[bob, { ...NONE, wonTogether: 1 }]]));
  });

  test('go when the friendship ends, and come back with it', () => {
    const [ann, bob] = [account('Ann'), account('Bob')];
    befriend(ann, bob);
    game([ann], [bob], 'red');
    expect(records.duos(ann).get(bob)).toEqual({ ...NONE, against: 1, beat: 1 });
    const row = friends.between(ann, bob);
    if (row) friends.delete(row.id);
    expect(records.duos(ann)).toEqual(new Map());
    befriend(bob, ann);
    expect(records.duos(ann).get(bob)).toEqual({ ...NONE, against: 1, beat: 1 });
  });

  test('go with an account that is deleted', () => {
    const [ann, bob] = [account('Ann'), account('Bob')];
    befriend(ann, bob);
    game([ann, bob], [], 'red');
    accounts.delete(bob);
    expect(records.duos(ann)).toEqual(new Map());
  });

  test('find the others in each game by the index on the game, not by reading every record', () => {
    const plan = db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT theirs.account_id FROM game_records AS mine JOIN game_records AS theirs ' +
          'ON theirs.game_id = mine.game_id AND theirs.account_id <> mine.account_id WHERE mine.account_id = ?',
      )
      .all(1) as { detail: string }[];
    const details = plan.map(({ detail }) => detail).join('\n');
    expect(details).toMatch(/game_records_game/);
    expect(details).not.toMatch(/SCAN/);
  });
});
