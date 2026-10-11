// @vitest-environment happy-dom
import type { SeatedRoom } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import BackToRoom from './BackToRoom.vue';

const socket = vi.hoisted(() => {
  type Listener = (payload?: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  return {
    send: vi.fn<(event: string) => Promise<{ ok: true; seats: SeatedRoom[] } | { ok: false; error: string }>>(),
    connect: vi.fn(),
    listeners,
    // What the server sends, to whoever listens for it.
    emit: (event: string, payload?: unknown) => {
      for (const run of [...(listeners.get(event) ?? [])]) run(payload);
    },
    socket: {
      connected: true,
      on: (event: string, run: Listener) => {
        listeners.set(event, (listeners.get(event) ?? new Set()).add(run));
      },
      off: (event: string, run: Listener) => listeners.get(event)?.delete(run),
    },
  };
});
vi.mock('../socket', () => socket);

const SEATS: SeatedRoom[] = [
  { code: 'K7QX', game: 'keywords', playing: true },
  { code: 'ABCD', game: 'keywords', playing: false },
];

beforeEach(() => {
  setLanguage('en', { remember: false });
  socket.send.mockReset();
  socket.send.mockResolvedValue({ ok: true, seats: SEATS });
  socket.connect.mockReset();
  socket.socket.connected = true;
  socket.listeners.clear();
});

const shown = async () => {
  const wrapper = mount(BackToRoom, {
    global: { plugins: [i18n], stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  });
  await flushPromises();
  return wrapper;
};

describe('the way back to a room', () => {
  test('names every room where the player has a seat, with a link to it', async () => {
    const wrapper = await shown();
    expect(socket.send).toHaveBeenCalledWith('meta:seats');
    const seats = wrapper.findAll('.seat');
    expect(seats.map((seat) => seat.get('p').text())).toEqual([
      "You're still in room R2-K7QX (game in progress)",
      "You're still in room R2-ABCD (waiting for the game to start)",
    ]);
    expect(seats.map((seat) => seat.get('a').attributes('href'))).toEqual(['/room/K7QX', '/room/ABCD']);
    expect(seats[0]?.get('a').text()).toBe('Back to the room');
  });

  test('shows nothing without a seat, or without an answer', async () => {
    socket.send.mockResolvedValue({ ok: true, seats: [] });
    expect((await shown()).find('.seats').exists()).toBe(false);
    socket.send.mockResolvedValue({ ok: false, error: 'rate_limited' });
    expect((await shown()).find('.seats').exists()).toBe(false);
  });

  test('asks once connected, and again after every reconnect, until the page goes', async () => {
    socket.socket.connected = false;
    const wrapper = await shown();
    expect(socket.connect).toHaveBeenCalled();
    expect(socket.send).not.toHaveBeenCalled();
    const reconnect = async () => {
      socket.emit('connect');
      await flushPromises();
    };
    await reconnect();
    expect(wrapper.findAll('.seat')).toHaveLength(2);
    // The seat went while the connection was down.
    socket.send.mockResolvedValue({ ok: true, seats: [] });
    await reconnect();
    expect(wrapper.find('.seats').exists()).toBe(false);
    wrapper.unmount();
    expect([...socket.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    expect(socket.send).toHaveBeenCalledTimes(2);
  });

  // The page came from a room, and its connection is still in it.
  test('follows the room it came from: whether a game is on, and when it closes', async () => {
    const wrapper = await shown();
    const lines = () => wrapper.findAll('.seat p').map((line) => line.text());
    socket.emit('room:state', { code: 'ABCD', phase: 'playing' });
    socket.emit('room:state', { code: 'K7QX', phase: 'lobby' });
    await flushPromises();
    expect(lines()).toEqual([
      "You're still in room R2-K7QX (waiting for the game to start)",
      "You're still in room R2-ABCD (game in progress)",
    ]);
    expect(socket.send).toHaveBeenCalledTimes(1);
    // The room closes, or the player is removed, and the server is asked again.
    socket.send.mockResolvedValue({ ok: true, seats: [SEATS[1] as SeatedRoom] });
    socket.emit('room:closed', { reason: 'closed' });
    await flushPromises();
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(lines()).toEqual(["You're still in room R2-ABCD (waiting for the game to start)"]);
  });
});
