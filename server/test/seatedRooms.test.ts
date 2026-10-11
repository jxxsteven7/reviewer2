import type { SeatedRoom } from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { Browser, createRoom, joinRoom, startServer, TestClient, until, type TestServer } from './helpers';

// The rooms where a connection still has a seat (meta:seats), which the home page offers the way
// back to: found by the browser's token or the account, on any device, and never anyone else's.

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

const seatsOf = async (client: TestClient) => {
  const reply = await client.send('meta:seats');
  if (!reply.ok) throw new Error(`no seats: ${reply.error}`);
  return reply.seats as SeatedRoom[];
};

async function loggedIn(name: string) {
  const browser = new Browser(server.url);
  const reply = await browser.register(name);
  if (!reply.body.ok) throw new Error(`could not register ${name}: ${String(reply.body.error)}`);
  return browser;
}

describe('the rooms where a connection has a seat', () => {
  test("are found by the browser's token, waiting or playing, and only its own", async () => {
    server = await startServer();
    const { chair, code } = await createRoom(server.url, 'Ann');
    track(chair);
    const bob = track(await joinRoom(server.url, code, 'Bob', { play: true }));
    // Another room, which Bob is not in.
    track((await createRoom(server.url, 'Cat')).chair);
    // Another tab of Bob's browser, on the home page.
    const home = track(await TestClient.connect(server.url, { token: bob.token }));
    expect(await seatsOf(home)).toEqual([{ code, game: 'test', playing: false }]);
    await chair.send('room:start', { round: 0 });
    await chair.waitFor((state) => state.phase === 'playing');
    bob.close();
    expect(await seatsOf(home)).toEqual([{ code, game: 'test', playing: true }]);
    // Someone else's browser has none.
    expect(await seatsOf(track(await TestClient.connect(server.url)))).toEqual([]);
  });

  test('are found by the account on another device, and by the seat the browser took as a guest', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await createRoom(server.url, 'Chair');
    track(chair);
    const phone = track(await ann.connect());
    expect(await phone.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    const laptop = new Browser(server.url);
    await laptop.logIn('Ann');
    expect(await seatsOf(track(await laptop.connect()))).toEqual([{ code, game: 'test', playing: false }]);

    // Bea sits down as a guest, then registers: the seat is hers on the home page, before the room
    // has made it the account's.
    const { code: other } = await createRoom(server.url, 'Dee');
    const asGuest = track(await joinRoom(server.url, other, 'Bea', { play: true }));
    const bea = await loggedIn('Bea');
    const home = track(await bea.connect({ token: asGuest.token }));
    expect(await seatsOf(home)).toEqual([{ code: other, game: 'test', playing: false }]);
    // A device without that token has no seat until the room has given it to the account.
    const tablet = new Browser(server.url);
    await tablet.logIn('Bea');
    expect(await seatsOf(track(await tablet.connect()))).toEqual([]);
  });

  // Everyone in these tests has the same address, as the people in one lab do.
  test('lead back to the seat the browser took as a guest, whatever codes the address got wrong', async () => {
    server = await startServer({ socketLimits: { failedLookupsPerMinute: 2 } });
    const { chair, code, roomId } = await createRoom(server.url, 'Dee');
    track(chair);
    const asGuest = track(await joinRoom(server.url, code, 'Bea', { play: true }));
    const bea = await loggedIn('Bea');
    const home = track(await bea.connect({ token: asGuest.token }));
    expect(await seatsOf(home)).toEqual([{ code, game: 'test', playing: false }]);
    const typist = track(await TestClient.connect(server.url));
    for (const wrong of ['ZZZZ', 'ZZZZ']) {
      expect(await typist.send('room:join', { code: wrong })).toEqual({ ok: false, error: 'room_not_found' });
    }
    expect(await typist.send('room:join', { code, name: 'Cat' })).toEqual({ ok: false, error: 'rate_limited' });
    expect(await home.send('room:join', { code })).toMatchObject({ ok: true, roomId });
    await home.waitFor((state) => state.me === asGuest.me);
  });

  test('are no longer found once the player has left, was removed or was dropped', async () => {
    server = await startServer();
    const { chair, code } = await createRoom(server.url, 'Ann');
    track(chair);
    const bob = track(await joinRoom(server.url, code, 'Bob'));
    const cat = track(await joinRoom(server.url, code, 'Cat'));
    const dee = track(await joinRoom(server.url, code, 'Dee'));
    await chair.waitFor((state) => state.players.length === 4);
    const tabOf = async (client: TestClient) => track(await TestClient.connect(server.url, { token: client.token }));
    const [bobHome, catHome, deeHome] = await Promise.all([tabOf(bob), tabOf(cat), tabOf(dee)]);

    expect(await bob.send('room:leave')).toEqual({ ok: true });
    expect(await seatsOf(bobHome)).toEqual([]);
    expect(await chair.send('room:remove', { playerId: cat.me })).toEqual({ ok: true });
    expect(await seatsOf(catHome)).toEqual([]);
    // Dee is offline in the waiting room for too long.
    dee.close();
    await until(() => server.app.rooms.find(code)?.onlineCount() === 1, 'Dee to go offline');
    expect(await seatsOf(deeHome)).toHaveLength(1);
    server.advance(10 * 60_000 + 1);
    server.app.sockets.sweep();
    expect(await seatsOf(deeHome)).toEqual([]);
  });

  test('leave out screens, and name five rooms at most, the newest first', async () => {
    server = await startServer({ roomsPerMinute: 10 });
    const { chair, code } = await createRoom(server.url, 'Ann');
    track(chair);
    const screen = track(await TestClient.connect(server.url));
    expect(await screen.send('room:watch', { code })).toMatchObject({ ok: true });
    expect(await seatsOf(screen)).toEqual([]);

    const codes = [code];
    for (let i = 0; i < 5; i += 1) {
      const reply = await chair.send('room:create', { game: 'test', language: 'en', fields: ['general'], name: 'Ann' });
      if (!reply.ok) throw new Error(`could not create a room: ${reply.error}`);
      codes.push(reply.code as string);
    }
    const seats = await seatsOf(chair);
    expect(seats.map((seat) => seat.code)).toEqual(codes.slice(1).reverse());
  });
});
