import { MAX_CONTACT_LENGTH, MAX_FEEDBACK_INPUT, MAX_FEEDBACK_LENGTH } from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_SOCKET_LIMITS } from '../src/core/socket';
import { createRoom, startServer, TestClient, type TestServer } from './helpers';

// Feedback over Socket.IO: what is kept of it, what is refused, how much one address may send,
// and what the log says about it.

let server: TestServer;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
});

const AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) MicroMessenger/8.0.60';

async function connect(headers: Record<string, string> = {}): Promise<TestClient> {
  const client = await TestClient.connect(server.url, {}, { extraHeaders: { 'user-agent': AGENT, ...headers } });
  clients.push(client);
  return client;
}

const message = (changes: Record<string, unknown> = {}) => ({
  kind: 'idea',
  text: 'A timer for the clues, please.',
  version: 'v0.0.15',
  language: 'en',
  page: 'home',
  ...changes,
});

describe('feedback', () => {
  test('is kept with what came along, and the log gets its number and kind alone', async () => {
    server = await startServer();
    const client = await connect();
    const text = 'Steps:\n1. Lock the phone\n2. Come back';
    expect(await client.send('meta:feedback', message({ kind: 'bug', text, contact: ' me@example.com ' }))).toEqual({
      ok: true,
    });
    expect(await client.send('meta:feedback', message({ language: 'zh', page: 'room' }))).toEqual({ ok: true });
    expect(server.feedback.latest(10)).toEqual([
      {
        id: 2,
        createdAt: expect.any(String),
        kind: 'idea',
        text: 'A timer for the clues, please.',
        contact: null,
        version: 'v0.0.15',
        language: 'zh',
        page: 'room',
        userAgent: null,
      },
      {
        id: 1,
        createdAt: expect.any(String),
        kind: 'bug',
        text,
        contact: 'me@example.com',
        version: 'v0.0.15',
        language: 'en',
        page: 'home',
        userAgent: AGENT,
      },
    ]);
    const logged = server.logs.filter(({ event }) => event.startsWith('feedback'));
    expect(logged).toEqual([
      { event: 'feedback_received', fields: { id: 1, kind: 'bug' } },
      { event: 'feedback_received', fields: { id: 2, kind: 'idea' } },
    ]);
    const log = JSON.stringify(server.logs);
    for (const secret of ['Lock the phone', 'me@example.com', 'iPhone', '127.0.0.1']) {
      expect(log, secret).not.toContain(secret);
    }
  });

  test('keeps nothing that says who sent it, even from someone in a room', async () => {
    server = await startServer({ trustProxy: true });
    const { chair, code, roomId } = await createRoom(server.url, 'Zelda');
    clients.push(chair);
    expect(await chair.send('meta:feedback', message({ kind: 'bug', page: 'room' }))).toEqual({ ok: true });
    const kept = JSON.stringify(server.feedback.latest(10));
    for (const secret of [code, roomId, chair.token, chair.me, 'Zelda', '127.0.0.1']) {
      expect(kept, secret).not.toContain(secret);
    }
  });

  test('is cleaned before it is kept, and a contact that shows nothing is none', async () => {
    server = await startServer();
    const client = await connect();
    const text = '\n\n  Too   many\tspaces \u200b\n\n\n\nand blank lines  \n\n';
    expect(await client.send('meta:feedback', message({ text, contact: '\u200b ' }))).toEqual({ ok: true });
    expect(server.feedback.latest(1)[0]).toMatchObject({ text: 'Too many spaces\n\nand blank lines', contact: null });
  });

  test('of another kind than a bug is kept without the user agent', async () => {
    server = await startServer();
    const client = await connect();
    for (const kind of ['idea', 'words']) {
      expect(await client.send('meta:feedback', message({ kind }))).toEqual({ ok: true });
    }
    expect(server.feedback.latest(10).map(({ userAgent }) => userAgent)).toEqual([null, null]);
  });

  test('keeps a long user agent only so far', async () => {
    server = await startServer();
    const client = await connect({ 'user-agent': `Mozilla/5.0 ${'x'.repeat(2000)}` });
    expect(await client.send('meta:feedback', message({ kind: 'bug' }))).toEqual({ ok: true });
    expect(server.feedback.latest(1)[0]?.userAgent).toHaveLength(512);
  });

  test('that is empty or too long is refused with a reason, and nothing is kept', async () => {
    server = await startServer();
    const client = await connect();
    const refusals: [Record<string, unknown>, string][] = [
      [{ text: '' }, 'feedback_empty'],
      [{ text: ' \n\u200b ' }, 'feedback_empty'],
      [{ text: 'x'.repeat(MAX_FEEDBACK_LENGTH + 1) }, 'feedback_too_long'],
      [{ text: ' '.repeat(MAX_FEEDBACK_INPUT + 1) }, 'feedback_too_long'],
      [{ contact: 'x'.repeat(MAX_CONTACT_LENGTH + 1) }, 'contact_too_long'],
    ];
    for (const [changes, error] of refusals) {
      expect(await client.send('meta:feedback', message(changes)), error).toEqual({ ok: false, error });
    }
    expect(server.feedback.count()).toBe(0);
  });

  test("that isn't in the expected shape is a bad request", async () => {
    server = await startServer();
    const client = await connect();
    const bad = [
      {},
      message({ kind: 'praise' }),
      message({ language: 'fr' }),
      message({ page: 'lobby' }),
      message({ text: 42 }),
      message({ contact: ['me'] }),
      message({ version: 'v'.repeat(65) }),
    ];
    for (const payload of bad) {
      expect(await client.send('meta:feedback', payload), JSON.stringify(payload).slice(0, 80)).toEqual({
        ok: false,
        error: 'bad_request',
      });
    }
    expect(server.feedback.count()).toBe(0);
  });

  test('is kept without whatever else a client sent along with it', async () => {
    server = await startServer();
    const client = await connect();
    expect(await client.send('meta:feedback', { ...message(), code: 'K7QX', name: 'Zelda' })).toEqual({ ok: true });
    const kept = JSON.stringify(server.feedback.latest(10));
    expect(kept).not.toContain('K7QX');
    expect(kept).not.toContain('Zelda');
  });
});

