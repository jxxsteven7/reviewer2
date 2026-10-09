import { afterEach, describe, expect, test } from 'vitest';
import { PasswordHasher } from '../src/accounts/passwords';
import { Browser, FakeMail, fastHasher, startServer, until, type TestServer } from './helpers';

// The account API awaits one thing, the password's hash, and what was true before it may not be
// after it (docs/architecture.md): the account may have changed under a request that waited for
// the hasher, and requests that arrive together all wait before any is answered.

let server: TestServer;

afterEach(async () => {
  await server.close();
});

// A hasher that holds the work it is told to, until it is released.
class HeldHasher extends PasswordHasher {
  hold: 'verify' | 'hash' | null = null;
  readonly #held: (() => void)[] = [];

  constructor() {
    super({ log2N: 10, r: 8, p: 1 }, 8, 64);
  }

  get holding(): number {
    return this.#held.length;
  }

  override verify(password: string, stored: string | null) {
    return this.#wait('verify').then(() => super.verify(password, stored));
  }

  override hash(password: string) {
    return this.#wait('hash').then(() => super.hash(password));
  }

  release(): void {
    for (const go of this.#held.splice(0)) go();
  }

  #wait(what: 'verify' | 'hash'): Promise<void> {
    return this.hold === what ? new Promise((resolve) => this.#held.push(resolve)) : Promise.resolve();
  }
}

const bind = (browser: Browser, email: string, password = 'correct horse') =>
  browser.request('/api/account/email', { email, password, language: 'en' });

describe('a request that waited for its password check', () => {
  test('does nothing once the password has been changed meanwhile', async () => {
    const hasher = new HeldHasher();
    const mail = new FakeMail();
    server = await startServer({ hasher, mail });
    const owner = new Browser(server.url);
    await owner.register('Ann');
    await bind(owner, 'ann@example.com');
    await new Browser(server.url).request('/api/email/confirm', { token: mail.last('bind') });
    // Someone who knows the password is logged in too, and asks to bind their own address, to
    // unbind the owner's and to delete the account, all while the password check waits.
    const thief = new Browser(server.url);
    await thief.logIn('Ann');
    hasher.hold = 'verify';
    const binding = bind(thief, 'thief@example.com');
    const unbinding = thief.request('/api/account/email/remove', { password: 'correct horse' });
    const deleting = thief.request('/api/account/delete', { password: 'correct horse' });
    await until(() => hasher.holding === 3, 'the checks to wait');
    hasher.hold = null;
    // Meanwhile the owner changes the password, which ends the thief's login.
    const changed = await owner.request('/api/account/password', {
      current: 'correct horse',
      password: 'battery staple',
    });
    expect(changed.status).toBe(200);
    hasher.release();
    expect((await binding).body.error).toBe('not_logged_in');
    expect((await unbinding).body.error).toBe('not_logged_in');
    expect((await deleting).body.error).toBe('not_logged_in');
    expect(mail.sent.map(({ to }) => to)).toEqual(['ann@example.com']);
    expect(await owner.account()).toMatchObject({ username: 'Ann', email: 'bound' });
  });

  test('writes nothing over a password that was reset while its hash was being made again', async () => {
    const hasher = new HeldHasher();
    const mail = new FakeMail();
    server = await startServer({ hasher, mail });
    const owner = new Browser(server.url);
    await owner.register('Ann');
    await bind(owner, 'ann@example.com');
    await new Browser(server.url).request('/api/email/confirm', { token: mail.last('bind') });
    const account = server.accounts.store.byKey('ann');
    if (!account) throw new Error('no account');
    // The hash was made with other parameters, as after the server raised them: a login makes it
    // again with the current ones.
    const older = new PasswordHasher({ log2N: 11, r: 8, p: 1 }, 1, 1);
    server.accounts.store.setPassword(account.id, await older.hash('correct horse'));
    expect((await new Browser(server.url).logIn('Ann')).status).toBe(200);
    expect(server.accounts.store.byId(account.id)?.password).toMatch(/^scrypt\$10\$/);

    // A login with the old password is making the hash again when the owner resets the password.
    server.accounts.store.setPassword(account.id, await older.hash('correct horse'));
    hasher.hold = 'hash';
    const stranger = new Browser(server.url);
    const loggingIn = stranger.logIn('Ann', 'correct horse');
    await until(() => hasher.holding === 1, 'the hash to wait');
    hasher.hold = null;
    await new Browser(server.url).request('/api/password/forgot', { email: 'ann@example.com', language: 'en' });
    await until(() => mail.sent.some(({ kind }) => kind === 'reset'), 'the reset mail');
    const device = new Browser(server.url);
    const reset = await device.request('/api/password/reset', {
      token: mail.last('reset'),
      password: 'battery staple',
    });
    expect(reset.status).toBe(200);
    hasher.release();
    expect((await loggingIn).body.error).toBe('login_failed');
    expect(stranger.cookie).toBe('');
    expect((await new Browser(server.url).logIn('Ann', 'correct horse')).body.error).toBe('login_failed');
    expect((await new Browser(server.url).logIn('Ann', 'battery staple')).status).toBe(200);
  });
});

describe('requests that arrive together', () => {
  test('count against their limits before any is answered', async () => {
    const mail = new FakeMail();
    server = await startServer({ trustProxy: true, hasher: fastHasher(32, 64), mail });
    const from = (ip: string) => new Browser(server.url, ip);
    // Twelve registrations from one address at once: five accounts an hour.
    const registered = await Promise.all(
      Array.from({ length: 12 }, (_, i) => from('203.0.113.1').register(`Name ${i}`)),
    );
    expect(registered.filter(({ status }) => status === 200)).toHaveLength(5);
    expect(registered.filter(({ body }) => body.error === 'register_limited')).toHaveLength(7);
    // Thirty wrong passwords for one name, from as many addresses, at once: ten in 15 minutes.
    const tried = await Promise.all(
      Array.from({ length: 30 }, (_, i) => from(`198.51.100.${i}`).logIn('Name 0', 'wrong horse')),
    );
    expect(tried.filter(({ body }) => body.error === 'login_failed')).toHaveLength(10);
    expect(tried.filter(({ body }) => body.error === 'login_limited')).toHaveLength(20);
    // Eight addresses to bind for one account at once: three a day.
    const owner = from('203.0.113.2');
    await owner.register('Binder');
    const bound = await Promise.all(Array.from({ length: 8 }, (_, i) => bind(owner, `me${i}@example.com`)));
    expect(bound.filter(({ status }) => status === 200)).toHaveLength(3);
    expect(bound.filter(({ body }) => body.error === 'email_limited')).toHaveLength(5);
    expect(mail.sent.filter(({ kind }) => kind === 'bind')).toHaveLength(3);
  });
});
