import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { RECORDS_NOTICE_VERSION, type RecordResult } from '@reviewer2/shared';
import { AccountStore } from './accounts';
import { openDatabase } from './database';
import { FriendStore } from './friends';
import { DUOS_SQL, RecordStore } from './records';
import { keepGame } from '../../test/keptGame';

// What friends have played together (docs/architecture.md#friend-duos), counted from the records
// of the games that both played in, each game apart: teammates on the same side, opponents on
// another, the one who finished in the better place beating the other, friends alone, whenever the
// two played.

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
  const created = accounts.create(name, name.toLowerCase(), 'h', RECORDS_NOTICE_VERSION);
  if (!created) throw new Error(`${name} is taken`);
  return created.id;
};

const befriend = (a: number, b: number) => {
  friends.request(a, b);
  const row = friends.between(a, b);
  if (row) friends.accept(row.id);
};

let games = 0;
// One game, with each account's side, how it came out for them and their place.
function placed(
  players: { accountId: number; side: string; result: RecordResult; place: number }[],
  winner: string | null,
  name = 'keywords',
  agents = false,
) {
  games += 1;
  const gameId = `game-${games}`;
  keepGame(db, gameId, {
    game: name,
    outcome: { winner, reason: 'found' },
    counts: { accounts: 1, guests: 0, agents: agents ? 1 : 0 },
  });
  for (const { accountId, side, result, place } of players) {
    records.add(accountId, { game: name, gameId, side, role: 'guesser', result, place, verdict: 'v', points: 0 });
  }
}

// One game with the accounts on each of its sides, which `winner` won in the first place, every
// other side level in the second; red and blue as a rule, but a game may have more sides.
function game(sides: Record<string, number[]>, winner: string, name = 'keywords', agents = false) {
  const players = Object.entries(sides).flatMap(([side, accounts]) =>
    accounts.map((accountId) =>
      side === winner
        ? { accountId, side, result: 'won' as const, place: 1 }
        : { accountId, side, result: 'lost' as const, place: 2 },
    ),
  );
  placed(players, winner, name, agents);
}

// The duos of an account in the first game alone.
const keywordsDuos = (accountId: number) => records.duos(accountId).get('keywords') ?? new Map();

const NONE = { wonTogether: 0, lostTogether: 0, against: 0, beat: 0, beaten: 0 };

describe('friend duos', () => {
  test('leave out the games that an AI played in, which are on the records all the same', () => {
    const [ann, bob] = [account('Ann'), account('Bob')];
    befriend(ann, bob);
    game({ red: [ann, bob], blue: [] }, 'red', 'keywords', true);
    game({ red: [ann, bob], blue: [] }, 'red', 'keywords', true);
    game({ red: [ann, bob], blue: [] }, 'red');
    expect(records.duos(ann)).toEqual(new Map([['keywords', new Map([[bob, { ...NONE, wonTogether: 1 }]])]]));
    expect(records.counts(ann)).toMatchObject({ keywords: { ordinary: { games: 3, wins: 3 } } });
    expect(records.streaks(ann)).toMatchObject({ keywords: { wins: 1 } });
  });

  test('count the games two friends played together and against each other', () => {
    const [ann, bob, cat] = [account('Ann'), account('Bob'), account('Cat')];
    befriend(ann, bob);
    befriend(cat, ann);
    game({ red: [ann, bob], blue: [cat] }, 'red');
    game({ red: [ann, bob], blue: [cat] }, 'blue');
    game({ red: [ann, cat], blue: [bob] }, 'red');
    game({ red: [ann], blue: [bob, cat] }, 'blue');
    // A game of another kind counts the same, but apart.
    game({ red: [bob], blue: [ann] }, 'red', 'test');
    expect(records.duos(ann)).toEqual(
      new Map([
        [
          'keywords',
          new Map([
            [bob, { wonTogether: 1, lostTogether: 1, against: 2, beat: 1, beaten: 1 }],
            [cat, { wonTogether: 1, lostTogether: 0, against: 3, beat: 1, beaten: 2 }],
          ]),
        ],
        ['test', new Map([[bob, { ...NONE, against: 1, beaten: 1 }]])],
      ]),
    );
    // From Bob's side: Ann is his only friend, and Cat isn't counted.
    expect(keywordsDuos(bob)).toEqual(
      new Map([[ann, { wonTogether: 1, lostTogether: 1, against: 2, beat: 1, beaten: 1 }]]),
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
    expect(keywordsDuos(ann)).toEqual(new Map([[bob, { ...NONE, wonTogether: 1 }]]));
  });

  test('go when the friendship ends, and come back with it', () => {
    const [ann, bob] = [account('Ann'), account('Bob')];
    befriend(ann, bob);
    game({ red: [ann], blue: [bob] }, 'red');
    expect(keywordsDuos(ann).get(bob)).toEqual({ ...NONE, against: 1, beat: 1 });
    const row = friends.between(ann, bob);
    if (row) friends.delete(row.id);
    expect(records.duos(ann)).toEqual(new Map());
    befriend(bob, ann);
    expect(keywordsDuos(ann).get(bob)).toEqual({ ...NONE, against: 1, beat: 1 });
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
    expect(keywordsDuos(ann)).toEqual(
      new Map([
        [bob, { ...NONE, lostTogether: 1 }],
        [cat, { ...NONE, against: 1 }],
        [dan, { ...NONE, against: 1, beaten: 1 }],
      ]),
    );
  });

  test('go by place between opponents, whoever won, and level opponents beat neither', () => {
    const [ann, bob, cat, dan] = [account('Ann'), account('Bob'), account('Cat'), account('Dan')];
    for (const friend of [bob, cat, dan]) befriend(ann, friend);
    // Each for themselves, no one side winning: Bob first, Ann and Cat level second, Dan last.
    placed(
      [
        { accountId: bob, side: 'b', result: 'won', place: 1 },
        { accountId: ann, side: 'a', result: 'lost', place: 2 },
        { accountId: cat, side: 'c', result: 'lost', place: 2 },
        { accountId: dan, side: 'd', result: 'lost', place: 4 },
      ],
      null,
      'test',
    );
    expect(records.duos(ann).get('test')).toEqual(
      new Map([
        [bob, { ...NONE, against: 1, beaten: 1 }],
        [cat, { ...NONE, against: 1 }],
        [dan, { ...NONE, against: 1, beat: 1 }],
      ]),
    );
  });

  test('count a game drawn together as neither won nor lost together, and one drawn against each other as no win', () => {
    const [ann, bob, cat] = [account('Ann'), account('Bob'), account('Cat')];
    befriend(ann, bob);
    befriend(ann, cat);
    placed(
      [
        { accountId: ann, side: 'all', result: 'drawn', place: 1 },
        { accountId: bob, side: 'all', result: 'drawn', place: 1 },
      ],
      null,
      'test',
    );
    placed(
      [
        { accountId: ann, side: 'red', result: 'drawn', place: 1 },
        { accountId: cat, side: 'blue', result: 'drawn', place: 1 },
      ],
      null,
    );
    expect(records.duos(ann)).toEqual(
      new Map([
        ['test', new Map([[bob, NONE]])],
        ['keywords', new Map([[cat, { ...NONE, against: 1 }]])],
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
