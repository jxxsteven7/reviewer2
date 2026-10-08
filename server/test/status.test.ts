import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { History } from '../src/stats';
import { createStatusHandler } from '../src/status';
import { createRoom, joinRoom, startServer, TestClient, until, type TestServer } from './helpers';

// The numbers that the `stats` line and the status page show, counted on a real server, and the
// status page's own HTTP server.

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

    const { chair, code } = await createRoom(server.url, 'Ann');
    const bob = await joinRoom(server.url, code, 'Bob');
    const other = await createRoom(server.url, 'Cy');
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
    // Engine.IO pings every 10 seconds, so the heartbeats are played here by hand: a ping goes
    // out, the clock moves on, and the pong comes back.
    const beat = (index: number, ms: number) => {
      const conn = sockets[index]?.conn;
      conn?.emit('packetCreate', { type: 'ping' });
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
  let status: Server;
  let base: string;

  async function startStatus(history = new History()) {
    status = createServer(createStatusHandler(server.app.stats, history));
    await new Promise<void>((resolve) => status.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(status.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    await new Promise((resolve) => status.close(resolve));
  });

  test('serves the page without a script and the numbers as JSON', async () => {
    server = await startServer();
    const history = new History();
    history.add(server.app.stats());
    await startStatus(history);

    const page = await get(base, '/');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['content-security-policy']).toMatch(/^default-src 'none'; style-src 'unsafe-inline';/);
    expect(page.body).toContain('<title>Reviewer 2 status</title>');
    expect(page.body).toContain('<polyline class="players"');

    const json = await get(base, '/status.json?fresh=1');
    expect(json.status).toBe(200);
    expect(json.headers['content-type']).toBe('application/json');
    const { uptime, memory, ...counts } = JSON.parse(json.body);
    expect(uptime).toBeTypeOf('number');
    expect(memory.rss).toBeTypeOf('number');
    expect(counts).toEqual({
      version: 'test',
      rooms: { lobby: 0, playing: 0, ended: 0 },
      players: { online: 0, offline: 0 },
      connections: { websocket: 0, polling: 0 },
      countries: [],
    });

    // HEAD gets the headers alone.
    const head = await get(base, '/', {}, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });

  test('shows nobody: no codes, room IDs, names, tokens or addresses', async () => {
    server = await startServer({ trustProxy: true });
    const { chair, code, roomId } = await createRoom(server.url, 'Zelda');
    const quentin = await joinRoom(server.url, code, 'Quentin');
    const screen = await TestClient.connect(server.url, {}, { extraHeaders: { 'x-forwarded-for': '203.0.113.9' } });
    clients.push(chair, quentin, screen);
    expect(await screen.send('room:watch', { code })).toMatchObject({ ok: true });
    await startStatus();

    for (const path of ['/', '/status.json']) {
      const { body } = await get(base, path);
      for (const secret of [
        roomId,
        chair.token,
        quentin.token,
        chair.me,
        quentin.me,
        'Zelda',
        'Quentin',
        '203.0.113',
      ]) {
        expect(body, `${path} has ${secret}`).not.toContain(secret);
      }
      expect(body, path).not.toMatch(new RegExp(`\\b${code}\\b`));
    }
    expect(JSON.parse((await get(base, '/status.json')).body).connections).toEqual({ websocket: 3, polling: 0 });
  });

  test('answers only to the names of this machine, to keep a page elsewhere from reading it', async () => {
    server = await startServer();
    await startStatus();
    const port = new URL(base).port;
    expect((await get(base, '/', { host: `localhost:${port}` })).status).toBe(200);
    expect((await get(base, '/status.json', { host: 'localhost' })).status).toBe(200);
    for (const host of [`attacker.example:${port}`, 'attacker.example', `127.0.0.1.attacker.example:${port}`]) {
      const response = await get(base, '/status.json', { host });
      expect(response.status, host).toBe(404);
      expect(response.body).toBe('Not found\n');
    }
  });

  test('is read-only, and knows no other path', async () => {
    server = await startServer();
    await startStatus();
    const post = await get(base, '/status.json', {}, 'POST');
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe('GET, HEAD');
    for (const path of ['/status', '/status.json/', '/index.html', '/healthz', '//']) {
      expect((await get(base, path)).status, path).toBe(404);
    }
  });

  test("isn't part of the game's own port", async () => {
    server = await startServer();
    await startStatus();
    const response = await get(server.url, '/status.json');
    expect(response.status).toBe(404);
    expect(response.body).not.toContain('"players"');
  });
});
