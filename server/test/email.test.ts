import { afterEach, describe, expect, test } from 'vitest';
import { fingerprintKey } from '../src/accounts/email';
import { Accounts } from '../src/accounts/service';
import { Browser, FakeMail, startServer, until, type TestServer } from './helpers';

// Email for accounts: binding an address with a link that confirms it, unbinding it, and resetting
// a forgotten password with a link, with what each of them tells nobody, and their limits.

let server: TestServer;
let mail: FakeMail;

afterEach(async () => {
  await server.close();
});

async function start(options: Parameters<typeof startServer>[0] = {}) {
  mail = new FakeMail();
  server = await startServer({ mail, ...options });
}

async function account(name: string) {
  const browser = new Browser(server.url);
  await browser.register(name);
  return browser;
}

const bind = (browser: Browser, email: string, password = 'correct horse', language = 'en') =>
  browser.request('/api/account/email', { email, password, language });
const confirm = (token: string) => new Browser(server.url).request('/api/email/confirm', { token });
const forgot = (browser: Browser, email: string, language = 'en') =>
  browser.request('/api/password/forgot', { email, language });

async function bound(name: string, email: string) {
  const browser = await account(name);
  await bind(browser, email);
  await confirm(mail.last('bind'));
  return browser;
}

describe('without a mailer or a server secret', () => {
  test('accounts have no email', async () => {
    server = await startServer();
    const browser = await account('Ann');
    expect((await browser.request('/api/account')).body.mail).toBe(false);
    expect((await bind(browser, 'ann@example.com')).body.error).toBe('mail_unavailable');
    expect(await forgot(browser, 'ann@example.com')).toMatchObject({
      status: 503,
      body: { error: 'mail_unavailable' },
    });
  });
});

