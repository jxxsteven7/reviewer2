import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { RECORDS_NOTICE_VERSION } from '@reviewer2/shared';
import { Accounts } from '../accounts/service';
import { impostorGame } from '../games/impostor';
import { AccountStore } from './accounts';
import { ContentStore } from './content';
import { openDatabase } from './database';
import { RatingStore } from './ratings';
import { ReplayStore } from './records';

// What players said of the games they played, and what is worked out of it for the next draw of a
// pair and for the page of a setter (docs/architecture.md#ratings), and the words adopted from the
// games (docs/architecture.md#content-contributions).

const NOW = Date.UTC(2026, 9, 22, 4);
const PATHS = { pair: '$.source.pair', setter: '$.source.setter' };

let db: DatabaseSync;
let accounts: AccountStore;
let replays: ReplayStore;
let ratings: RatingStore;
// When the next game kept ends.
let endsAt = NOW;

beforeEach(async () => {
  ({ db } = await openDatabase(null));
  endsAt = NOW;
  accounts = new AccountStore(db, () => NOW);
  replays = new ReplayStore(db, () => endsAt);
  ratings = new RatingStore(db, () => NOW);
});

afterEach(() => db.close());

const account = (name: string) => {
  const created = accounts.create(name, name.toLowerCase(), 'h', RECORDS_NOTICE_VERSION);
  if (!created) throw new Error(`${name} is taken`);
  return created.id;
};

// A kept game of the second game, or of another, with its pair or its setter, the students' term and
// the Reviewer 2s', and the accounts that took part.
function kept(
  gameId: string,
  source: object,
  players: [string, number][],
  ending = 'finished',
  { game = 'impostor', words = ['Apple', 'Pear'] }: { game?: string; words?: [string, string] } = {},
) {
  replays.add({
    game,
    gameId,
    ending: ending as 'finished',
    outcome: ending === 'finished' ? { winner: 'student', reason: 'caught' } : null,
    durationMs: 1000,
    setup: { words: { student: words[0], reviewer2: words[1] }, source },
    log: { v: 2, game, gameId, start: null, entries: [{ t: 1, by: null, type: 'end' }] },
    agentLog: null,
    players: players.map(([playerId, accountId]) => ({ playerId, accountId })),
    counts: { accounts: players.length, guests: 0, agents: 0 },
    takeover: false,
    scoresNothing: false,
    agentPlays: [],
    match: null,
    inMatch: false,
    practice: false,
    language: 'en',
    fields: ['fruit'],
    version: 'v',
    rules: 1,
    words: 'w',
  });
}

