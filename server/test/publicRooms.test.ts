import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_LIMITS } from '../src/core/rooms';
import { REMOVED_FOR_MS } from '../src/core/room';
import { DEFAULT_SOCKET_LIMITS } from '../src/core/socket';
import { DEFAULT_FEEDBACK_LIMITS } from '../src/store/feedback';
import { Browser, createRoom, joinRoom, startServer, TestClient, until, type TestServer } from './helpers';

// Public rooms (docs/architecture.md#public-rooms): the list on the home page, the account that
// creating, listing and joining one takes, the operator's bar, the chair's removals, which last
// for as long as the room does, and the reports that players send of each other.

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

async function loggedIn(name: string) {
  const browser = new Browser(server.url);
  const reply = await browser.register(name);
  if (!reply.body.ok) throw new Error(`could not register ${name}: ${String(reply.body.error)}`);
  return browser;
}

const CREATE = { game: 'test', language: 'en', fields: ['general'], public: true };

// A public room with its chair, who is logged in.
async function publicRoom(browser: Browser, payload: Record<string, unknown> = {}) {
  const chair = track(await browser.connect());
  const reply = await chair.send('room:create', { ...CREATE, ...payload });
  if (!reply.ok) throw new Error(`could not create a public room: ${reply.error}`);
  await chair.waitFor((state) => state.code === reply.code);
  return { chair, code: reply.code as string, roomId: reply.roomId as string };
}

const listed = async (client: TestClient) => {
  const reply = await client.send('meta:rooms');
  if (!reply.ok) throw new Error(`could not list the rooms: ${reply.error}`);
  return reply.rooms as Record<string, unknown>[];
};

