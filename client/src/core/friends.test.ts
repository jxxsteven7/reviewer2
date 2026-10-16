import type { FriendsView, InvitationView, JoinAskView } from '@reviewer2/shared';
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

import {
  answerFriend,
  askToJoin,
  asks,
  dismissAsk,
  friendsVersion,
  ignore,
  invitations,
  listFriends,
  requestFriend,
  standingOf,
} from './friends';
import { aliasOf, knowAliases } from './names';
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

describe('an answer to someone else', () => {
  test('goes over a connection, and the player hears of a friendship and of a refusal', async () => {
    const heard = () => toasts.at(-1)?.key;
    const before = toasts.length;
    mock.send.mockResolvedValueOnce({ ok: true });
    expect(await answerFriend('Bob', 'decline')).toBe(true);
    expect(mock.send).toHaveBeenCalledWith('friends:decline', { username: 'Bob' });
    expect(toasts.length).toBe(before);
    mock.send.mockResolvedValueOnce({ ok: true });
    expect(await answerFriend('Bob', 'accept')).toBe(true);
    expect(mock.send).toHaveBeenCalledWith('friends:accept', { username: 'Bob' });
    expect(heard()).toBe('friends.nowFriends');
    // A refusal is told, and every list on the page is asked for again.
    const version = friendsVersion.value;
    mock.send.mockResolvedValueOnce({ ok: false, error: 'not_friends' });
    expect(await answerFriend('Bob', 'remove')).toBe(false);
    expect(mock.send).toHaveBeenCalledWith('friends:remove', { username: 'Bob' });
    expect(heard()).toBe('errors.not_friends');
    expect(friendsVersion.value).toBe(version + 1);
    mock.whenConnected.mockResolvedValueOnce(false);
    mock.send.mockClear();
    expect(await answerFriend('Bob', 'accept')).toBe(false);
    expect(mock.send).not.toHaveBeenCalled();
    expect(heard()).toBe('errors.offline');
  });
});

// The names that the account gives its friends, which the page shows wherever it names them
// (names.ts): read with the friends list as an account's connection is made and whenever the
// friends change, and gone with a guest's.
describe("the names of the account's friends", () => {
  const listed = (alias: string) => ({
    ok: true,
    friends: [{ handle: 'b0b000000000', username: 'Bob', alias, avatar: null, online: true, room: null, duo: null }],
    incoming: [],
    outgoing: [],
  });

  afterEach(() => knowAliases([]));

  test("are read as an account's connection is made, again when the friends change, and go with a guest's", async () => {
    mock.send.mockResolvedValueOnce(listed('Bobby'));
    hear('session', { version: '1', account: { username: 'Ann', avatar: null } });
    await vi.runAllTimersAsync();
    expect(mock.send).toHaveBeenCalledWith('friends:list');
    expect(aliasOf('b0b000000000')).toBe('Bobby');

    mock.send.mockResolvedValueOnce(listed('Prof. B'));
    hear('friends:changed');
    await vi.runAllTimersAsync();
    expect(aliasOf('b0b000000000')).toBe('Prof. B');

    mock.send.mockClear();
    hear('session', { version: '1', account: null });
    hear('friends:changed');
    await vi.runAllTimersAsync();
    expect(aliasOf('b0b000000000')).toBeNull();
    expect(mock.send).not.toHaveBeenCalledWith('friends:list');
  });

  test('go at once with a connection made as someone else, and stay through one made as the same account', async () => {
    mock.send.mockResolvedValueOnce(listed('Bobby'));
    hear('session', { version: '1', account: { username: 'Ann', avatar: null } });
    await vi.runAllTimersAsync();
    expect(aliasOf('b0b000000000')).toBe('Bobby');
    // The same account's connection, made again, keeps the names while its list is on its way,
    // and when the list doesn't come.
    hear('disconnect');
    mock.send.mockResolvedValueOnce({ ok: false, error: 'timeout' });
    hear('session', { version: '1', account: { username: 'Ann', avatar: null } });
    expect(aliasOf('b0b000000000')).toBe('Bobby');
    await vi.runAllTimersAsync();
    expect(aliasOf('b0b000000000')).toBe('Bobby');
    // Another account's, as after a login in another tab, drops them before its own list has come,
    // and an answer to the first account's question is nothing to it.
    hear('disconnect');
    let answerLate: (reply: object) => void = () => {};
    mock.send.mockImplementationOnce(() => new Promise((resolve) => (answerLate = resolve)));
    hear('session', { version: '1', account: { username: 'Ann', avatar: null } });
    hear('disconnect');
    mock.send.mockResolvedValueOnce(listed('Prof. B'));
    hear('session', { version: '1', account: { username: 'Cat', avatar: null } });
    expect(aliasOf('b0b000000000')).toBeNull();
    answerLate(listed('Bobby'));
    await vi.runAllTimersAsync();
    expect(aliasOf('b0b000000000')).toBe('Prof. B');
  });

  test('come with the list that the parts of the page ask for, asked once for all of them', async () => {
    let answer: (reply: object) => void = () => {};
    mock.send.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const [first, second] = [listFriends(), listFriends()];
    hear('session', { version: '1', account: { username: 'Ann', avatar: null } });
    expect(mock.send).toHaveBeenCalledTimes(1);
    answer(listed('Bobby'));
    expect(await first).toEqual(listed('Bobby'));
    expect(await second).toEqual(listed('Bobby'));
    await vi.runAllTimersAsync();
    expect(aliasOf('b0b000000000')).toBe('Bobby');
    // Once answered, the next question goes out; so does one over a new connection, whatever the
    // old one still owes.
    mock.send.mockResolvedValueOnce(listed('Prof. B'));
    await listFriends();
    expect(mock.send).toHaveBeenCalledTimes(2);
    mock.send.mockImplementationOnce(() => new Promise(() => {}));
    void listFriends();
    hear('disconnect');
    mock.send.mockResolvedValueOnce(listed('Prof. B'));
    expect(await listFriends()).toEqual(listed('Prof. B'));
    expect(mock.send).toHaveBeenCalledTimes(4);
  });

  test("keep what they were when a list can't be had, and take only the latest answer", async () => {
    knowAliases([{ handle: 'b0b000000000', alias: 'Bobby' }]);
    mock.send.mockResolvedValueOnce({ ok: false, error: 'offline' });
    hear('session', { version: '1', account: { username: 'Ann', avatar: null } });
    await vi.runAllTimersAsync();
    expect(aliasOf('b0b000000000')).toBe('Bobby');

    let answerLate: (reply: object) => void = () => {};
    mock.send.mockImplementationOnce(() => new Promise((resolve) => (answerLate = resolve)));
    hear('friends:changed');
    hear('disconnect');
    mock.send.mockResolvedValueOnce(listed('Prof. B'));
    hear('friends:changed');
    await vi.runAllTimersAsync();
    answerLate(listed('Old'));
    await vi.runAllTimersAsync();
    expect(aliasOf('b0b000000000')).toBe('Prof. B');
  });
});

