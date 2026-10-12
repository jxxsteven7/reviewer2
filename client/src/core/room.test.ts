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

import { closeRoom, closeRoomPage, entry, leaveRoom, openRoom, room, submitName } from './room';

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
  public: false,
  customWordCount: 0,
  phase: 'lobby',
  round: 0,
  gameId: null,
  chairId: 'ann',
  players: [{ id: 'ann', name: 'Ann', online: true }],
  screens: 0,
  me,
  match: null,
  data: {},
});

beforeEach(() => {
  mock.send.mockReset();
  mock.reconnect.mockReset();
  mock.socket.connected = true;
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

  test('keeps a newcomer on the name form when the server refuses the name', async () => {
    mock.send.mockResolvedValueOnce(fail('name_required', { language: 'zh' }));
    openRoom('K7QX');
    await flushPromises();
    expect(entry.status).toBe('needs_name');
    expect(entry.language).toBe('zh');

    mock.send.mockResolvedValueOnce(fail('name_taken'));
    const reply = await submitName('Ann', true);
    expect(reply).toEqual(fail('name_taken'));
    expect(mock.send).toHaveBeenLastCalledWith('room:join', { code: 'K7QX', name: 'Ann', play: true });
    mock.send.mockResolvedValueOnce(fail('name_taken'));
    await submitName('Ann', false);
    expect(mock.send).toHaveBeenLastCalledWith('room:join', { code: 'K7QX', name: 'Ann', play: false });
    expect(entry.status).toBe('needs_name');
  });

  test('takes a newcomer off the name form when the room has come to take accounts only', async () => {
    mock.send.mockResolvedValueOnce(fail('name_required', { language: 'en' }));
    openRoom('K7QX');
    await flushPromises();
    expect(entry.status).toBe('needs_name');
    // The chair listed the room meanwhile: the notice shows the way to log in and come back.
    mock.send.mockResolvedValueOnce(fail('account_required'));
    await submitName('Ann', true);
    expect(entry.status).toBe('failed');
    expect(entry.error).toBe('account_required');
  });

  test('joins with an invitation in place of the code, once, and leaves for the notice when it has lapsed', async () => {
    mock.send.mockResolvedValueOnce(fail('name_required', { language: 'en' }));
    openRoom('K7QX', { invitation: 'inv-1' });
    await flushPromises();
    expect(mock.send).toHaveBeenLastCalledWith('room:join', { code: 'K7QX', invitation: 'inv-1' });
    // The newcomer's choice goes with the invitation too, until the page is in, which the snapshot
    // says even when the answer is lost on the way.
    mock.send.mockImplementationOnce(async () => {
      emit('room:state', view('K7QX', 'room-a', 'ann'));
      return fail('timeout');
    });
    await submitName(undefined, true);
    expect(mock.send).toHaveBeenLastCalledWith('room:join', { code: 'K7QX', invitation: 'inv-1', play: true });
    expect(entry.status).toBe('in');
    // After a reconnect the page is a member, and asks by the code and the room's ID alone.
    mock.send.mockResolvedValueOnce(ok('K7QX', 'room-a'));
    emit('connect');
    await flushPromises();
    expect(mock.send).toHaveBeenLastCalledWith('room:join', { code: 'K7QX', roomId: 'room-a' });

    // An invitation that lapsed while the newcomer was on the name form.
    closeRoomPage();
    mock.send.mockResolvedValueOnce(fail('name_required', { language: 'en' }));
    openRoom('K7QX', { invitation: 'inv-2' });
    await flushPromises();
    mock.send.mockResolvedValueOnce(fail('invitation_expired'));
    await submitName(undefined, true);
    expect(entry.status).toBe('failed');
    expect(entry.error).toBe('invitation_expired');
  });

  test('ignores the snapshots and the closing of a room the page has left', async () => {
    // The connection is still in room B, which keeps sending snapshots, while the page wants A.
    mock.send.mockResolvedValueOnce(fail('name_required', { language: 'en' }));
    openRoom('AAAA');
    await flushPromises();
    emit('room:state', view('BBBB', 'room-b', 'ann'));
    expect(entry.status).toBe('needs_name');
    expect(room.value).toBeNull();
    emit('room:closed', { reason: 'removed' });
    expect(entry.status).toBe('needs_name');

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
    mock.send.mockResolvedValueOnce(fail('name_required', { language: 'en' }));
    openRoom('BBBB');
    await flushPromises();
    expect(entry.status).toBe('needs_name');

    answer(fail('room_not_found'));
    await flushPromises();
    expect(entry.status).toBe('needs_name');
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
    mock.send.mockResolvedValue(fail('name_required', { language: 'en' }));
    openRoom('K7QX');
    expect(room.value).toBeNull();
    expect(entry.status).toBe('joining');
    await flushPromises();
    expect(entry.status).toBe('needs_name');
  });

  test('makes a fresh connection when the server does not answer', async () => {
    mock.send.mockResolvedValueOnce(fail('timeout'));
    openRoom('K7QX');
    await flushPromises();
    expect(mock.reconnect).toHaveBeenCalledOnce();
    expect(entry.status).toBe('joining');
  });
});
