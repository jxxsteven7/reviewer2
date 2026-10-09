import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MailRequest } from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { fingerprint, fingerprintKey, normalizeEmail } from './email';
import { socketMail } from './mail';

describe('an email address', () => {
  test('is normalized: trimmed, folded, in lower case and with the domain in punycode', () => {
    expect(normalizeEmail('  Ann.Lee+R2@Example.COM ')).toBe('ann.lee+r2@example.com');
    expect(normalizeEmail('\u{ff41}nn@example.com')).toBe('ann@example.com');
    expect(normalizeEmail('ann@\u{4f8b}\u{5b50}.cn')).toBe('ann@xn--fsqu00a.cn');
    expect(normalizeEmail('ann@EXAMPLE.com')).toBe(normalizeEmail('ANN@example.COM'));
  });

  test('is refused when it can not be mailed to as it is', () => {
    for (const raw of ['', 'ann', '@example.com', 'ann@', 'ann@example', 'Ann <ann@example.com>', 'a,b@example.com']) {
      expect(normalizeEmail(raw), raw).toBeNull();
    }
    expect(normalizeEmail(`${'a'.repeat(250)}@b.cn`)).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });

  test('is kept as a fingerprint that only the server secret makes', () => {
    const key = fingerprintKey('s'.repeat(44));
    expect(fingerprintKey('s'.repeat(44))).toEqual(key);
    const print = fingerprint(key, 'ann@example.com');
    expect(print).toHaveLength(32);
    expect(fingerprint(key, 'ann@example.com')).toEqual(print);
    expect(fingerprint(key, 'bob@example.com')).not.toEqual(print);
    expect(fingerprint(fingerprintKey('t'.repeat(44)), 'ann@example.com')).not.toEqual(print);
    expect(print.toString('hex')).not.toContain(Buffer.from('ann').toString('hex'));
  });
});

describe('the way to the mailer', () => {
  let dir: string;
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise((resolve) => server?.close(resolve));
    server = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  const request: MailRequest = { v: 1, kind: 'reset', to: 'ann@example.com', token: 'T'.repeat(43), language: 'en' };

  // A mailer that answers every request with `answer`, and keeps what it was sent.
  async function mailer(answer: string | null) {
    dir = mkdtempSync(join(tmpdir(), 'reviewer2-mail-'));
    const path = join(dir, 'mailer.sock');
    const received: string[] = [];
    server = createServer((socket) => {
      socket.setEncoding('utf8');
      socket.on('data', (line: string) => {
        received.push(line);
        if (answer === null) socket.destroy();
        else socket.end(answer);
      });
    });
    await new Promise<void>((resolve) => server?.listen(path, resolve));
    return { mail: socketMail(path), received };
  }

  test('sends one line and reads the answer', async () => {
    const { mail, received } = await mailer('{"ok":true}\n');
    expect(await mail.send(request)).toBe('sent');
    expect(received).toEqual([`${JSON.stringify(request)}\n`]);
  });

  test('tells a full count, a refusal and a failure apart', async () => {
    expect(await (await mailer('{"ok":false,"error":"quota"}\n')).mail.send(request)).toBe('quota');
    await new Promise((resolve) => server?.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    expect(await (await mailer('{"ok":false,"error":"bad_request"}\n')).mail.send(request)).toBe('refused');
    await new Promise((resolve) => server?.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    expect(await (await mailer(null)).mail.send(request)).toBe('failed');
  });

  test('fails when there is no mailer', async () => {
    dir = mkdtempSync(join(tmpdir(), 'reviewer2-mail-'));
    expect(await socketMail(join(dir, 'nobody.sock')).send(request)).toBe('failed');
  });
});
