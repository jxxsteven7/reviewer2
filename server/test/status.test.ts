import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { createConnection, type AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import type { Live } from '../src/live';
import type { Stats } from '../src/stats';
import { createStatusHandler } from '../src/status';
import { createRoom, joinRoom, loggedIn, rawPolling, startServer, TestClient, until, type TestServer } from './helpers';

// The numbers that the `stats` line and /status.json give, counted on a real server, who is
// connected and in which room for /live.json, and the status port's own HTTP server.

let server: TestServer;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
});

async function connect(country?: string, options: { transports?: string[] } = {}): Promise<TestClient> {
  const client = await TestClient.connect(
    server.url,
    {},
    { ...options, ...(country === undefined ? {} : { extraHeaders: { 'cf-ipcountry': country } }) },
  );
  clients.push(client);
  return client;
}

describe('the numbers', () => {
  test('count the rooms by phase and their members online and offline', async () => {
    server = await startServer();
    expect(server.app.stats()).toMatchObject({
      rooms: { lobby: 0, playing: 0, ended: 0 },
      players: { online: 0, offline: 0 },
      connections: { websocket: 0, polling: 0 },
      countries: [],
    });

    const { chair, code } = await createRoom(server.url);
    const bob = await joinRoom(server.url, code);
    const other = await createRoom(server.url);
    clients.push(chair, bob, other.chair);
    expect(await chair.send('room:start', { round: 0 })).toEqual({ ok: true });
    expect(server.app.stats()).toMatchObject({
      rooms: { lobby: 1, playing: 1, ended: 0 },
      players: { online: 3, offline: 0 },
      connections: { websocket: 3, polling: 0 },
    });

    bob.close();
    await until(() => server.app.stats().players.offline === 1, 'Bob to go offline');
    expect(await chair.send('test:finish')).toEqual({ ok: true });
    expect(server.app.stats()).toMatchObject({
      rooms: { lobby: 1, playing: 0, ended: 1 },
      players: { online: 2, offline: 1 },
      connections: { websocket: 2, polling: 0 },
    });
  });

  test('count a connection on long-polling, and one that is in no room', async () => {
    server = await startServer();
    await connect(undefined, { transports: ['polling'] });
    await connect();
    expect(server.app.stats()).toMatchObject({
      rooms: { lobby: 0, playing: 0, ended: 0 },
      players: { online: 0, offline: 0 },
      connections: { websocket: 1, polling: 1 },
    });
  });

  test("take each connection's country from Cloudflare's header behind a trusted proxy", async () => {
    server = await startServer({ trustProxy: true });
    for (const country of ['SG', 'SG', 'cn', 'T1', 'Singapore']) await connect(country);
    await connect();
    expect(server.app.stats().countries).toEqual([
      { country: 'XX', connections: 3, latency: null },
      { country: 'SG', connections: 2, latency: null },
      { country: 'CN', connections: 1, latency: null },
    ]);
  });

  test("don't believe the header without a trusted proxy", async () => {
    server = await startServer();
    await connect('SG');
    expect(server.app.stats().countries).toEqual([{ country: 'XX', connections: 1, latency: null }]);
  });

  test("time each connection's heartbeat, and give each country the median", async () => {
    server = await startServer({ trustProxy: true });
    for (const country of ['SG', 'SG', 'SG', 'CN']) await connect(country);
    const sockets = [...server.app.io.sockets.sockets.values()];
    // Engine.IO pings every 10 seconds, so the heartbeats are played here by hand: a ping is
    // flushed to the wire, the clock moves on, and the pong comes back.
    const beat = (index: number, ms: number) => {
      const conn = sockets[index]?.conn;
      conn?.emit('flush', [{ type: 'ping' }]);
      server.advance(ms);
      conn?.emit('packet', { type: 'pong' });
    };
    beat(0, 100);
    beat(1, 300);
    beat(3, 250);
    // A pong that answers no ping, and anything else that comes in, leaves the latency alone.
    sockets[0]?.conn.emit('packet', { type: 'pong' });
    sockets[0]?.conn.emit('packet', { type: 'message' });
    expect(server.app.stats().countries).toEqual([
      { country: 'SG', connections: 3, latency: 200 },
      { country: 'CN', connections: 1, latency: 250 },
    ]);
    // The last heartbeat is the one that counts.
    beat(0, 20);
    expect(server.app.stats().countries[0]).toEqual({ country: 'SG', connections: 3, latency: 160 });
    // A ping that is made but waits in the buffer, as it does between two polls, hasn't gone out
    // yet: the clock starts when it is flushed.
    sockets[3]?.conn.emit('packetCreate', { type: 'ping' });
    server.advance(500);
    beat(3, 40);
    expect(server.app.stats().countries[1]).toEqual({ country: 'CN', connections: 1, latency: 40 });
  });

  test('time the heartbeat once per connection, however often a client leaves and comes back on it', async () => {
    server = await startServer();
    const raw = await rawPolling(server.url);
    const socket = () => [...server.app.io.sockets.sockets.values()][0];
    const conn = socket()?.conn;
    expect(conn).toBeDefined();
    const listeners = () => ({ flush: conn?.listenerCount('flush'), packet: conn?.listenerCount('packet') });
    const before = listeners();
    // "41" leaves Socket.IO and "40" comes back, on the same Engine.IO connection. Listeners added
    // for each socket, and never removed, would pile up on the connection, round after round.
    for (let round = 0; round < 15; round += 1) {
      await raw.post('41');
      await raw.post('40');
      await raw.get();
    }
    await until(() => socket()?.conn === conn && socket()?.connected === true, 'the last socket to connect');
    expect(listeners()).toEqual(before);
    // The connection is still timed.
    conn?.emit('flush', [{ type: 'ping' }]);
    server.advance(30);
    conn?.emit('packet', { type: 'pong' });
    expect(server.app.stats().countries).toEqual([{ country: 'XX', connections: 1, latency: 30 }]);
  });
});

