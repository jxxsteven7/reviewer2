import { resolve } from 'node:path';
import { CODE_ALPHABET, EMOTE_COOLDOWN_MS, EMOTES, MAX_PLAYERS, MAX_SCREENS } from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { GameModule } from '../src/core/game';
import { seededRng } from '../src/core/random';
import { DEFAULT_SOCKET_LIMITS } from '../src/core/socket';
import { loadWordLibrary, WordLibrary } from '../src/core/words';
import type { FakeView } from './fakeGame';
import { fakeGame } from './fakeGame';
import {
  createRoom,
  joinRoom,
  rawPolling,
  startServer,
  TestClient,
  until,
  wordList,
  type Reply,
  type TestServer,
} from './helpers';

let server: TestServer;
let clients: TestClient[];

beforeEach(async () => {
  server = await startServer();
  clients = [];
});

afterEach(async () => {
  for (const client of clients) client.close();
  await server.close();
});

const track = <T extends TestClient>(client: T): T => {
  clients.push(client);
  return client;
};
const connect = async (
  auth: Parameters<typeof TestClient.connect>[1] = {},
  options: Parameters<typeof TestClient.connect>[2] = {},
) => track(await TestClient.connect(server.url, auth, options));
// A room whose chair is a guest, and so its first: Guest 1.
const room = async () => {
  const created = await createRoom(server.url);
  track(created.chair);
  return created;
};
// A guest who joins a room to watch, numbered after those who came before.
const join = async (code: string) => track(await joinRoom(server.url, code));
const names = (client: TestClient) => client.state?.players.map((player) => player.name);
// Whether a player is online, as a client sees them.
const online = (client: TestClient, player: TestClient) =>
  client.state?.players.find(({ id }) => id === player.me)?.online;
const game = (client: TestClient) => client.state?.data as FakeView;
// What the server has logged of one kind of event.
const logged = (event: string) => server.logs.filter((entry) => entry.event === event).map((entry) => entry.fields);
// The chair's messages about a game say which game they mean; these send what the chair sees.
const start = (chair: TestClient) => chair.send('room:start', { round: chair.state?.round });
const again = (chair: TestClient) => chair.send('room:again', { gameId: chair.state?.gameId });
// The names of a room's members as the server has them, whatever has reached the clients.
const members = (code: string) => [...(server.app.rooms.find(code)?.members.values() ?? [])].map(({ name }) => name);

describe('identity', () => {
  test('a new browser gets a token, and a browser that has one keeps it', async () => {
    const first = await connect();
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.version).toBe('test');
    const again = await connect({ token: first.token });
    expect(again.token).toBe(first.token);
  });

  test('a malformed token is replaced', async () => {
    const client = await connect({ token: 'not-a-token' });
    expect(client.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('creating a room', () => {
  test('puts its creator in the chair', async () => {
    const { chair, code, roomId } = await room();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(chair.state).toMatchObject({
      code,
      roomId,
      game: 'test',
      language: 'en',
      fields: ['general'],
      phase: 'lobby',
    });
    expect(chair.state?.chairId).toBe(chair.me);
    expect(chair.state?.players).toEqual([{ id: chair.me, name: 'Guest 1', guest: 1, online: true }]);
    expect(chair.state?.screens).toBe(0);
  });

  test('offers no practice room on a server without an agent', async () => {
    const client = await connect();
    expect(await client.send('meta:agents')).toEqual({ ok: true, available: null });
  });

  test('checks what it is given', async () => {
    const client = await connect();
    const create = (payload: Record<string, unknown>) =>
      client.send('room:create', { game: 'test', language: 'en', fields: ['general'], ...payload });
    expect(await create({ game: 'chess' })).toEqual({ ok: false, error: 'bad_game' });
    expect(await create({ fields: ['nope'] })).toEqual({ ok: false, error: 'bad_fields' });
    expect(await create({ fields: ['tiny'] })).toEqual({ ok: false, error: 'no_words' });
    expect(await create({ language: 'fr' })).toEqual({ ok: false, error: 'bad_request' });
    // No word list at all is too few words, until the chair has words of their own.
    expect(await create({ fields: [] })).toEqual({ ok: false, error: 'no_words' });
    expect(await create({ play: 'yes' })).toEqual({ ok: false, error: 'bad_request' });
    expect(await client.send('room:create', 'nonsense')).toEqual({ ok: false, error: 'bad_request' });
  });

  test("takes the game's settings, or starts with the game's defaults", async () => {
    const plain = await room();
    expect(game(plain.chair).level).toBe(1);
    const { chair } = await createRoom(server.url, { settings: { level: 3 } });
    track(chair);
    expect(game(chair).level).toBe(3);
  });

  test('leaves no room behind when the game refuses its settings', async () => {
    const client = await connect();
    const reply = await client.send('room:create', {
      game: 'test',
      language: 'en',
      fields: ['general'],
      settings: { level: 9 },
    });
    expect(reply).toEqual({ ok: false, error: 'bad_settings' });
    expect(server.app.rooms.size).toBe(0);
    expect(client.states).toEqual([]);
  });

  test('tells the game whether each newcomer came to play, once', async () => {
    const created = await createRoom(server.url, { play: true });
    const chair = track(created.chair);
    const { code } = created;
    const bob = track(await joinRoom(server.url, code, { play: true }));
    await join(code);
    track(await joinRoom(server.url, code, { play: false }));
    await chair.waitFor((state) => state.players.length === 4, 'four players');
    expect(game(chair).players).toEqual([chair.me, bob.me]);
    // Whoever is in the room already has made their choice: asking again changes nothing.
    const tab = await connect({ token: bob.token });
    expect(await tab.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    const eve = await connect();
    expect(await eve.send('room:join', { code, play: 'yes' })).toEqual({
      ok: false,
      error: 'bad_request',
    });
    expect(game(chair).players).toEqual([chair.me, bob.me]);
  });
});

describe('joining a room', () => {
  test('needs a code that exists and, from a newcomer, whether they play', async () => {
    const { code } = await room();
    const client = await connect();
    expect(await client.send('room:join', { code: 'ZZZZ' })).toEqual({ ok: false, error: 'room_not_found' });
    // The answer has the room's language, for the question that the newcomer is asked.
    expect(await client.send('room:join', { code })).toEqual({ ok: false, error: 'play_required', language: 'en' });
    const zh = await createRoom(server.url, { language: 'zh' });
    track(zh.chair);
    expect(await client.send('room:join', { code: zh.code })).toEqual({
      ok: false,
      error: 'play_required',
      language: 'zh',
    });
    expect(await client.send('room:join', { code, play: true })).toMatchObject({ ok: true, code });
  });

  test('numbers guests in the order they came in, whatever name a message gives', async () => {
    // Names were once asked of guests; a client that still sends one has it left out.
    const created = await createRoom(server.url, { name: 'Ann' });
    const chair = track(created.chair);
    const bob = await connect();
    expect(await bob.send('room:join', { code: created.code, name: 'Bob', play: false })).toMatchObject({ ok: true });
    await bob.waitFor((state) => state.code === created.code);
    const cat = await join(created.code);
    await chair.waitFor((state) => state.players.length === 3, 'three guests');
    expect(chair.state?.players.map(({ id, name, guest }) => ({ id, name, guest }))).toEqual([
      { id: chair.me, name: 'Guest 1', guest: 1 },
      { id: bob.me, name: 'Guest 2', guest: 2 },
      { id: cat.me, name: 'Guest 3', guest: 3 },
    ]);
  });

  test('gives a guest who comes back the number they had, and a new guest a number nobody had', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    const cat = await join(code);
    expect(await bob.send('room:leave')).toEqual({ ok: true });
    expect(await cat.send('room:leave')).toEqual({ ok: true });
    await chair.waitFor((state) => state.players.length === 1, 'both have left');
    // A newcomer is the fourth guest, although the second and the third have gone.
    const dan = await join(code);
    expect(await bob.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.players.length === 3, 'Dan and Bob are in');
    expect(chair.state?.players.map(({ name, guest }) => ({ name, guest }))).toEqual([
      { name: 'Guest 1', guest: 1 },
      { name: 'Guest 4', guest: 4 },
      { name: 'Guest 2', guest: 2 },
    ]);
    expect(chair.state?.players[1]?.id).toBe(dan.me);
  });

  test('tells everyone who is there', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    await chair.waitFor((state) => state.players.length === 2);
    expect(names(chair)).toEqual(['Guest 1', 'Guest 2']);
    expect(names(bob)).toEqual(['Guest 1', 'Guest 2']);
    expect(bob.state?.chairId).toBe(chair.me);
  });

  test('accepts the code however it is typed', async () => {
    const { code } = await room();
    const loose = `r2 ${code.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l')}`;
    const client = await connect();
    expect(await client.send('room:join', { code: loose, play: false })).toMatchObject({ ok: true, code });
    // None of the spellings of the right code is a wrong code: nothing was counted.
    expect(await client.send('room:watch', { code: `R2${code}` })).toMatchObject({ ok: true, code });
  });

  test('stops at the room size limit', async () => {
    const { code } = await room();
    for (let i = 1; i < MAX_PLAYERS; i += 1) await join(code);
    const late = await connect();
    expect(await late.send('room:join', { code, play: false })).toEqual({ ok: false, error: 'room_full' });
    // A newcomer hears it before being asked whether they play.
    expect(await late.send('room:join', { code })).toEqual({ ok: false, error: 'room_full' });
  });
});

describe('connections', () => {
  test('a player who reconnects with their token is put back, before anything else happens', async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code);
    bob.close();
    await chair.waitFor(() => online(chair, bob) === false, 'Bob offline');

    const back = await connect({ token: bob.token, code, roomId });
    await back.waitFor((state) => state.code === code, 'Bob back');
    await chair.waitFor(() => online(chair, bob) === true, 'Bob online');
    expect(names(chair)).toEqual(['Guest 1', 'Guest 2']);
    expect(back.me).toBe(bob.me);
  });

  test('joining again with the same token returns to the same seat', async () => {
    const { code } = await room();
    const bob = await join(code);
    const again = await connect({ token: bob.token });
    expect(await again.send('room:join', { code })).toMatchObject({ ok: true });
    await again.waitFor((state) => state.me === bob.me);
  });

  test('the handshake also works with the code alone', async () => {
    const { code } = await room();
    const bob = await join(code);
    bob.close();
    const back = await connect({ token: bob.token, code });
    await back.waitFor((state) => state.me === bob.me, 'Bob back');
    expect(back.closed).toEqual([]);
  });

  test('a stale room ID is answered with room:closed', async () => {
    const { chair, code } = await room();
    const client = await connect({ token: chair.token, code, roomId: 'old-room' });
    await until(() => client.closed.includes('expired'), 'room:closed');
  });

  test('two tabs with one token are one player, online while either is', async () => {
    const { chair, code } = await room();
    const tab1 = await join(code);
    const tab2 = await connect({ token: tab1.token });
    await tab2.send('room:join', { code });
    await tab2.waitFor((state) => state.me === tab1.me);
    expect(names(chair)).toEqual(['Guest 1', 'Guest 2']);
    tab1.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(online(chair, tab2)).toBe(true);
  });
});

describe('the handshake', () => {
  test('lets nobody in for the first time, and says nothing about a bare code', async () => {
    const { code } = await room();
    const clients = [
      await connect({ code }),
      await connect({ watch: code }),
      await connect({ code: 'ZZZZ' }),
      await connect({ watch: 'ZZZZ' }),
    ];
    for (const client of clients) {
      // An answered message shows that nothing else was on its way.
      expect(await client.send('sys:ping')).toEqual({ ok: true });
      expect(client.states).toEqual([]);
      expect(client.closed).toEqual([]);
    }
    expect(members(code)).toEqual(['Guest 1']);
    expect(server.app.rooms.find(code)?.screens.size).toBe(0);
  });

  test("answers a room ID that is not the room's with room:closed, whatever the code", async () => {
    const { chair, code } = await room();
    for (const auth of [
      { watch: code, roomId: 'another-room' },
      { watch: 'ZZZZ', roomId: 'another-room' },
      { token: chair.token, code, roomId: 'another-room' },
      { code: 'ZZZZ', roomId: 'another-room' },
    ]) {
      const client = await connect(auth);
      await until(() => client.closed.length > 0, 'room:closed');
      expect(client.closed, JSON.stringify(auth)).toEqual(['expired']);
      expect(client.states).toEqual([]);
    }
  });

  test('leaves it to room:join to tell a player who lost their seat while away', async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code);
    const cat = await join(code);
    bob.close();
    cat.close();
    await chair.waitFor(() => online(chair, bob) === false && online(chair, cat) === false);
    expect(await chair.send('room:remove', { playerId: bob.me })).toEqual({ ok: true });
    server.advance(10 * 60_000 + 1);
    server.app.sockets.sweep(); // drops Cat, who has been away from the waiting room too long

    // Neither is a member any more, so the handshake brings neither back and says nothing.
    const bobBack = await connect({ token: bob.token, code, roomId });
    const catBack = await connect({ token: cat.token, code, roomId });
    for (const client of [bobBack, catBack]) {
      expect(await client.send('sys:ping')).toEqual({ ok: true });
      expect(client.states).toEqual([]);
      expect(client.closed).toEqual([]);
    }
    // The message that follows does. Bob was removed more than two minutes ago by now, so
    // remove him again to see that answer.
    expect(await catBack.send('room:join', { code, roomId })).toEqual({
      ok: false,
      error: 'play_required',
      language: 'en',
    });
    expect(await bobBack.send('room:join', { code, roomId, play: false })).toMatchObject({ ok: true });
    expect(await chair.send('room:remove', { playerId: bobBack.me })).toEqual({ ok: true });
    const again = await connect({ token: bob.token, code, roomId });
    expect(await again.send('room:join', { code, roomId })).toEqual({ ok: false, error: 'removed_recently' });
  });

  test('takes a field that is not what it should be for a missing one', async () => {
    const { code } = await room();
    const bob = await join(code);
    bob.close();
    const back = await connect({ token: bob.token, code, roomId: null });
    await back.waitFor((state) => state.me === bob.me, 'Bob back');
    expect(back.closed).toEqual([]);
    // The message that follows the handshake takes "no room ID" in the same two ways.
    expect(await back.send('room:join', { code, roomId: null })).toMatchObject({ ok: true });
    const screen = await connect();
    expect(await screen.send('room:watch', { code, roomId: null })).toMatchObject({ ok: true });

    const odd = await connect({ token: 42, code: { length: 4 }, roomId: 7, watch: ['K7QX'] });
    expect(odd.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await odd.send('sys:ping')).toEqual({ ok: true });
    expect(odd.closed).toEqual([]);
  });
});

