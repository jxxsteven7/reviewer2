import type { KeywordsRoomData, KeywordsView, ShownReplay, Team } from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import type { GameLogData } from '../src/core/gameLog';
import { keywordsGame } from '../src/games/keywords';
import { Browser, startServer, TestClient, until, type TestServer } from './helpers';

// A replay as it is shown (docs/architecture.md#replays): worked out from the record of the game as
// it is opened, with the groups and who was who, each account as it is then, or as deleted. The
// record names no account.

let server: TestServer;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
});

const track = (client: TestClient) => {
  clients.push(client);
  return client;
};

const board = (client: TestClient) => (client.state?.data as KeywordsRoomData).game as KeywordsView;
const kept = () => server.db.prepare('SELECT game_id AS gameId, log FROM replays').all() as { log: string }[];

// Ann and Bob, with accounts, are red's PI and student; two guests are blue's. Red gives a clue,
// and Bob reveals Reviewer 2, which ends the game.
async function finished() {
  server = await startServer({ games: [keywordsGame] });
  const anns = new Browser(server.url);
  const bobs = new Browser(server.url);
  expect((await anns.register('Ann')).body).toEqual({ ok: true });
  expect((await bobs.register('Bob')).body).toEqual({ ok: true });
  const ann = track(await anns.connect());
  const reply = await ann.send('room:create', { game: 'keywords', language: 'en', fields: ['general'], play: true });
  if (!reply.ok) throw new Error(reply.error);
  const join = async (client: TestClient) => {
    expect(await track(client).send('room:join', { code: reply.code, play: true })).toMatchObject({ ok: true });
    return client;
  };
  const bob = await join(await bobs.connect());
  const cat = await join(await TestClient.connect(server.url));
  const dan = await join(await TestClient.connect(server.url));
  const everyone = [ann, bob, cat, dan];
  await ann.waitFor((state) => state.players.length === 4);
  const seats: [TestClient, Team, 'captain' | 'guesser'][] = [
    [ann, 'red', 'captain'],
    [bob, 'red', 'guesser'],
    [cat, 'blue', 'captain'],
    [dan, 'blue', 'guesser'],
  ];
  for (const [client, team, role] of seats) {
    expect(await client.send('keywords:seat', { team, role })).toEqual({ ok: true });
  }
  await ann.waitFor((state) => (state.data as KeywordsRoomData).startProblems.length === 0, 'ready');
  // Red starts, whichever group the deal gave the first turn: blue lets its time run out otherwise.
  expect(await ann.send('room:start', { round: ann.state?.round })).toEqual({ ok: true });
  for (const client of everyone) await client.waitFor((state) => state.phase === 'playing', 'the game');
  const team = board(ann).team;
  const [pi, student] = team === 'red' ? [ann, bob] : [cat, dan];
  const cards = board(pi).cards;
  const own = cards.findIndex((card) => card.color === team);
  const { gameId, turn } = board(pi);
  expect(await pi.send('keywords:clue', { gameId, turn, word: 'Hint', count: 1, targets: [own] })).toEqual({
    ok: true,
  });
  await student.waitFor((state) => (state.data as KeywordsRoomData).game?.phase === 'guess', 'the guesses');
  const reviewer2 = cards.findIndex((card) => card.color === 'reviewer2');
  expect(await student.send('keywords:reveal', { gameId, turn: board(student).turn, card: reviewer2 })).toEqual({
    ok: true,
  });
  for (const client of everyone) await client.waitFor((state) => state.phase === 'ended', 'the end');
  await until(() => kept().length === 1, 'the record');
  const ids = Object.fromEntries(
    everyone.map((client, index) => [['ann', 'bob', 'cat', 'dan'][index], client.state?.me]),
  );
  return { anns, bobs, ids: ids as Record<'ann' | 'bob' | 'cat' | 'dan', string>, gameId, seen: board(ann) };
}

const open = async (browser: Browser, gameId: string) => {
  const reply = await browser.request('/api/account/replay', { gameId });
  expect(reply.body.ok).toBe(true);
  return reply.body.replay as ShownReplay;
};

describe('a replay', () => {
  test('is kept as the record of the game, which names no account, and the guests by number', async () => {
    const { ids } = await finished();
    const columns = server.db.prepare("SELECT name FROM pragma_table_info('replays')").all() as { name: string }[];
    expect(columns.map(({ name }) => name)).not.toContain('data');
    const log = kept()[0]?.log as string;
    expect(log).not.toContain('Ann');
    expect(log).not.toContain('Bob');
    expect((JSON.parse(log) as GameLogData).guests).toEqual({ [ids.cat]: 1, [ids.dan]: 2 });
  });

  test('is the game as the players saw it end: the board, the record and the result', async () => {
    const { anns, gameId, seen } = await finished();
    const shown = await open(anns, gameId);
    expect(shown.cards).toEqual(seen.cards.map(({ word, color }) => ({ word, color })));
    expect(shown.history).toEqual(seen.history);
    expect(shown.result).toEqual(seen.result);
  });

  test('shows each account as it is now, a deleted one as deleted, and the guests by number', async () => {
    const { anns, bobs, ids, gameId } = await finished();
    const first = await open(anns, gameId);
    expect(first.groups).toEqual([
      { team: 'red', captain: ids.ann, guessers: [ids.bob] },
      { team: 'blue', captain: ids.cat, guessers: [ids.dan] },
    ]);
    expect(first.me).toBe(ids.ann);
    expect(first.people).toEqual({
      [ids.ann]: { name: 'Ann', handle: expect.any(String) },
      [ids.bob]: { name: 'Bob', handle: expect.any(String) },
      [ids.cat]: { guest: 1 },
      [ids.dan]: { guest: 2 },
    });
    // Bob's new username shows, and he sees himself first.
    expect((await bobs.request('/api/account/username', { username: 'Bobby' })).body).toEqual({ ok: true });
    expect((await open(anns, gameId)).people[ids.bob]).toMatchObject({ name: 'Bobby' });
    expect((await open(bobs, gameId)).me).toBe(ids.bob);
    // Once Bob has deleted his account, he is a deleted account, by no name.
    expect((await bobs.request('/api/account/delete', { password: 'correct horse' })).body).toEqual({ ok: true });
    const after = await open(anns, gameId);
    expect(after.people[ids.bob]).toEqual({ deleted: true });
    expect(JSON.stringify(after)).not.toContain('Bob');
  });
});