// Sends a request with the Host header and method given, which fetch() won't let a caller set.
function get(
  base: string,
  path: string,
  headers: Record<string, string> = {},
  method = 'GET',
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const sent = request(base, { path, headers, method }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
    });
    sent.on('error', reject);
    sent.end();
  });
}

describe('the status server', () => {
  let status: Server | undefined;
  let base: string;

  async function startStatus({
    stats = () => server.app.stats(),
    live = () => server.app.live(),
  }: { stats?: () => Stats; live?: () => Live } = {}) {
    const log = (event: string, fields?: Record<string, unknown>) =>
      server.logs.push({ event, ...(fields ? { fields } : {}) });
    const started = createServer(createStatusHandler(stats, live, log));
    status = started;
    await new Promise<void>((resolve) => started.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(started.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    // A test that failed before it started the server has none to close.
    const started = status;
    status = undefined;
    if (started) await new Promise((resolve) => started.close(resolve));
  });

  test('serves the numbers as JSON', async () => {
    server = await startServer();
    await startStatus();

    const json = await get(base, '/status.json?fresh=1');
    expect(json.status).toBe(200);
    expect(json.headers['content-type']).toBe('application/json');
    expect(json.headers['cache-control']).toBe('no-store');
    expect(json.headers['x-content-type-options']).toBe('nosniff');
    expect(json.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    const { uptime, memory, ...counts } = JSON.parse(json.body);
    expect(uptime).toBeTypeOf('number');
    expect(memory.rss).toBeTypeOf('number');
    expect(counts).toEqual({
      version: 'test',
      busy: false,
      rooms: { lobby: 0, playing: 0, ended: 0 },
      players: { online: 0, offline: 0 },
      agents: null,
      connections: { websocket: 0, polling: 0 },
      countries: [],
    });

    // HEAD gets the headers alone.
    const head = await get(base, '/status.json', {}, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.headers['content-type']).toBe('application/json');
    expect(head.body).toBe('');
  });

  test('names nobody in the numbers: no codes, room IDs, names, ids, tokens or addresses', async () => {
    server = await startServer({ trustProxy: true });
    // A guest chairs, and an account is in the room with them, which calls it by its username.
    const { chair, code, roomId } = await createRoom(server.url);
    const quentin = await joinRoom(server.url, code, {}, await loggedIn(server.url, 'Quentin'));
    const screen = await TestClient.connect(server.url, {}, { extraHeaders: { 'x-forwarded-for': '203.0.113.9' } });
    clients.push(chair, quentin, screen);
    await chair.waitFor((state) => state.players.length === 2);
    expect(chair.state?.players.map(({ name }) => name)).toEqual(['Guest 1', 'Quentin']);
    expect(await screen.send('room:watch', { code })).toMatchObject({ ok: true });
    await startStatus();

    const { body } = await get(base, '/status.json');
    for (const secret of [
      roomId,
      chair.token,
      quentin.token,
      chair.me,
      quentin.me,
      'Guest 1',
      'Quentin',
      '203.0.113',
    ]) {
      expect(body, `/status.json has ${secret}`).not.toContain(secret);
    }
    expect(body).not.toMatch(new RegExp(`\\b${code}\\b`));
    expect(body).not.toContain('"account"');
    expect(JSON.parse(body).connections).toEqual({ websocket: 3, polling: 0 });
  });

  test('gives who is connected and who is in each room this moment, by account id and never by name', async () => {
    server = await startServer({ trustProxy: true });
    const singapore = { 'cf-ipcountry': 'SG' };
    // A guest chairs. Quentin, who has an account, is in the room in two tabs, from Singapore, and
    // has a third tab open that is in no room. Bob, a guest, came and went. A screen shows the
    // room, from an address that a proxy forwarded, and another guest is connected in no room.
    const { chair, code, roomId } = await createRoom(server.url);
    const browser = await loggedIn(server.url, 'Quentin');
    const tabs: TestClient[] = [];
    for (let i = 0; i < 2; i += 1) {
      const tab = await browser.connect({}, singapore);
      clients.push(tab);
      expect(await tab.send('room:join', { code, play: false })).toMatchObject({ ok: true });
      await tab.waitFor((state) => state.code === code);
      tabs.push(tab);
    }
    const away = await browser.connect({}, singapore);
    const bob = await joinRoom(server.url, code);
    const screen = await TestClient.connect(server.url, {}, { extraHeaders: { 'x-forwarded-for': '203.0.113.9' } });
    const idle = await TestClient.connect(server.url);
    clients.push(chair, away, bob, screen, idle);
    expect(await screen.send('room:watch', { code })).toMatchObject({ ok: true });
    await chair.waitFor((state) => state.players.length === 3);
    const names = chair.state?.players.map(({ name }) => name);
    expect(names).toEqual(['Guest 1', 'Quentin', 'Guest 2']);
    bob.close();
    await until(() => server.app.rooms.find(code)?.onlineCount() === 2, 'Bob to go offline');
    // A minute later, and one of Quentin's tabs has had a heartbeat back in 85 milliseconds.
    server.advance(60_000);
    const conn = server.app.io.sockets.sockets.get(tabs[0]?.socket.id as string)?.conn;
    conn?.emit('flush', [{ type: 'ping' }]);
    server.advance(85);
    conn?.emit('packet', { type: 'pong' });
    await startStatus();
    const logged = server.logs.length;

    const before = Date.now();
    const response = await get(base, '/live.json');
    const after = Date.now();
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    const live = JSON.parse(response.body) as Live;

    const account = server.accounts.byName('Quentin')?.id as number;
    expect(account).toBeTypeOf('number');
    // One for each connection, in no order that matters.
    const sorted = (connections: Live['connections']) =>
      [...connections].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(sorted(live.connections)).toEqual(
      sorted([
        { account: null, room: code, country: 'XX', latency: null },
        { account, room: code, country: 'SG', latency: 85 },
        { account, room: code, country: 'SG', latency: null },
        { account, room: null, country: 'SG', latency: null },
        { account: null, room: code, country: 'XX', latency: null },
        { account: null, room: null, country: 'XX', latency: null },
      ]),
    );
    const offlineSince = live.rooms[0]?.members[2]?.offlineSince as string;
    expect(live.rooms).toEqual([
      {
        code,
        members: [
          { account: null, guest: 1, agent: null, online: true, offlineSince: null, takenOver: false },
          { account, guest: null, agent: null, online: true, offlineSince: null, takenOver: false },
          { account: null, guest: 2, agent: null, online: false, offlineSince, takenOver: false },
        ],
        screens: 1,
      },
    ]);
    // Bob went a minute and 85 milliseconds before, by the server's clock, which is told as the
    // system's time.
    expect(offlineSince).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(Date.parse(offlineSince)).toBeGreaterThanOrEqual(before - 60_085);
    expect(Date.parse(offlineSince)).toBeLessThanOrEqual(after - 60_085);

    // Nothing else of anyone: no username, name, address, token, login, member or room ID.
    for (const secret of [
      'Quentin',
      'quentin',
      'Guest',
      'name',
      '203.0.113',
      '127.0.0.1',
      roomId,
      chair.token,
      bob.token,
      browser.secret,
      chair.me,
      tabs[0]?.me as string,
      tabs[0]?.socket.id as string,
    ]) {
      expect(response.body, `/live.json has ${secret}`).not.toContain(secret);
    }

    // Asking writes nothing to the log.
    expect(server.logs).toHaveLength(logged);

    // Asked again, it is worked out again: when everyone else has gone, the guest in no room is
    // left.
    for (const client of [chair, ...tabs, away, screen]) client.close();
    await until(() => server.app.io.sockets.sockets.size === 1, 'everyone but the idle guest to go');
    expect(JSON.parse((await get(base, '/live.json')).body).connections).toEqual([
      { account: null, room: null, country: 'XX', latency: null },
    ]);
    const head = await get(base, '/live.json', {}, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });

  test('answers only to the names of this machine, on any port, to keep a page elsewhere from reading it', async () => {
    server = await startServer();
    await startStatus();
    const port = new URL(base).port;
    // The port may be another than the one listened on, as through a tunnel, or none.
    for (const host of [
      `localhost:${port}`,
      `127.0.0.1:${port}`,
      `[::1]:${port}`,
      `LocalHost:${port}`,
      `localhost:${Number(port) + 1}`,
      'localhost:8080',
      'localhost',
      '127.0.0.1',
      '[::1]',
    ]) {
      const numbers = await get(base, '/status.json', { host });
      expect(numbers.status, host).toBe(200);
      expect(numbers.body).toContain('"players"');
      const live = await get(base, '/live.json', { host });
      expect(live.status, host).toBe(200);
      expect(live.body).toContain('"connections"');
    }
    // A name that isn't this machine's, with or without the port, or one of them with more on it.
    for (const host of [
      `attacker.example:${port}`,
      'attacker.example',
      `127.0.0.1.attacker.example:${port}`,
      `localhost.attacker.example:${port}`,
      `localhost.:${port}`,
      `localhost:${port}.`,
      `localhost:${port}x`,
      `127.0.0.1:${port}:1`,
      `127.0.0.2:${port}`,
      `::1:${port}`,
    ]) {
      for (const path of ['/status.json', '/live.json', '/']) {
        const response = await get(base, path, { host });
        expect(response.status, `${host} ${path}`).toBe(421);
        expect(response.body, `${host} ${path}`).toBe('');
        expect(response.headers['content-type']).toBeUndefined();
        expect(response.headers['cache-control']).toBe('no-store');
      }
    }
    // No Host at all, which HTTP/1.0 allows.
    for (const path of ['/status.json', '/live.json']) {
      const raw = await new Promise<string>((resolve, reject) => {
        const socket = createConnection(Number(port), '127.0.0.1');
        let data = '';
        socket.on('data', (chunk: Buffer) => (data += chunk.toString()));
        socket.on('end', () => resolve(data));
        socket.on('error', reject);
        socket.end(`GET ${path} HTTP/1.0\r\n\r\n`);
      });
      expect(raw, path).toMatch(/^HTTP\/1\.1 421 /);
      expect(raw, path).not.toContain('"players"');
      expect(raw, path).not.toContain('"connections"');
    }
  });

  test('is read-only, has no pages, and knows no other path', async () => {
    server = await startServer();
    await startStatus();
    for (const path of ['/status.json', '/live.json']) {
      const post = await get(base, path, { 'content-type': 'application/x-www-form-urlencoded' }, 'POST');
      expect(post.status, path).toBe(405);
      expect(post.headers.allow).toBe('GET, HEAD');
    }
    // The pages it had are gone: the feedback and the reports are read with admin.cjs.
    for (const path of [
      '/',
      '/feedback',
      '/feedback?status=trash',
      '/reports',
      '/status',
      '/status.json/',
      '/live.json/',
      '/live',
      '/index.html',
      '/healthz',
      '//',
    ]) {
      const response = await get(base, path);
      expect(response.status, path).toBe(404);
      expect(response.headers['content-type'], path).toBe('text/plain; charset=utf-8');
    }
  });

  test('answers 500 and logs it when counting throws, and the game goes on', async () => {
    server = await startServer();
    const message = 'EMFILE: too many open files, uv_resident_set_memory';
    const broken = () => {
      throw new Error(message);
    };
    await startStatus({ stats: broken, live: broken });
    for (const path of ['/status.json', '/live.json']) {
      const response = await get(base, path);
      expect(response.status, path).toBe(500);
      expect(response.body).toBe('Internal server error\n');
    }
    expect(server.logs.filter(({ event }) => event === 'error')).toEqual([
      { event: 'error', fields: { where: 'status', message } },
      { event: 'error', fields: { where: 'status', message } },
    ]);
    const client = await TestClient.connect(server.url);
    clients.push(client);
    expect(await client.send('sys:ping')).toEqual({ ok: true });
  });

  test("isn't part of the game's own port", async () => {
    server = await startServer();
    await startStatus();
    for (const path of ['/status.json', '/live.json']) {
      const response = await get(server.url, path);
      expect(response.status, path).toBe(404);
      expect(response.body).not.toContain('"players"');
      expect(response.body).not.toContain('"connections"');
    }
  });
});
