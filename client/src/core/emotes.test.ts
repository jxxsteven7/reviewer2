// @vitest-environment happy-dom
import type { Ack, RoomView } from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { nextTick } from 'vue';

const mock = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    handlers,
    socket: { on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler) },
    act: vi.fn<(event: string, payload?: object) => Promise<Ack>>(async () => ({ ok: true })),
    playSound: vi.fn(),
  };
});
vi.mock('./socket', () => ({ socket: mock.socket, act: mock.act }));
vi.mock('./sound', () => ({ playSound: mock.playSound }));
vi.mock('./room', async () => ({ room: (await import('vue')).shallowRef(null) }));

import { bubbles, callOut, readyAt, sendEmote } from './emotes';
import { room } from './room';

const emit = (payload: object) => mock.handlers.get('room:emote')?.(payload);
const shown = {
  roomId: 'room-a',
  players: [
    { id: 'ann', name: 'Ann', online: true },
    { id: 'bob', name: 'Bob', online: true },
  ],
} as RoomView;

beforeEach(() => {
  vi.useFakeTimers();
  bubbles.splice(0);
  mock.playSound.mockReset();
  room.value = shown;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('quick reactions', () => {
  test('show and sound for the room on the page, with the sender by name', () => {
    emit({ roomId: 'room-a', playerId: 'bob', emote: 'reviewer2' });
    expect(bubbles).toEqual([{ id: expect.any(Number), name: 'Bob', emote: 'reviewer2' }]);
    expect(mock.playSound).toHaveBeenCalledWith('reviewer2');
  });

  test("of another room, of someone the page doesn't know, or of a kind it doesn't know, do nothing", () => {
    emit({ roomId: 'room-b', playerId: 'bob', emote: 'waiting' });
    emit({ roomId: 'room-a', playerId: 'zed', emote: 'waiting' });
    emit({ roomId: 'room-a', playerId: 'bob', emote: 'applause' });
    room.value = null;
    emit({ roomId: 'room-a', playerId: 'bob', emote: 'waiting' });
    expect(bubbles).toEqual([]);
    expect(mock.playSound).not.toHaveBeenCalled();
  });

  test('stay for four seconds, three at most', () => {
    for (const emote of ['waiting', 'deadline', 'reviewer2', 'waiting']) {
      emit({ roomId: 'room-a', playerId: 'ann', emote });
      vi.advanceTimersByTime(1000);
    }
    expect(bubbles.map((bubble) => ('emote' in bubble ? bubble.emote : null))).toEqual([
      'deadline',
      'reviewer2',
      'waiting',
    ]);
    vi.advanceTimersByTime(1000);
    expect(bubbles.map((bubble) => ('emote' in bubble ? bubble.emote : null))).toEqual(['reviewer2', 'waiting']);
    vi.advanceTimersByTime(2000);
    expect(bubbles).toEqual([]);
  });

  test("carry the room's calls about a player, louder and longer, with the reaction's sound", () => {
    callOut({ name: 'Ann', avatar: '/avatars/a.webp' }, 'Ann missed the deadline (\u00d72)', 'deadline');
    expect(bubbles).toEqual([
      { id: expect.any(Number), name: 'Ann', avatar: '/avatars/a.webp', call: 'Ann missed the deadline (\u00d72)' },
    ]);
    expect(mock.playSound).toHaveBeenCalledWith('deadline');
    vi.advanceTimersByTime(5000);
    expect(bubbles).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(bubbles).toEqual([]);
  });

  test('keep a call while the reactions to it crowd in, until nothing but calls is left', () => {
    callOut({ name: 'Ann' }, 'Ann missed the deadline', 'deadline');
    for (const emote of ['deadline', 'waiting', 'reviewer2']) emit({ roomId: 'room-a', playerId: 'bob', emote });
    expect(bubbles.map((bubble) => ('call' in bubble ? bubble.call : bubble.emote))).toEqual([
      'Ann missed the deadline',
      'waiting',
      'reviewer2',
    ]);
    callOut({ name: 'Bob' }, 'Bob missed the deadline', 'deadline');
    callOut({ name: 'Cat' }, 'Cat missed the deadline', 'deadline');
    callOut({ name: 'Dan' }, 'Dan missed the deadline', 'deadline');
    expect(bubbles.map((bubble) => ('call' in bubble ? bubble.call : bubble.emote))).toEqual([
      'Bob missed the deadline',
      'Cat missed the deadline',
      'Dan missed the deadline',
    ]);
  });

  test('wait ten seconds after one has gone, or as long as the server says, unless it never got there', async () => {
    const start = Date.now();
    await sendEmote('deadline');
    expect(mock.act).toHaveBeenLastCalledWith('room:emote', { emote: 'deadline' });
    expect(readyAt.value).toBe(start + 10_000);
    // Another tab sent one eight seconds ago.
    mock.act.mockResolvedValueOnce({ ok: false, error: 'emote_cooldown', waitMs: 2000 });
    await sendEmote('deadline');
    expect(readyAt.value).toBe(start + 2000);
    mock.act.mockResolvedValueOnce({ ok: false, error: 'emote_cooldown' });
    await sendEmote('deadline');
    expect(readyAt.value).toBe(start + 10_000);
    mock.act.mockResolvedValueOnce({ ok: false, error: 'offline' });
    await sendEmote('deadline');
    expect(readyAt.value).toBe(0);
  });

  test('stay behind, with the wait, when the page shows another room or none', async () => {
    emit({ roomId: 'room-a', playerId: 'ann', emote: 'waiting' });
    await sendEmote('deadline');
    expect(bubbles).toHaveLength(1);
    expect(readyAt.value).toBeGreaterThan(0);
    room.value = { ...shown, roomId: 'room-b' };
    await nextTick();
    expect(bubbles).toEqual([]);
    expect(readyAt.value).toBe(0);

    emit({ roomId: 'room-b', playerId: 'ann', emote: 'waiting' });
    expect(bubbles).toHaveLength(1);
    room.value = null;
    await nextTick();
    expect(bubbles).toEqual([]);
  });
});
