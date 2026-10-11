// @vitest-environment happy-dom
import type { SeatedRoom } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import BackToRoom from './BackToRoom.vue';

const socket = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    send: vi.fn<(event: string) => Promise<{ ok: true; seats: SeatedRoom[] } | { ok: false; error: string }>>(),
    connect: vi.fn(),
    listeners,
    socket: {
      connected: true,
      on: (_event: string, run: () => void) => listeners.add(run),
      off: (_event: string, run: () => void) => listeners.delete(run),
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
      for (const run of [...socket.listeners]) run();
      await flushPromises();
    };
    await reconnect();
    expect(wrapper.findAll('.seat')).toHaveLength(2);
    // The seat went while the connection was down.
    socket.send.mockResolvedValue({ ok: true, seats: [] });
    await reconnect();
    expect(wrapper.find('.seats').exists()).toBe(false);
    wrapper.unmount();
    expect(socket.listeners.size).toBe(0);
    expect(socket.send).toHaveBeenCalledTimes(2);
  });
});