describe('binding an address', () => {
  test('mails a link that binds it once it is opened, and the address is never kept', async () => {
    await start();
    const browser = await account('Ann');
    expect((await browser.request('/api/account')).body.mail).toBe(true);
    expect(await bind(browser, '  Ann@Example.COM ', 'correct horse', 'zh')).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(mail.sent).toEqual([
      { v: 1, kind: 'bind', to: 'ann@example.com', token: expect.stringMatching(/^[\w-]{43}$/), language: 'zh' },
    ]);
    expect(await browser.account()).toMatchObject({ email: 'pending' });

    expect(await confirm(mail.last('bind'))).toMatchObject({ status: 200, body: { ok: true } });
    expect(await browser.account()).toMatchObject({ email: 'bound' });
    // The link works once.
    expect(await confirm(mail.last('bind'))).toMatchObject({ status: 400, body: { error: 'link_invalid' } });
    // Nothing in the database holds the address.
    const dump = JSON.stringify(server.db.prepare('SELECT * FROM accounts').all());
    expect(dump).not.toContain('example');
    expect(server.logs.filter(({ event }) => event === 'mail_requested')).toEqual([
      { event: 'mail_requested', fields: { kind: 'bind' } },
    ]);
  });

  test('asks for the password, and an address that can be mailed to', async () => {
    await start();
    const browser = await account('Ann');
    expect(await bind(browser, 'ann@example.com', 'wrong horse')).toMatchObject({
      status: 401,
      body: { error: 'password_wrong' },
    });
    expect((await bind(browser, 'Ann <ann@example.com>')).body.error).toBe('email_invalid');
    expect(
      (await new Browser(server.url).request('/api/account/email', { email: 'a@b.cn', password: 'x', language: 'en' }))
        .status,
    ).toBe(401);
    expect(mail.sent).toEqual([]);
  });

  test('answers the same for an address that another account has, and sends no mail', async () => {
    await start();
    await bound('Ann', 'ann@example.com');
    const sent = mail.sent.length;
    const bob = await account('Bob');
    expect(await bind(bob, 'ANN@example.com')).toMatchObject({ status: 200, body: { ok: true } });
    expect(await bob.account()).toMatchObject({ email: 'pending' });
    expect(mail.sent).toHaveLength(sent);
  });

  test('again, with the address the account has, mails it again', async () => {
    await start();
    const ann = await bound('Ann', 'ann@example.com');
    const before = mail.sent.length;
    expect((await bind(ann, 'Ann@Example.com')).status).toBe(200);
    expect(mail.sent).toHaveLength(before + 1);
    expect(mail.sent.at(-1)).toMatchObject({ kind: 'bind', to: 'ann@example.com' });
    expect((await confirm(mail.last('bind'))).status).toBe(200);
    expect(await ann.account()).toMatchObject({ email: 'bound' });
  });

  test('that another account bound in the meantime can not be confirmed', async () => {
    await start();
    const ann = await account('Ann');
    const bob = await account('Bob');
    await bind(ann, 'shared@example.com');
    const annLink = mail.last('bind');
    await bind(bob, 'shared@example.com');
    expect((await confirm(mail.last('bind'))).status).toBe(200);
    expect(await confirm(annLink)).toMatchObject({ body: { error: 'link_invalid' } });
    expect(await ann.account()).toMatchObject({ email: 'none' });
  });

  test('again replaces the address, and only the latest link works', async () => {
    await start();
    const browser = await bound('Ann', 'old@example.com');
    await bind(browser, 'first@example.com');
    const first = mail.last('bind');
    await bind(browser, 'new@example.com');
    expect((await confirm(first)).body.error).toBe('link_invalid');
    expect((await confirm(mail.last('bind'))).status).toBe(200);
    // The old address no longer resets the password; the new one does.
    await forgot(browser, 'old@example.com');
    await forgot(browser, 'new@example.com');
    await until(() => mail.sent.some(({ kind }) => kind === 'reset'), 'the reset mail');
    expect(mail.sent.filter(({ kind }) => kind === 'reset').map(({ to }) => to)).toEqual(['new@example.com']);
  });

  test('is limited to 3 a day for an account, and 10 mails an hour for an address', async () => {
    await start({ accountLimits: { registrationsPerHour: 100 } });
    const browser = await account('Ann');
    for (let i = 0; i < 3; i += 1) expect((await bind(browser, `ann${i}@example.com`)).status).toBe(200);
    expect(await bind(browser, 'ann3@example.com')).toMatchObject({ status: 429, body: { error: 'email_limited' } });
    for (let i = 0; i < 3; i += 1) await bind(await account(`Bob ${i}`), `bob${i}@example.com`);
    for (let i = 0; i < 4; i += 1) await forgot(browser, `nobody${i}@example.com`);
    expect((await bind(await account('Cat'), 'cat@example.com')).body.error).toBe('email_limited');
  });
});

describe('unbinding the address', () => {
  test('asks for the password', async () => {
    await start();
    const browser = await bound('Ann', 'ann@example.com');
    expect((await browser.request('/api/account/email/remove', { password: 'wrong horse' })).body.error).toBe(
      'password_wrong',
    );
    expect((await browser.request('/api/account/email/remove', { password: 'correct horse' })).status).toBe(200);
    expect(await browser.account()).toMatchObject({ email: 'none' });
    await forgot(browser, 'ann@example.com');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mail.sent.some(({ kind }) => kind === 'reset')).toBe(false);
  });
});

