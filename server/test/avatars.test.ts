import { afterEach, describe, expect, test } from 'vitest';
import { Browser, createRoom, startServer, TestClient, until, type TestServer } from './helpers';
import { jpeg, webp } from './images';

// Avatars over HTTP: uploading one, the headers it is served with, replacing and removing it, what
// the rooms show, and the limits.

let server: TestServer;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
});

async function account(name: string) {
  const browser = new Browser(server.url);
  await browser.register(name);
  return browser;
}

describe('an avatar', () => {
  test('is uploaded as it is, and served from its own address as an image alone', async () => {
    server = await startServer();
    const ann = await account('Ann');
    const reply = await ann.upload(jpeg());
    expect(reply).toMatchObject({
      status: 200,
      body: { ok: true, avatar: expect.stringMatching(/^\/avatars\/[0-9a-f]{64}\.jpg$/) },
    });
    const avatar = reply.body.avatar as string;
    expect(await ann.account()).toMatchObject({ avatar });

    const response = await fetch(`${server.url}${avatar}`);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(jpeg());
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'image/jpeg',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
      'cache-control': 'public, max-age=31536000, immutable',
    });
    const head = await fetch(`${server.url}${avatar}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect((await fetch(`${server.url}/avatars/${'0'.repeat(64)}.jpg`)).status).toBe(404);
    expect((await fetch(`${server.url}/avatars/..%2Freviewer2.db`)).status).toBe(404);
    expect((await fetch(`${server.url}${avatar}`, { method: 'POST' })).status).toBe(405);
  });

  test('of WebP is served as WebP', async () => {
    server = await startServer();
    const ann = await account('Ann');
    const { avatar } = (await ann.upload(webp(), 'image/webp')).body;
    expect(avatar).toMatch(/\.webp$/);
    expect((await fetch(`${server.url}${String(avatar)}`)).headers.get('content-type')).toBe('image/webp');
  });

  test('that is not one, or too large, or of another type, is refused', async () => {
    server = await startServer();
    const ann = await account('Ann');
    expect(await ann.upload(jpeg(512, 512))).toMatchObject({ status: 400, body: { error: 'avatar_invalid' } });
    expect(await ann.upload(Buffer.from('<svg/>'), 'image/jpeg')).toMatchObject({ body: { error: 'avatar_invalid' } });
    expect(await ann.upload(jpeg(256, 256, 70 * 1024))).toMatchObject({
      status: 413,
      body: { error: 'avatar_too_large' },
    });
    expect((await ann.upload(jpeg(), 'image/svg+xml')).status).toBe(415);
    expect((await ann.upload(jpeg(), 'image/png')).status).toBe(415);
    expect((await ann.upload(jpeg(), 'image/jpeg', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await new Browser(server.url).upload(jpeg())).status).toBe(401);
    expect(await ann.account()).toMatchObject({ avatar: null });
  });

  test('replaces the one before, whose file goes unless another account shows it', async () => {
    server = await startServer();
    const ann = await account('Ann');
    const bob = await account('Bob');
    const first = (await ann.upload(jpeg())).body.avatar as string;
    expect((await bob.upload(jpeg())).body.avatar).toBe(first);
    const second = (await ann.upload(webp(), 'image/webp')).body.avatar as string;
    expect((await fetch(`${server.url}${first}`)).status).toBe(200);
    await bob.request('/api/account/avatar/remove', {});
    expect(await bob.account()).toMatchObject({ avatar: null });
    expect((await fetch(`${server.url}${first}`)).status).toBe(404);
    expect(server.accounts.avatars.names()).toEqual([second.slice('/avatars/'.length)]);
    // Deleting the account takes its avatar too.
    await ann.request('/api/account/delete', { password: 'correct horse' });
    expect((await fetch(`${server.url}${second}`)).status).toBe(404);
    expect(server.accounts.avatars.names()).toEqual([]);
  });

  test('shows beside the name in the rooms the account is in', async () => {
    server = await startServer();
    const ann = await account('Ann');
    const { code } = await createRoom(server.url);
    const own = await ann.connect();
    clients.push(own);
    await own.send('room:join', { code, play: true });
    const cat = server.app.rooms.find(code);
    await until(() => cat?.members.size === 2, 'Ann to join');
    const watcher = await TestClient.connect(server.url);
    clients.push(watcher);
    await watcher.send('room:watch', { code });
    await watcher.waitFor((state) => state.players.length === 2);
    expect(watcher.state?.players.map(({ avatar }) => avatar)).toEqual([undefined, undefined]);

    const { avatar } = (await ann.upload(jpeg())).body;
    await watcher.waitFor((state) => state.players[1]?.avatar === avatar, 'the avatar');
    await until(() => own.account?.avatar === avatar, 'the session to show it');
    await ann.request('/api/account/avatar/remove', {});
    await watcher.waitFor((state) => state.players[1]?.avatar === undefined, 'the default avatar');
  });

  test('can be changed 10 times a day', async () => {
    server = await startServer();
    const ann = await account('Ann');
    for (let i = 0; i < 10; i += 1) expect((await ann.upload(jpeg(256, 256, 100 + i))).status).toBe(200);
    expect(await ann.upload(jpeg())).toMatchObject({ status: 429, body: { error: 'avatar_limited' } });
    server.advance(24 * 60 * 60_000);
    expect((await ann.upload(jpeg())).status).toBe(200);
  });

  test('is refused once all of them take the room they may', async () => {
    server = await startServer({ maxAvatarBytes: 3000 });
    const ann = await account('Ann');
    expect((await ann.upload(jpeg())).status).toBe(200);
    expect(await ann.upload(jpeg(256, 256, 900))).toMatchObject({ status: 503, body: { error: 'avatars_full' } });
    expect(await ann.upload(jpeg(256, 256, 901))).toMatchObject({ body: { error: 'avatars_full' } });
    expect(server.logs.filter(({ event }) => event === 'avatars_full')).toEqual([
      { event: 'avatars_full', fields: { limit: 3000 } },
    ]);
    // Going back to the default makes room.
    await ann.request('/api/account/avatar/remove', {});
    expect((await ann.upload(jpeg(256, 256, 900))).status).toBe(200);
  });

  test('is refused to an account that the operator barred', async () => {
    server = await startServer();
    const ann = await account('Ann');
    server.accounts.store.setAvatarBanned(1, true);
    expect(await ann.upload(jpeg())).toMatchObject({ status: 403, body: { error: 'avatar_banned' } });
    server.accounts.store.setAvatarBanned(1, false);
    expect((await ann.upload(jpeg())).status).toBe(200);
  });
});