describe('the ratings', () => {
  test('keep a rating a player may change, but not once they dismissed the question', () => {
    kept('g1', { pair: 'fruit:apple+pear' }, []);
    expect(ratings.rate('impostor', 'g1', 'p1', 'good')).toBe(true);
    expect(ratings.rate('impostor', 'g1', 'p1', 'hard')).toBe(true);
    expect(ratings.rate('impostor', 'g1', 'p2', null)).toBe(true);
    expect(ratings.rate('impostor', 'g1', 'p2', 'good')).toBe(false);
    expect(db.prepare('SELECT player_id AS player, rating FROM ratings ORDER BY player_id').all()).toEqual([
      { player: 'p1', rating: 'hard' },
      { player: 'p2', rating: null },
    ]);
    // A game that isn't kept has nothing to rate.
    expect(ratings.rate('impostor', 'g9', 'p1', 'good')).toBe(false);
  });

  test('keep a guess of the AI players once, or a skip', () => {
    kept('g1', { pair: 'fruit:apple+pear' }, []);
    expect(ratings.guess('impostor', 'g1', 'p1', [2, 5])).toBe(true);
    expect(ratings.guess('impostor', 'g1', 'p1', [3])).toBe(false);
    expect(ratings.guess('impostor', 'g1', 'p2', null)).toBe(true);
    expect(ratings.guess('impostor', 'g9', 'p1', [1])).toBe(false);
    expect(db.prepare('SELECT player_id AS player, guess FROM ai_guesses ORDER BY player_id').all()).toEqual([
      { player: 'p1', guess: '[2,5]' },
      { player: 'p2', guess: null },
    ]);
  });

  test('tell how often the players in a room have had each pair, and how players rated it', () => {
    const ann = account('Ann');
    const bob = account('Bob');
    const cat = account('Cat');
    // Ann and Bob had the apple and the pear together, and Ann alone the cat and the dog, which a
    // player rated good and two said had a problem; Cat had the sun and the moon.
    kept('g1', { pair: 'fruit:apple+pear' }, [
      ['p1', ann],
      ['p2', bob],
    ]);
    kept('g2', { pair: 'pets:cat+dog' }, [['p1', ann]]);
    kept('g3', { pair: 'sky:sun+moon' }, [['p1', cat]]);
    ratings.rate('impostor', 'g2', 'p1', 'good');
    ratings.rate('impostor', 'g2', 'p2', 'problem');
    ratings.rate('impostor', 'g2', 'p3', 'problem');
    ratings.rate('impostor', 'g3', 'p1', 'easy');
    // Bob had the cat and the dog again and said again that they had a problem, and so did a guest
    // in that game: a person counts once, a guest once a game.
    kept('g4', { pair: 'pets:cat+dog' }, [['p1', bob]]);
    kept('g5', { pair: 'pets:cat+dog' }, [['p1', bob]]);
    ratings.rate('impostor', 'g4', 'p1', 'problem');
    ratings.rate('impostor', 'g4', 'p3', 'problem');
    ratings.rate('impostor', 'g5', 'p1', 'problem');
    const records = ratings.pairRecords('impostor', PATHS.pair, [ann, bob, ann]);
    expect(Object.fromEntries(records)).toEqual({
      'fruit:apple+pear': { seen: 2, together: true, good: 0, problems: 0 },
      'pets:cat+dog': { seen: 3, together: false, good: 1, problems: 4 },
      'sky:sun+moon': { seen: 0, together: false, good: 0, problems: 0 },
    });
    // A room of nobody with an account has only the ratings to go by, and another game none.
    expect(ratings.pairRecords('impostor', PATHS.pair, []).get('fruit:apple+pear')).toBeUndefined();
    expect(ratings.pairRecords('keywords', PATHS.pair, [ann]).size).toBe(0);
  });

  test('count the games that finished whose words an account set, and their good ratings', () => {
    const ann = account('Ann');
    const bob = account('Bob');
    const setter = (gameId: string, ending = 'finished') =>
      kept(
        gameId,
        { kind: 'setter', setter: 's', field: 'fruit', named: true },
        [
          ['s', ann],
          ['p1', bob],
        ],
        ending,
      );
    setter('g1');
    setter('g2');
    setter('g3', 'abandoned');
    ratings.rate('impostor', 'g1', 'p1', 'good');
    ratings.rate('impostor', 'g1', 'p2', 'good');
    ratings.rate('impostor', 'g2', 'p1', 'hard');
    ratings.rate('impostor', 'g3', 'p1', 'good');
    expect(ratings.setterCounts('impostor', PATHS.setter, ann)).toEqual({ games: 2, good: 2 });
    // Bob played in those games and set none.
    expect(ratings.setterCounts('impostor', PATHS.setter, bob)).toEqual({ games: 0, good: 0 });
  });

  test('list the latest games that finished whose words an account set, with how players rated each', () => {
    const ann = account('Ann');
    const bob = account('Bob');
    const minute = 60_000;
    const setBy = (
      gameId: string,
      setter: number,
      { ending, ...more }: { ending?: string; game?: string; words?: [string, string] } = {},
    ) => {
      endsAt += minute;
      kept(
        gameId,
        { kind: 'setter', setter: 's', field: 'fruit', named: true },
        [
          ['s', setter],
          ['p1', setter === ann ? bob : ann],
        ],
        ending,
        more,
      );
    };
    // Ann set the words of g1 and g2, which finished, of g3, which didn't, and of a game of another
    // game; Bob set those of g4, which Ann played in.
    setBy('g1', ann, { words: ['Apple', 'Pear'] });
    setBy('g2', ann, { words: ['Cat', 'Dog'] });
    setBy('g3', ann, { ending: 'abandoned' });
    setBy('g9', ann, { game: 'keywords' });
    setBy('g4', bob);
    // Of g1, two players rated it good, one too hard and one dismissed the question; nobody rated g2.
    ratings.rate('impostor', 'g1', 'p1', 'good');
    ratings.rate('impostor', 'g1', 'p2', 'good');
    ratings.rate('impostor', 'g1', 'p3', 'hard');
    ratings.rate('impostor', 'g1', 'p4', null);
    ratings.rate('impostor', 'g3', 'p1', 'good');
    ratings.rate('impostor', 'g4', 'p1', 'good');
    const at = (minutes: number) => new Date(NOW + minutes * minute).toISOString();
    const setup = (student: string, reviewer2: string) => ({
      words: { student, reviewer2 },
      source: { kind: 'setter', setter: 's', field: 'fruit', named: true },
    });
    expect(ratings.setterGames('impostor', PATHS.setter, ann)).toEqual([
      { gameId: 'g2', endedAt: at(2), setup: setup('Cat', 'Dog'), good: 0, rated: 0 },
      { gameId: 'g1', endedAt: at(1), setup: setup('Apple', 'Pear'), good: 2, rated: 3 },
    ]);
    expect(ratings.setterGames('impostor', PATHS.setter, bob).map((row) => row.gameId)).toEqual(['g4']);
    // The latest 20, the latest first.
    for (let index = 10; index < 31; index += 1) setBy(`g${index}`, ann);
    const latest = ratings.setterGames('impostor', PATHS.setter, ann).map((row) => row.gameId);
    expect(latest).toHaveLength(20);
    expect(latest[0]).toBe('g30');
    expect(latest.at(-1)).toBe('g11');
  });
});

