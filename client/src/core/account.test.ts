import { ACCOUNT_API } from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { account, changeLogin, loadAccount, logIn, request } from './account';
import { connection, reconnect } from './socket';

// What the module listens for on the connection, by event.
const listeners = vi.hoisted(() => new Map<string, (...args: unknown[]) => void>());
vi.mock('./socket', () => ({
  connection: { connected: false, everConnected: false },
  reconnect: vi.fn(),
  socket: { on: (event: string, handler: (...args: unknown[]) => void) => listeners.set(event, handler) },
}));

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.mocked(reconnect).mockClear();
  connection.everConnected = false;
  Object.assign(account, { loaded: false, summary: null, mail: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const summary = { username: 'Ann', avatar: null, email: 'none', titles: [] };

describe('a request to the account API', () => {
  test('sends JSON from the page, with its cookies, and reads the answer', async () => {
    fetchMock.mockResolvedValue(json({ ok: false, error: 'username_taken' }, 409));
    expect(await request(ACCOUNT_API.register, { username: 'Ann', password: 'x' })).toEqual({
      ok: false,
      error: 'username_taken',
    });
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/register');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{"username":"Ann","password":"x"}',
    });
  });

  test('sends a picture as it is, with its type', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, avatar: '/avatars/a.webp' }));
    const picture = new Blob([new Uint8Array(10)], { type: 'image/webp' });
    expect(await request(ACCOUNT_API.avatar, picture)).toEqual({ ok: true, avatar: '/avatars/a.webp' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ 'Content-Type': 'image/webp' });
    expect(init.body).toBe(picture);
  });

  test('that gets no answer, or one that is not JSON, fails with a code of the client', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await request(ACCOUNT_API.account)).toEqual({ ok: false, error: 'offline' });
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(await request(ACCOUNT_API.account)).toEqual({ ok: false, error: 'unknown' });

    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_path, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    const pending = request(ACCOUNT_API.account);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ ok: false, error: 'timeout' });
  });
});

describe('the account', () => {
  test('is what the server says the browser is', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, account: summary, mail: true }));
    await loadAccount();
    expect(account).toEqual({ loaded: true, summary, mail: true });
  });

  test('is logged in only when the browser kept the cookie', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ ok: true, account: summary, mail: false }));
    expect(await logIn(ACCOUNT_API.login, { username: 'Ann', password: 'x' })).toEqual({ ok: true });
    expect(account.summary).toEqual(summary);

    fetchMock
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ ok: true, account: null, mail: false }));
    expect(await logIn(ACCOUNT_API.login, { username: 'Ann', password: 'x' })).toEqual({
      ok: false,
      error: 'cookies_blocked',
    });

    // Only the server can say that the cookie was lost. When the question went unanswered, the
    // login stands as the server granted it.
    Object.assign(account, { loaded: false, summary: null });
    fetchMock.mockResolvedValueOnce(json({ ok: true })).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await logIn(ACCOUNT_API.login, { username: 'Ann', password: 'x' })).toEqual({ ok: true });
    expect(account.summary).toBeNull();
  });

  test('waits for the answer to a request that changes who it is, rather than act on account:ended', async () => {
    const on = Object.fromEntries(listeners);
    connection.everConnected = true;
    let answer!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const changing = changeLogin(ACCOUNT_API.password, { current: 'x', password: 'y' });
    await settled();
    // The server ends the login that the request came with, and closes the connection, before its
    // answer sets the new cookie. The page neither asks who it is nor connects again yet.
    on['account:ended']?.();
    on['disconnect']?.('io server disconnect');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reconnect).not.toHaveBeenCalled();
    // With the answer, it does both.
    fetchMock.mockResolvedValueOnce(json({ ok: true, account: summary, mail: false }));
    answer(json({ ok: true }));
    expect(await changing).toEqual({ reply: { ok: true }, answered: true });
    expect(account.summary).toEqual(summary);
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(ACCOUNT_API.account);

    // Without such a request out, the word is acted on at once.
    fetchMock.mockResolvedValueOnce(json({ ok: true, account: null, mail: false }));
    on['account:ended']?.();
    on['disconnect']?.('io server disconnect');
    expect(reconnect).toHaveBeenCalledTimes(2);
    await settled();
    expect(account.summary).toBeNull();
  });
});