describe('snapshots', () => {
  test('are not sent for a message that changed nothing', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    await chair.waitFor(() => online(chair, bob) === true);
    await bob.send('sys:ping');
    const before = { rev: chair.state?.rev, chair: chair.states.length, bob: bob.states.length };
    // A game message that the module grants without changing its data.
    expect(await bob.send('test:nothing')).toEqual({ ok: true });
    await chair.send('sys:ping');
    await bob.send('sys:ping');
    expect({ rev: chair.state?.rev, chair: chair.states.length, bob: bob.states.length }).toEqual(before);
    expect(await bob.send('test:press')).toEqual({ ok: false, error: 'wrong_phase' });
    await start(chair);
    expect(await bob.send('test:press')).toEqual({ ok: true });
    await chair.waitFor((state) => state.rev === (before.rev as number) + 2, 'the start and the press');
  });

  test('reach every tab of a player and every screen, each with its own view', async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code);
    const tab = await connect({ token: bob.token, code, roomId });
    const screens = [await connect({ watch: code, roomId }), await connect({ watch: code, roomId })];
    expect(await chair.send('room:settings', { settings: { level: 2 } })).toEqual({ ok: true });
    for (const client of [chair, bob, tab, ...screens]) await client.waitFor(() => game(client).level === 2);
    expect([chair, bob, tab, ...screens].map((client) => client.state?.me)).toEqual([
      chair.me,
      bob.me,
      bob.me,
      null,
      null,
    ]);
    expect([bob, tab, ...screens].map((client) => game(client).forViewer)).toEqual([
      `for ${bob.me}`,
      `for ${bob.me}`,
      'for screens',
      'for screens',
    ]);
  });

  test('are not sent around for a second tab, or for asking again', async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code);
    await chair.waitFor(() => online(chair, bob) === true);
    const found = server.app.rooms.find(code);
    const tabsOfBob = () => found?.memberByKey(found.members.get(bob.me)?.key ?? '')?.sockets.size;
    const before = { rev: found?.rev, chair: chair.states.length, bob: bob.states.length };

    // Bob asks again on his connection, as a client does after every reconnect. Then he opens a
    // second tab, which comes in through the handshake and asks again too, and closes it.
    expect(await bob.send('room:join', { code, roomId })).toMatchObject({ ok: true });
    const tab = await connect({ token: bob.token, code, roomId });
    await tab.waitFor((state) => state.me === bob.me, 'the tab gets the state for itself');
    expect(await tab.send('room:join', { code, roomId })).toMatchObject({ ok: true });
    expect(tab.states).toHaveLength(1);
    tab.close();
    await until(() => tabsOfBob() === 1, 'the tab is gone');

    // Nobody could have seen a difference, so nobody was sent anything.
    await chair.send('sys:ping');
    await bob.send('sys:ping');
    expect({ rev: found?.rev, chair: chair.states.length, bob: bob.states.length }).toEqual(before);

    // Going offline with the last connection is a difference.
    bob.close();
    await chair.waitFor(() => online(chair, bob) === false, 'Bob offline');
  });
});