describe('a forgotten password', () => {
  test('gets the same answer whether or not an account has the address', async () => {
    await start();
    await bound('Ann', 'ann@example.com');
    const stranger = new Browser(server.url);
    const known = await forgot(stranger, 'ANN@example.com', 'zh');
    const unknown = await forgot(stranger, 'nobody@example.com');
    expect(known).toEqual(unknown);
    expect(known).toMatchObject({ status: 200, body: { ok: true } });
    await until(() => mail.sent.some(({ kind }) => kind === 'reset'), 'the reset mail');
    expect(mail.sent.filter(({ kind }) => kind === 'reset')).toEqual([
      { v: 1, kind: 'reset', to: 'ann@example.com', token: expect.stringMatching(/^[\w-]{43}$/), language: 'zh' },
    ]);
  });

  test('is limited to 3 links an hour for an address, whether or not an account has it', async () => {
    await start();
    await bound('Ann', 'ann@example.com');
    const stranger = new Browser(server.url);
    for (const email of ['ann@example.com', 'nobody@example.com']) {
      for (let i = 0; i < 3; i += 1) expect((await forgot(stranger, email)).status).toBe(200);
      expect(await forgot(stranger, email)).toMatchObject({ status: 429, body: { error: 'email_limited' } });
    }
    server.advance(60 * 60_000);
    expect((await forgot(stranger, 'ann@example.com')).status).toBe(200);
  });

  test('is reset with the link, which logs the account out everywhere and this browser in', async () => {
    await start();
    const ann = await bound('Ann', 'ann@example.com');
    const socket = await ann.connect();
    const stranger = new Browser(server.url);
    // Someone has been trying passwords.
    for (let i = 0; i < 10; i += 1) await stranger.logIn('Ann', 'wrong horse');
    await forgot(stranger, 'ann@example.com');
    await until(() => mail.sent.some(({ kind }) => kind === 'reset'), 'the reset mail');
    const link = mail.last('reset');

    expect((await stranger.request('/api/password/reset', { token: link, password: 'short' })).body.error).toBe(
      'password_short',
    );
    const reply = await stranger.request('/api/password/reset', { token: link, password: 'battery staple' });
    expect(reply).toMatchObject({ status: 200, body: { ok: true } });
    expect(await stranger.account()).toMatchObject({ username: 'Ann' });
    expect(await ann.account()).toBeNull();
    await until(() => socket.loginsEnded === 1, 'the old login to end');
    socket.close();
    // The link works once, and the new password works, the old one not; the attempts before are
    // forgiven.
    expect(
      (await new Browser(server.url).request('/api/password/reset', { token: link, password: 'x'.repeat(8) })).body
        .error,
    ).toBe('link_invalid');
    expect((await new Browser(server.url).logIn('Ann', 'battery staple')).status).toBe(200);
    expect((await new Browser(server.url).logIn('Ann', 'correct horse')).body.error).toBe('login_failed');
    expect(server.logs.some(({ event }) => event === 'password_reset')).toBe(true);
  });

  test('with a link that has expired, or any of the older links, is refused', async () => {
    let clock = Date.UTC(2026, 9, 9);
    await start({ clock: () => clock });
    await bound('Ann', 'ann@example.com');
    const stranger = new Browser(server.url);
    for (let i = 0; i < 2; i += 1) {
      await forgot(stranger, 'ann@example.com');
      await until(() => mail.sent.filter(({ kind }) => kind === 'reset').length === i + 1, 'a reset mail');
    }
    const [older, newer] = mail.sent.filter(({ kind }) => kind === 'reset').map(({ token }) => token) as [
      string,
      string,
    ];
    clock += 30 * 60_000;
    expect(
      (await stranger.request('/api/password/reset', { token: newer, password: 'battery staple' })).body.error,
    ).toBe('link_invalid');
    clock -= 60_000;
    expect((await stranger.request('/api/password/reset', { token: newer, password: 'battery staple' })).status).toBe(
      200,
    );
    expect(
      (await stranger.request('/api/password/reset', { token: older, password: 'battery staple' })).body.error,
    ).toBe('link_invalid');
    for (const token of ['', 'x'.repeat(43), 'nonsense']) {
      expect((await stranger.request('/api/password/reset', { token, password: 'battery staple' })).body.error).toBe(
        'link_invalid',
      );
    }
  });

  test('is reset once when the link is used twice at the same moment', async () => {
    await start();
    await bound('Ann', 'ann@example.com');
    await forgot(new Browser(server.url), 'ann@example.com');
    await until(() => mail.sent.some(({ kind }) => kind === 'reset'), 'the reset mail');
    const link = mail.last('reset');
    const replies = await Promise.all(
      ['first password', 'second password'].map((password) =>
        new Browser(server.url).request('/api/password/reset', { token: link, password }),
      ),
    );
    expect(replies.map(({ status }) => status).sort()).toEqual([200, 400]);
  });
});

