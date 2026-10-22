import { MAX_CONTACT_LENGTH, MAX_FEEDBACK_INPUT, MAX_FEEDBACK_LENGTH, MAX_NAME_LENGTH } from '@reviewer2/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_SOCKET_LIMITS } from '../src/core/socket';
import { Browser, createRoom, startServer, TestClient, type TestServer } from './helpers';

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
    const nobody = {
      credit: null,
      accountId: null,
      linkProfile: false,
      issue: null,
      resolvedPr: null,
      resolvedAt: null,
      adoptedAt: null,
      summaryZh: null,
      summaryEn: null,
      closedAt: null,
      deletedAt: null,
      status: 'new',
      username: null,
      nameTakenBy: null,
      game: null,
      gameId: null,
    };
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
        ...nobody,
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
        ...nobody,
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

  test("keeps a guest's name, and the account of a player who is logged in, signed with it or not", async () => {
    server = await startServer();
    const ann = new Browser(server.url);
    await ann.register('Ann');
    const loggedIn = await ann.connect();
    const guest = await connect();
    clients.push(loggedIn);
    // A name typed while logged in, as an older page sent it, signs with the account, which keeps
    // no name of its own.
    expect(await loggedIn.send('meta:feedback', message({ credit: '  Ann   L ' }))).toEqual({ ok: true });
    expect(await guest.send('meta:feedback', message({ text: 'As a guest', credit: 'octocat' }))).toEqual({ ok: true });
    // Without a name, a player stays anonymous, and the feedback counts for their account all the
    // same.
    expect(await loggedIn.send('meta:feedback', message({ text: 'Anonymous', credit: ' \u200b' }))).toEqual({
      ok: true,
    });
    expect(
      server.feedback
        .latest(10)
        .map(({ text, credit, accountId, username, linkProfile }) => [text, credit, accountId, username, linkProfile]),
    ).toEqual([
      ['Anonymous', null, 1, 'Ann', false],
      ['As a guest', 'octocat', null, null, false],
      ['A timer for the clues, please.', null, 1, 'Ann', true],
    ]);
    // The log has the name no more than the text.
    expect(JSON.stringify(server.logs)).not.toContain('octocat');
    // A guest's name that can't be a nickname is refused, and nothing is kept.
    for (const credit of ['x'.repeat(MAX_NAME_LENGTH + 1), 'Ann\u200bL']) {
      expect(await guest.send('meta:feedback', message({ text: 'Refused', credit }))).toEqual({
        ok: false,
        error: 'credit_invalid',
      });
    }
    expect(await guest.send('meta:feedback', message({ text: 'Refused', credit: 'Reviewer 2' }))).toEqual({
      ok: false,
      error: 'credit_reserved',
    });
    expect(server.feedback.count()).toBe(3);
  });

  test('ignores the link for the name and the answer about a public issue that older pages send', async () => {
    server = await startServer();
    const client = await connect();
    const old = message({ credit: 'Ann L', link: 'https://orcid.org/0000-0002-1825-0097', publicIssue: false });
    expect(await client.send('meta:feedback', old)).toEqual({ ok: true });
    // Whatever they were, as an older page could send them.
    expect(await client.send('meta:feedback', message({ text: 'Odd', link: 'mailto:x', publicIssue: 'yes' }))).toEqual({
      ok: true,
    });
    expect(server.feedback.latest(10).map(({ text, credit }) => [text, credit])).toEqual([
      ['Odd', null],
      ['A timer for the clues, please.', 'Ann L'],
    ]);
    expect(JSON.stringify(server.feedback.latest(10))).not.toMatch(/orcid|mailto|publicIssue/);
  });

  test('keeps feedback from an account signed with it, with no name, whatever name came along', async () => {
    server = await startServer({ socketLimits: { ...DEFAULT_SOCKET_LIMITS, feedbackPerWindow: 10 } });
    const ann = new Browser(server.url);
    await ann.register('Ann');
    const loggedIn = await ann.connect();
    clients.push(loggedIn);
    const guest = await connect();
    // Signed with the account, with no name sent, as the form sends it now, or with one, as older
    // pages sent it, which goes: the account's username is looked up whenever it is shown.
    expect(await loggedIn.send('meta:feedback', message({ credit: 'Ann L', linkProfile: true }))).toEqual({ ok: true });
    expect(await loggedIn.send('meta:feedback', message({ text: 'No name', linkProfile: true }))).toEqual({ ok: true });
    // A name typed while logged in signs with the account too, asked or not, since an account's
    // feedback is signed with it or anonymous.
    expect(await loggedIn.send('meta:feedback', message({ text: 'No', credit: 'Ann L', linkProfile: false }))).toEqual({
      ok: true,
    });
    expect(await loggedIn.send('meta:feedback', message({ text: 'Not asked', credit: 'Ann L' }))).toEqual({ ok: true });
    // A guest has no account to sign with, and keeps the name they left.
    expect(await guest.send('meta:feedback', message({ text: 'Guest', credit: 'Bob', linkProfile: true }))).toEqual({
      ok: true,
    });
    // With no name to fall back on, feedback to be signed with an account that the connection
    // doesn't have is refused rather than kept as anonymous.
    expect(await guest.send('meta:feedback', message({ text: 'Logged out', linkProfile: true }))).toEqual({
      ok: false,
      error: 'feedback_unsigned',
    });
    expect(
      server.feedback
        .latest(10)
        .map(({ text, credit, username, linkProfile }) => [text, credit, username, linkProfile]),
    ).toEqual([
      ['Guest', 'Bob', null, false],
      ['Not asked', null, 'Ann', true],
      ['No', null, 'Ann', true],
      ['No name', null, 'Ann', true],
      ['A timer for the clues, please.', null, 'Ann', true],
    ]);
    // The same feedback signed again, with another name or none, is the same feedback, kept once.
    expect(await loggedIn.send('meta:feedback', message({ credit: 'Annie', linkProfile: false }))).toEqual({
      ok: true,
    });
    expect(server.feedback.count()).toBe(5);
    // Signed by another account, it is other feedback.
    const bob = new Browser(server.url);
    await bob.register('Bob');
    const bobs = await bob.connect();
    clients.push(bobs);
    expect(await bobs.send('meta:feedback', message({ linkProfile: true }))).toEqual({ ok: true });
    expect(server.feedback.count()).toBe(6);
    expect(await loggedIn.send('meta:feedback', message({ credit: 'Ann L', linkProfile: 'yes' }))).toEqual({
      ok: false,
      error: 'bad_request',
    });
  });

  test('keeps nothing that says who sent it, even from someone in a room', async () => {
    server = await startServer({ trustProxy: true });
    // A guest in the room, whom the room calls by a number: nothing of the room goes with the
    // feedback, the guest's name there included. One sent from an account is linked to it, by
    // design (above).
    const { chair, code, roomId } = await createRoom(server.url);
    clients.push(chair);
    expect(chair.state?.players.map(({ name }) => name)).toEqual(['Guest 1']);
    expect(await chair.send('meta:feedback', message({ kind: 'bug', page: 'room' }))).toEqual({ ok: true });
    const kept = JSON.stringify(server.feedback.latest(10));
    for (const secret of [code, roomId, chair.token, chair.me, 'Guest 1', '127.0.0.1']) {
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
    for (const kind of ['idea', 'game', 'words']) {
      expect(await client.send('meta:feedback', message({ kind }))).toEqual({ ok: true });
    }
    expect(server.feedback.latest(10).map(({ userAgent }) => userAgent)).toEqual([null, null, null]);
  });

  test('suggesting a new game is kept with its name, as any other', async () => {
    server = await startServer({ socketLimits: { ...DEFAULT_SOCKET_LIMITS, feedbackPerWindow: 10 } });
    const client = await connect();
    const game = message({
      kind: 'game',
      text: 'A game where the reviewers bid on papers.',
      credit: 'Ann',
    });
    expect(await client.send('meta:feedback', game)).toEqual({ ok: true });
    // A page from before the new game, which sends the kinds it knows and asks nothing more.
    for (const kind of ['idea', 'bug', 'words']) {
      expect(await client.send('meta:feedback', message({ kind, text: `Old ${kind}` }))).toEqual({ ok: true });
    }
    expect(server.feedback.latest(10).map(({ kind, credit }) => [kind, credit])).toEqual([
      ['words', null],
      ['bug', null],
      ['idea', null],
      ['game', 'Ann'],
    ]);
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
      message({ kind: 'GAME' }),
      message({ kind: '' }),
      message({ kind: null }),
      message({ language: 'fr' }),
      message({ page: 'lobby' }),
      message({ text: 42 }),
      message({ contact: ['me'] }),
      message({ credit: 7 }),
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

    // Another address, or another kind, contact or name, is other feedback.
    const other = await connect({ 'x-forwarded-for': '198.51.100.7' });
    expect(await other.send('meta:feedback', sent)).toEqual({ ok: true });
    expect(await other.send('meta:feedback', { ...sent, kind: 'idea' })).toEqual({ ok: true });
    expect(await other.send('meta:feedback', { ...sent, contact: 'other@example.com' })).toEqual({ ok: true });
    const third = await connect({ 'x-forwarded-for': '198.51.100.8' });
    expect(await third.send('meta:feedback', sent)).toEqual({ ok: true });
    expect(await third.send('meta:feedback', { ...sent, credit: 'Ann L' })).toEqual({ ok: true });
    expect(server.feedback.count()).toBe(8);

    // After the window, the same feedback is new again.
    server.advance(DEFAULT_SOCKET_LIMITS.feedbackWindowMs);
    server.app.sockets.sweep();
    expect(await client.send('meta:feedback', sent)).toEqual({ ok: true });
    expect(server.feedback.count()).toBe(9);
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