describe('leaving', () => {
  test("removes the player and tells the player's other tabs", async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    const otherTab = await connect({ token: bob.token });
    await otherTab.send('room:join', { code });
    expect(await bob.send('room:leave')).toEqual({ ok: true });
    await chair.waitFor((state) => state.players.length === 1);
    await until(() => otherTab.closed.includes('left'), 'the other tab hears');
    expect(bob.closed).toEqual([]);
  });

  test('passes the chair on, and closes the room when the last player goes', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    await chair.send('room:leave');
    await bob.waitFor((state) => state.chairId === bob.me, 'Bob chairs');
    await bob.send('room:leave');
    const late = await connect();
    expect(await late.send('room:join', { code, play: false })).toEqual({ ok: false, error: 'room_not_found' });
    expect(logged('room_closed')).toEqual([{ code, why: 'empty' }]);
  });

  test('passes the chair to whoever joined first, in the order that everyone sees', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    // A clock that is set back between two joins doesn't change who came first.
    server.advance(-5000);
    const cat = await join(code);
    await chair.send('room:leave');
    await cat.waitFor((state) => state.chairId !== chair.me, 'the chair has passed on');
    expect(names(cat)).toEqual(['Guest 2', 'Guest 3']);
    expect(cat.state?.chairId).toBe(bob.me);
  });
});

describe('quick reactions', () => {
  test('reach every connection in the room, the sender and screens included, and change nothing', async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code);
    const tab = await connect({ token: bob.token, code, roomId });
    await tab.waitFor((state) => state.code === code, 'the tab is in the room');
    const screen = await connect({ watch: code, roomId });
    await chair.waitFor((state) => state.screens === 1, 'the screen is up');
    const outsider = (await room()).chair;
    const before = { rev: chair.state?.rev, states: chair.states.length };

    expect(await bob.send('room:emote', { emote: 'coauthor' })).toEqual({ ok: true });
    const everyone = [chair, bob, tab, screen];
    await until(() => everyone.every((client) => client.emotes.length === 1), 'everyone hears');
    for (const client of everyone) expect(client.emotes).toEqual([{ roomId, playerId: bob.me, emote: 'coauthor' }]);
    expect(outsider.emotes).toEqual([]);
    // No snapshot, and no new rev.
    await chair.send('sys:ping');
    expect({ rev: chair.state?.rev, states: chair.states.length }).toEqual(before);
    expect(server.app.rooms.find(code)?.rev).toBe(before.rev);
  });

  test('come one every ten seconds from each member, from any tab, and also after leaving and coming back', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    const tab = await connect({ token: bob.token });
    await tab.send('room:join', { code });
    // Refused as too soon, with how long is left.
    const tooSoon = async (client: TestClient, atMost = 10_000) => {
      const reply = await client.send('room:emote', { emote: 'waiting' });
      expect(reply).toMatchObject({ ok: false, error: 'emote_cooldown' });
      const { waitMs } = reply as { waitMs?: number };
      expect(waitMs).toBeGreaterThan(0);
      expect(waitMs).toBeLessThanOrEqual(atMost);
    };
    expect(await bob.send('room:emote', { emote: 'waiting' })).toEqual({ ok: true });
    await tooSoon(bob);
    await tooSoon(tab);
    // Everyone has a wait of their own.
    expect(await chair.send('room:emote', { emote: 'waiting' })).toEqual({ ok: true });

    // The test's clock runs on as well, so it moves less than the whole wait at first.
    server.advance(9_000);
    await tooSoon(bob, 1_000);
    server.advance(1_000);
    expect(await bob.send('room:emote', { emote: 'waiting' })).toEqual({ ok: true });

    expect(await bob.send('room:leave')).toEqual({ ok: true });
    expect(await bob.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    await tooSoon(bob);
    // A clock that was set back doesn't keep anyone waiting until it has caught up.
    server.advance(-60_000);
    expect(await bob.send('room:emote', { emote: 'waiting' })).toEqual({ ok: true });
    await until(() => chair.emotes.length === 4, 'the chair hears all four');
  });

  test('are any of the phrases, old and new, with the same wait between any two', async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code);
    for (const [i, emote] of EMOTES.entries()) {
      expect(await bob.send('room:emote', { emote })).toEqual({ ok: true });
      expect(await bob.send('room:emote', { emote })).toMatchObject({ ok: false, error: 'emote_cooldown' });
      await until(() => chair.emotes.length === i + 1, `the chair hears ${emote}`);
      expect(chair.emotes.at(-1)).toEqual({ roomId, playerId: bob.me, emote });
      server.advance(EMOTE_COOLDOWN_MS);
    }
    expect(chair.emotes.map((event) => event.emote)).toEqual([...EMOTES]);
  });

  test('are for members, and only the ones there are', async () => {
    const { chair, code } = await room();
    const screen = await connect();
    expect(await screen.send('room:watch', { code })).toMatchObject({ ok: true });
    expect(await screen.send('room:emote', { emote: 'waiting' })).toEqual({ ok: false, error: 'not_member' });
    const stranger = await connect();
    expect(await stranger.send('room:emote', { emote: 'waiting' })).toEqual({ ok: false, error: 'not_member' });
    for (const payload of [{}, { emote: 'hello' }, { emote: 1 }]) {
      expect(await chair.send('room:emote', payload)).toEqual({ ok: false, error: 'bad_request' });
    }
    // None of the refusals counts as a reaction.
    expect(await chair.send('room:emote', { emote: 'waiting' })).toEqual({ ok: true });
  });
});

describe('closing a room', () => {
  test('tells every member and every screen, and leaves no room behind the code', async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code);
    // Another tab of each player, and a screen, all brought back by the handshake.
    const tabs = [
      await connect({ token: chair.token, code, roomId }),
      await connect({ token: bob.token, code, roomId }),
    ];
    for (const tab of tabs) await tab.waitFor((state) => state.code === code, 'the tab is in the room');
    const screen = await connect({ watch: code, roomId });
    await chair.waitFor((state) => state.screens === 1, 'the screen is up');

    expect(await chair.send('room:close')).toEqual({ ok: true });
    const [chairTab, bobTab] = tabs;
    const told = [bob, ...tabs, screen];
    await until(() => told.every((client) => client.closed.length > 0), 'everyone hears');
    for (const client of [bob, bobTab, screen]) expect(client?.closed).toEqual(['closed']);
    // The chair's page asked, and is answered instead; the chair's other tab hears that the chair
    // acted elsewhere, as after room:leave.
    expect(chair.closed).toEqual([]);
    expect(chairTab?.closed).toEqual(['left']);
    expect(server.app.rooms.find(code)).toBeUndefined();
    expect(logged('room_closed')).toEqual([{ code, why: 'chair' }]);

    // Nobody is in a room any more, and the code finds none.
    for (const client of [chair, bob, ...tabs]) {
      expect(await client.send('room:emote', { emote: 'waiting' })).toEqual({ ok: false, error: 'not_member' });
    }
    expect(await screen.send('room:watch', { code, roomId })).toEqual({ ok: false, error: 'room_not_found' });
    const late = await connect();
    expect(await late.send('room:join', { code, play: false })).toEqual({ ok: false, error: 'room_not_found' });
  });

  test('is for the chair alone, also from a screen of their own browser', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    const screen = await connect({ token: chair.token });
    expect(await screen.send('room:watch', { code })).toMatchObject({ ok: true });
    expect(await bob.send('room:close')).toEqual({ ok: false, error: 'not_chair' });
    expect(await screen.send('room:close')).toEqual({ ok: false, error: 'not_member' });
    expect(server.app.rooms.find(code)).toBeDefined();
    expect(bob.closed).toEqual([]);
  });

  test('tells members who were offline when they come back', async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code);
    const cat = await join(code);
    bob.close();
    cat.close();
    await chair.waitFor(() => online(chair, bob) === false && online(chair, cat) === false, 'both offline');
    expect(await chair.send('room:close')).toEqual({ ok: true });

    // One comes back with the room's ID in the handshake, and hears at once.
    const bobBack = await connect({ token: bob.token, code, roomId });
    await until(() => bobBack.closed.includes('expired'), 'Bob hears');
    expect(bobBack.states).toEqual([]);
    // The other asks with the code alone, and finds no room.
    const catBack = await connect({ token: cat.token });
    expect(await catBack.send('room:join', { code })).toEqual({ ok: false, error: 'room_not_found' });
  });

  test('in the middle of a game logs the game as started only', async () => {
    const { chair, code } = await room();
    await join(code);
    expect(await start(chair)).toEqual({ ok: true });
    expect(await chair.send('room:close')).toEqual({ ok: true });
    expect(logged('game_started')).toHaveLength(1);
    expect(logged('game_ended')).toEqual([]);
    expect(logged('room_closed')).toEqual([{ code, why: 'chair' }]);
  });
});

