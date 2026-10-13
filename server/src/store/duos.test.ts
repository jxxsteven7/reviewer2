import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AccountStore } from './accounts';
import { openDatabase } from './database';
import { FriendStore } from './friends';
import { DUOS_SQL, RecordStore } from './records';

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
// One game with the accounts on each of its sides, which `winner` won; red and blue as a rule, but
// a game may have more sides.
function game(sides: Record<string, number[]>, winner: string, name = 'keywords', agents = false) {
  games += 1;
  const gameId = `game-${games}`;
  for (const [side, players] of Object.entries(sides)) {
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
        agents,
      });
    }
  }
}

const NONE = { wonTogether: 0, lostTogether: 0, against: 0, beat: 0, beaten: 0 };

describe('friend duos', () => {
  test('leave out the games that an AI played in, which are on the records all the same', () => {
    const [ann, bob] = [account('Ann'), account('Bob')];
    befriend(ann, bob);
    game({ red: [ann, bob], blue: [] }, 'red', 'keywords', true);
    game({ red: [ann, bob], blue: [] }, 'red', 'keywords', true);
    game({ red: [ann, bob], blue: [] }, 'red');
    expect(records.duos(ann)).toEqual(new Map([[bob, { ...NONE, wonTogether: 1 }]]));
    expect(records.counts(ann)).toMatchObject({ ordinary: { games: 3, wins: 3 } });
    expect(records.streaks(ann)).toMatchObject({ wins: 1 });
  });

  test('count the games two friends played together and against each other', () => {
    const [ann, bob, cat] = [account('Ann'), account('Bob'), account('Cat')];
    befriend(ann, bob);
    befriend(cat, ann);
    game({ red: [ann, bob], blue: [cat] }, 'red');
    game({ red: [ann, bob], blue: [cat] }, 'blue');
    game({ red: [ann, cat], blue: [bob] }, 'red');
    game({ red: [ann], blue: [bob, cat] }, 'blue');
    // A game of another kind counts the same.
    game({ red: [bob], blue: [ann] }, 'red', 'test');
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
    game({ red: [ann, bob, cat, dan], blue: [] }, 'red');
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
    game({ red: [ann], blue: [bob] }, 'red');
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
    game({ red: [ann, bob], blue: [] }, 'red');
    accounts.delete(bob);
    expect(records.duos(ann)).toEqual(new Map());
  });

  test('count a game of more than two sides by the sides: an opponent who lost beat nobody', () => {
    const [ann, bob, cat, dan] = [account('Ann'), account('Bob'), account('Cat'), account('Dan')];
    for (const friend of [bob, cat, dan]) befriend(ann, friend);
    // Green wins: Ann and Bob lost together, Cat lost against Ann, and Dan beat her.
    game({ red: [ann, bob], blue: [cat], green: [dan] }, 'green');
    expect(records.duos(ann)).toEqual(
      new Map([
        [bob, { ...NONE, lostTogether: 1 }],
        [cat, { ...NONE, against: 1 }],
        [dan, { ...NONE, against: 1, beaten: 1 }],
      ]),
    );
  });

  test('find the others in each game by the index on the game, not by reading every record', () => {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${DUOS_SQL}`).all(1, 1, 1, 1) as { detail: string }[];
    const details = plan.map(({ detail }) => detail).join('\n');
    expect(details).toMatch(/SEARCH mine USING INDEX game_records_recent/);
    expect(details).toMatch(/SEARCH theirs USING INDEX game_records_game/);
    expect(details).not.toMatch(/SCAN (mine|theirs)/);
  });
});
