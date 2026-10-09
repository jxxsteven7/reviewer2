import { ACCOUNT_API } from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { account, loadAccount, logIn, request } from './account';

vi.mock('./socket', () => ({
  connection: { connected: false, everConnected: false },
  reconnect: vi.fn(),
  socket: { on: vi.fn() },
}));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
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
  });
});
