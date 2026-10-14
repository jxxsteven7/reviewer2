import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { createConnection, type AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { History, type Stats } from '../src/stats';
import { createStatusHandler, FEEDBACK_SHOWN } from '../src/status';
import { DEFAULT_ADMIN_COMMAND } from '../src/statusPage';
import { createRoom, joinRoom, rawPolling, startServer, TestClient, until, type TestServer } from './helpers';

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
    history = new History(),
    stats = () => server.app.stats(),
    adminCommand = DEFAULT_ADMIN_COMMAND,
    feedbackCommand = null,
  }: { history?: History; stats?: () => Stats; adminCommand?: string; feedbackCommand?: string | null } = {}) {
    const log = (event: string, fields?: Record<string, unknown>) =>
      server.logs.push({ event, ...(fields ? { fields } : {}) });
    const started = createServer(
      createStatusHandler(stats, history, server.feedback, log, { admin: adminCommand, feedback: feedbackCommand }),
    );
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

  test('serves the page without a script and the numbers as JSON', async () => {
    server = await startServer();
    const history = new History();
    history.add(server.app.stats());
    await startStatus({ history });

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
      agents: null,
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
    expect(
      await chair.send('meta:feedback', {
        kind: 'bug',
        text: 'From the room',
        version: 'v',
        language: 'en',
        page: 'room',
      }),
    ).toEqual({ ok: true });
    await startStatus();

    for (const path of ['/', '/feedback', '/reports', '/status.json']) {
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

  test('shows the reports a page at a time, with the way to bar an account', async () => {
    server = await startServer();
    const ann = server.accounts.store.create('Ann', 'ann', 'h');
    const bob = server.accounts.store.create('Bob', 'bob', 'h');
    if (!ann || !bob) throw new Error('no account');
    const total = FEEDBACK_SHOWN + 2;
    for (let i = 1; i <= total; i += 1) {
      server.feedback.report({
        reporterId: ann.id,
        reportedId: bob.id,
        reportedName: 'Bob',
        roomCode: 'K7QX',
        text: `Number ${i}`,
      });
    }
    server.accounts.store.setPublicBarred(bob.id, true);
    await startStatus();
    const shown = (body: string) =>
      [...body.matchAll(/<p class="text">Number (\d+)<\/p>/g)].map((match) => Number(match[1]));

    const status = await get(base, '/');
    expect(status.body).toContain(`<p class="note">${total} in all &middot; <a href="/reports">Read them</a></p>`);
    const latest = await get(base, '/reports');
    expect(latest.status).toBe(200);
    expect(latest.headers['cache-control']).toBe('no-store');
    expect(latest.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(latest.body).toContain('<title>Reviewer 2 reports</title>');
    expect(latest.body).toContain('admin.cjs accounts bar &lt;username&gt;');
    expect(latest.body).toContain(
      '<p class="text">Bob (account Bob &middot; <strong>barred from public rooms</strong>)</p>',
    );
    expect(latest.body).toContain('<p class="meta">Reported by Ann</p>');
    expect(shown(latest.body)).toEqual(Array.from({ length: FEEDBACK_SHOWN }, (_, i) => total - i));
    expect(latest.body).toContain('<p class="more"><a href="/reports?before=3">Older</a></p>');
    expect(shown((await get(base, '/reports?before=3')).body)).toEqual([2, 1]);
  });

  test('shows the feedback a page at a time, back from the latest', async () => {
    server = await startServer();
    const total = FEEDBACK_SHOWN + 5;
    for (let i = 1; i <= total; i += 1) {
      server.feedback.add({
        kind: 'idea',
        text: `Number ${i}`,
        contact: null,
        credit: null,
        accountId: null,
        linkProfile: false,
        version: 'test',
        language: 'en',
        page: 'home',
        userAgent: null,
      });
    }
    await startStatus();
    const shown = (body: string) =>
      [...body.matchAll(/<p class="text">Number (\d+)<\/p>/g)].map((match) => Number(match[1]));

    // The status page has the counts and the link, and none of the feedback.
    const status = await get(base, '/');
    expect(status.body).toContain(`<p class="note">${total} in all &middot; <a href="/feedback">Read it</a></p>`);
    expect(status.body).toContain(`<a class="badge" href="/feedback">Open <b>${total}</b></a>`);
    expect(status.body).toContain(`<a class="badge new" href="/feedback?status=new">New <b>${total}</b></a>`);
    expect(shown(status.body)).toEqual([]);

    const latest = await get(base, '/feedback');
    expect(latest.status).toBe(200);
    expect(latest.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(latest.headers['cache-control']).toBe('no-store');
    expect(latest.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(latest.body).toContain(`${total} in all, newest first`);
    expect(latest.body).not.toContain('http-equiv="refresh"');
    // Each piece has its commands to copy, with the default in front.
    expect(latest.body).toContain(
      `<details><summary>Commands</summary><p class="command"><code>node server/dist/admin.cjs feedback draft ${total}</code></p>`,
    );
    expect(shown(latest.body)).toEqual(Array.from({ length: FEEDBACK_SHOWN }, (_, i) => total - i));
    expect(latest.body).toContain('<p class="more"><a href="/feedback?before=6">Older</a></p>');

    const older = (await get(base, '/feedback?before=6')).body;
    expect(shown(older)).toEqual([5, 4, 3, 2, 1]);
    expect(older).toContain('<p class="more"><a href="/feedback">Latest</a></p>');

    // A query that isn't a number is taken for none.
    for (const query of ['?before=abc', '?before=-1', '?before=1e3', '?other=1']) {
      expect(shown((await get(base, `/feedback${query}`)).body), query).toEqual(shown(latest.body));
    }
  });

  test('puts how admin.cjs is run, as ADMIN_COMMAND says, in front of the commands it shows', async () => {
    server = await startServer();
    server.feedback.add({
      kind: 'idea',
      text: 'Number 1',
      contact: null,
      credit: null,
      accountId: null,
      linkProfile: false,
      version: 'test',
      language: 'en',
      page: 'home',
      userAgent: null,
    });
    await startStatus({ adminCommand: 'npm run admin --' });
    const page = await get(base, '/feedback');
    expect(page.body).toContain('<p class="command"><code>npm run admin -- feedback resolve 1 &#60;pr&#62;</code></p>');
    expect(page.body).not.toContain('node server/dist/admin.cjs');
  });

  test('puts the command that FEEDBACK_COMMAND names in front of the commands, with publish first', async () => {
    server = await startServer();
    const add = () =>
      server.feedback.add({
        kind: 'idea',
        text: 'Number 1',
        contact: null,
        credit: null,
        accountId: null,
        linkProfile: false,
        version: 'test',
        language: 'en',
        page: 'home',
        userAgent: null,
      });
    add();
    add();
    // Published already, it has no publish, and the command adopts it as it records the PR.
    server.feedback.setIssue(2, 42);
    await startStatus({ feedbackCommand: 'triage-feedback' });
    const page = await get(base, '/feedback');
    const first = (id: number) =>
      page.body.split(`<article><p class="head"><span>#${id}`)[1]?.match(/<code>([^<]*)<\/code>/)?.[1];
    expect(first(1)).toBe('triage-feedback publish 1');
    expect(page.body).toContain('<code>triage-feedback draft 1</code>');
    expect(first(2)).toBe('triage-feedback issue 2 --clear');
    expect(page.body).toContain(
      "<code>triage-feedback resolve 2 &#60;pr&#62;</code> records the pull request and adopts it, which can't be undone",
    );
    expect(page.body).not.toContain('triage-feedback adopt');
    expect(page.body).not.toContain('triage-feedback publish 2');
    expect(page.body).not.toContain('admin.cjs feedback resolve');
  });

  test('shows the feedback of one kind, a page at a time', async () => {
    server = await startServer();
    const kinds = ['game', 'idea', 'game', 'bug', 'game'] as const;
    for (const [i, kind] of kinds.entries()) {
      server.feedback.add({
        kind,
        text: `Number ${i + 1}`,
        contact: null,
        credit: null,
        accountId: null,
        linkProfile: false,
        version: 'test',
        language: 'en',
        page: 'home',
        userAgent: null,
      });
    }
    await startStatus();
    const shown = (body: string) =>
      [...body.matchAll(/<p class="text">Number (\d+)<\/p>/g)].map((match) => Number(match[1]));

    const games = (await get(base, '/feedback?kind=game')).body;
    expect(shown(games)).toEqual([5, 3, 1]);
    expect(games).toContain('5 in all, newest first');
    expect(games).toContain('<strong>New game <b>3</b></strong>');
    expect(games).toContain('<a href="/feedback?kind=idea">Idea <b>1</b></a>');
    expect(games).toContain('<a href="/feedback?kind=words">Word lists <b>0</b></a>');
    expect(shown((await get(base, '/feedback?kind=game&before=5')).body)).toEqual([3, 1]);
    expect(shown((await get(base, '/feedback?kind=words')).body)).toEqual([]);
    // A kind that the server doesn't know is taken for none.
    for (const query of ['?kind=other', '?kind=', '?kind=GAME']) {
      expect(shown((await get(base, `/feedback${query}`)).body), query).toEqual([5, 4, 3, 2, 1]);
    }
  });

  test('shows the open feedback unless asked for a status, with the trail of each and the trash with its days left', async () => {
    server = await startServer();
    for (let i = 1; i <= 7; i += 1) {
      server.feedback.add({
        kind: i % 2 === 0 ? 'bug' : 'idea',
        text: `Number ${i}`,
        contact: null,
        credit: i === 4 || i === 7 ? 'Ann' : null,
        accountId: null,
        linkProfile: false,
        version: 'test',
        language: 'en',
        page: 'home',
        userAgent: null,
      });
    }
    server.feedback.setIssue(2, 42);
    server.feedback.resolve(3, 50);
    server.feedback.setIssue(4, 43);
    server.feedback.adopt(4, { zh: '提出了计时器', en: 'Suggested a timer' });
    server.feedback.close(5);
    server.feedback.delete(6);
    // Adopted with a pull request recorded, which is resolved all the same.
    server.feedback.resolve(7, 51);
    server.feedback.setIssue(7, 44);
    server.feedback.adopt(7, { zh: '\u63d0\u51fa\u4e86\u6682\u505c', en: 'Suggested a pause' });
    await startStatus();
    const shown = (body: string) =>
      [...body.matchAll(/<p class="text">Number (\d+)<\/p>/g)].map((match) => Number(match[1]));

    // Open is what still waits: new, or an issue, which feedback with a pull request recorded but
    // not adopted is too.
    const open = (await get(base, '/feedback')).body;
    expect(shown(open)).toEqual([3, 2, 1]);
    expect(open).toContain('<strong>Open <b>3</b></strong>');
    expect(open).toContain('<a href="/feedback?status=issue">Issue <b>2</b></a>');
    expect(open).toContain('<a href="/feedback?status=resolved">Resolved <b>2</b></a>');
    expect(open).not.toContain('Thanked');
    expect(open).toContain('<a href="/feedback?status=closed">Closed <b>1</b></a>');
    expect(open).toContain('<a href="/feedback?status=trash">Trash <b>1</b></a>');
    expect(open).toContain('<strong>All <b>3</b></strong><a href="/feedback?kind=idea">Idea <b>2</b></a>');
    expect(open).toContain('<span class="badge issue">Issue #42</span>');
    expect(open).toContain('<span class="badge issue">PR #50</span>');
    expect(open).toContain('<p class="trail">resolved by PR #50</p>');
    for (const [query, ids] of [
      ['?status=new', [1]],
      ['?status=issue', [3, 2]],
      ['?status=resolved', [7, 4]],
      ['?status=closed', [5]],
      ['?status=trash', [6]],
      ['?status=trash&kind=idea', []],
      ['?status=open&kind=bug', [2]],
      ['?status=open&before=2', [1]],
      ['?status=resolved&kind=idea', [7]],
      // A status that isn't one is taken for none, as is the one that resolved feedback had once.
      ['?status=all', [3, 2, 1]],
      ['?status=', [3, 2, 1]],
      ['?status=Trash', [3, 2, 1]],
      ['?status=thanked', [3, 2, 1]],
    ] as const) {
      expect(shown((await get(base, `/feedback${query}`)).body), query).toEqual([...ids]);
    }
    // The badges write out what the feedback came to.
    const resolved = (await get(base, '/feedback?status=resolved')).body;
    expect(resolved).toContain('<span class="badge resolved">Resolved &middot; PR #51 &middot; issue #44</span>');
    expect(resolved).toContain('<span class="badge resolved">Resolved &middot; issue #43</span>');
    expect(resolved).toMatch(/<p class="trail">published as issue #43 &middot; adopted \d{4}-\d\d-\d\d<\/p>/);
    expect(resolved).toContain('Contributed: 提出了计时器 &middot; Suggested a timer');
    const trash = (await get(base, '/feedback?status=trash')).body;
    expect(trash).toContain('<span class="badge trash">Trash</span>');
    expect(trash).toMatch(/<p class="trail">in the trash since \d{4}-\d{2}-\d{2}, 30 days left<\/p>/);
    expect(trash).toContain('<a href="/feedback?status=closed">Closed <b>1</b></a>');
    expect(trash).toContain('<strong>All <b>1</b></strong>');
    const status = (await get(base, '/')).body;
    expect(status).toContain('<a class="badge" href="/feedback">Open <b>3</b></a>');
    expect(status).toContain('<a class="badge resolved" href="/feedback?status=resolved">Resolved <b>2</b></a>');
    expect(status).not.toContain('Thanked');
    expect(status).toContain('<p class="note">7 in all &middot; <a href="/feedback">Read it</a></p>');
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
      const response = await get(base, '/status.json', { host });
      expect(response.status, host).toBe(200);
      expect(response.body).toContain('"players"');
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
      for (const path of ['/', '/feedback', '/reports', '/status.json']) {
        const response = await get(base, path, { host });
        expect(response.status, `${host} ${path}`).toBe(421);
        expect(response.body, `${host} ${path}`).toBe('');
        expect(response.headers['content-type']).toBeUndefined();
        expect(response.headers['cache-control']).toBe('no-store');
      }
    }
    // No Host at all, which HTTP/1.0 allows.
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(Number(port), '127.0.0.1');
      let data = '';
      socket.on('data', (chunk: Buffer) => (data += chunk.toString()));
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
      socket.end('GET /status.json HTTP/1.0\r\n\r\n');
    });
    expect(raw).toMatch(/^HTTP\/1\.1 421 /);
    expect(raw).not.toContain('"players"');
  });

  test('is read-only, and knows no other path', async () => {
    server = await startServer();
    await startStatus();
    for (const path of ['/status.json', '/feedback', '/feedback?status=trash', '/reports', '/']) {
      const post = await get(base, path, { 'content-type': 'application/x-www-form-urlencoded' }, 'POST');
      expect(post.status, path).toBe(405);
      expect(post.headers.allow).toBe('GET, HEAD');
    }
    for (const path of ['/status', '/status.json/', '/feedback/', '/index.html', '/healthz', '//']) {
      expect((await get(base, path)).status, path).toBe(404);
    }
    for (const path of ['/', '/feedback', '/reports']) {
      expect((await get(base, path)).body, path).not.toMatch(/<form|<input|<button|<script/);
    }
  });

  test('answers 500 and logs it when counting throws, and the game goes on', async () => {
    server = await startServer();
    const message = 'EMFILE: too many open files, uv_resident_set_memory';
    await startStatus({
      stats: () => {
        throw new Error(message);
      },
    });
    for (const path of ['/', '/status.json']) {
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
    const response = await get(server.url, '/status.json');
    expect(response.status).toBe(404);
    expect(response.body).not.toContain('"players"');
  });
});