describe("the chair's controls", () => {
  test('are only for the chair', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    for (const [message, payload] of [
      ['room:settings', { fields: ['general'] }],
      ['room:start', { round: 0 }],
      ['room:end', { gameId: 'a-game' }],
      ['room:again', { gameId: 'a-game' }],
      ['room:shuffle', {}],
      ['room:spectate', { playerId: chair.me }],
      ['room:remove', { playerId: chair.me }],
      ['room:chair', { playerId: bob.me }],
      ['room:dismiss', {}],
      ['room:close', {}],
    ] as const) {
      expect(await bob.send(message, payload), message).toEqual({ ok: false, error: 'not_chair' });
    }
  });

  test('can hand the chair over', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    expect(await chair.send('room:chair', { playerId: bob.me })).toEqual({ ok: true });
    await bob.waitFor((state) => state.chairId === bob.me);
    expect(await chair.send('room:chair', { playerId: 'nobody' })).toEqual({ ok: false, error: 'not_chair' });
    expect(await bob.send('room:chair', { playerId: 'nobody' })).toEqual({ ok: false, error: 'no_such_player' });
  });

  test("can't hand the chair to someone who is offline", async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    bob.close();
    await chair.waitFor(() => online(chair, bob) === false, 'Bob offline');
    expect(await chair.send('room:chair', { playerId: bob.me })).toEqual({ ok: false, error: 'player_offline' });
    expect(server.app.rooms.find(code)?.chairId).toBe(chair.me);
  });

  test('can remove a player, who must then wait two minutes to come back', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    expect(await chair.send('room:remove', { playerId: chair.me })).toEqual({ ok: false, error: 'bad_request' });
    expect(await chair.send('room:remove', { playerId: bob.me })).toEqual({ ok: true });
    await until(() => bob.closed.includes('removed_recently'), 'Bob hears');
    await chair.waitFor((state) => state.players.length === 1);
    expect(await bob.send('room:join', { code, play: false })).toEqual({ ok: false, error: 'removed_recently' });
    // Another browser has another token, which the wait can't know. It comes in as a new guest,
    // with a number of its own rather than Bob's.
    const other = await connect();
    expect(await other.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    await other.waitFor((state) => state.players.length === 2);
    expect(other.state?.players.find(({ id }) => id === other.me)).toMatchObject({ name: 'Guest 3', guest: 3 });
    server.advance(2 * 60_000 + 1);
    expect(await bob.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    // Bob is the guest he was.
    await bob.waitFor((state) => state.players.length === 3, 'Bob is back');
    expect(bob.state?.players.find(({ id }) => id === bob.me)).toMatchObject({ name: 'Guest 2', guest: 2 });
  });

  test('can change the fields in the waiting room', async () => {
    const { chair } = await room();
    expect(await chair.send('room:settings', { fields: ['tiny'] })).toEqual({ ok: false, error: 'no_words' });
    expect(await chair.send('room:settings', { fields: ['nope'] })).toEqual({ ok: false, error: 'bad_fields' });
    expect(await chair.send('room:settings', { fields: ['general', 'tiny', 'general'] })).toEqual({ ok: true });
    await chair.waitFor((state) => state.fields?.length === 2);
    expect(chair.state?.fields).toEqual(['general', 'tiny']);
  });

  test('takes every list of the library at once', async () => {
    // The library itself, which has more lists than the tests' one.
    await server.close();
    const words = loadWordLibrary(resolve(import.meta.dirname, '..', '..', 'words'));
    server = await startServer({ words });
    const fields = words.fields().map((field) => field.id);
    expect(fields.length).toBeGreaterThan(20);
    const { chair, code } = await room();
    expect(await chair.send('room:settings', { fields })).toEqual({ ok: true });
    await chair.waitFor((state) => state.fields?.length === fields.length);
    expect(server.app.rooms.find(code)?.fields).toEqual(fields);
    const created = await createRoom(server.url, { fields, language: 'zh' });
    track(created.chair);
    expect(server.app.rooms.find(created.code)?.fields).toEqual(fields);
  });

  test('can have every game draw its lists anew, from those with enough words, and tells nobody which', async () => {
    await server.close();
    server = await startServer({
      words: new WordLibrary([wordList('a', 40), wordList('b', 40), wordList('c', 40), wordList('tiny', 2)]),
      // Eight games in a row take more messages than a burst allows.
      socketLimits: { messageBurst: 100 },
    });
    // A room that draws its lists needs none chosen; one that doesn't still does.
    const created = await createRoom(server.url, { fields: [], randomFields: true });
    const chair = track(created.chair);
    expect(chair.state).toMatchObject({ fields: [], randomFields: true });
    expect(server.app.rooms.find(created.code)?.listing()).toMatchObject({ fields: [], randomFields: true });
    expect(await chair.send('room:settings', { randomFields: false })).toEqual({ ok: false, error: 'no_words' });
    expect(await chair.send('room:settings', { fields: ['nope'] })).toEqual({ ok: false, error: 'bad_fields' });
    const bob = await join(created.code);
    const drawn = new Set<string>();
    for (let round = 0; round < 8; round += 1) {
      expect(await start(chair)).toEqual({ ok: true });
      await bob.waitFor((view) => view.phase === 'playing' && view.round === round + 1);
      const lists = game(bob).words.map((word) => word.split(' ')[0] as string);
      expect(
        lists.every((list) => ['a', 'b', 'c'].includes(list)),
        lists.join(),
      ).toBe(true);
      for (const list of lists) drawn.add(list);
      // The room knows which lists it drew, for the game's record; the words came from those.
      const drewFrom = server.app.rooms.find(created.code)?.gameFields ?? [];
      expect(drewFrom.length).toBeGreaterThan(0);
      expect(
        lists.every((list) => drewFrom.includes(list)),
        `${lists.join()} from ${drewFrom.join()}`,
      ).toBe(true);
      // The view still has the lists that the chair chose, none, and nothing of the draw.
      expect(bob.state).toMatchObject({ fields: [], randomFields: true });
      await chair.send('test:finish');
      await chair.waitFor((view) => view.phase === 'ended');
      expect(await again(chair)).toEqual({ ok: true });
      await chair.waitFor((view) => view.phase === 'lobby');
    }
    expect([...drawn].sort()).toEqual(['a', 'b', 'c']);
    // Turned off, the room plays with the lists chosen again.
    expect(await chair.send('room:settings', { fields: ['b'], randomFields: false })).toEqual({ ok: true });
    expect(await start(chair)).toEqual({ ok: true });
    await bob.waitFor((view) => view.phase === 'playing' && view.round === 9);
    expect(game(bob).words.every((word) => word.startsWith('b word'))).toBe(true);
    expect(server.app.rooms.find(created.code)?.gameFields).toEqual(['b']);
  });

  test('refuses a practice room that draws its lists', async () => {
    const client = await connect();
    expect(
      await client.send('room:create', {
        game: 'test',
        language: 'en',
        fields: ['general'],
        randomFields: true,
        practice: { role: 'captain' },
      }),
    ).toEqual({ ok: false, error: 'bad_request' });
  });

  test("can change the game's settings in the waiting room, with the fields or without them", async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    expect(await chair.send('room:settings', { settings: { level: 2 } })).toEqual({ ok: true });
    await bob.waitFor(() => game(bob).level === 2);
    expect(await bob.send('room:settings', { settings: { level: 3 } })).toEqual({ ok: false, error: 'not_chair' });
    // Both change together, or neither does.
    expect(await chair.send('room:settings', { fields: ['general', 'tiny'], settings: { level: 9 } })).toEqual({
      ok: false,
      error: 'bad_settings',
    });
    expect(await chair.send('room:settings', { fields: ['nope'], settings: { level: 3 } })).toEqual({
      ok: false,
      error: 'bad_fields',
    });
    expect(server.app.rooms.find(code)?.fields).toEqual(['general']);
    expect(await chair.send('room:settings', { fields: ['general', 'tiny'], settings: { level: 3 } })).toEqual({
      ok: true,
    });
    await bob.waitFor((state) => state.fields?.length === 2 && game(bob).level === 3);
    // Settings that change nothing are granted, and nobody is sent a snapshot for them.
    const rev = server.app.rooms.find(code)?.rev;
    expect(await chair.send('room:settings', { fields: ['tiny', 'general'], settings: { level: 3 } })).toEqual({
      ok: true,
    });
    expect(await chair.send('room:settings', {})).toEqual({ ok: true });
    expect(server.app.rooms.find(code)?.rev).toBe(rev);
  });

  test("can't change the fields during a game, whatever the fields are", async () => {
    const { chair, code } = await room();
    await join(code);
    await start(chair);
    for (const fields of [['general'], ['tiny'], ['nope']]) {
      expect(await chair.send('room:settings', { fields }), String(fields)).toEqual({
        ok: false,
        error: 'wrong_phase',
      });
    }
    expect(await chair.send('room:settings', { settings: { level: 2 } })).toEqual({ ok: false, error: 'wrong_phase' });
  });
});

