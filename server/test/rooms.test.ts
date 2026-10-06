import { CODE_ALPHABET, MAX_PLAYERS, MAX_SCREENS } from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { GameModule } from '../src/core/game';
import { seededRng } from '../src/core/random';
import type { FakeView } from './fakeGame';
import { fakeGame } from './fakeGame';
import { createRoom, joinRoom, startServer, TestClient, until, type Reply, type TestServer } from './helpers';

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
const room = async (name = 'Ann') => {
  const created = await createRoom(server.url, name);
  track(created.chair);
  return created;
};
const join = async (code: string, name: string) => track(await joinRoom(server.url, code, name));
const names = (client: TestClient) => client.state?.players.map((player) => player.name);
const online = (client: TestClient, name: string) =>
  client.state?.players.find((player) => player.name === name)?.online;
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
    expect(chair.state?.players).toEqual([{ id: chair.me, name: 'Ann', online: true }]);
    expect(chair.state?.screens).toBe(0);
  });

  test('checks what it is given', async () => {
    const client = await connect();
    const create = (payload: Record<string, unknown>) =>
      client.send('room:create', { game: 'test', language: 'en', fields: ['general'], name: 'Ann', ...payload });
    expect(await create({ game: 'chess' })).toEqual({ ok: false, error: 'bad_game' });
    expect(await create({ fields: ['nope'] })).toEqual({ ok: false, error: 'bad_fields' });
    expect(await create({ fields: ['tiny'] })).toEqual({ ok: false, error: 'no_words' });
    expect(await create({ language: 'fr' })).toEqual({ ok: false, error: 'bad_request' });
    expect(await create({ fields: [] })).toEqual({ ok: false, error: 'bad_request' });
    expect(await create({ name: '   ' })).toEqual({ ok: false, error: 'name_invalid' });
    expect(await create({ name: 'x'.repeat(17) })).toEqual({ ok: false, error: 'name_invalid' });
    expect(await client.send('room:create', 'nonsense')).toEqual({ ok: false, error: 'bad_request' });
  });
});

describe('joining a room', () => {
  test('needs a code that exists and, for a newcomer, a name', async () => {
    const { code } = await room();
    const client = await connect();
    expect(await client.send('room:join', { code: 'ZZZZ' })).toEqual({ ok: false, error: 'room_not_found' });
    expect(await client.send('room:join', { code })).toEqual({ ok: false, error: 'name_required', language: 'en' });
    expect(await client.send('room:join', { code, name: 'ANN' })).toEqual({ ok: false, error: 'name_taken' });
    expect(await client.send('room:join', { code, name: 'Bob' })).toMatchObject({ ok: true, code });
  });

  test('takes any name of up to 16 characters, however many code points they are built from', async () => {
    const { chair, code } = await room();
    // Ten families of four: 10 characters to a reader, 70 code points, 110 UTF-16 units.
    const families = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}'.repeat(10);
    const client = await connect();
    expect(await client.send('room:join', { code, name: families })).toMatchObject({ ok: true });
    expect(await chair.send('room:rename', { name: families })).toEqual({ ok: false, error: 'name_taken' });
    // A name that is too long is an invalid name, not a malformed message.
    expect(await chair.send('room:rename', { name: 'x'.repeat(200) })).toEqual({ ok: false, error: 'name_invalid' });
  });

  test("refuses a name that looks like someone else's", async () => {
    const { code } = await room();
    const client = await connect();
    const tryName = (name: string) => client.send('room:join', { code, name });
    // A soft hyphen, a bidi isolate and a grapheme joiner show nothing at all.
    for (const name of ['An\u00adn', 'Ann\u2066', 'An\u034fn']) {
      expect(await tryName(name), JSON.stringify(name)).toEqual({ ok: false, error: 'name_invalid' });
    }
    // A variation selector is part of many emoji, and shows nothing after a letter.
    expect(await tryName('Ann\ufe0f')).toEqual({ ok: false, error: 'name_taken' });
    // A Hangul filler is a name that looks empty.
    expect(await tryName('\u3164')).toEqual({ ok: false, error: 'name_invalid' });
  });

  test('tells everyone who is there', async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    await chair.waitFor((state) => state.players.length === 2);
    expect(names(chair)).toEqual(['Ann', 'Bob']);
    expect(names(bob)).toEqual(['Ann', 'Bob']);
    expect(bob.state?.chairId).toBe(chair.me);
  });

  test('accepts the code however it is typed', async () => {
    const { code } = await room();
    const loose = `r2 ${code.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l')}`;
    const client = await connect();
    expect(await client.send('room:join', { code: loose, name: 'Bob' })).toMatchObject({ ok: true, code });
    // None of the spellings of the right code is a wrong code: nothing was counted.
    expect(await client.send('room:watch', { code: `R2${code}` })).toMatchObject({ ok: true, code });
  });

  test('stops at the room size limit', async () => {
    const { code } = await room();
    for (let i = 1; i < MAX_PLAYERS; i += 1) await join(code, `Player ${i}`);
    const late = await connect();
    expect(await late.send('room:join', { code, name: 'Late' })).toEqual({ ok: false, error: 'room_full' });
    // A newcomer hears it before being asked for a name.
    expect(await late.send('room:join', { code })).toEqual({ ok: false, error: 'room_full' });
  });
});