describe('a public room', () => {
  test('is created by a player with an account, and listed for everyone, with nothing of who is in it', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await publicRoom(ann);
    expect(chair.state?.public).toBe(true);
    expect(server.logs.find(({ event }) => event === 'room_created')?.fields).toMatchObject({ code, public: true });
    // The list is for anyone, logged in or not, and says only what the home page shows.
    const visitor = track(await TestClient.connect(server.url));
    expect(await listed(visitor)).toEqual([
      { code, game: 'test', language: 'en', fields: ['general'], players: 1, playing: false },
    ]);
    // A room that isn't public is as it always was, and isn't listed.
    const { chair: other } = await createRoom(server.url, 'Guest');
    track(other);
    expect(other.state?.public).toBe(false);
    expect(await listed(visitor)).toHaveLength(1);
  });

  test("can't be created by a guest, or by an account the operator has barred", async () => {
    server = await startServer();
    const guest = track(await TestClient.connect(server.url));
    expect(await guest.send('room:create', { ...CREATE, name: 'Guest' })).toEqual({
      ok: false,
      error: 'account_required',
    });
    const ann = await loggedIn('Ann');
    server.accounts.store.setPublicBarred(1, true);
    const barred = track(await ann.connect());
    expect(await barred.send('room:create', CREATE)).toEqual({ ok: false, error: 'public_barred' });
    // A private room is still open to them.
    expect(await barred.send('room:create', { ...CREATE, public: false })).toMatchObject({ ok: true });
    // The refusal costs no attempt at a room: the word lists weren't looked at.
    expect(server.logs.filter(({ event }) => event === 'room_created')).toHaveLength(1);
  });

  test('takes newcomers with accounts only, by the code as from the list', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await publicRoom(ann);
    const guest = track(await TestClient.connect(server.url));
    // Before the question for a name, so that nobody types one for nothing.
    expect(await guest.send('room:join', { code })).toEqual({ ok: false, error: 'account_required' });
    expect(await guest.send('room:join', { code, name: 'Guest', play: true })).toEqual({
      ok: false,
      error: 'account_required',
    });
    const bob = await loggedIn('Bob');
    const visitor = track(await bob.connect());
    expect(await visitor.send('room:join', { code })).toEqual({ ok: false, error: 'name_required', language: 'en' });
    expect(await visitor.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.players.length === 2);
    expect((await listed(guest))[0]).toMatchObject({ players: 2 });
    // A screen takes an account with a seat here, and one each: anyone can read the code off the
    // list, and could otherwise put up all five.
    expect(await guest.send('room:watch', { code })).toEqual({ ok: false, error: 'account_required' });
    const cat = track(await (await loggedIn('Cat')).connect());
    expect(await cat.send('room:watch', { code })).toEqual({ ok: false, error: 'not_member' });
    const projector = track(await bob.connect());
    expect(await projector.send('room:watch', { code })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.screens === 1);
    const second = track(await bob.connect());
    expect(await second.send('room:watch', { code })).toMatchObject({ ok: true });
    await until(() => projector.closed.includes('left'), 'the first screen hears');
    expect(server.app.rooms.find(code)?.screens.size).toBe(1);
  });

  test('keeps the screens that were up when it was listed, as it keeps the guests', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code, roomId } = await publicRoom(ann, { public: false });
    const projector = track(await TestClient.connect(server.url));
    expect(await projector.send('room:watch', { code })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.screens === 1);
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: true });
    await projector.waitFor((state) => state.public);
    // The projector's connection drops and comes back: through the handshake, as a page's does,
    // and then by asking, as the page does after every reconnect.
    projector.close();
    await chair.waitFor((state) => state.screens === 0);
    const back = track(await TestClient.connect(server.url, { token: projector.token, watch: code, roomId }));
    await back.waitFor((state) => state.code === code && state.me === null);
    expect(await back.send('room:watch', { code, roomId })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.screens === 1);
    // One that comes back before its old connection was found to be gone takes its own place.
    const again = track(await TestClient.connect(server.url, { token: projector.token, watch: code, roomId }));
    await again.waitFor((state) => state.code === code);
    await until(() => back.closed.includes('left'), 'the old connection hears');
    expect(server.app.rooms.find(code)?.screens.size).toBe(1);
    // A new screen takes an account with a seat.
    const another = track(await TestClient.connect(server.url));
    expect(await another.send('room:watch', { code })).toEqual({ ok: false, error: 'account_required' });
  });

  test('is joined whatever wrong codes the address has sent, since the list gives anyone its code', async () => {
    server = await startServer({ socketLimits: { failedLookupsPerMinute: 2 } });
    const ann = await loggedIn('Ann');
    const { code } = await publicRoom(ann);
    const { chair: other, code: privateCode } = await createRoom(server.url, 'Guest');
    track(other);
    // Someone at the same address, as every client here is, has used up the wrong codes of a minute.
    const guesser = track(await TestClient.connect(server.url));
    for (let i = 0; i < 2; i += 1) {
      expect(await guesser.send('room:join', { code: 'ZZZZ' })).toEqual({ ok: false, error: 'room_not_found' });
    }
    expect(await guesser.send('room:join', { code: privateCode, name: 'Gus' })).toEqual({
      ok: false,
      error: 'rate_limited',
    });
    const bob = track(await (await loggedIn('Bob')).connect());
    expect(await bob.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    expect(await guesser.send('room:watch', { code })).toEqual({ ok: false, error: 'account_required' });
  });

  test('keeps a screen that was up when it was listed also once its browser has logged in', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code, roomId } = await publicRoom(ann, { public: false });
    const browser = new Browser(server.url);
    const projector = track(await browser.connect());
    expect(await projector.send('room:watch', { code })).toMatchObject({ ok: true });
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: true });
    await projector.waitFor((state) => state.public);
    // Someone logs in on the projector's computer, with an account that has no seat in the room,
    // and the screen comes back before its old connection was found to be gone.
    expect((await browser.register('Projector')).body).toMatchObject({ ok: true });
    const back = track(await browser.connect({ token: projector.token, watch: code, roomId }));
    await back.waitFor((state) => state.code === code && state.me === null);
    expect(await back.send('room:watch', { code, roomId })).toMatchObject({ ok: true });
    await until(() => projector.closed.includes('left'), 'the old connection hears');
    expect(server.app.rooms.find(code)?.screens.size).toBe(1);
  });

  test('is closed to an account the operator has barred, who may still play in private rooms', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const bob = await loggedIn('Bob');
    const { code } = await publicRoom(ann);
    const { code: privateCode } = await createRoom(server.url, 'Guest');
    server.accounts.store.setPublicBarred(2, true);
    const visitor = track(await bob.connect());
    expect(await visitor.send('room:join', { code, play: true })).toEqual({ ok: false, error: 'public_barred' });
    expect(await visitor.send('room:watch', { code })).toEqual({ ok: false, error: 'public_barred' });
    expect(await visitor.send('room:join', { code: privateCode, play: true })).toMatchObject({ ok: true });
    // The bar is read when it matters, so lifting it works at once.
    server.accounts.store.setPublicBarred(2, false);
    const again = track(await bob.connect());
    expect(await again.send('room:join', { code, play: true })).toMatchObject({ ok: true });
  });

  test('gives a barred account no seat through the one its browser took as a guest', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await publicRoom(ann, { public: false });
    const guest = track(await joinRoom(server.url, code, 'Guest'));
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: true });
    await guest.waitFor((state) => state.public);
    const browser = new Browser(server.url);
    expect((await browser.register('Bob')).body).toMatchObject({ ok: true });
    server.accounts.store.setPublicBarred(2, true);
    // Logged in on the guest's browser, Bob is told, and the seat stays the guest's.
    const asBob = track(await browser.connect({ token: guest.token, code }));
    expect(await asBob.send('room:join', { code, play: true })).toEqual({ ok: false, error: 'public_barred' });
    expect(asBob.states).toEqual([]);
    expect(chair.state?.players.map(({ name }) => name)).toEqual(['Ann', 'Guest']);
  });

  test('goes off the list by the next sweep when the operator bars its chair', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const bob = await loggedIn('Bob');
    const { chair, code } = await publicRoom(ann);
    const visitor = track(await bob.connect());
    expect(await visitor.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.players.length === 2);
    // A barred member who isn't the chair changes nothing.
    server.accounts.store.setPublicBarred(2, true);
    server.app.sockets.sweep();
    expect(chair.state?.public).toBe(true);
    expect(await listed(visitor)).toHaveLength(1);
    // A barred chair takes the room off the list, with everyone still in it.
    server.accounts.store.setPublicBarred(1, true);
    server.app.sockets.sweep();
    await visitor.waitFor((state) => !state.public);
    expect(visitor.state?.players).toHaveLength(2);
    expect(await listed(visitor)).toEqual([]);
    expect(server.logs.find(({ event }) => event === 'room_unlisted')?.fields).toEqual({ code });
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: false, error: 'public_barred' });
  });

  test('goes off the list by the next sweep when the chair passes to a guest', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await publicRoom(ann, { public: false });
    const guest = track(await joinRoom(server.url, code, 'Guest', { play: true }));
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: true });
    await guest.waitFor((state) => state.public);
    // A guest who isn't the chair changes nothing.
    server.app.sockets.sweep();
    const visitor = track(await TestClient.connect(server.url));
    expect(await listed(visitor)).toHaveLength(1);
    // The chair leaves, and the guest takes over: the room goes off the list, with the guest still in
    // it, and the guest can't put it back.
    expect(await chair.send('room:leave')).toEqual({ ok: true });
    await guest.waitFor((state) => state.chairId === state.me);
    server.app.sockets.sweep();
    await guest.waitFor((state) => !state.public);
    expect(guest.state?.players).toHaveLength(1);
    expect(await listed(visitor)).toEqual([]);
    expect(server.logs.find(({ event }) => event === 'room_unlisted')?.fields).toEqual({ code });
    expect(await guest.send('room:public', { public: true })).toEqual({ ok: false, error: 'account_required' });
  });

  test('lists only rooms with room for someone, waiting rooms first, and says when a game is on', async () => {
    server = await startServer({ roomsPerMinute: 10 });
    const ann = await loggedIn('Ann');
    const { chair: first, code: firstCode } = await publicRoom(ann);
    const bob = await loggedIn('Bob');
    const { chair: second, code: secondCode } = await publicRoom(bob);
    const catsBrowser = await loggedIn('Cat');
    const cat = track(await catsBrowser.connect());
    expect(await cat.send('room:join', { code: firstCode, play: true })).toMatchObject({ ok: true });
    await first.waitFor((state) => state.players.length === 2);
    const visitor = track(await TestClient.connect(server.url));
    expect((await listed(visitor)).map(({ code }) => code)).toEqual([firstCode, secondCode]);
    // A game in the first room puts it after the second, and says so; a game that has ended leaves
    // the room waiting for the next.
    expect(await first.send('room:start', { round: 0 })).toEqual({ ok: true });
    expect(await listed(visitor)).toMatchObject([
      { code: secondCode, playing: false },
      { code: firstCode, playing: true },
    ]);
    expect(await first.send('room:end', { gameId: first.state?.gameId })).toEqual({ ok: true });
    expect(await listed(visitor)).toMatchObject([
      { code: firstCode, playing: false },
      { code: secondCode, playing: false },
    ]);
    // A full room isn't listed; the test game's room takes 30. The guests join while the room is
    // off the list, as a room may be listed with the guests who were in it.
    expect(await second.send('room:public', { public: false })).toEqual({ ok: true });
    for (let i = 0; i < 29; i += 1) track(await joinRoom(server.url, secondCode, `Guest ${i}`, { play: false }));
    await second.waitFor((state) => state.players.length === 30);
    expect(await second.send('room:public', { public: true })).toEqual({ ok: true });
    await second.waitFor((state) => state.public);
    expect((await listed(visitor)).map(({ code }) => code)).toEqual([firstCode]);
    // A room where nobody is online isn't listed either, until someone is back.
    first.close();
    cat.close();
    await until(() => server.app.rooms.find(firstCode)?.onlineCount() === 0, 'the first room is empty');
    expect(await listed(visitor)).toEqual([]);
    const back = track(await catsBrowser.connect({ code: firstCode }));
    await back.waitFor((state) => state.code === firstCode);
    expect((await listed(visitor)).map(({ code }) => code)).toEqual([firstCode]);
  });

  test('lists only so many rooms, the first by its order', async () => {
    server = await startServer({ roomsPerMinute: 10, limits: { ...DEFAULT_LIMITS, maxListed: 2 } });
    const codes: string[] = [];
    for (const name of ['Ann', 'Bob', 'Cat']) codes.push((await publicRoom(await loggedIn(name))).code);
    const visitor = track(await TestClient.connect(server.url));
    expect((await listed(visitor)).map(({ code }) => code)).toEqual(codes.slice(0, 2));
  });

  test('is listed and unlisted by the chair in the waiting room, with an account that may', async () => {
    server = await startServer();
    const { chair, code } = await createRoom(server.url, 'Guest');
    track(chair);
    const bob = await joinRoom(server.url, code, 'Bob');
    track(bob);
    const visitor = track(await TestClient.connect(server.url));
    // Not for members, and not for a guest chair.
    expect(await bob.send('room:public', { public: true })).toEqual({ ok: false, error: 'not_chair' });
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: false, error: 'account_required' });
    expect(await listed(visitor)).toEqual([]);

    const ann = await loggedIn('Ann');
    const { chair: annsChair, code: annsCode, roomId } = await publicRoom(ann, { public: false });
    expect(annsChair.state?.public).toBe(false);
    track(await joinRoom(server.url, annsCode, 'Guest', { play: true }));
    await annsChair.waitFor((state) => state.players.length === 2);
    expect(await annsChair.send('room:public', { public: true })).toEqual({ ok: true });
    await annsChair.waitFor((state) => state.public);
    expect((await listed(visitor)).map(({ code }) => code)).toEqual([annsCode]);
    // Asking for what is already so changes nothing.
    const { rev } = annsChair.state as { rev: number };
    expect(await annsChair.send('room:public', { public: true })).toEqual({ ok: true });
    expect(annsChair.state?.rev).toBe(rev);
    // Not during a game.
    expect(await annsChair.send('room:start', { round: 0 })).toEqual({ ok: true });
    expect(await annsChair.send('room:public', { public: false })).toEqual({ ok: false, error: 'wrong_phase' });
    expect(await annsChair.send('room:end', { gameId: annsChair.state?.gameId })).toEqual({ ok: true });
    expect(await annsChair.send('room:again', { gameId: annsChair.state?.gameId })).toEqual({ ok: true });
    // A barred chair can still take the room off the list, but not put it back.
    server.accounts.store.setPublicBarred(1, true);
    expect(await annsChair.send('room:public', { public: false })).toEqual({ ok: true });
    await annsChair.waitFor((state) => !state.public && state.roomId === roomId);
    expect(await listed(visitor)).toEqual([]);
    expect(await annsChair.send('room:public', { public: true })).toEqual({ ok: false, error: 'public_barred' });
  });

  test('keeps the guests who were there when it was listed, and takes accounts from then on', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await publicRoom(ann, { public: false });
    const guest = track(await joinRoom(server.url, code, 'Guest'));
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: true });
    await guest.waitFor((state) => state.public);
    expect(guest.state?.players).toHaveLength(2);
    // The guest comes back after a reconnect, as always.
    const back = track(await TestClient.connect(server.url, { token: guest.token, code }));
    await back.waitFor((state) => state.code === code);
    expect(back.me).toBe(guest.me);
    const another = track(await TestClient.connect(server.url));
    expect(await another.send('room:join', { code, name: 'Late', play: true })).toEqual({
      ok: false,
      error: 'account_required',
    });
  });
});