describe("an account's page", () => {
  test('counts the games it set the words of, and their good ratings, beside what it played', () => {
    const ann = account('Ann');
    const bob = account('Bob');
    accounts.setProfile(ann, { link: null, bio: null, showRecord: true, showThanks: false });
    kept('g1', { kind: 'setter', setter: 's', field: 'fruit', named: true }, [
      ['s', ann],
      ['p1', bob],
    ]);
    ratings.rate('impostor', 'g1', 'p1', 'good');
    const service = new Accounts({ db, now: () => 0, clock: () => NOW, games: [impostorGame] });
    const set = {
      ordinary: { games: 0, wins: 0 },
      inMatches: { games: 0, wins: 0 },
      roles: {},
      wordsSet: { games: 1, good: 1 },
    };
    expect(service.profileOf(accounts.byId(ann)?.handle as string, null)?.record).toEqual({
      impostor: { ...set, matches: { played: 0, won: 0 } },
    });
    // Its own record lists the game too, with the words, the students' first, which its public
    // page doesn't.
    expect(service.recordsOf({ account: accounts.byId(ann) as never, hash: Buffer.alloc(0) })).toEqual({
      impostor: {
        ...set,
        recent: [],
        matches: { played: 0, won: 0, recent: [] },
        wordsSetRecent: [
          {
            game: 'impostor',
            gameId: 'g1',
            endedAt: new Date(NOW).toISOString(),
            words: ['Apple', 'Pear'],
            good: 1,
            rated: 1,
          },
        ],
      },
    });
    // Bob played and set nothing.
    expect(service.recordsOf({ account: accounts.byId(bob) as never, hash: Buffer.alloc(0) })).toEqual({});
    // The setter may watch the game again, as Bob, who played in it, may, and nobody else.
    const cat = account('Cat');
    expect(service.replayOf({ account: accounts.byId(ann) as never, hash: Buffer.alloc(0) }, 'g1')).not.toBeNull();
    expect(service.replayOf({ account: accounts.byId(bob) as never, hash: Buffer.alloc(0) }, 'g1')).not.toBeNull();
    expect(service.replayOf({ account: accounts.byId(cat) as never, hash: Buffer.alloc(0) }, 'g1')).toBeNull();
  });

  test('adds up what its records of a game that asks for it count, game by game', () => {
    const ann = account('Ann');
    const service = new Accounts({ db, now: () => 0, clock: () => NOW, games: [impostorGame] });
    const played = (gameId: string, verdict: string, detail: object) => {
      kept(gameId, { pair: 'fruit:apple+pear' }, [['p1', ann]]);
      const record = { side: 'student', role: 'student', result: 'won' as const, place: 1, points: 3 };
      service.records.add(ann, { game: 'impostor', gameId, ...record, verdict, detail });
    };
    played('g1', 'alive', { rounds: 3, votes: 3, hits: 2, missedVotes: 0 });
    played('g2', 'violation', { rounds: 1, votes: 1, hits: 0, missedVotes: 1 });
    // The votes, the hits and the rounds of both games, and the one out for breaking the rules.
    expect(service.recordsOf({ account: accounts.byId(ann) as never, hash: Buffer.alloc(0) }).impostor?.sums).toEqual({
      votes: 4,
      hits: 2,
      rounds: 4,
      violation: 1,
    });
  });
});

describe('the words adopted from the games', () => {
  test('keep who gave them, named only with an account, and name nobody once the account goes', () => {
    const ann = account('Ann');
    kept('g1', { kind: 'setter', setter: 's', field: 'fruit', named: true }, [['s', ann]]);
    const content = new ContentStore(db, () => NOW);
    const summary = { zh: '一对词', en: 'A pair' };
    const pair = { words: ['Apple', 'Pear'], field: 'fruit' };
    expect(
      content.adopt({
        kind: 'pair',
        game: 'impostor',
        gameId: 'g1',
        content: pair,
        accountId: ann,
        named: true,
        summary,
      }),
    ).toEqual({
      id: 1,
      kind: 'pair',
      game: 'impostor',
      gameId: 'g1',
      content: pair,
      accountId: ann,
      named: true,
      adoptedAt: new Date(NOW).toISOString(),
      summaryZh: '一对词',
      summaryEn: 'A pair',
    });
    const words = { words: ['Lamp'] };
    expect(
      content.adopt({
        kind: 'words',
        game: 'keywords',
        gameId: null,
        content: words,
        accountId: null,
        named: true,
        summary,
      }),
    ).toMatchObject({ id: 2, named: false, accountId: null });
    expect(content.list().map((row) => row.id)).toEqual([2, 1]);
    content.forget(ann);
    accounts.delete(ann);
    expect(content.list()[1]).toMatchObject({ id: 1, accountId: null, named: false, content: pair });
  });
});
