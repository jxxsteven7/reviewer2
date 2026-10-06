import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createAppServer, type AppServer } from '../src/server';

const INDEX = '<!doctype html><title>Reviewer 2</title>';
const SCRIPT = 'console.log(1);';

async function start(publicDir: string): Promise<{ server: AppServer; base: string }> {
  const server = createAppServer({ publicDir, version: 'test-version' });
  await new Promise<void>((resolve) => server.http.listen(0, '127.0.0.1', resolve));
  const { port } = server.http.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

// Sends the request target exactly as it is given and returns the body as it arrives. fetch()
// does neither: it parses the URL first, and it expands a compressed body.
function get(
  base: string,
  target: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const sent = request(base, { path: target, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }),
      );
    });
    sent.on('error', reject);
    sent.end();
  });
}

describe('with a built front end', () => {
  let dir: string;
  let server: AppServer;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'reviewer2-http-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), INDEX);
    writeFileSync(join(dir, 'assets', 'index-abc123.js'), SCRIPT);
    // The copies that the build leaves beside each text file; see client/compress.mjs.
    for (const [file, content] of [
      ['index.html', INDEX],
      [join('assets', 'index-abc123.js'), SCRIPT],
    ] as const) {
      writeFileSync(join(dir, `${file}.gz`), gzipSync(content));
      writeFileSync(join(dir, `${file}.br`), brotliCompressSync(content));
    }
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

  test('a request target that is not a valid URL gets the page, like any other unknown path', async () => {
    for (const target of ['//', '//[', '//x:99999/', 'http://[::1']) {
      const response = await get(base, target);
      expect(response.status, target).toBe(200);
      expect(response.body.toString(), target).toBe(INDEX);
    }
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  test('hashed assets are cached for good, and missing ones are a 404', async () => {
    const asset = await fetch(`${base}/assets/index-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    const missing = await fetch(`${base}/assets/index-old999.js`);
    expect(missing.status).toBe(404);
  });

  test('text files are sent compressed to the browsers that accept it', async () => {
    const files = [
      { target: '/assets/index-abc123.js', content: SCRIPT, cache: 'public, max-age=31536000, immutable' },
      { target: '/room/K7QX', content: INDEX, cache: 'no-cache' },
    ];
    const accepted = [
      { accept: 'br', encoding: 'br', expand: brotliDecompressSync },
      { accept: 'gzip', encoding: 'gzip', expand: gunzipSync },
      { accept: 'gzip, deflate, br', encoding: 'br', expand: brotliDecompressSync },
    ];
    for (const { target, content, cache } of files) {
      for (const { accept, encoding, expand } of accepted) {
        const response = await get(base, target, { 'accept-encoding': accept });
        const which = `${target} with ${accept}`;
        expect(response.status, which).toBe(200);
        expect(response.headers['content-encoding'], which).toBe(encoding);
        expect(response.headers.vary, which).toBe('Accept-Encoding');
        expect(response.headers['cache-control'], which).toBe(cache);
        expect(expand(response.body).toString(), which).toBe(content);
      }
      const plain = await get(base, target);
      expect(plain.headers['content-encoding'], target).toBeUndefined();
      expect(plain.body.toString(), target).toBe(content);
    }
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
