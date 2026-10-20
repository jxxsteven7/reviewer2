import { connect as connectTcp } from 'node:net';
import { MAX_SCREENS } from '@reviewer2/shared';
import { io, type ManagerOptions, type SocketOptions } from 'socket.io-client';
import { afterEach, describe, expect, test } from 'vitest';
import { memberKey } from '../src/core/identity';
import { BUSY_MEMBER_CONNECTIONS, DEFAULT_CONNECTIONS_PER_ADDRESS } from '../src/core/load';
import { MAX_LOGGED_PER_MEMBER } from '../src/core/room';
import { Browser, createRoom, startServer, TestClient, until, type TestServer } from './helpers';

// What one address, and everyone at once, may take of the server (core/load.ts): the connections
// one address may have open, what a busy server turns away and lets through, the log's line of the
// minute for what the limits turned away (core/refusals.ts), and the HTTP server's timeouts.

let server: TestServer;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
});

async function connect(
  auth: Record<string, unknown> = {},
  options: Partial<ManagerOptions & SocketOptions> = {},
): Promise<TestClient> {
  const client = await TestClient.connect(server.url, auth, options);
  clients.push(client);
  return client;
}

// A connection that the server turns away, with the error that Socket.IO gives the page.
function refused(auth: Record<string, unknown> = {}, options: Partial<ManagerOptions & SocketOptions> = {}) {
  return new Promise<Error>((resolve, reject) => {
    const socket = io(server.url, { auth, transports: ['websocket'], reconnection: false, forceNew: true, ...options });
    socket.once('connect', () => {
      socket.close();
      reject(new Error('the connection was made'));
    });
    socket.once('connect_error', (error) => {
      socket.close();
      resolve(error);
    });
  });
}

// The start of a connection over Engine.IO's long polling, which never comes to Socket.IO.
const handshake = () => fetch(`${server.url}/socket.io/?EIO=4&transport=polling`);

const open = () => server.app.io.engine.clientsCount;
const lines = (event: string) => server.logs.filter((entry) => entry.event === event).map(({ fields }) => fields);

describe('the connections of one address', () => {
  test('are refused past the limit, count until they close, and are taken again then', async () => {
    server = await startServer({ connectionsPerAddress: 3 });
    for (let round = 0; round < 3; round += 1) {
      const three = [await connect(), await connect(), await connect()];
      await expect(refused()).resolves.toBeInstanceOf(Error);
      expect(open()).toBe(3);
      for (const client of three) client.close();
      await until(() => open() === 0, 'the connections to close');
    }
    server.app.refusals.flush();
    expect(lines('limited')).toEqual([{ level: 'warn', limit: 'connections_per_address', count: 3, addresses: 1 }]);
  });

  test('count from the handshake of Engine.IO, whether or not the connection comes to Socket.IO', async () => {
    server = await startServer({ connectionsPerAddress: 2 });
    expect((await handshake()).status).toBe(200);
    expect((await handshake()).status).toBe(200);
    const third = await handshake();
    expect(third.status).toBe(403);
    expect(await third.json()).toMatchObject({ message: 'too_many_connections' });
    await expect(refused({}, { transports: ['polling'] })).resolves.toBeInstanceOf(Error);
  });

  test('may be raised, which the server says, since a higher limit protects less', async () => {
    server = await startServer({ connectionsPerAddress: DEFAULT_CONNECTIONS_PER_ADDRESS });
    expect(lines('connections_per_address_raised')).toEqual([]);
    await server.close();
    const raised = DEFAULT_CONNECTIONS_PER_ADDRESS + 1;
    server = await startServer({ connectionsPerAddress: raised });
    expect(lines('connections_per_address_raised')).toEqual([
      { connectionsPerAddress: raised, default: DEFAULT_CONNECTIONS_PER_ADDRESS },
    ]);
  });

  test('are counted for each address behind a reverse proxy', async () => {
    server = await startServer({ trustProxy: true, connectionsPerAddress: 2 });
    const from = (address: string) => ({ extraHeaders: { 'x-forwarded-for': address } });
    await connect({}, from('203.0.113.9'));
    await connect({}, from('203.0.113.9'));
    await expect(refused({}, from('203.0.113.9'))).resolves.toBeInstanceOf(Error);
    await connect({}, from('198.51.100.7'));
    // One IPv6 network is one address.
    await connect({}, from('2001:db8:1:2::1'));
    await connect({}, from('2001:db8:1:2::2'));
    await expect(refused({}, from('2001:db8:1:2::3'))).resolves.toBeInstanceOf(Error);
  });
});

