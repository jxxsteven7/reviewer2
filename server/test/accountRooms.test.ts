import type { RecordsView } from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { Browser, createRoom, startServer, TestClient, until, type TestServer } from './helpers';
import { jpeg } from './images';

const NO_MATCHES = { played: 0, won: 0, recent: [] };
const NONE = { games: 0, wins: 0 };
const NO_RECORDS = { ordinary: NONE, inMatches: NONE, recent: [], matches: NO_MATCHES };

// Accounts in rooms: who a connection is, the name and seat of a player with an account, the
// guests beside them and those who log in, what happens to connections when a login ends or the
// account changes, and the record of the games that players with accounts finish.

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
    // Asked whether they have come to play, as a guest is too.
    expect(await visitor.send('room:join', { code })).toEqual({ ok: false, error: 'play_required', language: 'en' });
    expect(await visitor.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    await visitor.waitFor((state) => state.players.length === 2);
    expect(names(visitor)).toEqual(['Ann', 'Bob']);
    // Nothing in the room says who has an account, apart from an avatar, the rank and the handle
    // of their public page.
    expect(visitor.state?.players).toEqual([
      { id: expect.any(String), name: 'Ann', online: true, rank: 'kindergarten', handle: expect.any(String) },
      { id: expect.any(String), name: 'Bob', online: true, rank: 'kindergarten', handle: expect.any(String) },
    ]);
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
    expect(again.players).toEqual([
      { id: state.me, name: 'Ann', online: true, rank: 'kindergarten', handle: expect.any(String) },
    ]);
  });
});