describe('a removed player', () => {
  test('with an account stays out on every device, and after the account logs out and in', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const bob = await loggedIn('Bob');
    const { chair, code, roomId } = await publicRoom(ann);
    const phone = track(await bob.connect());
    expect(await phone.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.players.length === 2);
    const laptop = track(await bob.connect({ code, roomId }));
    await laptop.waitFor((state) => state.code === code);

    expect(await chair.send('room:remove', { playerId: phone.me })).toEqual({ ok: true });
    await until(() => phone.closed.includes('removed') && laptop.closed.includes('removed'), 'Bob hears');
    await chair.waitFor((state) => state.players.length === 1);
    // Neither device gets back in, by the handshake or by asking.
    const again = track(await bob.connect({ code, roomId }));
    expect(await again.send('sys:ping')).toEqual({ ok: true });
    expect(again.states).toEqual([]);
    expect(await again.send('room:join', { code, roomId, play: true })).toEqual({ ok: false, error: 'removed' });
    expect(await laptop.send('room:join', { code, play: false })).toEqual({ ok: false, error: 'removed' });
    // Nor does a fresh login of the same account from a browser that was never in the room.
    const elsewhere = new Browser(server.url);
    expect((await elsewhere.logIn('Bob')).body).toMatchObject({ ok: true });
    const fresh = track(await elsewhere.connect());
    expect(await fresh.send('room:join', { code, play: true })).toEqual({ ok: false, error: 'removed' });
    // Nor does logging out on a browser that was: it stays out as a guest, by its own token.
    const loggedOut = track(await TestClient.connect(server.url, { token: laptop.token }));
    expect(await loggedOut.send('room:join', { code, name: 'Robert', play: true })).toEqual({
      ok: false,
      error: 'removed',
    });
    // Everyone else is where they were.
    expect(chair.state?.players.map(({ name }) => name)).toEqual(['Ann']);
    expect(chair.state?.chairId).toBe(chair.me);
  });

  test("with an account can't come back through a seat its browser took as a guest", async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    // A private room, which guests can join; for the wait, as long as one lasts there.
    const { chair, code } = await publicRoom(ann, { public: false });
    const bob = await loggedIn('Bob');
    const laptop = track(await bob.connect());
    expect(await laptop.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    // Bob's phone is in the room as a guest.
    const phone = track(await joinRoom(server.url, code, 'Bobby'));
    await chair.waitFor((state) => state.players.length === 3);
    expect(await chair.send('room:remove', { playerId: laptop.me })).toEqual({ ok: true });
    await chair.waitFor((state) => state.players.length === 2);
    // Logging in on the phone doesn't make the guest's seat the account's.
    const phoneBrowser = new Browser(server.url);
    expect((await phoneBrowser.logIn('Bob')).body).toMatchObject({ ok: true });
    const asBob = track(await phoneBrowser.connect({ token: phone.token, code }));
    expect(await asBob.send('sys:ping')).toEqual({ ok: true });
    expect(asBob.states).toEqual([]);
    expect(await asBob.send('room:join', { code, play: true })).toEqual({ ok: false, error: 'removed_recently' });
    expect(chair.state?.players.map(({ name }) => name)).toEqual(['Ann', 'Bobby']);
  });

  test('removed while offline stays out by the browsers they were on, as one removed online does', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await publicRoom(ann);
    const bob = await loggedIn('Bob');
    const laptop = track(await bob.connect());
    expect(await laptop.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.players.length === 2);
    const bobId = laptop.me;
    laptop.close();
    await chair.waitFor((state) => state.players.some((player) => player.id === bobId && !player.online));
    expect(await chair.send('room:remove', { playerId: bobId })).toEqual({ ok: true });
    await chair.waitFor((state) => state.players.length === 1);
    // Logged out, the laptop is a guest by its token, and stays out; so does a new account on it.
    const loggedOut = track(await TestClient.connect(server.url, { token: laptop.token }));
    expect(await loggedOut.send('room:join', { code, name: 'Robert', play: true })).toEqual({
      ok: false,
      error: 'removed',
    });
    const another = new Browser(server.url);
    expect((await another.register('Rob')).body).toMatchObject({ ok: true });
    const asRob = track(await another.connect({ token: laptop.token }));
    expect(await asRob.send('room:join', { code, play: true })).toEqual({ ok: false, error: 'removed' });
  });

  test('loses the screen their browser put up as a guest, also after logging in there', async () => {
    server = await startServer();
    const { chair, code } = await createRoom(server.url, 'Ann');
    track(chair);
    // A guest's browser takes a seat and puts up a screen, and then registers. The seat becomes the
    // account's when its page comes back; the screen, which hasn't reconnected, has the guest's key.
    const browser = new Browser(server.url);
    const seat = track(await browser.connect());
    expect(await seat.send('room:join', { code, name: 'Gus', play: true })).toMatchObject({ ok: true });
    const screen = track(await browser.connect({ token: seat.token }));
    expect(await screen.send('room:watch', { code })).toMatchObject({ ok: true });
    expect((await browser.register('Gus')).body).toMatchObject({ ok: true });
    seat.close();
    const back = track(await browser.connect({ token: seat.token }));
    expect(await back.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    const state = await chair.waitFor(
      ({ players, screens }) => screens === 1 && players.some(({ name, online }) => name === 'Gus' && online),
    );
    const gus = state.players.find(({ name }) => name === 'Gus')?.id;
    expect(await chair.send('room:remove', { playerId: gus })).toEqual({ ok: true });
    await until(() => back.closed.includes('removed_recently') && screen.closed.includes('removed_recently'), 'both');
    await chair.waitFor((now) => now.screens === 0 && now.players.length === 1);
  });

  test('without an account waits by their token, also after logging in on that browser', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await publicRoom(ann, { public: false });
    const guest = track(await joinRoom(server.url, code, 'Guest'));
    expect(await chair.send('room:remove', { playerId: guest.me })).toEqual({ ok: true });
    await until(() => guest.closed.includes('removed_recently'), 'the guest hears');
    expect(await guest.send('room:join', { code, name: 'Someone else', play: true })).toEqual({
      ok: false,
      error: 'removed_recently',
    });
    // The browser registers and comes back logged in: the token it still has keeps it out.
    const browser = new Browser(server.url);
    expect((await browser.register('Bob')).body).toMatchObject({ ok: true });
    const asBob = track(await browser.connect({ token: guest.token }));
    expect(asBob.account).toEqual({ username: 'Bob', avatar: null });
    expect(await asBob.send('room:join', { code, play: true })).toEqual({ ok: false, error: 'removed_recently' });
    expect(await asBob.send('room:watch', { code })).toEqual({ ok: false, error: 'removed_recently' });
    server.advance(REMOVED_FOR_MS);
    expect(await asBob.send('room:join', { code, play: true })).toMatchObject({ ok: true });
  });

  test('stays out as the room was when they were removed, whatever it becomes', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await publicRoom(ann);
    const bob = track(await (await loggedIn('Bob')).connect());
    expect(await bob.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.players.length === 2);
    // Removed from the public room, Bob stays out when it is made private, however long it lasts.
    expect(await chair.send('room:remove', { playerId: bob.me })).toEqual({ ok: true });
    await until(() => bob.closed.includes('removed'), 'Bob hears');
    expect(await chair.send('room:public', { public: false })).toEqual({ ok: true });
    server.advance(60 * 60_000);
    expect(await bob.send('room:join', { code, play: true })).toEqual({ ok: false, error: 'removed' });

    // Removed from it while it is private, a guest waits two minutes, also when it is made public
    // meanwhile; then, as a newcomer to a public room, they need an account.
    const guest = track(await joinRoom(server.url, code, 'Guest'));
    expect(await chair.send('room:remove', { playerId: guest.me })).toEqual({ ok: true });
    await until(() => guest.closed.includes('removed_recently'), 'the guest hears');
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: true });
    expect(await guest.send('room:join', { code, name: 'Guest', play: true })).toEqual({
      ok: false,
      error: 'removed_recently',
    });
    server.advance(REMOVED_FOR_MS);
    expect(await guest.send('room:join', { code, name: 'Guest', play: true })).toEqual({
      ok: false,
      error: 'account_required',
    });
    // Bob is still out, by the list or by the code.
    expect(await bob.send('room:join', { code, play: true })).toEqual({ ok: false, error: 'removed' });
  });

  test('is out of the game as if they had left, and the game goes on', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await publicRoom(ann);
    const bob = track(await (await loggedIn('Bob')).connect());
    expect(await bob.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.players.length === 2);
    expect(await chair.send('room:start', { round: 0 })).toEqual({ ok: true });
    await bob.waitFor((state) => state.phase === 'playing');
    expect(await chair.send('room:remove', { playerId: bob.me })).toEqual({ ok: true });
    await chair.waitFor((state) => state.players.length === 1);
    expect(chair.state).toMatchObject({ phase: 'playing', chairId: chair.me });
    expect(await chair.send('test:press')).toEqual({ ok: true });
    await chair.waitFor((state) => (state.data as { presses: number }).presses === 1);
  });
});

