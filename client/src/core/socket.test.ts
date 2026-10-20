// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// Socket.IO's client, as a socket that the test makes connect, or refuse, by hand.
const fake = vi.hoisted(() => {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const socket = {
    connected: false,
    active: false,
    sendBuffer: [] as unknown[],
    connect: vi.fn(),
    disconnect: vi.fn(),
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return socket;
    },
    fire(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
  };
  return { socket, toastError: vi.fn() };
});
vi.mock('socket.io-client', () => ({ io: () => fake.socket }));
vi.mock('./toast', () => ({ toastError: fake.toastError }));

import { BUSY_RETRY_MS, connection, send } from './socket';

// Engine.IO's refusal of a connection, as the client reports it: the HTTP status is the description.
const refusedWith = (status: number) => Object.assign(new Error('xhr poll error'), { description: status });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fake.toastError.mockClear();
  fake.socket.connect.mockClear();
  fake.socket.disconnect.mockClear();
});

test('a busy server turning the page away is said once, answers every message, and is tried again', async () => {
  fake.socket.fire('connect_error', new Error('server_busy'));
  fake.socket.fire('connect_error', new Error('server_busy'));
  expect(fake.toastError).toHaveBeenCalledExactlyOnceWith('server_busy');
  expect(connection.refusal).toBe('server_busy');
  expect(await send('meta:rooms')).toEqual({ ok: false, error: 'server_busy' });

  // Socket.IO doesn't try again after a refusal, so the page does, in a while.
  vi.advanceTimersByTime(BUSY_RETRY_MS - 1);
  expect(fake.socket.connect).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(fake.socket.connect).toHaveBeenCalledOnce();
  expect(fake.socket.disconnect).not.toHaveBeenCalled();

  fake.socket.connected = true;
  fake.socket.fire('connect');
  expect(connection.refusal).toBeNull();
  // Nothing is tried again once the page is in.
  vi.advanceTimersByTime(2 * BUSY_RETRY_MS);
  expect(fake.socket.connect).toHaveBeenCalledOnce();

  // Turned away once more later, after a break, the page says so again.
  fake.socket.connected = false;
  fake.socket.fire('disconnect');
  fake.socket.fire('connect_error', new Error('server_busy'));
  expect(fake.toastError).toHaveBeenCalledTimes(2);
});

test('an address with too many connections open is known by the 403, said once, and tried again later', async () => {
  fake.socket.connected = false;
  fake.socket.fire('connect_error', refusedWith(403));
  fake.socket.fire('connect_error', refusedWith(403));
  expect(fake.toastError).toHaveBeenCalledExactlyOnceWith('too_many_connections');
  expect(connection.refusal).toBe('too_many_connections');
  expect(await send('meta:rooms')).toEqual({ ok: false, error: 'too_many_connections' });
  // Socket.IO would try again every few seconds, which would only count against the address again.
  expect(fake.socket.disconnect).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(BUSY_RETRY_MS - 1);
  expect(fake.socket.connect).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(fake.socket.connect).toHaveBeenCalledOnce();

  // One refusal after the other is said each time it changes.
  fake.socket.fire('connect_error', new Error('server_busy'));
  expect(fake.toastError).toHaveBeenLastCalledWith('server_busy');
  expect(fake.toastError).toHaveBeenCalledTimes(2);
  fake.socket.connected = true;
  fake.socket.fire('connect');
  expect(connection.refusal).toBeNull();
});

test('any other failed connection is left to Socket.IO, and the page is offline', async () => {
  fake.socket.connected = false;
  // Even after the server turned the page away: the server may have gone since.
  fake.socket.fire('connect_error', new Error('server_busy'));
  fake.toastError.mockClear();
  fake.socket.fire('connect_error', new Error('xhr poll error'));
  fake.socket.fire('connect_error', refusedWith(400));
  expect(fake.toastError).not.toHaveBeenCalled();
  expect(fake.socket.disconnect).not.toHaveBeenCalled();
  expect(connection.refusal).toBeNull();
  expect(await send('meta:rooms')).toEqual({ ok: false, error: 'offline' });
  vi.advanceTimersByTime(2 * BUSY_RETRY_MS);
  expect(fake.socket.connect).not.toHaveBeenCalled();
});
