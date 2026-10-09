import { afterEach, describe, expect, test } from 'vitest';
import { PasswordHasher } from '../src/accounts/passwords';
import { Browser, fastHasher, startServer, type TestServer } from './helpers';

// The account API over HTTP: registering, logging in and out, renaming, changing the password and
// deleting the account, with every way each of them can be refused, the login cookie, and the
// checks that every request goes through.

let server: TestServer;

afterEach(async () => {
  await server.close();
});

const DAY = 24 * 60 * 60_000;

describe('registering', () => {
  test('creates the account and logs the browser in to it', async () => {
    server = await startServer();
    const browser = new Browser(server.url);
    expect(await browser.account()).toBeNull();
    const reply = await browser.register('  Ann  Lee ');
    expect(reply).toMatchObject({ status: 200, body: { ok: true } });
    expect(reply.cookie).toMatch(/^r2s=[A-Za-z0-9_-]{43}; Max-Age=31536000; Path=\/; HttpOnly; SameSite=Lax$/);
    expect(await browser.request('/api/account')).toMatchObject({
      status: 200,
      body: {
        ok: true,
        account: { username: 'Ann Lee', avatar: null, email: 'none', titles: [] },
        mail: false,
      },
    });
    expect(server.logs.filter(({ event }) => event === 'account_created')).toEqual([
      { event: 'account_created', fields: { id: 1 } },
    ]);
    // Neither the password nor the secret is anywhere in the database.
    const row = server.db.prepare('SELECT * FROM accounts').get() as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain('correct horse');
    const session = server.db.prepare('SELECT hex(token_hash) AS hash FROM sessions').get() as { hash: string };
    expect(session.hash).not.toContain(Buffer.from(browser.secret).toString('hex').toUpperCase());
  });

  test('is refused for a name or a password that will not do', async () => {
    server = await startServer();
    const browser = new Browser(server.url);
    const refusals: [string, string, string][] = [
      ['A', 'correct horse', 'username_short'],
      ['x'.repeat(17), 'correct horse', 'username_invalid'],
      ['\u{430}dmin', 'correct horse', 'username_mixed'],
      ['Reviewer 2', 'correct horse', 'username_reserved'],
      ['Ann', 'short', 'password_short'],
      ['Ann', 'x'.repeat(129), 'password_long'],
    ];
    for (const [username, password, error] of refusals) {
      expect(await browser.request('/api/register', { username, password }), error).toMatchObject({
        status: 400,
        body: { ok: false, error },
      });
    }
    expect(await browser.account()).toBeNull();
  });

  test('is refused for a name that another account has, in any case or width', async () => {
    server = await startServer();
    await new Browser(server.url).register('Ann');
    for (const name of ['ann', 'ANN', '\u{ff21}\u{ff4e}\u{ff4e}']) {
      expect(await new Browser(server.url).register(name), name).toMatchObject({
        status: 409,
        body: { error: 'username_taken' },
      });
    }
  });

  test('gives a name that two ask for at once to one of them', async () => {
    server = await startServer();
    const replies = await Promise.all([1, 2, 3].map(() => new Browser(server.url).register('Ann')));
    expect(replies.map(({ status }) => status).sort()).toEqual([200, 409, 409]);
    expect(server.accounts.store.count()).toBe(1);
  });

  test('from one address is limited to 5 accounts an hour, and 30 refusals', async () => {
    server = await startServer();
    for (let i = 1; i <= 5; i += 1) expect((await new Browser(server.url).register(`Player ${i}`)).status).toBe(200);
    expect(await new Browser(server.url).register('Player 6')).toMatchObject({
      status: 429,
      body: { error: 'register_limited' },
    });
    server.advance(60 * 60_000);
    expect((await new Browser(server.url).register('Player 6')).status).toBe(200);

    for (let i = 0; i < 30; i += 1) await new Browser(server.url).register('Player 1');
    expect(await new Browser(server.url).register('Somebody new')).toMatchObject({
      body: { error: 'register_limited' },
    });
  });

  test('logs a browser out of the account it was logged in to', async () => {
    server = await startServer();
    const browser = new Browser(server.url);
    await browser.register('Ann');
    const ann = browser.cookie;
    await browser.register('Bob');
    expect(await browser.account()).toMatchObject({ username: 'Bob' });
    expect(server.accounts.login(ann.split('=')[1] as string)).toBeNull();
  });
});