describe('a guest', () => {
  test('is numbered among the guests alone, beside players with accounts, who have no number', async () => {
    server = await startServer();
    const { chair, code } = await roomOf(await loggedIn('Ann'));
    const cat = await guest();
    expect(await cat.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    const bob = track(await (await loggedIn('Bob')).connect());
    expect(await bob.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    const dee = await guest();
    expect(await dee.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    const { players } = await chair.waitFor((state) => state.players.length === 4, 'four players');
    const handle = expect.any(String);
    expect(players).toEqual([
      { id: chair.me, name: 'Ann', online: true, rank: 'kindergarten', handle },
      { id: expect.any(String), name: 'Guest 1', guest: 1, online: true },
      { id: expect.any(String), name: 'Bob', online: true, rank: 'kindergarten', handle },
      { id: expect.any(String), name: 'Guest 2', guest: 2, online: true },
    ]);
    expect(players.filter((player) => 'guest' in player).map(({ name }) => name)).toEqual(['Guest 1', 'Guest 2']);
  });

  test("can't pass for an account by sending its username, which a room leaves out", async () => {
    server = await startServer();
    await loggedIn('Ann Lee');
    const visitor = await guest();
    const created = await visitor.send('room:create', {
      game: 'test',
      language: 'en',
      fields: ['general'],
      name: 'Ann Lee',
    });
    if (!created.ok) throw new Error(created.error);
    const code = created.code as string;
    const joiner = await guest();
    expect(await joiner.send('room:join', { code, name: 'ANN LEE', play: false })).toMatchObject({ ok: true });
    const { players } = await joiner.waitFor((state) => state.players.length === 2);
    expect(players).toEqual([
      { id: expect.any(String), name: 'Guest 1', guest: 1, online: true },
      { id: joiner.me, name: 'Guest 2', guest: 2, online: true },
    ]);
  });
});

describe('a guest who logs in or registers', () => {
  test("comes back to the seat they took as a guest, which becomes the account's", async () => {
    server = await startServer();
    const { chair, code } = await createRoom(server.url);
    const asGuest = await guest();
    await asGuest.send('room:join', { code, play: true });
    const { me: seat, players } = await asGuest.waitFor((state) => state.players.length === 2);
    expect(players.find(({ id }) => id === seat)).toMatchObject({ name: 'Guest 2', guest: 2 });
    const { token } = asGuest;
    asGuest.close();
    // Guest 2 registers as Ann on the home page, and opens the room again, with the token she had.
    const ann = await loggedIn('Ann');
    const back = track(await ann.connect({ token, code }));
    const state = await back.waitFor((view) => view.players.some(({ name, online }) => name === 'Ann' && online));
    expect(state.me).toBe(seat);
    await chair.waitFor((view) => view.players.some(({ name }) => name === 'Ann'));
    expect(names(chair)).toEqual(['Guest 1', 'Ann']);
    // She is no guest any more, and has no number.
    expect(chair.state?.players.find(({ id }) => id === seat)).not.toHaveProperty('guest');
    // The seat is the account's now: another device of the account shares it, without the token.
    const other = track(await ann.connect());
    expect(await other.send('room:join', { code })).toMatchObject({ ok: true });
    await other.waitFor((view) => view.me === seat);
  });

  test('has the number they had as a guest again, once logged out', async () => {
    server = await startServer();
    const { chair, code } = await createRoom(server.url);
    track(chair);
    const asGuest = await guest();
    await asGuest.send('room:join', { code, play: true });
    await asGuest.waitFor((state) => state.players.length === 2);
    const { token } = asGuest;
    asGuest.close();
    const ann = await loggedIn('Ann');
    const back = track(await ann.connect({ token, code }));
    await back.waitFor((view) => view.players.some(({ name, online }) => name === 'Ann' && online));
    // Ann logs out, and her browser comes back as the guest it was, beside her seat.
    await ann.request('/api/logout', {});
    await until(() => back.disconnects.length > 0, 'the connection to close');
    const again = track(await ann.connect({ token }));
    expect(again.account).toBeNull();
    expect(await again.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    const { players } = await again.waitFor((view) => view.players.length === 3);
    expect(players.find(({ id }) => id === again.me)).toMatchObject({ name: 'Guest 2', guest: 2 });
    expect(names(again)).toEqual(['Guest 1', 'Ann', 'Guest 2']);
  });
});

describe('an avatar that the operator took down', () => {
  test('is gone from the rooms by the next sweep', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const avatar = (await ann.upload(jpeg())).body.avatar as string;
    const { chair } = await roomOf(ann, { play: true });
    expect(chair.state?.players[0]?.avatar).toBe(avatar);
    // The operator's command runs in another process, on the database alone (admin.ts).
    const account = server.accounts.store.byKey('ann');
    if (!account) throw new Error('no account');
    server.accounts.store.setAvatar(account.id, null);
    server.app.sockets.sweep();
    await chair.waitFor((state) => state.players[0]?.avatar === undefined, 'the default avatar');
  });
});

describe('a login that ends', () => {
  test('closes its connections, which come back as guests, without the seat', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code, roomId } = await roomOf(ann, { play: true });
    const visitor = await guest();
    await visitor.send('room:join', { code, play: false });
    await visitor.waitFor((state) => state.players.length === 2);

    await ann.request('/api/logout', {});
    await until(() => chair.disconnects.length > 0, 'the connection to close');
    expect(chair.loginsEnded).toBe(1);
    expect(chair.disconnects).toEqual(['io server disconnect']);
    // The browser comes back without its login: a guest, who is not in the room.
    const back = track(await ann.connect({ token: chair.token, code, roomId }));
    expect(back.account).toBeNull();
    expect(await back.send('room:join', { code, roomId })).toMatchObject({ ok: false, error: 'play_required' });
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
  test('shows its new name in the rooms it is in, at once', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await roomOf(ann);
    const visitor = await guest();
    await visitor.send('room:join', { code, play: false });
    const cat = await loggedIn('Cat');
    const catInRoom = track(await cat.connect());
    await catInRoom.send('room:join', { code, play: false });
    await visitor.waitFor((state) => state.players.length === 3);

    await ann.request('/api/account/username', { username: 'Annabel' });
    await visitor.waitFor((state) => state.players.some(({ name }) => name === 'Annabel'), 'the new name');
    expect(names(visitor)).toEqual(['Annabel', 'Guest 1', 'Cat']);
    // The account's own pages hear of it.
    await until(() => chair.account?.username === 'Annabel', 'the new session');

    // The chair removes Cat, who stays out by the keys of her account and her browser, not by her
    // name: once her account takes another name and Ann's takes "Cat", the room shows Ann as Cat.
    expect(await chair.send('room:remove', { playerId: catInRoom.me })).toEqual({ ok: true });
    await visitor.waitFor((state) => state.players.length === 2, 'Cat removed');
    await cat.request('/api/account/username', { username: 'Cathy' });
    await ann.request('/api/account/username', { username: 'Cat' });
    await until(() => chair.account?.username === 'Cat', 'the second session');
    await visitor.waitFor((state) => state.players.some(({ name }) => name === 'Cat'), 'the name again');
    expect(names(visitor)).toEqual(['Cat', 'Guest 1']);
  });

  test('that is deleted leaves every room it was in, whatever a game makes of that', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { code } = await createRoom(server.url);
    const client = track(await ann.connect());
    await client.send('room:join', { code, play: true });
    const cat = server.app.rooms.find(code);
    await until(() => cat?.members.size === 2, 'Ann to join');
    // In another room, the game lets nobody leave.
    const { chair: dee, code: other } = await createRoom(server.url);
    const second = track(await ann.connect());
    await second.send('room:join', { code: other, play: true });
    await dee.waitFor((state) => state.players.length === 2);
    await dee.send('test:break', 'leave');
    expect((await ann.request('/api/account/delete', { password: 'correct horse' })).status).toBe(200);
    await until(() => cat?.members.size === 1, 'Ann to leave');
    expect([...(cat?.members.values() ?? [])].map(({ name }) => name)).toEqual(['Guest 1']);
    expect(server.logs.filter(({ event }) => event === 'error').map(({ fields }) => fields?.where)).toEqual([
      'account_deleted',
    ]);
    expect(server.logs.some(({ event }) => event === 'account_deleted')).toBe(true);
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
    await fourth.send('room:join', { code, play: true });
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
      gameId: chair.state?.gameId,
      endedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      side: 'all',
      role: 'player',
      winner: 'all',
      won: true,
      verdict: 'pressed 1',
      replay: true,
      match: null,
      agents: false,
    };
    const one = { ordinary: { games: 1, wins: 1 }, inMatches: NONE, recent: [record], matches: NO_MATCHES };
    expect(await records(ann)).toEqual(one);
    expect(await records(bob)).toEqual(one);
    // Dee only watched.
    expect(await records(watcher)).toEqual(NO_RECORDS);
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
    expect((await records(ann)).ordinary.games).toBe(2);
  });

  test('keeps nothing of a game that the chair withdrew on the records, and the game only as withdrawn', async () => {
    server = await startServer();
    const { ann } = await playedGame('room:end');
    expect(await records(ann)).toEqual(NO_RECORDS);
    // The record of the game itself, for whoever studies the games (docs/architecture.md#game-records).
    await until(() => server.db.prepare('SELECT count(*) AS count FROM replays').get()?.count === 1, 'the record');
    expect(server.db.prepare('SELECT ending, log IS NOT NULL AS log FROM replays').get()).toEqual({
      ending: 'withdrawn',
      log: 1,
    });
  });
});

