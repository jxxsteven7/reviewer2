import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createAppServer, type AppServer } from '../src/server';

const INDEX = '<!doctype html><title>Reviewer 2</title>';

async function start(publicDir: string): Promise<{ server: AppServer; base: string }> {
  const server = createAppServer({ publicDir, version: 'test-version' });
  await new Promise<void>((resolve) => server.http.listen(0, '127.0.0.1', resolve));
  const { port } = server.http.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

describe('with a built front end', () => {
  let dir: string;
  let server: AppServer;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'reviewer2-http-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), INDEX);
    writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1);');
    ({ server, base } = await start(dir));
  });

  afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('/healthz reports the version', async () => {
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, version: 'test-version' });
  });

  test('pages are served with no-cache, and routes fall back to index.html', async () => {
    for (const path of ['/', '/room/K7QX', '/room/K7QX/screen']) {
      const response = await fetch(`${base}${path}`);
      expect(response.status, path).toBe(200);
      expect(await response.text(), path).toBe(INDEX);
      expect(response.headers.get('cache-control'), path).toBe('no-cache');
    }
  });

  test('hashed assets are cached for good, and missing ones are a 404', async () => {
    const asset = await fetch(`${base}/assets/index-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    const missing = await fetch(`${base}/assets/index-old999.js`);
    expect(missing.status).toBe(404);
  });

  test('every response carries the security headers', async () => {
    const response = await fetch(`${base}/`);
    const csp = response.headers.get('content-security-policy') ?? '';
    const host = new URL(base).host;
    expect(csp).toContain(`connect-src 'self' ws://${host} wss://${host}`);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
  });

  test('Socket.IO answers on the same port', async () => {
    const socket = connect(base, { transports: ['websocket'], reconnection: false });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      expect(socket.connected).toBe(true);
    } finally {
      socket.close();
    }
  });
});

describe('without a built front end', () => {
  test('pages explain how to build it, and /healthz still works', async () => {
    const { server, base } = await start(join(tmpdir(), 'reviewer2-no-such-dir'));
    try {
      const page = await fetch(`${base}/`);
      expect(page.status).toBe(404);
      expect(await page.text()).toMatch(/npm run build/);
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