describe('the links that are still out', () => {
  test('are no use once the password has been changed or reset, or the address unbound', async () => {
    await start();
    const ann = await bound('Ann', 'ann@example.com');
    const stranger = new Browser(server.url);
    // Asks for a link to reset the password, and waits for the mail with it.
    const reset = async () => {
      const before = mail.sent.length;
      await forgot(stranger, 'ann@example.com');
      await until(() => mail.sent.length > before, 'the reset mail');
      return mail.last('reset');
    };
    const use = (token: string) => stranger.request('/api/password/reset', { token, password: 'battery staple' });

    // Someone who had the password asked for a link to bind their own address, and one to reset.
    await bind(ann, 'thief@example.com');
    const theirs = mail.last('bind');
    const resetLink = await reset();
    await ann.request('/api/account/password', { current: 'correct horse', password: 'new password' });
    expect((await confirm(theirs)).body.error).toBe('link_invalid');
    expect((await use(resetLink)).body.error).toBe('link_invalid');
    expect(await ann.account()).toMatchObject({ email: 'bound' });

    // A reset uses up a link to bind an address too.
    await bind(ann, 'thief@example.com', 'new password');
    const again = mail.last('bind');
    expect((await use(await reset())).status).toBe(200);
    expect((await confirm(again)).body.error).toBe('link_invalid');

    // And unbinding the address uses up the links to reset the password that went to it.
    const owner = new Browser(server.url);
    await owner.logIn('Ann', 'battery staple');
    const lastReset = await reset();
    await owner.request('/api/account/email/remove', { password: 'battery staple' });
    expect((await use(lastReset)).body.error).toBe('link_invalid');
  });
});

describe('the links that reset the password', () => {
  test('are no use once another address has been bound', async () => {
    await start();
    const ann = await bound('Ann', 'old@example.com');
    const stranger = new Browser(server.url);
    await forgot(stranger, 'old@example.com');
    await until(() => mail.sent.some(({ kind }) => kind === 'reset'), 'the reset mail');
    const link = mail.last('reset');
    await bind(ann, 'new@example.com');
    expect((await confirm(mail.last('bind'))).status).toBe(200);
    const used = await stranger.request('/api/password/reset', { token: link, password: 'battery staple' });
    expect(used.body.error).toBe('link_invalid');
  });
});

describe('a server secret other than the one before', () => {
  test('unbinds every address, and uses up the links that were to bind one', async () => {
    await start();
    const ann = await bound('Ann', 'ann@example.com');
    const bob = await account('Bob');
    await bind(bob, 'bob@example.com');
    const link = mail.last('bind');
    // The server starts again with another secret.
    const restarted = new Accounts({
      db: server.db,
      now: () => 0,
      mail,
      fingerprintKey: fingerprintKey('another-secret-'.repeat(3)),
    });
    expect(restarted.adoptFingerprintKey()).toBe(1);
    expect(await ann.account()).toMatchObject({ email: 'none' });
    expect(await bob.account()).toMatchObject({ email: 'none' });
    expect((await confirm(link)).body.error).toBe('link_invalid');
    // The same secret again changes nothing, and a server without one touches nothing.
    expect(restarted.adoptFingerprintKey()).toBe(0);
    expect(new Accounts({ db: server.db, now: () => 0 }).adoptFingerprintKey()).toBeNull();
  });
});

describe('an account that is deleted', () => {
  test('frees its address', async () => {
    await start();
    const ann = await bound('Ann', 'ann@example.com');
    await ann.request('/api/account/delete', { password: 'correct horse' });
    expect(server.db.prepare('SELECT count(*) AS count FROM email_tokens').get()).toEqual({ count: 0 });
    const bob = await account('Bob');
    await bind(bob, 'ann@example.com');
    expect((await confirm(mail.last('bind'))).status).toBe(200);
  });
});