describe('logging in', () => {
  test('takes the name in any case or width, and gives the browser a new secret', async () => {
    server = await startServer();
    const first = new Browser(server.url);
    await first.register('Ann Lee');
    const second = new Browser(server.url);
    expect(await second.logIn('\u{ff21}NN   lee')).toMatchObject({ status: 200, body: { ok: true } });
    expect(second.secret).not.toBe(first.secret);
    expect(await second.account()).toMatchObject({ username: 'Ann Lee' });
    // Both browsers are logged in.
    expect(await first.account()).toMatchObject({ username: 'Ann Lee' });
  });

  test('ends the login that the browser had before', async () => {
    server = await startServer();
    const browser = new Browser(server.url);
    await browser.register('Ann');
    const before = browser.secret;
    await browser.logIn('Ann');
    expect(browser.secret).not.toBe(before);
    expect(server.accounts.login(before)).toBeNull();
  });

  test('says the same for a wrong password and for a name that no account has', async () => {
    server = await startServer();
    await new Browser(server.url).register('Ann');
    const browser = new Browser(server.url);
    for (const [name, password] of [
      ['Ann', 'wrong horse'],
      ['Nobody', 'correct horse'],
      ['', 'correct horse'],
    ] as const) {
      expect(await browser.logIn(name, password)).toEqual({
        status: 401,
        body: { ok: false, error: 'login_failed' },
        cookie: undefined,
      });
    }
    expect(await browser.account()).toBeNull();
  });

  test('is refused after 10 wrong passwords for a name in 15 minutes, and 50 in a day', async () => {
    server = await startServer({ accountLimits: { loginFailuresPerMinute: 1000 } });
    await new Browser(server.url).register('Ann');
    const browser = new Browser(server.url);
    for (let i = 0; i < 10; i += 1) expect((await browser.logIn('ann', 'wrong horse')).body.error).toBe('login_failed');
    // Even the right password, in any spelling of the name.
    expect(await browser.logIn('ANN')).toMatchObject({ status: 429, body: { error: 'login_limited' } });
    // A name that no account has is counted the same, so the answer says nothing about it.
    for (let i = 0; i < 10; i += 1) await browser.logIn('Nobody', 'wrong horse');
    expect((await browser.logIn('Nobody')).body.error).toBe('login_limited');

    server.advance(15 * 60_000);
    expect((await browser.logIn('Ann')).status).toBe(200);
    for (let round = 0; round < 4; round += 1) {
      for (let i = 0; i < 10; i += 1) await browser.logIn('Ann', 'wrong horse');
      server.advance(15 * 60_000);
    }
    // 50 in the day so far.
    expect((await browser.logIn('Ann')).body.error).toBe('login_limited');
    server.advance(DAY);
    expect((await browser.logIn('Ann')).status).toBe(200);
  });

  test('from one address is refused after 20 wrong passwords in a minute, whatever the names', async () => {
    server = await startServer();
    await new Browser(server.url).register('Ann');
    const browser = new Browser(server.url);
    for (let i = 0; i < 20; i += 1) await browser.logIn(`Name ${i}`, 'wrong horse');
    expect((await browser.logIn('Ann')).body.error).toBe('login_limited');
    server.advance(60_000);
    expect((await browser.logIn('Ann')).status).toBe(200);
  });

  test('is answered with busy when too many passwords are being checked', async () => {
    server = await startServer({ hasher: new PasswordHasher({ log2N: 14, r: 8, p: 1 }, 1, 0) });
    await new Browser(server.url).register('Ann');
    const replies = await Promise.all([1, 2, 3].map(() => new Browser(server.url).logIn('Ann')));
    expect(replies.map(({ body }) => body.error ?? 'ok')).toContain('busy');
    expect(replies.find(({ body }) => body.error === 'busy')?.status).toBe(503);
  });
});