describe('games', () => {
  test('start only when the game says so, with words from the library', async () => {
    const { chair, code } = await room();
    expect(await start(chair)).toEqual({ ok: false, error: 'cannot_start' });
    const bob = await join(code);
    expect(await start(chair)).toEqual({ ok: true });
    const state = await bob.waitFor((view) => view.phase === 'playing');
    expect(game(bob).words).toHaveLength(3);
    expect(game(bob).words.every((word) => word.startsWith('general word'))).toBe(true);
    expect(state.fields).toEqual(['general']);
    await chair.waitFor((view) => view.phase === 'playing');
    expect(await start(chair)).toEqual({ ok: false, error: 'wrong_phase' });
  });

  test('send every connection its own view', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    await start(chair);
    expect(await bob.send('test:press')).toEqual({ ok: true });
    await chair.waitFor(() => game(chair).presses === 1);
    expect(game(chair).forViewer).toBe(`for ${chair.me}`);
    expect(game(bob).forViewer).toBe(`for ${bob.me}`);
  });

  test('take game messages only from members, and only for their own game', async () => {
    const { chair, code } = await room();
    await join(code);
    await start(chair);
    const stranger = await connect();
    expect(await stranger.send('test:press')).toEqual({ ok: false, error: 'not_member' });
    expect(await chair.send('chess:move', { to: 'e4' })).toEqual({ ok: false, error: 'bad_request' });
  });

  test('end by themselves or when the chair withdraws, and can be played again', async () => {
    const { chair, code } = await room();
    await join(code);
    await start(chair);
    await chair.send('test:finish');
    const finished = await chair.waitFor((state) => state.phase === 'ended');
    expect(await chair.send('room:end', { gameId: finished.gameId })).toEqual({ ok: false, error: 'game_over' });
    expect(logged('game_ended')).toEqual([{ code }]);
    expect(await again(chair)).toEqual({ ok: true });
    await chair.waitFor((state) => state.phase === 'lobby');
    expect(chair.state?.gameId).toBeNull();
    await start(chair);
    const gameId = (await chair.waitFor((state) => state.phase === 'playing')).gameId;
    expect(gameId).toEqual(expect.any(String));
    expect(await chair.send('room:end')).toEqual({ ok: false, error: 'bad_request' });
    expect(await chair.send('room:end', { gameId: 'an-earlier-game' })).toEqual({ ok: false, error: 'stale' });
    expect(await chair.send('room:end', { gameId })).toEqual({ ok: true });
    await chair.waitFor((state) => state.phase === 'ended');
    // A game that the chair withdraws has ended like any other, and is logged once.
    await chair.send('sys:ping');
    expect(logged('game_started')).toHaveLength(2);
    expect(logged('game_ended')).toEqual([{ code }, { code }]);
    // A second withdrawal, such as from a double click, gets the game's own answer for any
    // action on a game that is over.
    expect(await chair.send('room:end', { gameId })).toEqual({ ok: false, error: 'game_over' });
    // A withdrawal that arrives after the room went back to the waiting room is for no game.
    await again(chair);
    await chair.waitFor((state) => state.phase === 'lobby');
    expect(await chair.send('room:end', { gameId })).toEqual({ ok: false, error: 'stale' });
  });

  test('end when the game says so, whatever brought the end about', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    const cat = await join(code);
    await chair.send('test:fragile'); // from now on a game ends when someone leaves it
    await start(chair);
    expect(await bob.send('room:leave')).toEqual({ ok: true });
    await chair.waitFor((state) => state.phase === 'ended', 'ended by a player who left');
    expect(await again(chair)).toEqual({ ok: true });
    expect(await start(chair)).toEqual({ ok: true });
    expect(await chair.send('room:spectate', { playerId: cat.me })).toEqual({ ok: true });
    await chair.waitFor((state) => state.phase === 'ended', 'ended by a player who was benched');
    expect(await again(chair)).toEqual({ ok: true });
    expect(await start(chair)).toEqual({ ok: true });
    expect(await chair.send('room:remove', { playerId: cat.me })).toEqual({ ok: true });
    await chair.waitFor((state) => state.phase === 'ended', 'ended by a player who was removed');
    expect(logged('game_ended')).toHaveLength(3);
  });

  test('a start that comes late or twice starts no second game', async () => {
    const { chair, code } = await room();
    await join(code);
    // Two tabs of the chair send the same start, and one of them arrives after the game that
    // the other started is over and the room is back in the waiting room.
    expect(await chair.send('room:start', { round: 0 })).toEqual({ ok: true });
    expect(await chair.send('room:start', { round: 0 })).toEqual({ ok: false, error: 'stale' });
    await chair.send('test:finish');
    await again(chair);
    await chair.waitFor((state) => state.phase === 'lobby' && state.round === 1);
    expect(await chair.send('room:start', { round: 0 })).toEqual({ ok: false, error: 'stale' });
    expect(server.app.rooms.find(code)?.phase).toBe('lobby');
    expect(await chair.send('room:start', {})).toEqual({ ok: false, error: 'bad_request' });
    expect(await chair.send('room:start', { round: 1 })).toEqual({ ok: true });
    expect(await chair.send('room:start', { round: 2 })).toEqual({ ok: false, error: 'wrong_phase' });
  });

  test('"play again" is for one game, and a late one leaves the next game alone', async () => {
    const { chair, code } = await room();
    await join(code);
    await start(chair);
    const first = (await chair.waitFor((state) => state.phase === 'playing')).gameId;
    expect(await chair.send('room:again', { gameId: first })).toEqual({ ok: false, error: 'wrong_phase' });
    await chair.send('test:finish');
    expect(await chair.send('room:again', { gameId: first })).toEqual({ ok: true });
    await chair.waitFor((state) => state.phase === 'lobby');
    await start(chair);
    await chair.send('test:finish');
    await chair.waitFor((state) => state.phase === 'ended' && state.gameId !== first);
    // The second "play again" for the first game comes in only now.
    expect(await chair.send('room:again', { gameId: first })).toEqual({ ok: false, error: 'stale' });
    expect(await chair.send('room:again', {})).toEqual({ ok: false, error: 'bad_request' });
    expect(server.app.rooms.find(code)?.phase).toBe('ended');
  });

  test('a game that throws answers internal, and the server goes on', async () => {
    const { chair, code } = await room();
    await join(code);
    await start(chair);
    expect(await chair.send('test:explode')).toEqual({ ok: false, error: 'internal' });
    expect(await chair.send('test:press')).toEqual({ ok: true });
    expect(server.logs.some((entry) => entry.event === 'error')).toBe(true);
  });

  test("the chair's bench and shuffle reach the game", async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    expect(await chair.send('room:spectate', { playerId: bob.me })).toEqual({ ok: true });
    await chair.waitFor(() => game(chair).benched.includes(bob.me));
    expect(await chair.send('room:spectate', { playerId: 'nobody' })).toEqual({ ok: false, error: 'no_such_player' });
    expect(await chair.send('room:shuffle')).toEqual({ ok: true });
  });
});

describe("a game's deadlines", () => {
  const playing = async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    await start(chair);
    await bob.waitFor((state) => state.phase === 'playing');
    return { chair, bob, code };
  };

  test('come by themselves on the server, and everyone hears of them', async () => {
    const { chair, bob } = await playing();
    expect(server.timers()).toBe(0);
    expect(await chair.send('test:alarm', 5000)).toEqual({ ok: true });
    expect(server.timers()).toBe(1);
    server.advance(4999);
    expect(game(bob).rings).toBe(0);
    server.advance(1);
    await bob.waitFor(() => game(bob).rings === 1, 'the alarm');
    await chair.waitFor(() => game(chair).rings === 1, 'the alarm');
    expect(server.timers()).toBe(0);
  });

  test('come before a message that arrives after them, however late the timer is', async () => {
    const { chair, bob } = await playing();
    await chair.send('test:alarm', 1000);
    server.advance(2000, false);
    expect(await bob.send('test:press')).toEqual({ ok: true });
    const state = await chair.waitFor(() => game(chair).presses === 1);
    expect((state.data as FakeView).rings).toBe(1);
    // The timer is no longer needed.
    expect(server.timers()).toBe(0);
  });

  test('reach everyone even when the message that came after them is refused', async () => {
    const { chair, bob, code } = await playing();
    await chair.send('test:alarm', 1000);
    server.advance(1000, false);
    const rev = server.app.rooms.find(code)?.rev ?? 0;
    expect(await bob.send('test:refuse')).toEqual({ ok: false, error: 'odd' });
    await chair.waitFor((state) => state.rev > rev && game(chair).rings === 1, 'the alarm');
  });

  test("don't count as something happening in the room", async () => {
    const { chair, code } = await playing();
    const room = server.app.rooms.find(code);
    const before = room?.lastActivity;
    await chair.send('test:alarm', 1000);
    const set = room?.lastActivity;
    server.advance(1000);
    await chair.waitFor(() => game(chair).rings === 1);
    expect(room?.lastActivity).toBe(set);
    expect(set).toBeGreaterThanOrEqual(before ?? 0);
  });

  test('go when the game ends, is withdrawn, or goes back to the waiting room, and when the room closes', async () => {
    const { chair, bob, code } = await playing();
    await chair.send('test:alarm', 1000);
    await chair.send('test:finish');
    expect(server.timers()).toBe(0);
    await again(chair);
    await start(chair);
    await chair.waitFor((state) => state.phase === 'playing');
    await chair.send('test:alarm', 1000);
    expect(await chair.send('room:end', { gameId: chair.state?.gameId })).toEqual({ ok: true });
    expect(server.timers()).toBe(0);
    await again(chair);
    await start(chair);
    await chair.waitFor((state) => state.phase === 'playing');
    await chair.send('test:alarm', 1000);
    expect(server.timers()).toBe(1);
    await bob.send('room:leave');
    await chair.send('room:leave');
    expect(server.app.rooms.find(code)).toBeUndefined();
    expect(server.timers()).toBe(0);
  });

  test('of a game that throws are logged, and the server goes on', async () => {
    const { chair } = await playing();
    await chair.send('test:alarm', 1000);
    await chair.send('test:break', 'tick');
    server.advance(1000);
    expect(server.logs.some((entry) => entry.event === 'error' && entry.fields?.where === 'deadline')).toBe(true);
    expect(await chair.send('sys:ping')).toEqual({ ok: true });
  });
});