describe('a busy server', () => {
  const MB = 2 ** 20;

  test('turns newcomers and new rooms away, and lets members and screens back into their rooms', async () => {
    let memory = 50 * MB;
    server = await startServer({ busyMemoryMb: 100, memory: () => memory });
    const { chair, code, roomId } = await createRoom(server.url);
    clients.push(chair);
    const token = chair.token;
    const looker = await connect();
    expect(server.app.stats().busy).toBe(false);

    memory = 100 * MB;
    expect((await refused()).message).toBe('server_busy');
    // A code alone, or with the room's ID, doesn't make a stranger a member.
    expect((await refused({ code })).message).toBe('server_busy');
    expect((await refused({ code, roomId })).message).toBe('server_busy');
    expect(await looker.send('room:create', { game: 'test', language: 'en', fields: ['general'] })).toEqual({
      ok: false,
      error: 'server_busy',
    });
    expect(lines('busy_started')).toEqual([
      { level: 'warn', connections: 3, memoryMb: 100, busyConnections: 10_000, busyMemoryMb: 100 },
    ]);
    expect(server.app.stats().busy).toBe(true);

    // The chair's phone locked, and the page comes back by its handshake.
    chair.close();
    const back = await connect({ token, code, roomId });
    await back.waitFor((state) => state.code === code && state.me !== null);
    // A screen comes back by the room's ID.
    const screen = await connect({ watch: code, roomId });
    await screen.waitFor((state) => state.code === code);
    // What is open goes on.
    expect(await looker.send('meta:rooms')).toMatchObject({ ok: true });

    server.app.refusals.flush();
    expect(lines('limited')).toEqual([
      { level: 'warn', limit: 'busy_connections', count: 3, addresses: 1 },
      { level: 'warn', limit: 'busy_rooms', count: 1, addresses: 1 },
    ]);

    // Once the load has come down far enough, newcomers are taken again.
    memory = 95 * MB;
    expect((await refused()).message).toBe('server_busy');
    memory = 89 * MB;
    await connect();
    expect(lines('busy_ended')).toEqual([{ connections: 4, memoryMb: 89, busyConnections: 10_000, busyMemoryMb: 100 }]);
    expect(await looker.send('room:create', { game: 'test', language: 'en', fields: ['general'] })).toMatchObject({
      ok: true,
    });
    expect(server.app.stats().busy).toBe(false);
  });

  test('lets a member back on a few connections, and a screen while the room has room for one', async () => {
    let memory = 50 * MB;
    server = await startServer({ busyMemoryMb: 100, memory: () => memory });
    const { chair, code, roomId } = await createRoom(server.url);
    clients.push(chair);
    memory = 100 * MB;
    // The chair's phone and computer come back; whoever has the token besides gets no further.
    for (let i = 1; i < BUSY_MEMBER_CONNECTIONS; i += 1) {
      const back = await connect({ token: chair.token, code, roomId });
      await back.waitFor((state) => state.code === code && state.me !== null);
    }
    expect((await refused({ token: chair.token, code, roomId })).message).toBe('server_busy');
    // Once one of them has gone, the seat has room again.
    const seat = () => server.app.rooms.find(code)?.memberByKey(memberKey(chair.token));
    chair.close();
    await until(() => seat()?.sockets.size === BUSY_MEMBER_CONNECTIONS - 1, 'the connection to close');
    const back = await connect({ token: chair.token, code, roomId });
    await back.waitFor((state) => state.code === code && state.me !== null);

    // The room's screens come back while the room may have another; a sixth isn't one of them.
    for (let i = 0; i < MAX_SCREENS; i += 1) {
      const screen = await connect({ watch: code, roomId });
      await screen.waitFor((state) => state.code === code && state.screens === i + 1);
    }
    expect((await refused({ watch: code, roomId })).message).toBe('server_busy');
    server.app.refusals.flush();
    expect(lines('limited')).toEqual([{ level: 'warn', limit: 'busy_connections', count: 2, addresses: 1 }]);
  });

  test('is busy with more connections than BUSY_CONNECTIONS, and takes newcomers again well below it', async () => {
    server = await startServer({ busyConnections: 4 });
    const four = [await connect(), await connect(), await connect(), await connect()];
    expect((await refused()).message).toBe('server_busy');
    expect(lines('busy_started')).toMatchObject([{ connections: 5, busyConnections: 4 }]);
    for (const client of four.slice(2)) client.close();
    await until(() => open() === 2, 'the connections to close');
    await connect();
    expect(lines('busy_ended')).toMatchObject([{ connections: 3, busyConnections: 4 }]);
  });
});

