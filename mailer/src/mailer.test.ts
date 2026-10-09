import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MailRequest } from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_BASE_URL, loadConfig } from './config';
import { createMailer } from './mailer';
import { parseRequest } from './protocol';
import { DEFAULT_QUOTA, Quota } from './quota';
import { render } from './templates';
import { printTransport, resendTransport, SENDER, type Transport } from './transports';

const TOKEN = 'T'.repeat(43);
const request = (changes: Partial<Record<keyof MailRequest, unknown>> = {}): MailRequest =>
  ({ v: 1, kind: 'reset', to: 'ann@example.com', token: TOKEN, language: 'en', ...changes }) as MailRequest;
const line = (changes: Partial<Record<keyof MailRequest, unknown>> = {}) => JSON.stringify(request(changes));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reviewer2-mailer-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('a request', () => {
  test('has exactly the five fields, each as it should be', () => {
    expect(parseRequest(line())).toEqual(request());
    for (const kind of ['bind', 'reset']) {
      for (const language of ['zh', 'en']) expect(parseRequest(line({ kind, language }))).not.toBeNull();
    }
  });

  test('that is anything else is refused', () => {
    const refused = [
      '',
      'not json',
      '[]',
      'null',
      JSON.stringify({ ...request(), subject: 'Free money' }),
      JSON.stringify({ ...request(), link: 'https://evil.example' }),
      JSON.stringify({ v: 1, kind: 'reset', to: 'ann@example.com', token: TOKEN }),
      line({ v: 2 }),
      line({ kind: 'welcome' }),
      line({ language: 'fr' }),
      line({ token: 'T'.repeat(42) }),
      line({ token: `${'T'.repeat(42)}/` }),
      line({ token: 42 }),
    ];
    for (const text of refused) expect(parseRequest(text), text).toBeNull();
  });

  test('names one plain address, and nothing a mail header could read as more', () => {
    const addresses = [
      'ann',
      'ann@example',
      'Ann <ann@example.com>',
      'ann@example.com, bob@example.com',
      'ann@example.com\nBcc: bob@example.com',
      'ann lee@example.com',
      '"ann"@example.com',
      'ann@exa mple.com',
      '\u{e4}nn@example.com',
      `${'a'.repeat(250)}@b.cn`,
    ];
    for (const to of addresses) expect(parseRequest(line({ to })), to).toBeNull();
    expect(parseRequest(line({ to: 'ann.lee+r2@mail.example.edu.sg' }))).not.toBeNull();
    expect(parseRequest(line({ to: 'ann@xn--fiqs8s.cn' }))).not.toBeNull();
  });
});

describe('a mail', () => {
  test('links to the page for its kind, with the secret after a #', () => {
    expect(render(request({ kind: 'reset' }), DEFAULT_BASE_URL).link).toBe(
      `https://playreviewer2.com/account/reset#${TOKEN}`,
    );
    expect(render(request({ kind: 'bind' }), 'http://127.0.0.1:3000').link).toBe(
      `http://127.0.0.1:3000/account/confirm#${TOKEN}`,
    );
  });

  test('is written from the templates of its language, in text and in HTML', () => {
    const reset = render(request(), DEFAULT_BASE_URL);
    expect(reset.subject).toBe('Reset your Reviewer 2 password');
    expect(reset.text).toContain(`\n\n${reset.link}\n\n`);
    expect(reset.text).toContain('within 30 minutes');
    expect(reset.html).toContain(`<a href="${reset.link}">${reset.link}</a>`);
    expect(reset.html).toContain('<p>If it wasn&#39;t you, ignore this mail. Your password stays as it is.</p>');
    expect(reset.html).not.toMatch(/<img|<script|src=/);

    const bind = render(request({ kind: 'bind', language: 'zh' }), DEFAULT_BASE_URL);
    expect(bind.subject).toBe('\u{786e}\u{8ba4}\u{4f60}\u{5728} Reviewer 2 \u{7ed1}\u{5b9a}\u{7684}\u{90ae}\u{7bb1}');
    expect(bind.text).toContain('24');
    expect(bind.html).toContain('lang="zh-CN"');
  });

  test('holds nothing of the address it goes to', () => {
    const mail = render(request({ to: 'ann@example.com' }), DEFAULT_BASE_URL);
    expect(JSON.stringify(mail)).not.toContain('ann@');
  });
});

