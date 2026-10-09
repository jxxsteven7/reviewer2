import type { RecordsView } from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { Browser, createRoom, startServer, TestClient, until, type TestServer } from './helpers';

// Accounts in rooms: who a connection is, the name and seat of a player with an account, the
// nicknames that guests can't take, what happens to connections when a login ends or the account
// changes, and the record of the games that players with accounts finish.

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

async function guest() {
  return track(await TestClient.connect(server.url));
}

async function roomOf(browser: Browser, payload: Record<string, unknown> = {}) {
  const chair = track(await browser.connect());
  const reply = await chair.send('room:create', { game: 'test', language: 'en', fields: ['general'], ...payload });
  if (!reply.ok) throw new Error(`could not create a room: ${reply.error}`);
  await chair.waitFor((state) => state.code === reply.code);
  return { chair, code: reply.code as string, roomId: reply.roomId as string };
}

const names = (client: TestClient) => client.state?.players.map(({ name }) => name);

describe('a connection', () => {
  test('is the account that its browser is logged in to, and a guest otherwise', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const client = track(await ann.connect());
    expect(client.account).toEqual({ username: 'Ann', avatar: null });
    // It still gets a token, for when the browser logs out.
    expect(client.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await guest()).account).toBeNull();
    // A cookie that stands for no login, or a login cookie that isn't, makes a guest.
    expect(track(await new Browser(server.url).connect({}, { cookie: `r2s=${'x'.repeat(43)}` })).account).toBeNull();
  });

  test('from a page of another site is a guest, even with the cookie', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    expect(track(await ann.connect({}, { origin: 'https://evil.example' })).account).toBeNull();
  });
});

describe('a player with an account', () => {
  test('is called by the username in a room, whatever name the message gives', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await roomOf(ann, { name: 'Somebody else' });
    expect(names(chair)).toEqual(['Ann']);
    // Without a name at all, too, and the guest who joins sees it.
    const bob = await loggedIn('Bob');
    const visitor = track(await bob.connect());
    // Asked whether they have come to play, as a guest is asked for a name too.
    expect(await visitor.send('room:join', { code })).toEqual({ ok: false, error: 'name_required', language: 'en' });
    expect(await visitor.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    await visitor.waitFor((state) => state.players.length === 2);
    expect(names(visitor)).toEqual(['Ann', 'Bob']);
    // Nothing in the room says who has an account, apart from an avatar.
    expect(visitor.state?.players).toEqual([
      { id: expect.any(String), name: 'Ann', online: true },
      { id: expect.any(String), name: 'Bob', online: true },
    ]);
  });

  test('can not rename themselves in the room', async () => {
    server = await startServer();
    const { chair } = await roomOf(await loggedIn('Ann'));
    expect(await chair.send('room:rename', { name: 'Annie' })).toEqual({ ok: false, error: 'account_name' });
  });

  test('is one player on two devices, and comes back to the seat after reconnecting', async () => {
    server = await startServer();
    const phone = await loggedIn('Ann');
    const laptop = new Browser(server.url);
    await laptop.logIn('Ann');
    const { chair, code, roomId } = await roomOf(phone, { play: true });
    const other = track(await laptop.connect());
    // The account is in the room already, so it needs to say nothing more.
    expect(await other.send('room:join', { code })).toMatchObject({ ok: true });
    const state = await other.waitFor((view) => view.code === code);
    expect(state.me).toBe(chair.me);
    expect(state.players).toHaveLength(1);

    // The phone's connection drops, and a new one with another token comes back to the seat
    // through the handshake alone.
    chair.close();
    other.close();
    await until(() => server.app.rooms.find(code)?.onlineCount() === 0, 'the account to go offline');
    const back = track(await phone.connect({ code, roomId }));
    const again = await back.waitFor((view) => view.code === code);
    expect(again.me).toBe(state.me);
    expect(again.players).toEqual([{ id: state.me, name: 'Ann', online: true }]);
  });

  test('can not join a room where a guest already has the name', async () => {
    server = await startServer();
    const { code } = await createRoom(server.url, 'Ann');
    const ann = await loggedIn('Ann');
    const client = track(await ann.connect());
    expect(await client.send('room:join', { code, play: true })).toEqual({ ok: false, error: 'name_taken' });
  });
});