describe('a game module that throws', () => {
  const errors = () => server.logs.filter((entry) => entry.event === 'error');

  test('may throw anything at all', async () => {
    const { chair } = await room();
    for (const thrown of [null, 'a string', 42]) {
      expect(await chair.send('test:throw', thrown), String(thrown)).toEqual({ ok: false, error: 'internal' });
    }
    expect(errors()).toHaveLength(3);
    expect(await chair.send('sys:ping')).toEqual({ ok: true });
  });

  test('has its refusals passed on as a code and nothing else', async () => {
    const { chair, code } = await room();
    await join(code);
    await start(chair);
    // The fake game puts its words and a number that can't be encoded into this refusal.
    expect(await chair.send('test:refuse')).toEqual({ ok: false, error: 'odd' });
    expect(await chair.send('sys:ping')).toEqual({ ok: true });
    expect(errors()).toEqual([]);
  });

  test('when its first player joins, leaves no room behind', async () => {
    const grumpy = {
      ...fakeGame,
      id: 'grumpy',
      join: () => {
        throw new Error('nobody may join');
      },
    } as GameModule;
    await server.close();
    server = await startServer({ games: [fakeGame as GameModule, grumpy] });
    const client = await connect();
    const reply = await client.send('room:create', {
      game: 'grumpy',
      language: 'en',
      fields: ['general'],
    });
    expect(reply).toEqual({ ok: false, error: 'internal' });
    expect(server.app.rooms.size).toBe(0);
    expect(logged('room_created')).toEqual([]);
    expect(errors()).toHaveLength(1);
  });

  test('in a view costs only that view, wherever the view is built', async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code);
    expect(await chair.send('test:break', 'view')).toEqual({ ok: true });
    // A disconnect, a handshake and the sweep send views too, with no message to answer.
    bob.close();
    await until(() => server.app.rooms.find(code)?.onlineCount() === 1, 'Bob offline');
    const back = await connect({ token: bob.token, code, roomId });
    await until(() => server.app.rooms.find(code)?.onlineCount() === 2, 'Bob back');
    expect(errors().length).toBeGreaterThan(0);
    // The sweep sends a view when it changes something: here it passes the chair on to Bob.
    chair.close();
    await until(() => server.app.rooms.find(code)?.onlineCount() === 1, 'the chair offline');
    const before = errors().length;
    server.advance(3 * 60_000 + 1);
    server.app.sockets.sweep();
    expect(server.app.rooms.find(code)?.chairId).toBe(bob.me);
    expect(errors().length).toBeGreaterThan(before);
    expect(errors().every((entry) => entry.fields?.where === 'view')).toBe(true);

    expect(await back.send('test:mend')).toEqual({ ok: true });
    await back.waitFor((state) => state.chairId === bob.me, 'Bob sees the room again');
  });

  test('when someone leaves, leaves the room as it was', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    await chair.send('test:break', 'leave');
    expect(await bob.send('room:leave')).toEqual({ ok: false, error: 'internal' });
    expect(await chair.send('room:remove', { playerId: bob.me })).toEqual({ ok: false, error: 'internal' });
    expect(members(code)).toEqual(['Guest 1', 'Guest 2']);
    expect(await chair.send('room:leave')).toEqual({ ok: false, error: 'internal' });
    expect(server.app.rooms.find(code)?.chairId).toBe(chair.me);

    // Bob is still a member like any other, and nothing says that he was removed.
    await chair.send('test:mend');
    expect(await bob.send('room:leave')).toEqual({ ok: true });
    expect(await bob.send('room:join', { code, play: false })).toMatchObject({ ok: true });
  });

  test('when someone joins, lets nobody in', async () => {
    const { chair, code } = await room();
    await chair.send('test:break', 'join');
    const client = await connect();
    expect(await client.send('room:join', { code, play: false })).toEqual({ ok: false, error: 'internal' });
    expect(members(code)).toEqual(['Guest 1']);
    expect(await client.send('test:press')).toEqual({ ok: false, error: 'not_member' });
  });

  test('in the sweep still lets the room hear what changed before it threw', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    const cat = await join(code);
    await chair.send('test:break', { what: 'leave', only: cat.me });
    bob.close();
    cat.close();
    await chair.waitFor(() => online(chair, bob) === false && online(chair, cat) === false);
    server.advance(10 * 60_000 + 1);
    server.app.sockets.sweep();
    // Bob was dropped before the game threw for Cat, and the chair is told so.
    await chair.waitFor((state) => state.players.length === 2, 'Bob dropped');
    expect(names(chair)).toEqual(['Guest 1', 'Guest 3']);
    expect(errors().map((entry) => entry.fields?.where)).toEqual(['sweep']);
  });

  test('in the sweep stops the sweep of its own room only', async () => {
    const broken = await room();
    const bob = await join(broken.code);
    const other = await room();
    const dan = await join(other.code);
    await broken.chair.send('test:break', 'leave');
    bob.close();
    dan.close();
    await until(() => [broken, other].every(({ code }) => server.app.rooms.find(code)?.onlineCount() === 1));
    server.advance(10 * 60_000 + 1);
    server.app.sockets.sweep();
    await other.chair.waitFor((state) => state.players.length === 1, 'Dan dropped');
    expect(members(broken.code)).toEqual(['Guest 1', 'Guest 2']);
    expect(errors().map((entry) => entry.fields?.where)).toEqual(['sweep']);
  });
});

describe('screens', () => {
  test('watch without playing, and see the screen view', async () => {
    const { chair, code } = await room();
    const screen = await connect();
    expect(await screen.send('room:watch', { code })).toMatchObject({ ok: true, code });
    const state = await screen.waitFor((view) => view.code === code);
    expect(state.me).toBeNull();
    expect((state.data as FakeView).forViewer).toBe('for screens');
    expect(names(chair)).toEqual(['Guest 1']);
    expect(await screen.send('test:press')).toEqual({ ok: false, error: 'not_member' });
  });

  test('come back through the handshake by the room ID, and are limited per room', async () => {
    const { code, roomId } = await room();
    const first = await connect({ watch: code, roomId });
    await first.waitFor((view) => view.me === null);
    for (let i = 1; i < MAX_SCREENS; i += 1) await connect({ watch: code, roomId });
    const extra = await connect();
    expect(await extra.send('room:watch', { code })).toEqual({ ok: false, error: 'screens_full' });
  });

  test('are counted for everyone to see, and the chair can send them all away', async () => {
    const { chair, code, roomId } = await room();
    const taken = await Promise.all(Array.from({ length: MAX_SCREENS }, () => connect({ watch: code, roomId })));
    await chair.waitFor((state) => state.screens === MAX_SCREENS, 'the chair sees five screens');
    const projector = await connect();
    expect(await projector.send('room:watch', { code })).toEqual({ ok: false, error: 'screens_full' });

    expect(await chair.send('room:dismiss')).toEqual({ ok: true });
    await until(() => taken.every((screen) => screen.closed.includes('dismissed')), 'the screens hear');
    await chair.waitFor((state) => state.screens === 0, 'the chair sees none');
    expect(await taken[0]?.send('test:press')).toEqual({ ok: false, error: 'not_member' });
    expect(await projector.send('room:watch', { code })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.screens === 1);
    projector.close();
    await chair.waitFor((state) => state.screens === 0, 'the count follows a screen that goes');
  });

  test("can't be put up by someone the chair has just removed", async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    // A screen that Bob's browser has up already goes with him; another one stays.
    const bobsScreen = await connect({ token: bob.token });
    const projector = await connect();
    expect(await bobsScreen.send('room:watch', { code })).toMatchObject({ ok: true });
    expect(await projector.send('room:watch', { code })).toMatchObject({ ok: true });
    await chair.send('room:remove', { playerId: bob.me });
    await until(() => bobsScreen.closed.includes('removed_recently'), "Bob's screen hears");
    await chair.waitFor((state) => state.screens === 1 && state.players.length === 1);
    expect(projector.closed).toEqual([]);
    projector.close();
    await chair.waitFor((state) => state.screens === 0);

    expect(await bob.send('room:watch', { code })).toEqual({ ok: false, error: 'removed_recently' });
    expect(server.app.rooms.find(code)?.screens.size).toBe(0);
    server.advance(2 * 60_000 + 1);
    expect(await bob.send('room:watch', { code })).toMatchObject({ ok: true });
  });

  test('are not taken to the room that got their code later', async () => {
    // A generator that can be told what to draw next, so that a second room gets the code of
    // the first.
    const next: number[] = [];
    const drawn = seededRng(7);
    await server.close();
    server = await startServer({ rng: { int: (below) => next.shift() ?? drawn.int(below) } });

    const first = await room();
    const screen = await connect();
    expect(await screen.send('room:watch', { code: first.code })).toMatchObject({ ok: true, roomId: first.roomId });
    screen.close();
    expect(await first.chair.send('room:leave')).toEqual({ ok: true });
    next.push(...[...first.code].map((character) => CODE_ALPHABET.indexOf(character)));
    const second = await room();
    expect(second.code).toBe(first.code);
    expect(second.roomId).not.toBe(first.roomId);

    const asked = { code: first.code, roomId: first.roomId };
    const back = await connect({ watch: first.code, roomId: first.roomId });
    await until(() => back.closed.includes('expired'), 'room:closed for the screen');
    expect(await back.send('room:watch', asked)).toEqual({ ok: false, error: 'room_not_found' });
    expect(back.states).toEqual([]);
    expect(server.app.rooms.find(second.code)?.screens.size).toBe(0);

    // The same goes for a player of the first room.
    const player = await connect({ token: first.chair.token, ...asked });
    await until(() => player.closed.includes('expired'), 'room:closed for the player');
    expect(await player.send('room:join', { ...asked, play: false })).toEqual({ ok: false, error: 'room_not_found' });
    expect([...(server.app.rooms.find(second.code)?.members.keys() ?? [])]).toEqual([second.chair.me]);
  });
});