describe('a report', () => {
  async function roomWithBob() {
    const ann = await loggedIn('Ann');
    const bob = await loggedIn('Bob');
    const { chair, code } = await publicRoom(ann);
    const visitor = track(await bob.connect());
    expect(await visitor.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.players.length === 2);
    return { ann, bob, chair, visitor, code };
  }

  test('is kept with who reported whom, where and why, once per pair and room', async () => {
    server = await startServer();
    const { chair, visitor, code } = await roomWithBob();
    expect(await visitor.send('room:report', { playerId: chair.me, text: ' Rude\n\n\nclues ' })).toEqual({ ok: true });
    expect(server.feedback.reports(10)).toEqual([
      {
        id: 1,
        createdAt: expect.any(String),
        reporter: 'Bob',
        reported: 'Ann',
        reportedId: 1,
        reportedBarred: false,
        reportedName: 'Ann',
        roomCode: code,
        text: 'Rude\n\nclues',
      },
    ]);
    expect(server.logs.find(({ event }) => event === 'report_received')?.fields).toEqual({ id: 1, code });
    // The same pair again is answered as the first was, and kept once; the other way round is new.
    expect(await visitor.send('room:report', { playerId: chair.me })).toEqual({ ok: true });
    expect(server.feedback.reportCount()).toBe(1);
    expect(await chair.send('room:report', { playerId: visitor.me })).toEqual({ ok: true });
    expect(server.feedback.reports(10).map(({ reporter, reported, text }) => [reporter, reported, text])).toEqual([
      ['Ann', 'Bob', null],
      ['Bob', 'Ann', 'Rude\n\nclues'],
    ]);
    expect(server.feedback.reportCount()).toBe(2);
  });

  test('names a guest who was there before the room was listed by the name they had', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await publicRoom(ann, { public: false });
    const guest = track(await joinRoom(server.url, code, 'Guest'));
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: true });
    await guest.waitFor((state) => state.public);
    expect(await chair.send('room:report', { playerId: guest.me })).toEqual({ ok: true });
    expect(server.feedback.reports(10)[0]).toMatchObject({ reported: null, reportedId: null, reportedName: 'Guest' });
    // A guest has no account to report from.
    expect(await guest.send('room:report', { playerId: chair.me })).toEqual({ ok: false, error: 'account_required' });
    // The guest registers, and their seat becomes the account's: the same report isn't kept again.
    const browser = new Browser(server.url);
    expect((await browser.register('Gus')).body).toMatchObject({ ok: true });
    guest.close();
    track(await browser.connect({ token: guest.token, code }));
    await chair.waitFor(({ players }) =>
      players.some(({ id, name, online }) => id === guest.me && name === 'Gus' && online),
    );
    expect(await chair.send('room:report', { playerId: guest.me })).toEqual({ ok: true });
    expect(server.feedback.reportCount()).toBe(1);
  });

  test('is for members with accounts, about others in a public room, and is checked', async () => {
    server = await startServer();
    const { ann, chair, visitor } = await roomWithBob();
    expect(await chair.send('room:report', { playerId: chair.me })).toEqual({ ok: false, error: 'bad_request' });
    expect(await chair.send('room:report', { playerId: 'nobody' })).toEqual({ ok: false, error: 'no_such_player' });
    expect(await chair.send('room:report', { playerId: visitor.me, text: 'x'.repeat(301) })).toEqual({
      ok: false,
      error: 'report_too_long',
    });
    expect(await chair.send('room:report', { playerId: visitor.me, text: 'x'.repeat(1201) })).toEqual({
      ok: false,
      error: 'report_too_long',
    });
    const outside = track(await TestClient.connect(server.url));
    expect(await outside.send('room:report', { playerId: visitor.me })).toEqual({ ok: false, error: 'not_member' });
    // Not in a room that isn't public.
    const { chair: privateChair, code } = await publicRoom(ann, { public: false });
    const guest = track(await joinRoom(server.url, code, 'Guest'));
    expect(await privateChair.send('room:report', { playerId: guest.me })).toEqual({
      ok: false,
      error: 'not_public',
    });
    expect(server.feedback.reportCount()).toBe(0);
  });

  test('that the database could not take is refused, and can be sent again once it can', async () => {
    server = await startServer();
    const { chair, visitor, code } = await roomWithBob();
    // The database is over its size for the moment.
    server.feedback.limits.maxDatabaseBytes = 1;
    expect(await visitor.send('room:report', { playerId: chair.me, text: 'Rude' })).toEqual({
      ok: false,
      error: 'report_full',
    });
    expect(server.feedback.reportCount()).toBe(0);
    server.feedback.limits.maxDatabaseBytes = DEFAULT_FEEDBACK_LIMITS.maxDatabaseBytes;
    expect(await visitor.send('room:report', { playerId: chair.me, text: 'Rude' })).toEqual({ ok: true });
    expect(server.feedback.reports(10)).toMatchObject([{ reporter: 'Bob', reported: 'Ann', roomCode: code }]);
  });

  test('comes only so often from one account', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const bob = await loggedIn('Bob');
    // The guests join before the room is listed, as a room may be listed with the guests in it.
    const { chair, code } = await publicRoom(ann, { public: false });
    const guests: TestClient[] = [];
    for (let i = 0; i < DEFAULT_SOCKET_LIMITS.reportsPerHour; i += 1) {
      guests.push(track(await joinRoom(server.url, code, `Guest ${i}`, { play: false })));
    }
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: true });
    const visitor = track(await bob.connect());
    expect(await visitor.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.players.length === guests.length + 2);
    // Each guest is a new pair; the limit counts the reports kept.
    for (const guest of guests) expect(await chair.send('room:report', { playerId: guest.me })).toEqual({ ok: true });
    expect(await chair.send('room:report', { playerId: visitor.me })).toEqual({ ok: false, error: 'report_limited' });
    // A report that was kept is answered as it was, whatever the count: the answer to it may have
    // been lost on the way.
    expect(await chair.send('room:report', { playerId: guests[0]?.me })).toEqual({ ok: true });
    expect(server.feedback.reportCount()).toBe(guests.length);
    // Another account has its own count, also from the same address.
    expect(await visitor.send('room:report', { playerId: chair.me })).toEqual({ ok: true });
    // An hour later, the chair may again.
    server.advance(60 * 60_000 + 1);
    server.app.sockets.sweep();
    expect(await chair.send('room:report', { playerId: visitor.me })).toEqual({ ok: true });
  });
});