describe('a guest', () => {
  test('can not take a username as a nickname, in any case or width', async () => {
    server = await startServer();
    await loggedIn('Ann Lee');
    const visitor = await guest();
    const create = (name: string) =>
      visitor.send('room:create', { game: 'test', language: 'en', fields: ['general'], name });
    for (const name of ['Ann Lee', 'ann lee', 'ANN  LEE', '\u{ff21}nn Lee']) {
      expect(await create(name), name).toEqual({ ok: false, error: 'name_reserved' });
    }
    // That costs the address no room.
    for (let i = 0; i < 6; i += 1) await create('ann lee');
    const { code } = await createRoom(server.url, 'Ann');
    const joiner = await guest();
    expect(await joiner.send('room:join', { code, name: 'ANN LEE' })).toEqual({ ok: false, error: 'name_reserved' });
    expect(await joiner.send('room:join', { code, name: 'Annie' })).toMatchObject({ ok: true });
    await joiner.waitFor((state) => state.players.length === 2);
    expect(await joiner.send('room:rename', { name: 'ann lee' })).toEqual({ ok: false, error: 'name_reserved' });
  });

  test('keeps a nickname that nobody has registered, and a guest may take a name that is free again', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    await ann.request('/api/account/username', { username: 'Annabel' });
    const { chair } = await createRoom(server.url, 'Ann');
    expect(names(chair)).toEqual(['Ann']);
  });
});

describe('a login that ends', () => {
  test('closes its connections, which come back as guests, without the seat', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code, roomId } = await roomOf(ann, { play: true });
    const visitor = await guest();
    await visitor.send('room:join', { code, name: 'Cat' });
    await visitor.waitFor((state) => state.players.length === 2);

    await ann.request('/api/logout', {});
    await until(() => chair.disconnects.length > 0, 'the connection to close');
    expect(chair.loginsEnded).toBe(1);
    expect(chair.disconnects).toEqual(['io server disconnect']);
    // The browser comes back without its login: a guest, who is not in the room.
    const back = track(await ann.connect({ token: chair.token, code, roomId }));
    expect(back.account).toBeNull();
    expect(await back.send('room:join', { code, roomId })).toMatchObject({ ok: false, error: 'name_required' });
    // The others see Ann offline in her seat.
    await visitor.waitFor((state) => state.players.some((player) => player.name === 'Ann' && !player.online));
  });

  test('after a password change closes every connection of the account, which come back with the new login', async () => {
    server = await startServer();
    const phone = await loggedIn('Ann');
    const laptop = new Browser(server.url);
    await laptop.logIn('Ann');
    // Someone else has the phone's cookie, and a connection open with it.
    const thief = new Browser(server.url);
    thief.cookie = phone.cookie;
    const onPhone = track(await phone.connect());
    const onLaptop = track(await laptop.connect());
    const stolen = track(await thief.connect());
    expect(stolen.account).toEqual({ username: 'Ann', avatar: null });

    await phone.request('/api/account/password', { current: 'correct horse', password: 'battery staple' });
    await until(
      () => [onPhone, onLaptop, stolen].every((client) => client.disconnects.length > 0),
      'every connection to close',
    );
    expect([onPhone, onLaptop, stolen].map((client) => client.loginsEnded)).toEqual([1, 1, 1]);
    // The phone has the new login, and comes back as Ann; the others come back as guests.
    expect(track(await phone.connect()).account).toEqual({ username: 'Ann', avatar: null });
    expect(track(await laptop.connect()).account).toBeNull();
    expect(track(await thief.connect()).account).toBeNull();
  });
});