describe('messages', () => {
  test('are handled in the order in which a connection sent them', async () => {
    const { chair, code } = await room();
    await join(code);
    // Sent together, without waiting for the first answer: the game message must not overtake
    // the start of its game.
    const [started, pressed] = await Promise.all([start(chair), chair.send('test:press')]);
    expect(started).toEqual({ ok: true });
    expect(pressed).toEqual({ ok: true });
  });

  test('a message named by a number is refused, and the server goes on', async () => {
    const client = await connect();
    const numbered = 1 as unknown as string;
    expect(await client.socket.timeout(2000).emitWithAck(numbered)).toEqual({ ok: false, error: 'bad_request' });
    client.socket.emit(numbered); // and one that asks for no answer
    expect(await client.send('sys:ping')).toEqual({ ok: true });
  });

  test('all get an answer, unknown ones too', async () => {
    const { chair } = await room();
    // A guest's name was once changed with room:rename, which the server no longer knows either.
    for (const message of ['room:nonsense', 'sys:nonsense', 'meta:nonsense', 'room:rename']) {
      expect(await chair.send(message, { name: 'Zed' }), message).toEqual({ ok: false, error: 'bad_request' });
    }
    expect(names(chair)).toEqual(['Guest 1']);
    // Unknown messages use up the connection's allowance like any other.
    const replies = await Promise.all(Array.from({ length: 30 }, () => chair.send('room:nonsense')));
    expect(replies.some((reply) => reply.error === 'rate_limited')).toBe(true);
  });

  test('one with more than a payload is refused, and still answered', async () => {
    const { chair } = await room();
    const reply = (await chair.socket.timeout(2000).emitWithAck('room:emote', { emote: 'waiting' }, 'extra')) as Reply;
    expect(reply).toEqual({ ok: false, error: 'bad_request' });
    expect(await chair.send('sys:ping')).toEqual({ ok: true });
    expect(chair.emotes).toEqual([]);
  });

  test('one that arrives after its connection has ended is ignored', async () => {
    const { chair, code } = await room();
    const create = ['room:create', { game: 'test', language: 'en', fields: ['general'] }];
    // One request that disconnects and then sends a message. Whoever that message put into a
    // room would stay "online" for good, with no connection that could ever be closed.
    for (const message of [create, ['room:join', { code, play: false }], ['room:watch', { code }]]) {
      const raw = await rawPolling(server.url);
      await raw.post(`41\x1e42${JSON.stringify(message)}`);
    }
    await chair.send('sys:ping');
    expect(server.app.rooms.size).toBe(1);
    expect(members(code)).toEqual(['Guest 1']);
    expect(server.app.rooms.find(code)?.screens.size).toBe(0);
    expect(logged('room_created')).toHaveLength(1);
  });

  test("a game can't be named after the room's own messages", async () => {
    for (const id of ['room', 'sys', 'meta']) {
      await expect(startServer({ games: [{ ...fakeGame, id } as GameModule] }), id).rejects.toThrow(/can't be named/);
    }
  });
});

describe('limits', () => {
  test('a connection that sends too fast is slowed down', async () => {
    const client = await connect();
    const replies = await Promise.all(Array.from({ length: 30 }, () => client.send('sys:ping')));
    expect(replies.filter((reply) => !reply.ok).every((reply) => reply.error === 'rate_limited')).toBe(true);
    expect(replies.filter((reply) => !reply.ok).length).toBeGreaterThan(0);
    server.advance(5_000);
    expect(await client.send('sys:ping')).toEqual({ ok: true });
  });

  test('an attempt to create a room counts once it reaches the word lists, whatever comes of it', async () => {
    const client = await connect();
    const create = (payload: Record<string, unknown>) =>
      client.send('room:create', { game: 'test', language: 'en', fields: ['general'], ...payload });
    // A public room, which a guest may not make, is refused first, whatever the fields, and costs
    // nothing.
    for (let i = 0; i < 8; i += 1) {
      server.advance(200); // stay under the per-connection limit
      expect(await create({ public: true, fields: ['nope'] })).toEqual({ ok: false, error: 'account_required' });
    }
    for (let i = 0; i < DEFAULT_SOCKET_LIMITS.roomsPerMinute; i += 1) {
      expect(await create({ fields: ['tiny'] })).toEqual({ ok: false, error: 'no_words' });
    }
    expect(await create({})).toEqual({ ok: false, error: 'rate_limited' });
    expect(server.app.rooms.size).toBe(0);
  });

  test('one address may create only a few rooms a minute', async () => {
    for (let i = 0; i < DEFAULT_SOCKET_LIMITS.roomsPerMinute; i += 1) await room();
    const client = await connect();
    const reply = await client.send('room:create', { game: 'test', language: 'en', fields: ['general'] });
    expect(reply).toEqual({ ok: false, error: 'rate_limited' });
    expect(server.logs.map((entry) => entry.event)).not.toContain('rooms_per_minute_raised');
  });

  test('the options say how many rooms a minute, and the number goes all the way to the counter', async () => {
    await server.close();
    const raised = DEFAULT_SOCKET_LIMITS.roomsPerMinute + 2;
    server = await startServer({ roomsPerMinute: raised });
    // A raised limit protects less against abuse, so the server says that it has one.
    expect(server.logs).toContainEqual({
      event: 'rooms_per_minute_raised',
      fields: { roomsPerMinute: raised, default: DEFAULT_SOCKET_LIMITS.roomsPerMinute },
    });
    for (let i = 0; i < raised; i += 1) await room();
    const client = await connect();
    const reply = await client.send('room:create', { game: 'test', language: 'en', fields: ['general'] });
    expect(reply).toEqual({ ok: false, error: 'rate_limited' });
  });

  test('a limit on rooms that is not a whole number from 1 up is refused, not counted as one', async () => {
    for (const roomsPerMinute of [0, -1, 2.5, NaN]) {
      await expect(startServer({ roomsPerMinute }), String(roomsPerMinute)).rejects.toThrow(/roomsPerMinute/);
    }
  });

  // Uses up what one address may get wrong in a minute. Every client in these tests has the
  // same address, as the people in one lab do.
  const mistype = async (client: TestClient, message = 'room:join') => {
    for (let i = 0; i < 20; i += 1) {
      server.advance(200); // stay under the per-connection limit
      expect(await client.send(message, { code: 'ZZZZ' })).toEqual({ ok: false, error: 'room_not_found' });
    }
  };

  test('one address may name only so many codes that belong to no room', async () => {
    const { code } = await room();
    const client = await connect();
    await mistype(client);
    expect(await client.send('room:join', { code: 'ZZZZ' })).toEqual({ ok: false, error: 'rate_limited' });
    // A right code is refused as well, or the address could go on telling right from wrong.
    expect(await client.send('room:join', { code, play: false })).toEqual({ ok: false, error: 'rate_limited' });
    server.advance(60_000);
    expect(await client.send('room:join', { code, play: false })).toMatchObject({ ok: true });
  });

  test('watching counts like joining, and a handshake counts for nothing', async () => {
    const { code, roomId } = await room();
    const client = await connect();
    await mistype(client, 'room:watch');
    expect(await client.send('room:watch', { code })).toEqual({ ok: false, error: 'rate_limited' });
    expect(await client.send('room:join', { code, play: false })).toEqual({ ok: false, error: 'rate_limited' });
    // Whoever gives the room's ID has been there, and is not held up. Nor is that connection
    // from then on: it is in the room.
    expect(await client.send('room:watch', { code, roomId })).toMatchObject({ ok: true });
    expect(await client.send('room:watch', { code })).toMatchObject({ ok: true });

    // Handshakes with wrong codes are not counted, because they are not answered either.
    server.advance(60_000);
    for (let i = 0; i < 25; i += 1) await connect(i % 2 ? { code: 'ZZZZ' } : { watch: 'ZZZZ', roomId: 'another-room' });
    expect(await client.send('room:join', { code, play: false })).toMatchObject({ ok: true });
  });

  test('a wrong room ID finds nothing, and tells nothing about the code', async () => {
    const { code } = await room();
    const client = await connect();
    for (const tried of [code, 'ZZZZ']) {
      const asked = { code: tried, roomId: 'another-room' };
      expect(await client.send('room:join', { ...asked, play: false })).toEqual({ ok: false, error: 'room_not_found' });
      expect(await client.send('room:watch', asked)).toEqual({ ok: false, error: 'room_not_found' });
    }
    // Nor does it count: none of these could have found a room.
    for (let i = 0; i < 25; i += 1) {
      server.advance(200);
      await client.send('room:watch', { code: 'ZZZZ', roomId: 'another-room' });
    }
    expect(await client.send('room:join', { code, play: false })).toMatchObject({ ok: true });
  });

  test('a member comes back whatever their address has used up', async () => {
    const { code, roomId } = await room();
    const bob = await join(code);
    await mistype(await connect());
    const newcomer = await connect();
    expect(await newcomer.send('room:join', { code, play: false })).toEqual({ ok: false, error: 'rate_limited' });
    // Bob asks again on the connection he has, and comes back on a new one.
    expect(await bob.send('room:join', { code })).toMatchObject({ ok: true, roomId });
    const back = await connect({ token: bob.token });
    expect(await back.send('room:join', { code })).toMatchObject({ ok: true, roomId });
    await back.waitFor((state) => state.me === bob.me);
  });

  test('counts a forwarded address as one, whatever port the proxy saw it on', async () => {
    await server.close();
    server = await startServer({ trustProxy: true });
    const create = async (forwarded: string) => {
      const client = await connect({}, { extraHeaders: { 'x-forwarded-for': forwarded } });
      return client.send('room:create', { game: 'test', language: 'en', fields: ['general'] });
    };
    for (let port = 5000; port < 5000 + DEFAULT_SOCKET_LIMITS.roomsPerMinute; port += 1) {
      expect(await create(`203.0.113.9:${port}`)).toMatchObject({ ok: true });
    }
    expect(await create(`203.0.113.9:${5000 + DEFAULT_SOCKET_LIMITS.roomsPerMinute}`)).toEqual({
      ok: false,
      error: 'rate_limited',
    });
    expect(await create('198.51.100.7')).toMatchObject({ ok: true });
  });

  test('says so once when it ignores the address that a proxy passed on', async () => {
    await connect({}, { extraHeaders: { 'x-forwarded-for': '203.0.113.9' } });
    await connect({}, { extraHeaders: { 'x-forwarded-for': '203.0.113.10' } });
    expect(server.logs.filter((entry) => entry.event === 'forwarded_address_ignored')).toHaveLength(1);
  });
});

describe('housekeeping', () => {
  test('passes the chair on when the chair has been away for three minutes', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    chair.close();
    await bob.waitFor(() => online(bob, chair) === false);
    server.advance(3 * 60_000 - 1000);
    server.app.sockets.sweep();
    // Asked of the server itself: a snapshot from this sweep could not have reached Bob yet, so
    // his view would show the first chair whatever the sweep had done.
    expect(server.app.rooms.find(code)?.chairId).toBe(chair.me);
    server.advance(1001);
    server.app.sockets.sweep();
    await bob.waitFor((state) => state.chairId === bob.me, 'Bob chairs');
  });

  test('drops players who stay away from the waiting room', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    bob.close();
    await chair.waitFor(() => online(chair, bob) === false);
    server.advance(10 * 60_000 + 1);
    server.app.sockets.sweep();
    await chair.waitFor((state) => state.players.length === 1, 'Bob dropped');
  });

  test('closes a waiting room once everyone has been dropped from it, and tells its screens', async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code);
    const screen = await connect({ watch: code, roomId });
    chair.close();
    bob.close();
    await until(() => server.app.rooms.find(code)?.onlineCount() === 0, 'everyone offline');
    server.advance(10 * 60_000 + 1);
    server.app.sockets.sweep();
    await until(() => screen.closed.includes('expired'), 'the screen hears');
    expect(server.app.rooms.find(code)).toBeUndefined();
    expect(logged('room_closed')).toEqual([{ code, why: 'empty' }]);
    // Nobody takes over what is left of the room by its code.
    const late = await connect();
    expect(await late.send('room:join', { code, play: false })).toEqual({ ok: false, error: 'room_not_found' });
  });

  test('gives a player who was away during a game the same ten minutes in the waiting room', async () => {
    const { chair, code } = await room();
    const bob = await join(code);
    await start(chair);
    bob.close();
    await chair.waitFor(() => online(chair, bob) === false);
    server.advance(15 * 60_000);
    server.app.sockets.sweep();
    expect(members(code)).toEqual(['Guest 1', 'Guest 2']);

    await chair.send('test:finish');
    expect(await again(chair)).toEqual({ ok: true });
    server.advance(60_000);
    server.app.sockets.sweep();
    expect(members(code)).toEqual(['Guest 1', 'Guest 2']);
    server.advance(9 * 60_000 + 1);
    server.app.sockets.sweep();
    expect(members(code)).toEqual(['Guest 1']);
  });

  // In a game the sweep drops nobody, so that only the half-hour rule can close the room.
  const abandoned = async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code);
    await start(chair);
    chair.close();
    bob.close();
    await until(() => server.app.rooms.find(code)?.onlineCount() === 0, 'everyone offline');
    return { chair, code, roomId };
  };

  test('closes rooms nobody has been in for half an hour', async () => {
    const { code } = await abandoned();
    server.advance(30 * 60_000 - 1000);
    server.app.sockets.sweep();
    expect(server.app.rooms.find(code)).toBeDefined();
    server.advance(1001);
    server.app.sockets.sweep();
    expect(server.app.rooms.find(code)).toBeUndefined();
    expect(logged('room_closed')).toEqual([{ code, why: 'idle' }]);
  });

  test('counts the half hour from the last visit, also one that no sweep saw', async () => {
    const { chair, code, roomId } = await abandoned();
    server.advance(28 * 60_000);
    server.app.sockets.sweep();
    // The chair looks in and is gone again before the next sweep runs.
    const back = await connect({ token: chair.token, code, roomId });
    await back.waitFor((state) => state.code === code);
    back.close();
    await until(() => server.app.rooms.find(code)?.onlineCount() === 0, 'the chair offline again');
    server.advance(2 * 60_000 + 1);
    server.app.sockets.sweep();
    expect(server.app.rooms.find(code)).toBeDefined();
    server.advance(28 * 60_000);
    server.app.sockets.sweep();
    expect(server.app.rooms.find(code)).toBeUndefined();
  });

  test('closes rooms where nothing has happened for six hours, and tells those still there', async () => {
    const { chair, code } = await room();
    server.advance(6 * 60 * 60_000 + 1);
    server.app.sockets.sweep();
    await until(() => chair.closed.includes('expired'), 'room:closed');
    expect(server.app.rooms.find(code)).toBeUndefined();
    expect(logged('room_closed')).toEqual([{ code, why: 'stale' }]);
  });

  test('a restart reaches a connection that is between two long polls', async () => {
    const { chair, code } = await room();
    const bob = await connect({}, { transports: ['polling'] });
    expect(await bob.send('room:join', { code, play: false })).toMatchObject({ ok: true });
    await bob.waitFor((state) => state.code === code);
    const found = server.app.rooms.find(code);
    if (!found) throw new Error('the room is gone');
    // A snapshot answers the request that Bob's connection had waiting, so for a moment the
    // server has nowhere to send him anything. That is when it is told to stop.
    server.app.sockets.broadcast(found);
    await server.app.stop();
    await until(() => bob.closed.includes('restart'), 'Bob hears of the restart');
    expect(chair.closed).toEqual(['restart']);
  });

  test('a restart also reaches whoever made a room while the others were being told', async () => {
    const { chair } = await room();
    // A connection that never asks for what the server has for it, so that the server waits for
    // it as long as it is willing to.
    await rawPolling(server.url);
    const stopped = server.app.stop(400);
    await until(() => chair.closed.includes('restart'), 'the chair hears at once');
    const late = await room();
    await stopped;
    await until(() => late.chair.closed.includes('restart'), 'the latecomer hears as well');
    expect(server.app.rooms.size).toBe(0);
  });

  test('tells everyone when the server restarts', async () => {
    const { chair, code, roomId } = await room();
    const screen = await connect({ watch: code, roomId });
    server.app.sockets.closeAll('restart');
    await until(() => chair.closed.includes('restart') && screen.closed.includes('restart'));
    expect(logged('room_closed')).toEqual([{ code, why: 'restart' }]);
  });
});

test('the fake game is a game module', () => {
  const module: GameModule = fakeGame as GameModule;
  expect(module.id).toBe('test');
});