describe('connections', () => {
  test('a player who reconnects with their token is put back, before anything else happens', async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code, 'Bob');
    bob.close();
    await chair.waitFor(() => online(chair, 'Bob') === false, 'Bob offline');

    const back = await connect({ token: bob.token, code, roomId });
    await back.waitFor((state) => state.code === code, 'Bob back');
    await chair.waitFor(() => online(chair, 'Bob') === true, 'Bob online');
    expect(names(chair)).toEqual(['Ann', 'Bob']);
    expect(back.me).toBe(bob.me);
  });

  test('joining again with the same token returns to the same seat', async () => {
    const { code } = await room();
    const bob = await join(code, 'Bob');
    const again = await connect({ token: bob.token });
    expect(await again.send('room:join', { code })).toMatchObject({ ok: true });
    await again.waitFor((state) => state.me === bob.me);
  });

  test('the handshake also works with the code alone', async () => {
    const { code } = await room();
    const bob = await join(code, 'Bob');
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
    const tab1 = await join(code, 'Bob');
    const tab2 = await connect({ token: tab1.token });
    await tab2.send('room:join', { code });
    await tab2.waitFor((state) => state.me === tab1.me);
    expect(names(chair)).toEqual(['Ann', 'Bob']);
    tab1.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(online(chair, 'Bob')).toBe(true);
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
    expect(members(code)).toEqual(['Ann']);
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
    const bob = await join(code, 'Bob');
    const cat = await join(code, 'Cat');
    bob.close();
    cat.close();
    await chair.waitFor(() => online(chair, 'Bob') === false && online(chair, 'Cat') === false);
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
      error: 'name_required',
      language: 'en',
    });
    expect(await bobBack.send('room:join', { code, roomId, name: 'Bob' })).toMatchObject({ ok: true });
    expect(await chair.send('room:remove', { playerId: bobBack.me })).toEqual({ ok: true });
    const again = await connect({ token: bob.token, code, roomId });
    expect(await again.send('room:join', { code, roomId })).toEqual({ ok: false, error: 'removed_recently' });
  });

  test('takes a field that is not what it should be for a missing one', async () => {
    const { code } = await room();
    const bob = await join(code, 'Bob');
    bob.close();
    const back = await connect({ token: bob.token, code, roomId: null });
    await back.waitFor((state) => state.me === bob.me, 'Bob back');
    expect(back.closed).toEqual([]);

    const odd = await connect({ token: 42, code: { length: 4 }, roomId: 7, watch: ['K7QX'] });
    expect(odd.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await odd.send('sys:ping')).toEqual({ ok: true });
    expect(odd.closed).toEqual([]);
  });
});

