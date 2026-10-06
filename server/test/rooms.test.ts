import { MAX_PLAYERS, MAX_SCREENS } from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { GameModule } from '../src/core/game';
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
const connect = async (auth: Parameters<typeof TestClient.connect>[1] = {}) =>
  track(await TestClient.connect(server.url, auth));
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
    const loose = `r2-${code.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l')}`;
    const client = await connect();
    expect(await client.send('room:join', { code: loose, name: 'Bob' })).toMatchObject({ ok: true, code });
  });

  test('stops at the room size limit', async () => {
    const { code } = await room();
    for (let i = 1; i < MAX_PLAYERS; i += 1) await join(code, `Player ${i}`);
    const late = await connect();
    expect(await late.send('room:join', { code, name: 'Late' })).toEqual({ ok: false, error: 'room_full' });
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
      ['room:start', {}],
      ['room:shuffle', {}],
      ['room:spectate', { playerId: chair.me }],
      ['room:remove', { playerId: chair.me }],
      ['room:chair', { playerId: bob.me }],
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
  });

  test('can remove a player, who must then wait two minutes to come back', async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    expect(await chair.send('room:remove', { playerId: chair.me })).toEqual({ ok: false, error: 'bad_request' });
    expect(await chair.send('room:remove', { playerId: bob.me })).toEqual({ ok: true });
    await until(() => bob.closed.includes('removed'), 'Bob hears');
    await chair.waitFor((state) => state.players.length === 1);
    expect(await bob.send('room:join', { code, name: 'Bob' })).toEqual({ ok: false, error: 'removed_recently' });
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
    expect(await chair.send('room:start')).toEqual({ ok: false, error: 'cannot_start' });
    const bob = await join(code, 'Bob');
    expect(await chair.send('room:start')).toEqual({ ok: true });
    const state = await bob.waitFor((view) => view.phase === 'playing');
    expect(game(bob).words).toHaveLength(3);
    expect(game(bob).words.every((word) => word.startsWith('general word'))).toBe(true);
    expect(state.fields).toEqual(['general']);
    expect(await chair.send('room:start')).toEqual({ ok: false, error: 'wrong_phase' });
  });

  test('send every connection its own view', async () => {
    const { chair, code } = await room();
    const bob = await join(code, 'Bob');
    await chair.send('room:start');
    expect(await bob.send('test:press')).toEqual({ ok: true });
    await chair.waitFor(() => game(chair).presses === 1);
    expect(game(chair).forViewer).toBe(`for ${chair.me}`);
    expect(game(bob).forViewer).toBe(`for ${bob.me}`);
  });

  test('take game messages only from members, and only for their own game', async () => {
    const { chair, code } = await room();
    await join(code, 'Bob');
    await chair.send('room:start');
    const stranger = await connect();
    expect(await stranger.send('test:press')).toEqual({ ok: false, error: 'not_member' });
    expect(await chair.send('chess:move', { to: 'e4' })).toEqual({ ok: false, error: 'bad_request' });
  });

  test('end by themselves or when the chair withdraws, and can be played again', async () => {
    const { chair, code } = await room();
    await join(code, 'Bob');
    await chair.send('room:start');
    await chair.send('test:finish');
    await chair.waitFor((state) => state.phase === 'ended');
    expect(server.logs.some((entry) => entry.event === 'game_ended')).toBe(true);
    expect(await chair.send('room:again')).toEqual({ ok: true });
    await chair.waitFor((state) => state.phase === 'lobby');
    await chair.send('room:start');
    const { gameId } = game(chair);
    expect(await chair.send('room:end')).toEqual({ ok: false, error: 'bad_request' });
    expect(await chair.send('room:end', { gameId: 'an-earlier-game' })).toEqual({ ok: false, error: 'stale' });
    expect(await chair.send('room:end', { gameId })).toEqual({ ok: true });
    await chair.waitFor((state) => state.phase === 'ended');
    expect(await chair.send('room:end', { gameId })).toEqual({ ok: false, error: 'wrong_phase' });
    // A withdrawal that arrives after the room went back to the waiting room is for no game.
    await chair.send('room:again');
    await chair.waitFor((state) => state.phase === 'lobby');
    expect(await chair.send('room:end', { gameId })).toEqual({ ok: false, error: 'stale' });
  });

  test('a game that throws answers internal, and the server goes on', async () => {
    const { chair, code } = await room();
    await join(code, 'Bob');
    await chair.send('room:start');
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
  const members = (code: string) => [...(server.app.rooms.find(code)?.members.values() ?? [])].map(({ name }) => name);

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

  test('can come back through the handshake, and are limited per room', async () => {
    const { code } = await room();
    const first = await connect({ watch: code });
    await first.waitFor((view) => view.me === null);
    for (let i = 1; i < MAX_SCREENS; i += 1) await connect({ watch: code });
    const extra = await connect();
    expect(await extra.send('room:watch', { code })).toEqual({ ok: false, error: 'screens_full' });
  });
});

describe('messages', () => {
  test('are handled in the order in which a connection sent them', async () => {
    const { chair, code } = await room();
    await join(code, 'Bob');
    // Sent together, without waiting for the first answer: the game message must not overtake
    // the start of its game.
    const [started, pressed] = await Promise.all([chair.send('room:start'), chair.send('test:press')]);
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

  test('one address may fail to join only so often', async () => {
    const client = await connect();
    for (let i = 0; i < 20; i += 1) {
      server.advance(200); // stay under the per-connection limit
      expect(await client.send('room:join', { code: 'ZZZZ' })).toEqual({ ok: false, error: 'room_not_found' });
    }
    expect(await client.send('room:join', { code: 'ZZZZ' })).toEqual({ ok: false, error: 'rate_limited' });
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

  test('closes rooms nobody has been in for half an hour', async () => {
    const { chair, code } = await room();
    chair.close();
    await until(() => server.app.rooms.find(code)?.onlineCount() === 0);
    server.advance(30 * 60_000 + 1);
    server.app.sockets.sweep();
    expect(server.app.rooms.find(code)).toBeUndefined();
  });

  test('closes rooms where nothing has happened for six hours, and tells those still there', async () => {
    const { chair, code } = await room();
    server.advance(6 * 60 * 60_000 + 1);
    server.app.sockets.sweep();
    await until(() => chair.closed.includes('expired'), 'room:closed');
    expect(server.app.rooms.find(code)).toBeUndefined();
  });

  test('tells everyone when the server restarts', async () => {
    const { chair, code } = await room();
    const screen = await connect({ watch: code });
    server.app.sockets.closeAll('restart');
    await until(() => chair.closed.includes('restart') && screen.closed.includes('restart'));
  });
});

test('the fake game is a game module', () => {
  const module: GameModule = fakeGame as GameModule;
  expect(module.id).toBe('test');
});