describe('logging out', () => {
  test('ends the login and clears the cookie', async () => {
    server = await startServer();
    const browser = new Browser(server.url);
    await browser.register('Ann');
    const { secret } = browser;
    const reply = await browser.request('/api/logout', {});
    expect(reply).toMatchObject({ status: 200, body: { ok: true } });
    expect(reply.cookie).toBe('r2s=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
    expect(server.accounts.login(secret)).toBeNull();
    // A browser that still sends the old cookie is a guest, and keeps the cookie: only a login or a
    // logout sets it, so that no answer can take away a cookie that another answer has just set.
    const stale = new Browser(server.url);
    stale.cookie = `r2s=${secret}`;
    const answer = await stale.request('/api/account');
    expect(answer.body.account).toBeNull();
    expect(answer.cookie).toBeUndefined();
    expect((await stale.request('/api/account/records')).status).toBe(401);
  });
});

describe('a login', () => {
  test('ends after 30 days without use', async () => {
    let clock = Date.UTC(2026, 9, 9);
    server = await startServer({ clock: () => clock });
    const browser = new Browser(server.url);
    await browser.register('Ann');
    clock += 29 * DAY;
    expect(await browser.account()).not.toBeNull();
    clock += 29 * DAY;
    expect(await browser.account()).not.toBeNull();
    clock += 30 * DAY + 60_000;
    expect(await browser.account()).toBeNull();
  });
});

describe('renaming', () => {
  test('changes the username, to one that no other account has', async () => {
    server = await startServer();
    await new Browser(server.url).register('Bob');
    const browser = new Browser(server.url);
    await browser.register('Ann');
    expect(await browser.request('/api/account/username', { username: 'Annie' })).toMatchObject({ status: 200 });
    expect(await browser.account()).toMatchObject({ username: 'Annie' });
    expect(await browser.request('/api/account/username', { username: 'BOB' })).toMatchObject({
      status: 409,
      body: { error: 'username_taken' },
    });
    expect((await browser.request('/api/account/username', { username: 'admin' })).body.error).toBe(
      'username_reserved',
    );
    // Only the case changes.
    expect((await browser.request('/api/account/username', { username: 'ANNIE' })).status).toBe(200);
    expect(await browser.account()).toMatchObject({ username: 'ANNIE' });
    // The old name is free for anyone.
    expect((await new Browser(server.url).register('Ann')).status).toBe(200);
  });

  test('needs a login', async () => {
    server = await startServer();
    expect(await new Browser(server.url).request('/api/account/username', { username: 'Ann' })).toMatchObject({
      status: 401,
      body: { error: 'not_logged_in' },
    });
  });
});

describe('changing the password', () => {
  test('asks for the old one, and logs every other browser out', async () => {
    server = await startServer();
    const browser = new Browser(server.url);
    await browser.register('Ann');
    const other = new Browser(server.url);
    await other.logIn('Ann');
    const before = browser.secret;

    const change = (current: string, password: string) =>
      browser.request('/api/account/password', { current, password });
    expect(await change('wrong horse', 'battery staple')).toMatchObject({
      status: 401,
      body: { error: 'password_wrong' },
    });
    expect((await change('correct horse', 'short')).body.error).toBe('password_short');
    expect(await change('correct horse', 'battery staple')).toMatchObject({ status: 200, body: { ok: true } });

    // This browser has a new secret and is still logged in; the other one is out.
    expect(browser.secret).not.toBe(before);
    expect(server.accounts.login(before)).toBeNull();
    expect(await browser.account()).toMatchObject({ username: 'Ann' });
    expect(await other.account()).toBeNull();
    expect((await new Browser(server.url).logIn('Ann', 'correct horse')).body.error).toBe('login_failed');
    expect((await new Browser(server.url).logIn('Ann', 'battery staple')).status).toBe(200);
  });

  test('counts a wrong old password against the account, apart from the logins by its name', async () => {
    server = await startServer({ accountLimits: { loginFailuresPerMinute: 1000 } });
    const browser = new Browser(server.url);
    await browser.register('Ann');
    const change = (current: string) =>
      browser.request('/api/account/password', { current, password: 'battery staple' });
    // Whoever types wrong passwords at the login page doesn't keep the owner from changing theirs.
    for (let i = 0; i < 10; i += 1) await new Browser(server.url).logIn('Ann', 'wrong horse');
    expect((await new Browser(server.url).logIn('Ann')).body.error).toBe('login_limited');
    expect((await change('wrong horse')).body.error).toBe('password_wrong');
    // Ten wrong ones here are as many as at a login, from any address.
    for (let i = 0; i < 9; i += 1) await change('wrong horse');
    expect((await change('correct horse')).body.error).toBe('login_limited');
    server.advance(15 * 60_000);
    expect((await change('correct horse')).status).toBe(200);
  });
});

describe('deleting the account', () => {
  test('asks for the password, logs out everywhere and frees the name', async () => {
    server = await startServer();
    const browser = new Browser(server.url);
    await browser.register('Ann');
    const other = new Browser(server.url);
    await other.logIn('Ann');
    server.accounts.records.add(1, {
      game: 'keywords',
      gameId: 'g',
      side: 'red',
      role: 'captain',
      winner: 'red',
      won: true,
      verdict: 'oral',
    });

    expect((await browser.request('/api/account/delete', { password: 'wrong horse' })).body.error).toBe(
      'password_wrong',
    );
    const reply = await browser.request('/api/account/delete', { password: 'correct horse' });
    expect(reply).toMatchObject({ status: 200, body: { ok: true } });
    expect(reply.cookie).toMatch(/^r2s=; Max-Age=0/);
    expect(await other.account()).toBeNull();
    for (const table of ['accounts', 'sessions', 'game_records']) {
      expect(server.db.prepare(`SELECT count(*) AS count FROM ${table}`).get(), table).toEqual({ count: 0 });
    }
    expect((await new Browser(server.url).logIn('Ann')).body.error).toBe('login_failed');
    expect((await new Browser(server.url).register('Ann')).status).toBe(200);
    expect(server.logs.some(({ event, fields }) => event === 'account_deleted' && fields?.id === 1)).toBe(true);
  });
});

describe('the record of games', () => {
  test("is the account owner's alone", async () => {
    server = await startServer();
    expect(await new Browser(server.url).request('/api/account/records')).toMatchObject({
      status: 401,
      body: { error: 'not_logged_in' },
    });
    const browser = new Browser(server.url);
    await browser.register('Ann');
    expect(await browser.request('/api/account/records')).toMatchObject({
      status: 200,
      body: { ok: true, records: { games: 0, wins: 0, recent: [] } },
    });
  });
});

describe('every request', () => {
  test('that changes something must come from a page of this site', async () => {
    server = await startServer();
    const browser = new Browser(server.url);
    const body = { username: 'Ann', password: 'correct horse' };
    expect(await browser.request('/api/register', body, { origin: 'https://evil.example' })).toMatchObject({
      status: 403,
      body: { error: 'bad_origin' },
    });
    expect(await browser.request('/api/register', body, { origin: '', 'sec-fetch-site': 'cross-site' })).toMatchObject({
      status: 403,
      body: { error: 'bad_origin' },
    });
    expect(server.accounts.store.count()).toBe(0);
    // Without an Origin, as some browsers send none, Sec-Fetch-Site says it.
    expect(await browser.request('/api/register', body, { origin: '', 'sec-fetch-site': 'same-origin' })).toMatchObject(
      { status: 200 },
    );
  });

  test('that changes something must be JSON, of at most 4 KB', async () => {
    server = await startServer();
    const browser = new Browser(server.url);
    const body = { username: 'Ann', password: 'correct horse' };
    expect(await browser.request('/api/register', body, { 'content-type': 'text/plain' })).toMatchObject({
      status: 415,
    });
    expect(await browser.request('/api/register', '{"username": "Ann"')).toMatchObject({
      status: 400,
      body: { error: 'bad_request' },
    });
    expect(await browser.request('/api/register', { username: 'Ann' })).toMatchObject({
      body: { error: 'bad_request' },
    });
    expect(await browser.request('/api/register', { ...body, padding: 'x'.repeat(5000) })).toMatchObject({
      status: 413,
    });
    expect(server.accounts.store.count()).toBe(0);
  });

  test('goes to an address and a method that the API has', async () => {
    server = await startServer();
    const browser = new Browser(server.url);
    expect((await browser.request('/api/nothing')).status).toBe(404);
    const wrong = await fetch(`${server.url}/api/register`);
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('POST');
    expect((await browser.request('/api/account', {})).status).toBe(405);
    expect((await fetch(`${server.url}/api/account`, { method: 'HEAD' })).status).toBe(200);
  });

  test('that changes something counts against its address, 60 a minute', async () => {
    server = await startServer();
    const browser = new Browser(server.url);
    for (let i = 0; i < 60; i += 1) await browser.request('/api/logout', {});
    expect(await browser.request('/api/logout', {})).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    server.advance(60_000);
    expect((await browser.request('/api/logout', {})).status).toBe(200);
  });
});

describe('over HTTPS', () => {
  test('the login cookie is Secure, with the __Host- prefix', async () => {
    server = await startServer({ cookieSecure: true, hasher: fastHasher() });
    const browser = new Browser(server.url);
    const reply = await browser.register('Ann');
    expect(reply.cookie).toMatch(
      /^__Host-r2s=[A-Za-z0-9_-]{43}; Max-Age=31536000; Path=\/; HttpOnly; SameSite=Lax; Secure$/,
    );
    expect(await browser.account()).toMatchObject({ username: 'Ann' });
    // A cookie without the prefix is not read.
    const plain = new Browser(server.url);
    plain.cookie = `r2s=${browser.secret}`;
    expect(await plain.account()).toBeNull();
  });
});
