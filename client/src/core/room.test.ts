// @vitest-environment happy-dom
import type { Ack, RoomView } from '@reviewer2/shared';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// The connection, as room.ts sees it: the handlers it registers, and what the server answers.
const mock = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    handlers,
    socket: {
      connected: true,
      on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
    },
    send: vi.fn<(event: string, payload?: object) => Promise<Ack>>(),
    connect: vi.fn(),
    reconnect: vi.fn(),
    setHandshake: vi.fn(),
  };
});
vi.mock('./socket', () => mock);

import { i18n } from './i18n';
import { knowAliases } from './names';
import { closeRoom, closeRoomPage, entry, leaveRoom, openRoom, room, submitChoice } from './room';
import { clearMemory, readStored } from './storage';

const emit = (event: string, payload?: unknown) => mock.handlers.get(event)?.(payload);
const fail = (error: string, extra: object = {}): Ack => ({ ok: false, error, ...extra });
const ok = (code: string, roomId: string): Ack<{ code: string; roomId: string }> => ({ ok: true, code, roomId });

const view = (code: string, roomId: string, me: string | null, rev = 1): RoomView => ({
  roomId,
  code,
  rev,
  game: 'keywords',
  language: 'en',
  fields: ['general'],
  randomFields: false,
  public: false,
  customWordCount: 0,
  rating: null,
  phase: 'lobby',
  round: 0,
  gameId: null,
  chairId: 'ann',
  players: [{ id: 'ann', name: 'Ann', online: true }],
  agents: false,
  agentsOnline: false,
  screens: 0,
  me,
  match: null,
  streaks: [],
  duos: [],
  agentsPlayed: false,
  points: [],
  data: {},
});

beforeEach(() => {
  mock.send.mockReset();
  mock.reconnect.mockReset();
  mock.setHandshake.mockClear();
  mock.socket.connected = true;
  localStorage.clear();
  clearMemory();
  closeRoomPage();
  emit('disconnect'); // the connection forgets its snapshots
});