describe('the limit on feedback', () => {
  test('lets one address send three every ten minutes, counting only what was kept', async () => {
    server = await startServer();
    const client = await connect();
    expect(await client.send('meta:feedback', message({ text: '' }))).toEqual({ ok: false, error: 'feedback_empty' });
    for (let i = 0; i < DEFAULT_SOCKET_LIMITS.feedbackPerWindow; i += 1) {
      expect(await client.send('meta:feedback', message({ text: `Idea ${i}` }))).toEqual({ ok: true });
    }
    // A new connection from the same address doesn't start the count again.
    const again = await connect();
    expect(await again.send('meta:feedback', message({ text: 'Idea 3' }))).toEqual({
      ok: false,
      error: 'feedback_limited',
    });
    expect(server.feedback.count()).toBe(3);

    server.advance(DEFAULT_SOCKET_LIMITS.feedbackWindowMs - 1000);
    expect(await again.send('meta:feedback', message({ text: 'Idea 3' }))).toEqual({
      ok: false,
      error: 'feedback_limited',
    });
    server.advance(1000);
    expect(await again.send('meta:feedback', message({ text: 'Idea 3' }))).toEqual({ ok: true });
  });

  test('counts each address on its own behind a trusted proxy', async () => {
    server = await startServer({ trustProxy: true, socketLimits: { feedbackPerWindow: 1 } });
    const lab = await connect({ 'x-forwarded-for': '203.0.113.9' });
    const home = await connect({ 'x-forwarded-for': '198.51.100.7' });
    expect(await lab.send('meta:feedback', message())).toEqual({ ok: true });
    expect(await lab.send('meta:feedback', message({ text: 'Another' }))).toEqual({
      ok: false,
      error: 'feedback_limited',
    });
    expect(await home.send('meta:feedback', message())).toEqual({ ok: true });
  });

  test('keeps the same feedback from one address once in a window, as when the first answer was lost', async () => {
    server = await startServer({ trustProxy: true });
    const client = await connect({ 'x-forwarded-for': '203.0.113.9' });
    const sent = message({ kind: 'bug', text: ' Same  text ', contact: 'me@example.com' });
    expect(await client.send('meta:feedback', sent)).toEqual({ ok: true });
    // Sent again, as the panel does when it heard no answer: the same, give or take the cleaning.
    const again = await connect({ 'x-forwarded-for': '203.0.113.9' });
    expect(await again.send('meta:feedback', { ...sent, text: 'Same text' })).toEqual({ ok: true });
    expect(server.feedback.count()).toBe(1);
    expect(server.logs.filter(({ event }) => event === 'feedback_received')).toHaveLength(1);
    // It didn't count against the address either.
    for (let i = 1; i < DEFAULT_SOCKET_LIMITS.feedbackPerWindow; i += 1) {
      expect(await client.send('meta:feedback', message({ text: `Idea ${i}` }))).toEqual({ ok: true });
    }
    expect(await client.send('meta:feedback', message({ text: 'One more' }))).toEqual({
      ok: false,
      error: 'feedback_limited',
    });
    // The same feedback again is still answered as it was, limit or no limit.
    expect(await client.send('meta:feedback', sent)).toEqual({ ok: true });
    expect(server.feedback.count()).toBe(3);

    // Another address, or another kind or contact, is other feedback.
    const other = await connect({ 'x-forwarded-for': '198.51.100.7' });
    expect(await other.send('meta:feedback', sent)).toEqual({ ok: true });
    expect(await other.send('meta:feedback', { ...sent, kind: 'idea' })).toEqual({ ok: true });
    expect(await other.send('meta:feedback', { ...sent, contact: 'other@example.com' })).toEqual({ ok: true });
    expect(server.feedback.count()).toBe(6);

    // After the window, the same feedback is new again.
    server.advance(DEFAULT_SOCKET_LIMITS.feedbackWindowMs);
    server.app.sockets.sweep();
    expect(await client.send('meta:feedback', sent)).toEqual({ ok: true });
    expect(server.feedback.count()).toBe(7);
  });

  test('is a whole number from 1 up, like every limit of the sockets', async () => {
    server = await startServer();
    for (const feedbackPerWindow of [0, 1.5, NaN]) {
      await expect(startServer({ socketLimits: { feedbackPerWindow } })).rejects.toThrow(
        /^feedbackPerWindow must be a whole number from 1 up/,
      );
    }
  });
});