describe('leaving', () => {
  test("removes the player and tells the player's other tabs", async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    const otherTab = await connect({ token: bob.token });
    await otherTab.send('room:join', { code });
    expect(await bob.send('room:leave')).toEqual({ ok: true });
    await chair.waitFor((state) => state.players.length === 1);
    await until(() => otherTab.closed.includes('left'), 'the other tab hears');
    expect(bob.closed).toEqual([]);
  });

  test('passes the chair on, and closes the room when the last player goes', async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    await chair.send('room:leave');
    await bob.waitFor((state) => state.chairId === bob.me, 'Bob chairs');
    await bob.send('room:leave');
    const late = await connect();
    expect(await late.send('room:join', { code, name: 'Cat' })).toEqual({ ok: false, error: 'room_not_found' });
    expect(logged('room_closed')).toEqual([{ code, why: 'empty' }]);
  });

  test('a renamed player keeps their seat, and names stay unique', async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    expect(await bob.send('room:rename', { name: 'ann' })).toEqual({ ok: false, error: 'name_taken' });
    expect(await bob.send('room:rename', { name: '  Robert  ' })).toEqual({ ok: true });
    await chair.waitFor(() => names(chair)?.[1] === 'Robert');
  });
});

describe("the chair's controls", () => {
  test('are only for the chair', async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
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
    ] as const) {
      expect(await bob.send(message, payload), message).toEqual({ ok: false, error: 'not_chair' });
    }
  });

  test('can hand the chair over', async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    expect(await chair.send('room:chair', { playerId: bob.me })).toEqual({ ok: true });
    await bob.waitFor((state) => state.chairId === bob.me);
    expect(await chair.send('room:chair', { playerId: 'nobody' })).toEqual({ ok: false, error: 'not_chair' });
    expect(await bob.send('room:chair', { playerId: 'nobody' })).toEqual({ ok: false, error: 'no_such_player' });
  });

  test("can't hand the chair to someone who is offline", async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    bob.close();
    await chair.waitFor(() => online(chair, 'Bob') === false, 'Bob offline');
    expect(await chair.send('room:chair', { playerId: bob.me })).toEqual({ ok: false, error: 'player_offline' });
    expect(server.app.rooms.find(code)?.chairId).toBe(chair.me);
  });

  test('can remove a player, who must then wait two minutes to come back', async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    expect(await chair.send('room:remove', { playerId: chair.me })).toEqual({ ok: false, error: 'bad_request' });
    expect(await chair.send('room:remove', { playerId: bob.me })).toEqual({ ok: true });
    await until(() => bob.closed.includes('removed'), 'Bob hears');
    await chair.waitFor((state) => state.players.length === 1);
    expect(await bob.send('room:join', { code, name: 'Bob' })).toEqual({ ok: false, error: 'removed_recently' });
    // Another browser has another token, which the wait can't know. It doesn't get Bob's name.
    const other = await connect();
    expect(await other.send('room:join', { code, name: 'bob' })).toEqual({ ok: false, error: 'name_taken' });
    expect(await chair.send('room:rename', { name: 'Bob' })).toEqual({ ok: false, error: 'name_taken' });
    server.advance(2 * 60_000 + 1);
    expect(await bob.send('room:join', { code, name: 'Bob' })).toMatchObject({ ok: true });
  });

  test('can change the fields in the waiting room', async () => {
    const { chair } = await room();
    expect(await chair.send('room:settings', { fields: ['tiny'] })).toEqual({ ok: false, error: 'no_words' });
    expect(await chair.send('room:settings', { fields: ['nope'] })).toEqual({ ok: false, error: 'bad_fields' });
    expect(await chair.send('room:settings', { fields: ['general', 'tiny'] })).toEqual({ ok: true });
    await chair.waitFor((state) => state.fields.length === 2);
  });
});