describe('how the account stands with someone', () => {
  test("is read from the account's own list by the other's handle", () => {
    const other = (handle: string) => ({ handle, username: handle, avatar: null });
    const friend = { ...other('f00000000000'), online: false, room: null, duo: null };
    const view: FriendsView = {
      friends: [friend],
      incoming: [{ ...other('1a0000000000'), note: 'Hi' }],
      outgoing: [other('0a0000000000')],
    };
    expect(standingOf('5e1f00000000', '5e1f00000000', view)).toEqual({ kind: 'self' });
    expect(standingOf('f00000000000', '5e1f00000000', view)).toEqual({ kind: 'friend', friend });
    expect(standingOf('1a0000000000', '5e1f00000000', view)).toEqual({
      kind: 'incoming',
      request: { ...other('1a0000000000'), note: 'Hi' },
    });
    expect(standingOf('0a0000000000', '5e1f00000000', view)).toEqual({ kind: 'outgoing' });
    expect(standingOf('5a0000000000', '5e1f00000000', view)).toEqual({ kind: 'stranger' });
    // Without the list, anyone else is a stranger, whom the server judges anyway.
    expect(standingOf('f00000000000', null, null)).toEqual({ kind: 'stranger' });
  });
});

describe('the requests to be let into the room', () => {
  const ask = (id: string, expiresInMs = 600_000): JoinAskView => ({
    id,
    roomId: 'room-1',
    from: { username: 'Bob', avatar: null },
    expiresInMs,
  });
  const asked = () => asks.map(({ id }) => id);

  test('show as they come, the same one once, and go when they lapse, end, are ignored or a new connection comes', () => {
    hear('friends:asked', ask('a', 1000));
    hear('friends:asked', ask('b'));
    hear('friends:asked', ask('a', 1000));
    hear('friends:asked', ask('c'));
    expect(asked()).toEqual(['b', 'a', 'c']);
    vi.advanceTimersByTime(1000);
    expect(asked()).toEqual(['b', 'c']);
    hear('friends:unasked', { id: 'b' });
    dismissAsk('c');
    expect(asked()).toEqual([]);
    expect(mock.send).toHaveBeenCalledWith('friends:dismiss', { id: 'c' });
    hear('friends:asked', ask('d'));
    hear('friends:invited', invitation('e'));
    hear('connect');
    expect(asked()).toEqual([]);
    expect(shown()).toEqual([]);
  });

  test('go out over a connection, and the player hears how it went', async () => {
    const heard = () => toasts.at(-1)?.key;
    expect(await askToJoin('Ann')).toBe(true);
    expect(mock.send).toHaveBeenCalledWith('friends:ask', { username: 'Ann' });
    expect(heard()).toBe('friends.askSent');
    mock.send.mockResolvedValueOnce({ ok: false, error: 'join_ask_pending' });
    expect(await askToJoin('Ann')).toBe(false);
    expect(heard()).toBe('errors.join_ask_pending');
  });
});