describe('the count of mails', () => {
  test('allows 50 in any 24 hours, of which 40 may confirm an address', () => {
    const start = Date.UTC(2026, 9, 9);
    let now = start;
    const quota = new Quota(null, () => now);
    expect(DEFAULT_QUOTA).toEqual({ total: 50, bind: 40, windowMs: 24 * 60 * 60_000 });
    for (let i = 0; i < 40; i += 1) expect(quota.take('bind')).toBe(true);
    expect(quota.take('bind')).toBe(false);
    // The ten left are for resetting passwords.
    now += 60 * 60_000;
    for (let i = 0; i < 10; i += 1) expect(quota.take('reset')).toBe(true);
    expect(quota.take('reset')).toBe(false);
    // A day after the first ones, they no longer count; the later ones still do.
    now = start + 24 * 60 * 60_000 - 1;
    expect(quota.take('bind')).toBe(false);
    now += 1;
    for (let i = 0; i < 40; i += 1) expect(quota.take('bind')).toBe(true);
    expect(quota.take('reset')).toBe(false);
  });

  test('lasts through a restart, and a file that holds no count stops the mailer', () => {
    const file = join(dir, 'sent.json');
    const now = () => Date.UTC(2026, 9, 9);
    const first = new Quota(file, now, { total: 2, bind: 2, windowMs: 1000 });
    expect(first.take('reset')).toBe(true);
    expect(first.take('bind')).toBe(true);
    expect(new Quota(file, now, { total: 2, bind: 2, windowMs: 1000 }).take('reset')).toBe(false);
    writeFileSync(file, '{"count": 0}');
    expect(() => new Quota(file, now)).toThrow(/does not hold a count/);
  });
});

describe('Resend', () => {
  test('gets the mail from the fixed sender, once for each secret', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const logs: unknown[] = [];
    const transport = resendTransport('re_key', (...entry) => logs.push(entry), (async (
      url: string,
      init: RequestInit,
    ) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as typeof fetch);
    const mail = render(request(), DEFAULT_BASE_URL);
    expect(await transport.send(request(), mail)).toBe(true);
    const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer re_key',
      'Content-Type': 'application/json',
      'Idempotency-Key': expect.stringMatching(/^reset-[0-9a-f]{64}$/),
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: SENDER,
      to: ['ann@example.com'],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    expect(SENDER).toBe('Reviewer 2 <noreply@playreviewer2.com>');
    expect(logs).toEqual([]);
  });

  test('that refuses or can not be reached is logged without the address', async () => {
    const logs: unknown[] = [];
    const log = (...entry: unknown[]) => logs.push(entry);
    const refusing = resendTransport(
      're_key',
      log,
      (async () =>
        new Response('{"message":"ann@example.com is invalid"}', { status: 422 })) as unknown as typeof fetch,
    );
    const unreachable = resendTransport('re_key', log, (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch);
    const mail = render(request(), DEFAULT_BASE_URL);
    expect(await refusing.send(request(), mail)).toBe(false);
    expect(await unreachable.send(request(), mail)).toBe(false);
    expect(logs).toEqual([
      ['mail_failed', { kind: 'reset', status: 422 }],
      ['mail_failed', { kind: 'reset', message: 'getaddrinfo ENOTFOUND' }],
    ]);
  });
});

describe('the mailer', () => {
  function setUp(transport?: Transport, limits = DEFAULT_QUOTA) {
    const printed: string[] = [];
    const logs: { event: string; fields?: Record<string, unknown> }[] = [];
    const mailer = createMailer({
      quota: new Quota(null, Date.now, limits),
      transport: transport ?? printTransport((text) => printed.push(text)),
      baseUrl: 'http://127.0.0.1:3000',
      log: (event, fields) => logs.push({ event, ...(fields ? { fields } : {}) }),
      readMs: 200,
    });
    return { mailer, printed, logs };
  }

  test('sends what it is asked for, and logs its kind and language alone', async () => {
    const { mailer, printed, logs } = setUp();
    expect(await mailer.handle(line({ kind: 'bind', language: 'zh' }))).toEqual({ ok: true });
    expect(JSON.parse(printed[0] as string)).toMatchObject({
      kind: 'bind',
      to: 'ann@example.com',
      link: `http://127.0.0.1:3000/account/confirm#${TOKEN}`,
    });
    expect(logs).toEqual([{ event: 'mail_sent', fields: { kind: 'bind', language: 'zh' } }]);
  });

  test('refuses a request that is not one, and what is over the count', async () => {
    const { mailer, printed, logs } = setUp(undefined, { total: 1, bind: 1, windowMs: 60_000 });
    expect(await mailer.handle(line({ to: 'Ann <ann@example.com>' }))).toEqual({ ok: false, error: 'bad_request' });
    expect(await mailer.handle(line())).toEqual({ ok: true });
    expect(await mailer.handle(line())).toEqual({ ok: false, error: 'quota' });
    expect(printed).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toMatch(/ann@|TTTT/);
  });

  test('says when the mail service would not take a mail', async () => {
    const { mailer } = setUp({ send: async () => false });
    expect(await mailer.handle(line())).toEqual({ ok: false, error: 'failed' });
  });

  test('answers one line with one line over its socket', async () => {
    const { mailer, printed } = setUp();
    const path = join(dir, 'mailer.sock');
    await new Promise<void>((resolve) => mailer.server.listen(path, resolve));
    const ask = (text: string) =>
      new Promise<string>((resolve) => {
        let answer = '';
        const socket = connect(path, () => socket.write(text));
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => (answer += chunk));
        socket.on('close', () => resolve(answer));
      });
    try {
      expect(await ask(`${line()}\n`)).toBe('{"ok":true}\n');
      expect(await ask('nonsense\n')).toBe('{"ok":false,"error":"bad_request"}\n');
      expect(await ask(`${'x'.repeat(3000)}\n`)).toBe('{"ok":false,"error":"bad_request"}\n');
      // A connection that never finishes its line is closed without an answer.
      expect(await ask(line())).toBe('');
      // What comes after the line is not read: one request, however it is written, is one mail.
      const sent = printed.length;
      const answer = await new Promise<string>((resolve) => {
        let received = '';
        const socket = connect(path, () => {
          socket.write(`${line()}\n`);
          setTimeout(() => socket.write(`${line()}\n`), 20);
        });
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => (received += chunk));
        socket.on('close', () => resolve(received));
      });
      expect(answer).toBe('{"ok":true}\n');
      expect(printed).toHaveLength(sent + 1);
    } finally {
      await new Promise((resolve) => mailer.server.close(resolve));
    }
  });
});