const records = async (browser: Browser) => (await browser.request('/api/account/records')).body.records as RecordsView;

describe('a replay', () => {
  const replay = (browser: Browser, gameId: string) => browser.request('/api/account/replay', { gameId });

  test('is kept once for a finished game, for every account that played in it, and for nobody else', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const bob = await loggedIn('Bob');
    const watcher = await loggedIn('Dee');
    const { chair, code } = await roomOf(ann, { play: true });
    const second = track(await bob.connect());
    await second.send('room:join', { code, play: true });
    const third = track(await watcher.connect());
    await third.send('room:join', { code, play: false });
    await chair.waitFor((state) => state.players.length === 3);
    await chair.send('room:start', { round: 0 });
    const { gameId } = (await chair.waitFor((state) => state.phase === 'playing')) as { gameId: string };
    await chair.send('test:press');
    await chair.send('test:finish');
    await chair.waitFor((state) => state.phase === 'ended');
    await until(() => server.db.prepare('SELECT count(*) AS count FROM replays').get()?.count === 1, 'the replay');

    const kept = { presses: 1, words: expect.arrayContaining([expect.stringMatching(/^general word \d+$/)]) };
    expect((await replay(ann, gameId)).body).toEqual({ ok: true, replay: kept });
    expect((await replay(bob, gameId)).body).toEqual({ ok: true, replay: kept });
    // Dee only watched, and a stranger never played here.
    expect(await replay(watcher, gameId)).toMatchObject({ status: 404, body: { ok: false, error: 'no_replay' } });
    expect(await replay(await loggedIn('Eve'), gameId)).toMatchObject({ status: 404 });
    expect(await replay(ann, 'no-such-game')).toMatchObject({ status: 404 });
    // A replay needs a login.
    expect((await new Browser(server.url).request('/api/account/replay', { gameId })).status).toBe(401);
    // The end of the game is reported once more, as when the last player leaves: still one replay.
    await second.send('room:leave');
    await chair.waitFor((state) => state.players.length === 2);
    expect(server.db.prepare('SELECT count(*) AS count FROM replays').get()).toEqual({ count: 1 });

    // Bob deletes the account: the replay stays, and Ann still reads it.
    expect((await bob.request('/api/account/delete', { password: 'correct horse' })).body).toEqual({ ok: true });
    expect(server.db.prepare('SELECT count(*) AS count FROM game_records').get()).toEqual({ count: 1 });
    expect(server.db.prepare('SELECT count(*) AS count FROM replays').get()).toEqual({ count: 1 });
    expect((await replay(ann, gameId)).body).toEqual({ ok: true, replay: kept });
  });

  test("is not kept for a room with the chair's own words, while the records are", async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    const { chair, code } = await roomOf(ann, { play: true });
    expect(await chair.send('room:settings', { words: 'Mine' })).toEqual({ ok: true });
    const bob = track(await TestClient.connect(server.url));
    await bob.send('room:join', { code, play: true });
    await chair.waitFor((state) => state.players.length === 2);
    await chair.send('room:start', { round: 0 });
    const { gameId } = (await chair.waitFor((state) => state.phase === 'playing')) as { gameId: string };
    await chair.send('test:finish');
    await chair.waitFor((state) => state.phase === 'ended');
    await until(() => server.db.prepare('SELECT count(*) AS count FROM game_records').get()?.count === 1, 'the record');
    expect(server.db.prepare('SELECT count(*) AS count FROM replays').get()).toEqual({ count: 0 });
    expect((await records(ann)).recent[0]).toMatchObject({ gameId, replay: false });
    expect(await replay(ann, gameId)).toMatchObject({ status: 404 });
  });

  test('is kept when nobody with an account played, for nobody to watch', async () => {
    server = await startServer();
    const { chair, code } = await createRoom(server.url, { play: true });
    track(chair);
    const bob = track(await TestClient.connect(server.url));
    await bob.send('room:join', { code, play: true });
    await chair.waitFor((state) => state.players.length === 2);
    await chair.send('room:start', { round: 0 });
    await chair.waitFor((state) => state.phase === 'playing');
    await chair.send('test:finish');
    await chair.waitFor((state) => state.phase === 'ended');
    await until(() => server.db.prepare('SELECT count(*) AS count FROM replays').get()?.count === 1, 'the record');
    expect(server.db.prepare('SELECT count(*) AS count FROM game_players').get()).toEqual({ count: 0 });
  });
});