describe('an account that changes', () => {
  test('shows its new name in the rooms it is in, unless someone there has it', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await roomOf(ann);
    const visitor = await guest();
    await visitor.send('room:join', { code, name: 'Cat' });
    await visitor.waitFor((state) => state.players.length === 2);

    await ann.request('/api/account/username', { username: 'Annabel' });
    await visitor.waitFor((state) => state.players.some(({ name }) => name === 'Annabel'), 'the new name');
    expect(names(visitor)).toEqual(['Annabel', 'Cat']);
    // The account's own pages hear of it.
    await until(() => chair.account?.username === 'Annabel', 'the new session');

    // A guest in the room has "Cat", so the account keeps its name there.
    await ann.request('/api/account/username', { username: 'Cat' });
    await until(() => chair.account?.username === 'Cat', 'the second session');
    expect(names(visitor)).toEqual(['Annabel', 'Cat']);
  });

  test('that is deleted leaves every room it was in', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { code } = await createRoom(server.url, 'Cat');
    const client = track(await ann.connect());
    await client.send('room:join', { code, play: true });
    const cat = server.app.rooms.find(code);
    await until(() => cat?.members.size === 2, 'Ann to join');
    await ann.request('/api/account/delete', { password: 'correct horse' });
    await until(() => cat?.members.size === 1, 'Ann to leave');
    expect([...(cat?.members.values() ?? [])].map(({ name }) => name)).toEqual(['Cat']);
  });
});

describe('the record of games', () => {
  async function playedGame(finish: 'test:finish' | 'room:end') {
    const ann = await loggedIn('Ann');
    const bob = await loggedIn('Bob');
    const watcher = await loggedIn('Dee');
    const { chair, code } = await roomOf(ann, { play: true });
    const second = track(await bob.connect());
    await second.send('room:join', { code, play: true });
    const third = track(await watcher.connect());
    await third.send('room:join', { code, play: false });
    const fourth = await guest();
    await fourth.send('room:join', { code, name: 'Cat', play: true });
    await chair.waitFor((state) => state.players.length === 4);
    expect(await chair.send('room:start', { round: 0 })).toMatchObject({ ok: true });
    const { gameId } = await chair.waitFor((state) => state.phase === 'playing');
    await chair.send('test:press');
    if (finish === 'room:end') await chair.send('room:end', { gameId });
    else await chair.send('test:finish');
    await chair.waitFor((state) => state.phase === 'ended');
    return { ann, bob, watcher, chair, code, gameId: gameId as string };
  }

  const records = async (browser: Browser) =>
    (await browser.request('/api/account/records')).body.records as RecordsView;

  test('keeps a finished game for every player with an account who took part', async () => {
    server = await startServer();
    const { ann, bob, watcher, chair } = await playedGame('test:finish');
    const record = {
      game: 'test',
      endedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      side: 'all',
      role: 'player',
      winner: 'all',
      won: true,
      verdict: 'pressed 1',
    };
    expect(await records(ann)).toEqual({ games: 1, wins: 1, recent: [record] });
    expect(await records(bob)).toEqual({ games: 1, wins: 1, recent: [record] });
    // Dee only watched.
    expect(await records(watcher)).toEqual({ games: 0, wins: 0, recent: [] });
    // Only accounts have records.
    expect(server.db.prepare('SELECT count(*) AS count FROM game_records').get()).toEqual({ count: 2 });

    // Another round is another game.
    const { gameId } = chair.state ?? {};
    await chair.send('room:again', { gameId });
    await chair.waitFor((state) => state.phase === 'lobby');
    await chair.send('room:start', { round: 1 });
    await chair.waitFor((state) => state.phase === 'playing');
    await chair.send('test:finish');
    await chair.waitFor((state) => state.phase === 'ended');
    expect((await records(ann)).games).toBe(2);
  });

  test('keeps nothing of a game that the chair withdrew', async () => {
    server = await startServer();
    const { ann } = await playedGame('room:end');
    expect(await records(ann)).toEqual({ games: 0, wins: 0, recent: [] });
  });
});
