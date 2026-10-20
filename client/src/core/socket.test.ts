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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fake.toastError.mockClear();
  fake.socket.connect.mockClear();
});

test('a busy server turning the page away is said once, answers every message, and is tried again', async () => {
  fake.socket.fire('connect_error', new Error('server_busy'));
  fake.socket.fire('connect_error', new Error('server_busy'));
  expect(fake.toastError).toHaveBeenCalledExactlyOnceWith('server_busy');
  expect(connection.busy).toBe(true);
  expect(await send('meta:rooms')).toEqual({ ok: false, error: 'server_busy' });

  // Socket.IO doesn't try again after a refusal, so the page does, in a while.
  vi.advanceTimersByTime(BUSY_RETRY_MS - 1);
  expect(fake.socket.connect).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(fake.socket.connect).toHaveBeenCalledOnce();

  fake.socket.connected = true;
  fake.socket.fire('connect');
  expect(connection.busy).toBe(false);
  // Nothing is tried again once the page is in.
  vi.advanceTimersByTime(2 * BUSY_RETRY_MS);
  expect(fake.socket.connect).toHaveBeenCalledOnce();

  // Turned away once more later, after a break, the page says so again.
  fake.socket.connected = false;
  fake.socket.fire('disconnect');
  fake.socket.fire('connect_error', new Error('server_busy'));
  expect(fake.toastError).toHaveBeenCalledTimes(2);
});

test('any other failed connection is left to Socket.IO, and the page is offline', async () => {
  fake.socket.connected = false;
  // Even after a busy server turned the page away: the server may have gone since.
  fake.socket.fire('connect_error', new Error('server_busy'));
  fake.toastError.mockClear();
  fake.socket.fire('connect_error', new Error('xhr poll error'));
  expect(fake.toastError).not.toHaveBeenCalled();
  expect(connection.busy).toBe(false);
  expect(await send('meta:rooms')).toEqual({ ok: false, error: 'offline' });
  vi.advanceTimersByTime(2 * BUSY_RETRY_MS);
  expect(fake.socket.connect).not.toHaveBeenCalled();
});