describe('the last room setup', () => {
  test('is kept for an account as it makes a room, the last one alone, and for nobody else', async () => {
    server = await startServer();
    const ann = await loggedIn('Ann');
    expect((await ann.account())?.roomSetup).toEqual({});
    // The settings are kept as the game took them, without what it left out.
    await roomOf(ann, { settings: { level: 2, extra: true }, play: true });
    expect((await ann.account())?.roomSetup).toEqual({
      room: {
        game: 'test',
        language: 'en',
        fields: ['general'],
        randomFields: false,
        settings: { level: 2 },
        match: null,
        public: false,
        play: true,
      },
    });
    await roomOf(ann, { language: 'zh', fields: ['general', 'tiny'], randomFields: true });
    expect((await ann.account())?.roomSetup).toEqual({
      room: {
        game: 'test',
        language: 'zh',
        fields: ['general', 'tiny'],
        randomFields: true,
        match: null,
        public: false,
        play: false,
      },
    });
    // A room that isn't made keeps nothing, and a guest's rooms are nobody's.
    const chair = track(await ann.connect());
    expect(await chair.send('room:create', { game: 'test', language: 'en', fields: ['nope'] })).toEqual({
      ok: false,
      error: 'bad_fields',
    });
    await createRoom(server.url).then(({ chair: bob }) => track(bob));
    expect(server.db.prepare('SELECT username FROM accounts WHERE room_setup IS NOT NULL').all()).toEqual([
      { username: 'Ann' },
    ]);
    expect((await ann.account())?.roomSetup).toMatchObject({ room: { fields: ['general', 'tiny'] } });
  });
});
