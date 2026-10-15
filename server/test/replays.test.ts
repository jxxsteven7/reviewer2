import type { KeywordsRoomData, KeywordsView, ShownReplay, Team } from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { keywordsGame } from '../src/games/keywords';
import { Browser, startServer, TestClient, until, type TestServer } from './helpers';

// A replay as it is kept and as it is shown (docs/architecture.md#replays): the groups and who was
// who, without the name of any account, which the server puts in as the replay is opened, as the
// account is then, or as deleted.

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
const kept = () => server.db.prepare('SELECT game_id AS gameId, data FROM replays').all() as { data: string }[];

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
  return { anns, bobs, ids: ids as Record<'ann' | 'bob' | 'cat' | 'dan', string>, gameId };
}

const open = async (browser: Browser, gameId: string) => {
  const reply = await browser.request('/api/account/replay', { gameId });
  expect(reply.body.ok).toBe(true);
  return reply.body.replay as ShownReplay;
};

describe('a replay', () => {
  test('keeps the groups and who was who, but no account by name', async () => {
    const { ids } = await finished();
    const data = kept()[0]?.data as string;
    expect(data).not.toContain('Ann');
    expect(data).not.toContain('Bob');
    const replay = JSON.parse(data) as Record<string, unknown>;
    expect(replay.players).toBeUndefined();
    expect(replay.groups).toEqual([
      { team: 'red', captain: ids.ann, guessers: [ids.bob] },
      { team: 'blue', captain: ids.cat, guessers: [ids.dan] },
    ]);
    expect(replay.members).toEqual({
      [ids.ann]: { account: true },
      [ids.bob]: { account: true },
      [ids.cat]: { guest: 1 },
      [ids.dan]: { guest: 2 },
    });
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

  test('from before the groups were kept shows whoever has no account there as a guest', async () => {
    const { anns, bobs, ids, gameId } = await finished();
    // The replay as it was kept before: without the groups and who was who.
    const old = JSON.parse(kept()[0]?.data as string) as Record<string, unknown>;
    delete old.groups;
    delete old.members;
    server.db.prepare('UPDATE replays SET data = ?').run(JSON.stringify(old));
    // Shown, it has the guests by number, in the order of the seats, and the accounts as they are now.
    const shown = await open(anns, gameId);
    expect(shown.people[ids.cat]).toEqual({ guest: 1 });
    expect(shown.people[ids.dan]).toEqual({ guest: 2 });
    expect(shown.people[ids.bob]).toMatchObject({ name: 'Bob' });
    expect(shown.groups).toEqual([
      { team: 'red', captain: ids.ann, guessers: [ids.bob] },
      { team: 'blue', captain: ids.cat, guessers: [ids.dan] },
    ]);
    expect((await bobs.request('/api/account/delete', { password: 'correct horse' })).body).toEqual({ ok: true });
    expect(kept()[0]?.data).not.toContain('Bob');
    // Bob can't be told from a guest any more: he is the first of them, in the order of the seats.
    const after = await open(anns, gameId);
    expect([ids.bob, ids.cat, ids.dan].map((id) => after.people[id])).toEqual([
      { guest: 1 },
      { guest: 2 },
      { guest: 3 },
    ]);
  });
});