describe('games', () => {
  test('start only when the game says so, with words from the library', async () => {
    const { chair, code } = await room();
    expect(await start(chair)).toEqual({ ok: false, error: 'cannot_start' });
    const bob = await join(code, 'Bob');
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
    const bob = await join(code, 'Bob');
    await start(chair);
    expect(await bob.send('test:press')).toEqual({ ok: true });
    await chair.waitFor(() => game(chair).presses === 1);
    expect(game(chair).forViewer).toBe(`for ${chair.me}`);
    expect(game(bob).forViewer).toBe(`for ${bob.me}`);
  });

  test('take game messages only from members, and only for their own game', async () => {
    const { chair, code } = await room();
    await join(code, 'Bob');
    await start(chair);
    const stranger = await connect();
    expect(await stranger.send('test:press')).toEqual({ ok: false, error: 'not_member' });
    expect(await chair.send('chess:move', { to: 'e4' })).toEqual({ ok: false, error: 'bad_request' });
  });

  test('end by themselves or when the chair withdraws, and can be played again', async () => {
    const { chair, code } = await room();
    await join(code, 'Bob');
    await start(chair);
    await chair.send('test:finish');
    await chair.waitFor((state) => state.phase === 'ended');
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
    expect(await chair.send('room:end', { gameId })).toEqual({ ok: false, error: 'wrong_phase' });
    // A withdrawal that arrives after the room went back to the waiting room is for no game.
    await again(chair);
    await chair.waitFor((state) => state.phase === 'lobby');
    expect(await chair.send('room:end', { gameId })).toEqual({ ok: false, error: 'stale' });
  });

  test('end when the game says so, whatever brought the end about', async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    const cat = await join(code, 'Cat');
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
    await join(code, 'Bob');
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
    await join(code, 'Bob');
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
    await join(code, 'Bob');
    await start(chair);
    expect(await chair.send('test:explode')).toEqual({ ok: false, error: 'internal' });
    expect(await chair.send('test:press')).toEqual({ ok: true });
    expect(server.logs.some((entry) => entry.event === 'error')).toBe(true);
  });

  test("the chair's bench and shuffle reach the game", async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    expect(await chair.send('room:spectate', { playerId: bob.me })).toEqual({ ok: true });
    await chair.waitFor(() => game(chair).benched.includes(bob.me));
    expect(await chair.send('room:spectate', { playerId: 'nobody' })).toEqual({ ok: false, error: 'no_such_player' });
    expect(await chair.send('room:shuffle')).toEqual({ ok: true });
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

  test('in a view costs only that view, wherever the view is built', async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code, 'Bob');
    expect(await chair.send('test:break', 'view')).toEqual({ ok: true });
    // A disconnect, a handshake and the sweep send views too, with no message to answer.
    bob.close();
    await until(() => server.app.rooms.find(code)?.onlineCount() === 1, 'Bob offline');
    const back = await connect({ token: bob.token, code, roomId });
    await until(() => server.app.rooms.find(code)?.onlineCount() === 2, 'Bob back');
    server.advance(3 * 60_000);
    server.app.sockets.sweep();
    expect(errors().length).toBeGreaterThan(0);
    expect(errors().every((entry) => entry.fields?.where === 'view')).toBe(true);

    expect(await chair.send('test:mend')).toEqual({ ok: true });
    await back.waitFor((state) => state.me === bob.me, 'Bob sees the room again');
  });

  test('when someone leaves, leaves the room as it was', async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    await chair.send('test:break', 'leave');
    expect(await bob.send('room:leave')).toEqual({ ok: false, error: 'internal' });
    expect(await chair.send('room:remove', { playerId: bob.me })).toEqual({ ok: false, error: 'internal' });
    expect(members(code)).toEqual(['Ann', 'Bob']);
    expect(await chair.send('room:leave')).toEqual({ ok: false, error: 'internal' });
    expect(server.app.rooms.find(code)?.chairId).toBe(chair.me);

    // Bob is still a member like any other, and nothing says that he was removed.
    await chair.send('test:mend');
    expect(await bob.send('room:leave')).toEqual({ ok: true });
    expect(await bob.send('room:join', { code, name: 'Bob' })).toMatchObject({ ok: true });
  });

  test('when someone joins, lets nobody in', async () => {
    const { chair, code } = await room();
    await chair.send('test:break', 'join');
    const client = await connect();
    expect(await client.send('room:join', { code, name: 'Bob' })).toEqual({ ok: false, error: 'internal' });
    expect(members(code)).toEqual(['Ann']);
    expect(await client.send('test:press')).toEqual({ ok: false, error: 'not_member' });
  });

  test('in the sweep stops the sweep of its own room only', async () => {
    const broken = await room('Ann');
    const bob = await join(broken.code, 'Bob');
    const other = await room('Cat');
    const dan = await join(other.code, 'Dan');
    await broken.chair.send('test:break', 'leave');
    bob.close();
    dan.close();
    await until(() => [broken, other].every(({ code }) => server.app.rooms.find(code)?.onlineCount() === 1));
    server.advance(10 * 60_000 + 1);
    server.app.sockets.sweep();
    await other.chair.waitFor((state) => state.players.length === 1, 'Dan dropped');
    expect(members(broken.code)).toEqual(['Ann', 'Bob']);
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
    expect(names(chair)).toEqual(['Ann']);
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
    await until(() => taken.every((screen) => screen.closed.includes('removed')), 'the screens hear');
    await chair.waitFor((state) => state.screens === 0, 'the chair sees none');
    expect(await taken[0]?.send('test:press')).toEqual({ ok: false, error: 'not_member' });
    expect(await projector.send('room:watch', { code })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.screens === 1);
    projector.close();
    await chair.waitFor((state) => state.screens === 0, 'the count follows a screen that goes');
  });

  test("can't be put up by someone the chair has just removed", async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    await chair.send('room:remove', { playerId: bob.me });
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
    const second = await room('Stranger');
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
    expect(await player.send('room:join', { ...asked, name: 'Ann' })).toEqual({ ok: false, error: 'room_not_found' });
    expect(members(second.code)).toEqual(['Stranger']);
  });
});

