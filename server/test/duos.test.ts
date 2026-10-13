import type { DuoView, FriendsView } from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { Browser, startServer, TestClient, type TestServer } from './helpers';

// Friend duos over real sockets and HTTP (docs/architecture.md#friend-duos): what an account has
// played with each friend, on the friends list and on a friend's public profile, which nobody but
// the friend is told; and, when a game ends, the titles that it brought friends who played in it,
// which each account alone is told.

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

// A browser logged in to a new account, with a connection of its own and the account's ID and
// the handle of its profile.
async function person(name: string) {
  const browser = new Browser(server.url);
  const reply = await browser.register(name);
  if (!reply.body.ok) throw new Error(`could not register ${name}: ${String(reply.body.error)}`);
  const { id, handle } = (await browser.account()) as { id: number; handle: string };
  return { browser, client: track(await browser.connect()), id, handle };
}

async function befriend(ann: TestClient, bob: TestClient, bobName: string, annName: string) {
  expect(await ann.send('friends:request', { username: bobName })).toEqual({ ok: true, status: 'pending' });
  expect(await bob.send('friends:accept', { username: annName })).toEqual({ ok: true });
}

const listOf = async (client: TestClient): Promise<FriendsView> => {
  const reply = await client.send('friends:list');
  if (!reply.ok) throw new Error(reply.error);
  return reply as unknown as FriendsView;
};

// Earlier games that the accounts won together, on the same side.
function wonTogether(accountIds: number[], games: number) {
  for (let i = 0; i < games; i += 1) {
    for (const accountId of accountIds) {
      server.accounts.records.add(accountId, {
        game: 'test',
        gameId: `earlier-${i}`,
        side: 'all',
        role: 'player',
        winner: 'all',
        won: true,
        verdict: 'v',
        points: 0,
      });
    }
  }
}

const NONE = { wonTogether: 0, lostTogether: 0, against: 0, beat: 0, beaten: 0 };

describe('friend duos', () => {
  test('are on the friends list, and on the profile of a friend for that friend alone', async () => {
    server = await startServer();
    const ann = await person('Ann');
    const bob = await person('Bob');
    const cat = await person('Cat');
    await befriend(ann.client, bob.client, 'Bob', 'Ann');
    await befriend(ann.client, cat.client, 'Cat', 'Ann');
    wonTogether([ann.id, bob.id], 3);
    const coauthor: DuoView = { ...NONE, wonTogether: 3, titles: ['coauthor'] };
    expect((await listOf(ann.client)).friends).toEqual([
      expect.objectContaining({ username: 'Bob', duo: coauthor }),
      // Friends who share no game have nothing to show.
      expect.objectContaining({ username: 'Cat', duo: null }),
    ]);
    expect((await listOf(bob.client)).friends).toEqual([expect.objectContaining({ username: 'Ann', duo: coauthor })]);

    const duoOn = async (browser: Browser, handle: string) =>
      ((await browser.request(`/api/profile/${handle}`)).body as unknown as { profile: { duo: unknown } }).profile.duo;
    expect(await duoOn(ann.browser, bob.handle)).toEqual(coauthor);
    // Cat is Ann's friend but not Bob's; a guest is nobody's; nobody is their own.
    expect(await duoOn(cat.browser, bob.handle)).toBeNull();
    expect(await duoOn(new Browser(server.url), bob.handle)).toBeNull();
    expect(await duoOn(bob.browser, bob.handle)).toBeNull();
    // Once the two part, it goes; it comes back with the friendship.
    expect(await bob.client.send('friends:remove', { username: 'Ann' })).toEqual({ ok: true });
    expect(await duoOn(ann.browser, bob.handle)).toBeNull();
    await befriend(bob.client, ann.client, 'Ann', 'Bob');
    expect(await duoOn(ann.browser, bob.handle)).toEqual(coauthor);
  });

  test('tell each account alone of the titles that a game brought friends who played in it', async () => {
    server = await startServer();
    // Ann and Bob are friends with two games won together; Cat has an account and is nobody's
    // friend, Dan is a guest, and a screen watches.
    const ann = await person('Ann');
    const bob = await person('Bob');
    const cat = await person('Cat');
    await befriend(ann.client, bob.client, 'Bob', 'Ann');
    wonTogether([ann.id, bob.id], 2);
    const reply = await ann.client.send('room:create', {
      game: 'test',
      language: 'en',
      fields: ['general'],
      play: true,
    });
    if (!reply.ok) throw new Error(reply.error);
    const code = reply.code as string;
    await ann.client.waitFor((state) => state.code === code);
    for (const client of [bob.client, cat.client]) {
      expect(await client.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    }
    const dan = track(await TestClient.connect(server.url));
    expect(await dan.send('room:join', { code, name: 'Dan', play: true })).toMatchObject({ ok: true });
    const screen = track(await TestClient.connect(server.url));
    expect(await screen.send('room:watch', { code, roomId: reply.roomId })).toMatchObject({ ok: true });
    const everyone = [ann.client, bob.client, cat.client, dan, screen];
    await ann.client.waitFor((state) => state.players.length === 4 && state.screens === 1);

    // A game that everyone who came to play wins, and the duo notices that its end tells.
    const game = async () => {
      expect(await ann.client.send('room:start', { round: ann.client.state?.round })).toEqual({ ok: true });
      const { gameId } = await ann.client.waitFor((state) => state.phase === 'playing', 'the game');
      for (const client of everyone) expect(client.state?.duos).toEqual([]);
      expect(await ann.client.send('test:finish', {})).toEqual({ ok: true });
      for (const client of everyone) await client.waitFor((state) => state.phase === 'ended', 'the end');
      const told = everyone.map((client) => client.state?.duos);
      expect(await ann.client.send('room:again', { gameId })).toEqual({ ok: true });
      for (const client of everyone) await client.waitFor((state) => state.phase === 'lobby', 'the waiting room');
      for (const client of everyone) expect(client.state?.duos).toEqual([]);
      return told;
    };

    // The third game won together makes each the other's co-first author, which each is told of,
    // by the other's player ID in the room; Cat, Dan and the screen hear nothing.
    expect(await game()).toEqual([
      [{ playerId: bob.client.me, title: 'coauthor', count: 3 }],
      [{ playerId: ann.client.me, title: 'coauthor', count: 3 }],
      [],
      [],
      [],
    ]);
    // A fourth changes nothing that is worth telling.
    expect(await game()).toEqual([[], [], [], [], []]);
    expect(server.accounts.records.duos(ann.id)).toEqual(new Map([[bob.id, { ...NONE, wonTogether: 4 }]]));
  });
});
