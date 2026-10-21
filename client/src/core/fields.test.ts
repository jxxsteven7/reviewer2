// @vitest-environment happy-dom
import type { Ack, FieldInfo } from '@reviewer2/shared';
import { flushPromises } from '@vue/test-utils';
import { afterEach, expect, test, vi } from 'vitest';

// The socket module, with its wait for a connection as the real one has it (onceConnected).
const mock = vi.hoisted(() => {
  const connect = vi.fn();
  const socket = { connected: false, once: vi.fn<(event: string, handler: () => void) => void>() };
  return {
    send: vi.fn<(event: string) => Promise<Ack<{ fields: FieldInfo[] }>>>(),
    connect,
    socket,
    onceConnected(run: () => void) {
      if (socket.connected) run();
      else {
        socket.once('connect', run);
        connect();
      }
      return () => {};
    },
  };
});
vi.mock('./socket', () => mock);

import { fields, loadFields } from './fields';

const general: FieldInfo = { id: 'general', name: { zh: 'G', en: 'General' }, counts: { zh: 30, en: 30 }, pairs: 0 };

afterEach(() => vi.useRealTimers());

test('asks once the connection is there, asks again when no answer comes, and keeps the answer', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });

  // Offline: wait for the connection.
  loadFields();
  loadFields(); // on its way already
  expect(mock.connect).toHaveBeenCalledOnce();
  expect(mock.send).not.toHaveBeenCalled();
  const [event, onConnect] = mock.socket.once.mock.calls[0] ?? [];
  expect(event).toBe('connect');
  if (!onConnect) throw new Error('nothing waits for the connection');

  // Connected, but the first answer doesn't come.
  mock.socket.connected = true;
  mock.send.mockResolvedValueOnce({ ok: false, error: 'timeout' });
  mock.send.mockResolvedValueOnce({ ok: true, fields: [general] });
  onConnect();
  await flushPromises();
  expect(mock.send).toHaveBeenCalledWith('meta:fields');
  expect(fields.value).toBeNull();

  await vi.advanceTimersByTimeAsync(3000);
  expect(mock.send).toHaveBeenCalledTimes(2);
  expect(fields.value).toEqual([general]);

  loadFields();
  expect(mock.send).toHaveBeenCalledTimes(2);
});