describe("the limits' line of the minute", () => {
  test('counts what the message, room and account API limits turned away, naming no address', async () => {
    server = await startServer({ roomsPerMinute: 1, accountLimits: { requestsPerMinute: 1 } });
    const { chair } = await createRoom(server.url);
    clients.push(chair);
    expect(await chair.send('room:create', { game: 'test', language: 'en', fields: ['general'] })).toEqual({
      ok: false,
      error: 'rate_limited',
    });
    const flood = await connect();
    const replies = await Promise.all(Array.from({ length: 30 }, () => flood.send('sys:ping')));
    const floods = replies.filter((reply) => !reply.ok).length;
    expect(floods).toBeGreaterThan(0);
    const browser = new Browser(server.url);
    expect((await browser.request('/api/logout', {})).status).not.toBe(429);
    expect((await browser.request('/api/logout', {})).status).toBe(429);

    server.app.refusals.flush();
    expect(lines('limited')).toEqual([
      { level: 'warn', limit: 'rooms', count: 1, addresses: 1 },
      { level: 'warn', limit: 'messages', count: floods, addresses: 1 },
      { level: 'warn', limit: 'requests', count: 1, addresses: 1 },
    ]);
    expect(JSON.stringify(lines('limited'))).not.toContain('127.0.0.1');
    // The next minute starts anew.
    server.app.refusals.flush();
    expect(lines('limited')).toHaveLength(3);
  });

  test('counts a member whom the log of their game takes no more from', async () => {
    server = await startServer({ socketLimits: { messagesPerSecond: 1000, messageBurst: 1000 } });
    const { chair, code } = await createRoom(server.url, { play: true });
    clients.push(chair);
    const other = await connect();
    expect(await other.send('room:join', { code, play: true })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.players.length === 2);
    expect(await chair.send('room:start', { round: 0 })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.phase === 'playing');
    for (let press = 0; press < MAX_LOGGED_PER_MEMBER; press += 1) {
      expect(await chair.send('test:press')).toMatchObject({ ok: true });
    }
    expect(await chair.send('test:press')).toEqual({ ok: false, error: 'rate_limited' });
    expect(await chair.send('test:press')).toEqual({ ok: false, error: 'rate_limited' });
    server.app.refusals.flush();
    expect(lines('limited')).toEqual([{ level: 'warn', limit: 'game_log', count: 2, addresses: 1 }]);
  });
});

describe('the HTTP timeouts', () => {
  const short = { headersTimeout: 300, requestTimeout: 600, keepAliveTimeout: 3_000, connectionsCheckingInterval: 50 };

  // A connection over plain TCP that writes `request`, and resolves with what came back once the
  // server has closed it.
  function raw(request: string): Promise<{ answer: string; ms: number }> {
    const { port } = new URL(server.url);
    return new Promise((resolve, reject) => {
      const started = performance.now();
      let answer = '';
      const socket = connectTcp(Number(port), '127.0.0.1', () => socket.write(request));
      socket.on('data', (data) => (answer += data.toString()));
      socket.on('error', reject);
      socket.on('close', () => resolve({ answer, ms: performance.now() - started }));
    });
  }

  test('close a connection whose headers never end', async () => {
    server = await startServer({ httpLimits: short });
    const { answer, ms } = await raw('GET /healthz HTTP/1.1\r\nHost: localhost\r\nX-Slow: 1');
    expect(answer).toMatch(/^HTTP\/1\.1 408/);
    expect(ms).toBeLessThan(2_000);
  });

  test('cut neither a long poll nor a WebSocket, nor a connection waiting for its next request', async () => {
    server = await startServer({ httpLimits: short });
    const polling = await connect({}, { transports: ['polling'] });
    const websocket = await connect();
    // Twice the time a request may take: a long poll is held all along, waiting for the heartbeat.
    await new Promise((resolve) => setTimeout(resolve, 2 * short.requestTimeout));
    expect(await polling.send('sys:ping')).toEqual({ ok: true });
    expect(await websocket.send('sys:ping')).toEqual({ ok: true });
    expect([...polling.disconnects, ...websocket.disconnects]).toEqual([]);

    // Two requests on one connection, with longer than the headers may take between them.
    const { port } = new URL(server.url);
    const answers: string[] = [];
    const socket = connectTcp(Number(port), '127.0.0.1');
    socket.on('data', (data) => answers.push(data.toString()));
    const request = 'GET /healthz HTTP/1.1\r\nHost: localhost\r\n\r\n';
    socket.write(request);
    await until(() => answers.length === 1, 'the first answer');
    await new Promise((resolve) => setTimeout(resolve, 2 * short.headersTimeout));
    socket.write(request);
    await until(() => answers.length === 2, 'the second answer');
    expect(answers.map((answer) => answer.split('\r\n', 1)[0])).toEqual(['HTTP/1.1 200 OK', 'HTTP/1.1 200 OK']);
    socket.destroy();
  });
});