describe('the room page', () => {
  test('shows the room once the server has sent it, whatever case the address gives the code in', async () => {
    mock.send.mockImplementation(async () => {
      emit('room:state', view('K7QX', 'room-a', 'ann'));
      return ok('K7QX', 'room-a');
    });
    openRoom('k7qx');
    await flushPromises();
    expect(entry.status).toBe('in');
    expect(room.value?.roomId).toBe('room-a');
    expect(mock.setHandshake).toHaveBeenLastCalledWith({ code: 'K7QX', roomId: 'room-a' });
  });

  test('names a guest by their number, in the table of a match too, in the language of the interface', async () => {
    i18n.global.locale.value = 'en';
    const withGuests = {
      ...view('K7QX', 'room-a', 'ann'),
      players: [
        { id: 'ann', name: 'Ann', online: true },
        { id: 'g3', name: 'Guest 3', guest: 3, online: true },
      ],
      match: {
        id: 'm1',
        rules: { games: 3, options: { teams: 'switch' as const, grouping: 'random' as const } },
        played: 0,
        status: 'on' as const,
        game: 1,
        chairBound: false,
        standings: [
          { playerId: null, name: 'Guest 1', guest: 1, total: 0, delta: null, games: 1, rank: null, left: true },
        ],
      },
    };
    mock.send.mockImplementation(async () => {
      emit('room:state', withGuests);
      return ok('K7QX', 'room-a');
    });
    openRoom('K7QX');
    await flushPromises();
    expect(room.value?.players.map((player) => player.name)).toEqual(['Ann', 'Guest 3']);
    expect(room.value?.match?.standings[0]?.name).toBe('Guest 1');
    i18n.global.locale.value = 'zh';
    await flushPromises();
    expect(room.value?.players.map((player) => player.name)).toEqual(['Ann', '\u6e38\u5ba23']);
    expect(room.value?.match?.standings[0]?.name).toBe('\u6e38\u5ba21');
    i18n.global.locale.value = 'en';
  });

  test('names an AI player by its persona, in the language of the interface', async () => {
    i18n.global.locale.value = 'en';
    const withAi = {
      ...view('K7QX', 'room-a', 'ann'),
      players: [
        { id: 'ann', name: 'Ann', online: true },
        { id: 'ai', name: 'reviewer1', online: true, agent: 'reviewer1' as const },
      ],
    };
    mock.send.mockImplementation(async () => {
      emit('room:state', withAi);
      return ok('K7QX', 'room-a');
    });
    openRoom('K7QX');
    await flushPromises();
    expect(room.value?.players.map((player) => player.name)).toEqual(['Ann', 'Reviewer 1']);
    i18n.global.locale.value = 'zh';
    await flushPromises();
    expect(room.value?.players[1]?.name).toBe('\u4e00\u53f7\u5ba1\u7a3f\u4eba');
    i18n.global.locale.value = 'en';
  });

  // The viewer's own names for their friends (names.ts), in the players and in a match's table,
  // with the username kept beside, which the default avatar is drawn from; never on a big screen,
  // which the whole room sees, and anew as the names change.
  test("names a friend by the viewer's name for them, but not on a big screen", async () => {
    const withFriend = (me: string | null): RoomView => ({
      ...view('K7QX', 'room-a', me),
      players: [
        { id: 'ann', name: 'Ann', online: true, handle: 'a77000000000' },
        { id: 'bob', name: 'Bob', online: true, handle: 'b0b000000000' },
        { id: 'g3', name: 'Guest 3', guest: 3, online: true },
      ],
      match: {
        id: 'm1',
        rules: { games: 3, options: { teams: 'switch' as const, grouping: 'random' as const } },
        played: 0,
        status: 'on' as const,
        game: 1,
        chairBound: false,
        standings: [
          { playerId: 'bob', name: 'Bob', total: 0, delta: null, games: 1, rank: null, left: false },
          { playerId: null, name: 'Bob', total: 0, delta: null, games: 1, rank: null, left: true },
        ],
      },
    });
    knowAliases([{ handle: 'b0b000000000', alias: 'Bobby' }]);
    mock.send.mockImplementation(async () => {
      emit('room:state', withFriend('ann'));
      return ok('K7QX', 'room-a');
    });
    openRoom('K7QX');
    await flushPromises();
    expect(room.value?.players.map((player) => player.name)).toEqual(['Ann', 'Bobby', 'Guest 3']);
    expect(room.value?.players.map((player) => player.username)).toEqual(['Ann', 'Bob', undefined]);
    // Someone who has left the table is known by the name alone.
    expect(room.value?.match?.standings.map((line) => [line.name, line.username])).toEqual([
      ['Bobby', 'Bob'],
      ['Bob', undefined],
    ]);
    // The same names again, as every connection reads them, leave the room as it is.
    const asShown = room.value;
    knowAliases([{ handle: 'b0b000000000', alias: 'Bobby' }]);
    await flushPromises();
    expect(room.value).toBe(asShown);
    knowAliases([{ handle: 'b0b000000000', alias: 'Prof. B' }]);
    await flushPromises();
    expect(room.value?.players[1]?.name).toBe('Prof. B');
    knowAliases([]);
    await flushPromises();
    expect(room.value?.players[1]?.name).toBe('Bob');

    knowAliases([{ handle: 'b0b000000000', alias: 'Bobby' }]);
    closeRoomPage();
    mock.send.mockImplementation(async () => {
      emit('room:state', withFriend(null));
      return ok('K7QX', 'room-a');
    });
    openRoom('K7QX', { screen: true });
    await flushPromises();
    expect(room.value?.players.map((player) => player.name)).toEqual(['Ann', 'Bob', 'Guest 3']);
    expect(room.value?.match?.standings[0]?.name).toBe('Bob');
    knowAliases([]);
  });

  test('keeps a newcomer on the form when the server refuses them, and sends no name', async () => {
    mock.send.mockResolvedValueOnce(fail('play_required', { language: 'zh' }));
    openRoom('K7QX');
    await flushPromises();
    expect(entry.status).toBe('needs_choice');
    expect(entry.language).toBe('zh');

    mock.send.mockResolvedValueOnce(fail('room_full'));
    const reply = await submitChoice(true);
    expect(reply).toEqual(fail('room_full'));
    expect(mock.send).toHaveBeenLastCalledWith('room:join', { code: 'K7QX', play: true });
    mock.send.mockResolvedValueOnce(fail('room_full'));
    await submitChoice(false);
    expect(mock.send).toHaveBeenLastCalledWith('room:join', { code: 'K7QX', play: false });
    expect(entry.status).toBe('needs_choice');
  });

  test('takes a newcomer off the form when the room has come to take accounts only', async () => {
    mock.send.mockResolvedValueOnce(fail('play_required', { language: 'en' }));
    openRoom('K7QX');
    await flushPromises();
    expect(entry.status).toBe('needs_choice');
    // The chair listed the room meanwhile: the notice shows the way to log in and come back.
    mock.send.mockResolvedValueOnce(fail('account_required'));
    await submitChoice(true);
    expect(entry.status).toBe('failed');
    expect(entry.error).toBe('account_required');
  });

  test('joins with an invitation in place of the code, once, and leaves for the notice when it has lapsed', async () => {
    mock.send.mockResolvedValueOnce(fail('play_required', { language: 'en' }));
    openRoom('K7QX', { invitation: 'inv-1' });
    await flushPromises();
    expect(mock.send).toHaveBeenLastCalledWith('room:join', { code: 'K7QX', invitation: 'inv-1' });
    // The newcomer's choice goes with the invitation too, until the page is in, which the snapshot
    // says even when the answer is lost on the way.
    mock.send.mockImplementationOnce(async () => {
      emit('room:state', view('K7QX', 'room-a', 'ann'));
      return fail('timeout');
    });
    await submitChoice(true);
    expect(mock.send).toHaveBeenLastCalledWith('room:join', { code: 'K7QX', invitation: 'inv-1', play: true });
    expect(entry.status).toBe('in');
    // After a reconnect the page is a member, and asks by the code and the room's ID alone.
    mock.send.mockResolvedValueOnce(ok('K7QX', 'room-a'));
    emit('connect');
    await flushPromises();
    expect(mock.send).toHaveBeenLastCalledWith('room:join', { code: 'K7QX', roomId: 'room-a' });

    // An invitation that lapsed while the newcomer was on the form.
    closeRoomPage();
    mock.send.mockResolvedValueOnce(fail('play_required', { language: 'en' }));
    openRoom('K7QX', { invitation: 'inv-2' });
    await flushPromises();
    mock.send.mockResolvedValueOnce(fail('invitation_expired'));
    await submitChoice(true);
    expect(entry.status).toBe('failed');
    expect(entry.error).toBe('invitation_expired');
  });

  test("remembers a screen's room by its ID, which a reloaded screen comes back by, and lets a stale one go", async () => {
    mock.send.mockImplementation(async () => {
      emit('room:state', view('K7QX', 'room-a', null));
      return ok('K7QX', 'room-a');
    });
    openRoom('K7QX', { screen: true });
    await flushPromises();
    expect(entry.status).toBe('in');
    expect(mock.setHandshake).toHaveBeenLastCalledWith({ watch: 'K7QX', roomId: 'room-a' });
    expect(readStored('r2.screen')).toBe('{"code":"K7QX","roomId":"room-a"}');

    // The page is reloaded: its handshake carries the ID it remembered, and it asks by the code
    // alone, as the ID may be a room's that the code has gone from since.
    closeRoomPage();
    emit('disconnect');
    let answer!: (reply: Ack) => void;
    mock.send.mockReturnValueOnce(new Promise<Ack>((resolve) => (answer = resolve)));
    openRoom('K7QX', { screen: true });
    expect(mock.setHandshake).toHaveBeenLastCalledWith({ watch: 'K7QX', roomId: 'room-a' });
    expect(mock.send).toHaveBeenLastCalledWith('room:watch', { code: 'K7QX' });
    // Which it has: the server says so of the handshake, and the page waits on for its answer.
    emit('room:closed', { reason: 'expired' });
    expect(entry.status).toBe('joining');
    expect(mock.setHandshake).toHaveBeenLastCalledWith({ watch: 'K7QX' });
    expect(readStored('r2.screen')).toBeNull();
    emit('room:state', view('K7QX', 'room-b', null));
    answer(ok('K7QX', 'room-b'));
    await flushPromises();
    expect(entry.status).toBe('in');
    expect(room.value?.roomId).toBe('room-b');
    expect(readStored('r2.screen')).toBe('{"code":"K7QX","roomId":"room-b"}');

    // A room that has closed is forgotten, and a player's page remembers nothing.
    emit('room:closed', { reason: 'closed' });
    expect(entry.status).toBe('closed');
    expect(readStored('r2.screen')).toBeNull();
    closeRoomPage();
    mock.send.mockImplementation(async () => {
      emit('room:state', view('K7QX', 'room-b', 'ann'));
      return ok('K7QX', 'room-b');
    });
    openRoom('K7QX');
    await flushPromises();
    expect(readStored('r2.screen')).toBeNull();
  });

  test('ignores the snapshots and the closing of a room the page has left', async () => {
    // The connection is still in room B, which keeps sending snapshots, while the page wants A.
    mock.send.mockResolvedValueOnce(fail('play_required', { language: 'en' }));
    openRoom('AAAA');
    await flushPromises();
    emit('room:state', view('BBBB', 'room-b', 'ann'));
    expect(entry.status).toBe('needs_choice');
    expect(room.value).toBeNull();
    emit('room:closed', { reason: 'removed' });
    expect(entry.status).toBe('needs_choice');

    emit('room:state', view('AAAA', 'room-a', 'ann'));
    expect(entry.status).toBe('in');
    emit('room:closed', { reason: 'expired' });
    expect(entry.status).toBe('closed');
    expect(entry.closed).toBe('expired');
  });

  test('ignores a late answer for a room the page has left', async () => {
    let answer!: (reply: Ack) => void;
    mock.send.mockReturnValueOnce(new Promise<Ack>((resolve) => (answer = resolve)));
    openRoom('AAAA');
    closeRoomPage();
    mock.send.mockResolvedValueOnce(fail('play_required', { language: 'en' }));
    openRoom('BBBB');
    await flushPromises();
    expect(entry.status).toBe('needs_choice');

    answer(fail('room_not_found'));
    await flushPromises();
    expect(entry.status).toBe('needs_choice');
  });

  test('starts from the snapshot the connection has been sent already', () => {
    // The page created the room, so its connection is in it: the server answers the join with
    // no snapshot of its own.
    emit('room:state', view('K7QX', 'room-a', 'ann'));
    mock.send.mockResolvedValueOnce(ok('K7QX', 'room-a'));
    openRoom('K7QX');
    expect(entry.status).toBe('in');
    expect(room.value?.roomId).toBe('room-a');
  });

  test.each([
    ['leaving it', 'room:leave', leaveRoom],
    ['closing it', 'room:close', closeRoom],
  ])('forgets the room after %s', async (_, message, goAway) => {
    mock.send.mockImplementation(async (event) => {
      if (event === message) return { ok: true };
      emit('room:state', view('K7QX', 'room-a', 'ann'));
      return ok('K7QX', 'room-a');
    });
    openRoom('K7QX');
    await flushPromises();
    expect(entry.status).toBe('in');

    expect((await goAway()).ok).toBe(true);
    expect(mock.send).toHaveBeenLastCalledWith(message);
    expect(entry.status).toBe('idle');
    mock.send.mockResolvedValue(fail('play_required', { language: 'en' }));
    openRoom('K7QX');
    expect(room.value).toBeNull();
    expect(entry.status).toBe('joining');
    await flushPromises();
    expect(entry.status).toBe('needs_choice');
  });

  test('makes a fresh connection when the server does not answer', async () => {
    mock.send.mockResolvedValueOnce(fail('timeout'));
    openRoom('K7QX');
    await flushPromises();
    expect(mock.reconnect).toHaveBeenCalledOnce();
    expect(entry.status).toBe('joining');
  });
});
