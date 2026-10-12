// @vitest-environment happy-dom
import type { FieldInfo, PublicRoom } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fields } from '../fields';
import { i18n, setLanguage } from '../i18n';
import PublicRooms from './PublicRooms.vue';

const socket = vi.hoisted(() => ({
  send: vi.fn<(event: string) => Promise<{ ok: true; rooms: PublicRoom[] } | { ok: false; error: string }>>(),
  // Whether the page is connected, and what waits for the connection while it isn't.
  connected: true,
  waiting: [] as (() => void)[],
  onceConnected(run: () => void) {
    if (socket.connected) {
      run();
      return () => {};
    }
    socket.waiting.push(run);
    return () => {
      socket.waiting = socket.waiting.filter((waits) => waits !== run);
    };
  },
}));
vi.mock('../socket', () => socket);
vi.mock('../fields', async () => {
  const { shallowRef } = await import('vue');
  return { fields: shallowRef<FieldInfo[] | null>(null), loadFields: vi.fn() };
});
const signedIn = vi.hoisted(() => ({ account: { loaded: true, summary: null as object | null, mail: false } }));
vi.mock('../account', async () => {
  const { reactive } = await import('vue');
  signedIn.account = reactive(signedIn.account);
  return signedIn;
});

const ROOMS: PublicRoom[] = [
  { code: 'K7QX', game: 'keywords', language: 'en', fields: ['general', 'ml'], players: 3, playing: false },
  { code: 'ABCD', game: 'keywords', language: 'zh', fields: ['general'], players: 12, playing: true },
];

beforeEach(() => {
  setLanguage('en', { remember: false });
  signedIn.account.summary = null;
  fields.value = [
    { id: 'general', name: { zh: '通用', en: 'General' }, counts: { zh: 30, en: 30 } },
    { id: 'ml', name: { zh: '机器学习', en: 'Machine learning' }, counts: { zh: 30, en: 30 } },
  ];
  socket.send.mockReset();
  socket.send.mockResolvedValue({ ok: true, rooms: ROOMS });
  socket.connected = true;
  socket.waiting = [];
});

const refresh = (wrapper: Awaited<ReturnType<typeof opened>>) =>
  wrapper
    .findAll('button')
    .find((button) => button.text() === 'Refresh')
    ?.trigger('click');

const opened = async () => {
  const wrapper = mount(PublicRooms, {
    global: { plugins: [i18n], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  await wrapper.get('button').trigger('click');
  await flushPromises();
  return wrapper;
};

describe('the public rooms', () => {
  test('are asked for when the list is opened, and shown with what the home page says of them', async () => {
    const wrapper = await opened();
    expect(socket.send).toHaveBeenCalledWith('meta:rooms');
    const rooms = wrapper.findAll('.room');
    expect(rooms).toHaveLength(2);
    expect(rooms[0]?.text()).toContain('Double Blind');
    expect(rooms[0]?.text()).toContain('Waiting for players');
    expect(rooms[0]?.text()).toContain('English · General · Machine learning');
    expect(rooms[0]?.text()).toContain('Players: 3');
    expect(rooms[1]?.text()).toContain('Game in progress');
    expect(rooms[1]?.text()).toContain('中文 · 通用');
    // Guests are told to log in; the list is theirs to see all the same.
    expect(wrapper.text()).toContain('Log in or register to join one.');
    signedIn.account.summary = { username: 'Ann', avatar: null };
    await flushPromises();
    expect(wrapper.text()).not.toContain('Log in or register to join one.');
  });

  test('say when there is none, and ask again on request', async () => {
    socket.send.mockResolvedValue({ ok: true, rooms: [] });
    const wrapper = await opened();
    expect(wrapper.text()).toContain('No public room is open right now.');
    socket.send.mockResolvedValue({ ok: true, rooms: ROOMS });
    await refresh(wrapper);
    await flushPromises();
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('.room')).toHaveLength(2);
  });

  test('say why the list did not come, as the server or the connection said, and wait for it', async () => {
    // The connection went while the list was asked for.
    socket.send.mockImplementation(async () => {
      socket.connected = false;
      return { ok: false, error: 'offline' };
    });
    const wrapper = await opened();
    expect(wrapper.text()).toContain("You're offline.");
    expect(wrapper.findAll('.room')).toHaveLength(0);
    // The connection is back: the list is asked for again, as the text promised.
    socket.send.mockResolvedValue({ ok: true, rooms: ROOMS });
    socket.connected = true;
    for (const run of socket.waiting.splice(0)) run();
    await flushPromises();
    expect(wrapper.findAll('.room')).toHaveLength(2);
    socket.send.mockResolvedValue({ ok: false, error: 'rate_limited' });
    await refresh(wrapper);
    await flushPromises();
    expect(wrapper.text()).toContain('Too many requests.');
  });

  test('leave an answer that comes after the list was folded away alone', async () => {
    let answer!: (reply: { ok: false; error: string }) => void;
    socket.send.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const wrapper = await opened();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Hide')
      ?.trigger('click');
    // The connection went while the answer was on its way: nothing waits for it to come back.
    socket.connected = false;
    answer({ ok: false, error: 'offline' });
    await flushPromises();
    expect(socket.waiting).toHaveLength(0);
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['Find a public room']);
  });

  test('fold back into the button, and stop waiting for a connection', async () => {
    socket.connected = false;
    const wrapper = await opened();
    expect(socket.waiting).toHaveLength(1);
    expect(wrapper.find('.room').exists()).toBe(false);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Hide')
      ?.trigger('click');
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['Find a public room']);
    expect(wrapper.find('h2').exists()).toBe(false);
    expect(socket.waiting).toHaveLength(0);
    // Opened again, the list is asked for anew.
    socket.connected = true;
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.room')).toHaveLength(2);
  });
});
