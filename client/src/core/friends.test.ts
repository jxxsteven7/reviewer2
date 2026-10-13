import type { InvitationView } from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The connection, as the invitations see it: the handlers it registers, and what the page sends.
const mock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    handlers,
    socket: { on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler) },
    send: vi.fn(() => Promise.resolve({ ok: true } as object)),
    whenConnected: vi.fn(() => Promise.resolve(true)),
  };
});
vi.mock('./socket', () => mock);

import { ignore, invitations, requestFriend } from './friends';
import { toasts } from './toast';

// What the server says.
const hear = (event: string, ...args: unknown[]) => mock.handlers.get(event)?.(...args);
const invitation = (id: string, expiresInMs = 600_000): InvitationView => ({
  id,
  code: 'ABCD',
  roomId: `room-${id}`,
  from: { username: 'Ann', avatar: null },
  expiresInMs,
});
const shown = () => invitations.map(({ id }) => id);

beforeEach(() => {
  vi.useFakeTimers();
  mock.send.mockClear();
});

afterEach(() => {
  hear('connect');
  vi.useRealTimers();
});

describe('the invitations on the page', () => {
  test('show as they come, the same one once, and go when they lapse', () => {
    hear('friends:invited', invitation('a', 1000));
    hear('friends:invited', invitation('b'));
    hear('friends:invited', invitation('a', 1000));
    expect(shown()).toEqual(['b', 'a']);
    vi.advanceTimersByTime(1000);
    expect(shown()).toEqual(['b']);
  });

  test('go when the server says one ended, and when the player ignores one here, which the server hears', () => {
    hear('friends:invited', invitation('a'));
    hear('friends:invited', invitation('b'));
    hear('friends:uninvited', { id: 'a' });
    expect(shown()).toEqual(['b']);
    ignore('b');
    expect(shown()).toEqual([]);
    expect(mock.send).toHaveBeenCalledWith('friends:ignore', { id: 'b' });
    // One that isn't shown is nothing to the page.
    hear('friends:uninvited', { id: 'a' });
    expect(shown()).toEqual([]);
  });

  test('show five at most, the oldest going first, and all go with a new connection', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) hear('friends:invited', invitation(id));
    expect(shown()).toEqual(['b', 'c', 'd', 'e', 'f']);
    hear('connect');
    expect(shown()).toEqual([]);
  });
});

describe('a request to be friends', () => {
  test('goes over a connection, and the player hears how it went', async () => {
    const heard = () => toasts.at(-1)?.key;
    mock.send.mockResolvedValueOnce({ ok: true, status: 'pending' });
    expect(await requestFriend({ username: 'Bob' })).toBe(true);
    expect(mock.send).toHaveBeenCalledWith('friends:request', { username: 'Bob' });
    expect(heard()).toBe('friends.requestSent');
    mock.send.mockResolvedValueOnce({ ok: true, status: 'accepted' });
    expect(await requestFriend({ playerId: 'p1' })).toBe(true);
    expect(mock.send).toHaveBeenCalledWith('friends:request', { playerId: 'p1' });
    expect(heard()).toBe('friends.nowFriends');
    mock.send.mockResolvedValueOnce({ ok: false, error: 'request_pending' });
    expect(await requestFriend({ username: 'Bob' })).toBe(false);
    expect(heard()).toBe('errors.request_pending');
    // Without a connection within the wait, nothing is sent.
    mock.whenConnected.mockResolvedValueOnce(false);
    expect(await requestFriend({ username: 'Cy' })).toBe(false);
    expect(mock.send).not.toHaveBeenCalledWith('friends:request', { username: 'Cy' });
    expect(heard()).toBe('errors.offline');
  });
});