describe('a server that takes no more feedback', () => {
  test('says so to the player, and once to the log', async () => {
    server = await startServer({ feedbackLimits: { maxEntries: 2 }, socketLimits: { feedbackPerWindow: 10 } });
    const client = await connect();
    let n = 0;
    const next = () => message({ text: `Idea ${(n += 1)}` });
    for (let i = 0; i < 2; i += 1) expect(await client.send('meta:feedback', next())).toEqual({ ok: true });
    for (let i = 0; i < 2; i += 1) {
      expect(await client.send('meta:feedback', next())).toEqual({ ok: false, error: 'feedback_full' });
    }
    expect(server.feedback.count()).toBe(2);
    expect(server.logs.filter(({ event }) => event === 'feedback_full')).toEqual([
      { event: 'feedback_full', fields: { reason: 'entries' } },
    ]);

    // Once the operator has made room, feedback is taken again, and the log hears of the next time
    // that it is full.
    server.db.exec('DELETE FROM feedback WHERE id = 1');
    expect(await client.send('meta:feedback', next())).toEqual({ ok: true });
    expect(await client.send('meta:feedback', next())).toEqual({ ok: false, error: 'feedback_full' });
    expect(server.logs.filter(({ event }) => event === 'feedback_full')).toHaveLength(2);
  });
});