describe('the settings', () => {
  const key = () => join(dir, 'key');

  test('send through Resend by default, with its key, a state directory and the site over https', () => {
    writeFileSync(key(), 're_secret\n');
    expect(
      loadConfig({ RESEND_API_KEY_FILE: key(), STATE_DIRECTORY: '/srv/mailer-state', MAILER_SOCKET: '/s' }, 1),
    ).toEqual({
      transport: 'resend',
      apiKey: 're_secret',
      baseUrl: 'https://playreviewer2.com',
      activated: false,
      socket: '/s',
      stateDir: '/srv/mailer-state',
      printFile: null,
    });
    expect(() => loadConfig({ MAILER_SOCKET: '/s', STATE_DIRECTORY: '/d' }, 1)).toThrow(/RESEND_API_KEY/);
    expect(() => loadConfig({ RESEND_API_KEY: 'k', MAILER_SOCKET: '/s' }, 1)).toThrow(/STATE_DIRECTORY/);
    expect(() =>
      loadConfig(
        { RESEND_API_KEY: 'k', MAILER_SOCKET: '/s', STATE_DIRECTORY: '/d', MAILER_BASE_URL: 'http://x.cn' },
        1,
      ),
    ).toThrow(/over https/);
  });

  test('take a relative path from the repository root, as the game server does', () => {
    const root = join(import.meta.dirname, '..', '..');
    expect(
      loadConfig({ MAILER_TRANSPORT: 'print', MAILER_SOCKET: 'data/mailer.sock', MAILER_PRINT_FILE: 'data/mails' }, 1),
    ).toMatchObject({ socket: join(root, 'data', 'mailer.sock'), printFile: join(root, 'data', 'mails') });
  });

  test('take the socket that systemd hands over, when it is for this process', () => {
    const env = { MAILER_TRANSPORT: 'print', LISTEN_FDS: '1', LISTEN_PID: '42' };
    expect(loadConfig(env, 42)).toMatchObject({ activated: true, socket: null, transport: 'print', apiKey: null });
    expect(() => loadConfig(env, 43)).toThrow(/MAILER_SOCKET/);
  });

  test('take the site alone as its address', () => {
    const print = { MAILER_TRANSPORT: 'print', MAILER_SOCKET: '/s' };
    expect(loadConfig({ ...print, MAILER_BASE_URL: 'http://127.0.0.1:3000/' }, 1).baseUrl).toBe(
      'http://127.0.0.1:3000',
    );
    for (const url of [
      'https://playreviewer2.com/path',
      'https://a@playreviewer2.com',
      'javascript:alert(1)',
      'nope',
    ]) {
      expect(() => loadConfig({ ...print, MAILER_BASE_URL: url }, 1), url).toThrow(/MAILER_BASE_URL/);
    }
    expect(() => loadConfig({ MAILER_TRANSPORT: 'smtp', MAILER_SOCKET: '/s' }, 1)).toThrow(/MAILER_TRANSPORT/);
    expect(() => loadConfig({ ...print, MAILER_SOCKET: `/${'x'.repeat(107)}` }, 1)).toThrow(/at most 107 bytes/);
  });
});