describe('messages', () => {
  test('are handled in the order in which a connection sent them', async () => {
    const { chair, code } = await room();
    await join(code, 'Bob');
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
    for (const message of ['room:nonsense', 'sys:nonsense', 'meta:nonsense']) {
      expect(await chair.send(message), message).toEqual({ ok: false, error: 'bad_request' });
    }
    // Unknown messages use up the connection's allowance like any other.
    const replies = await Promise.all(Array.from({ length: 30 }, () => chair.send('room:nonsense')));
    expect(replies.some((reply) => reply.error === 'rate_limited')).toBe(true);
  });

  test('one with more than a payload is refused, and still answered', async () => {
    const { chair } = await room();
    const reply = (await chair.socket.timeout(2000).emitWithAck('room:rename', { name: 'Zed' }, 'extra')) as Reply;
    expect(reply).toEqual({ ok: false, error: 'bad_request' });
    expect(await chair.send('sys:ping')).toEqual({ ok: true });
    expect(names(chair)).toEqual(['Ann']);
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

  test('one address may create only a few rooms a minute', async () => {
    for (let i = 0; i < 5; i += 1) await room(`Chair ${i}`);
    const client = await connect();
    const reply = await client.send('room:create', { game: 'test', language: 'en', fields: ['general'], name: 'Six' });
    expect(reply).toEqual({ ok: false, error: 'rate_limited' });
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
    expect(await client.send('room:join', { code, name: 'Bob' })).toEqual({ ok: false, error: 'rate_limited' });
    server.advance(60_000);
    expect(await client.send('room:join', { code, name: 'Bob' })).toMatchObject({ ok: true });
  });

  test('watching counts like joining, and a handshake counts for nothing', async () => {
    const { code, roomId } = await room();
    const client = await connect();
    await mistype(client, 'room:watch');
    expect(await client.send('room:watch', { code })).toEqual({ ok: false, error: 'rate_limited' });
    expect(await client.send('room:join', { code, name: 'Bob' })).toEqual({ ok: false, error: 'rate_limited' });
    // Whoever gives the room's ID has been there, and is not held up.
    expect(await client.send('room:watch', { code, roomId })).toMatchObject({ ok: true });

    // Handshakes with wrong codes are not counted, because they are not answered either.
    server.advance(60_000);
    for (let i = 0; i < 25; i += 1) await connect(i % 2 ? { code: 'ZZZZ' } : { watch: 'ZZZZ', roomId: 'another-room' });
    expect(await client.send('room:join', { code, name: 'Bob' })).toMatchObject({ ok: true });
  });

  test('a wrong room ID finds nothing, and tells nothing about the code', async () => {
    const { code } = await room();
    const client = await connect();
    for (const tried of [code, 'ZZZZ']) {
      const asked = { code: tried, roomId: 'another-room' };
      expect(await client.send('room:join', { ...asked, name: 'Bob' })).toEqual({ ok: false, error: 'room_not_found' });
      expect(await client.send('room:watch', asked)).toEqual({ ok: false, error: 'room_not_found' });
    }
    // Nor does it count: none of these could have found a room.
    for (let i = 0; i < 25; i += 1) {
      server.advance(200);
      await client.send('room:watch', { code: 'ZZZZ', roomId: 'another-room' });
    }
    expect(await client.send('room:join', { code, name: 'Bob' })).toMatchObject({ ok: true });
  });

  test('a member comes back whatever their address has used up', async () => {
    const { code, roomId } = await room();
    const bob = await join(code, 'Bob');
    await mistype(await connect());
    const newcomer = await connect();
    expect(await newcomer.send('room:join', { code, name: 'Cat' })).toEqual({ ok: false, error: 'rate_limited' });
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
      return client.send('room:create', { game: 'test', language: 'en', fields: ['general'], name: 'Ann' });
    };
    for (let port = 5000; port < 5005; port += 1) {
      expect(await create(`203.0.113.9:${port}`)).toMatchObject({ ok: true });
    }
    expect(await create('203.0.113.9:5005')).toEqual({ ok: false, error: 'rate_limited' });
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
    const bob = await join(code, 'Bob');
    chair.close();
    await bob.waitFor(() => online(bob, 'Ann') === false);
    server.advance(2 * 60_000);
    server.app.sockets.sweep();
    expect(bob.state?.chairId).not.toBe(bob.me);
    server.advance(60_000 + 1);
    server.app.sockets.sweep();
    await bob.waitFor((state) => state.chairId === bob.me, 'Bob chairs');
  });

  test('drops players who stay away from the waiting room', async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    bob.close();
    await chair.waitFor(() => online(chair, 'Bob') === false);
    server.advance(10 * 60_000 + 1);
    server.app.sockets.sweep();
    await chair.waitFor((state) => state.players.length === 1, 'Bob dropped');
  });

  test('closes a waiting room once everyone has been dropped from it, and tells its screens', async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code, 'Bob');
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
    expect(await late.send('room:join', { code, name: 'Cat' })).toEqual({ ok: false, error: 'room_not_found' });
  });

  test('gives a player who was away during a game the same ten minutes in the waiting room', async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    await start(chair);
    bob.close();
    await chair.waitFor(() => online(chair, 'Bob') === false);
    server.advance(15 * 60_000);
    server.app.sockets.sweep();
    expect(members(code)).toEqual(['Ann', 'Bob']);

    await chair.send('test:finish');
    expect(await again(chair)).toEqual({ ok: true });
    server.advance(60_000);
    server.app.sockets.sweep();
    expect(members(code)).toEqual(['Ann', 'Bob']);
    server.advance(9 * 60_000 + 1);
    server.app.sockets.sweep();
    expect(members(code)).toEqual(['Ann']);
  });

  // In a game the sweep drops nobody, so that only the half-hour rule can close the room.
  const abandoned = async () => {
    const { chair, code, roomId } = await room();
    const bob = await join(code, 'Bob');
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
    expect(await bob.send('room:join', { code, name: 'Bob' })).toMatchObject({ ok: true });
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
