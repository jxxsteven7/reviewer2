// @vitest-environment happy-dom
import type { FriendRoomView } from '@reviewer2/shared';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import FriendsPlaying from './FriendsPlaying.vue';

// The rooms that friends are in, on the home page (docs/architecture.md#friends).

const mock = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  return {
    handlers,
    send: vi.fn<(event: string) => Promise<{ ok: true; rooms: unknown[] } | { ok: false; error: string }>>(),
    connect: vi.fn(),
    socket: {
      connected: true,
      on: (event: string, handler: () => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
    },
  };
});
vi.mock('../socket', () => mock);
const signedIn = vi.hoisted(() => ({ account: { loaded: true, summary: null as object | null, mail: false } }));
vi.mock('../account', async () => {
  const { reactive } = await import('vue');
  signedIn.account = reactive(signedIn.account);
  return signedIn;
});
const friends = vi.hoisted(() => ({ askToJoin: vi.fn(async () => true), friendsVersion: { value: 0 } }));
vi.mock('../friends', async () => {
  const { ref } = await import('vue');
  friends.friendsVersion = ref(0);
  return friends;
});

const ann = { handle: 'ann000000000', username: 'Ann', avatar: null };
const ROOMS: FriendRoomView[] = [
  { code: 'K7QX', playing: true, friends: [ann] },
  {
    code: null,
    playing: false,
    friends: [
      { handle: 'bob000000000', username: 'Bob', alias: 'Bobby', avatar: null },
      { handle: 'cat000000000', username: 'Cat', avatar: null },
    ],
  },
];

enableAutoUnmount(afterEach);

beforeEach(() => {
  setLanguage('en', { remember: false });
  signedIn.account.summary = { username: 'Dan', avatar: null };
  mock.send.mockReset();
  mock.send.mockResolvedValue({ ok: true, rooms: ROOMS });
  mock.socket.connected = true;
  friends.askToJoin.mockClear();
});

const mounted = async () => {
  const wrapper = mount(FriendsPlaying, {
    global: { plugins: [i18n], stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  });
  await flushPromises();
  return wrapper;
};

describe('the rooms that friends are in', () => {
  test('show a row a room, with the friends, the game, and the way in or the way to ask', async () => {
    const wrapper = await mounted();
    expect(mock.send).toHaveBeenCalledWith('friends:rooms');
    expect(wrapper.get('h2').text()).toBe('Friends playing');
    const [open, closed] = wrapper.findAll('.room');
    expect(open?.get('.names').text()).toBe('Ann');
    expect(open?.get('.status').text()).toBe('Game in progress');
    expect(open?.get('a.join').attributes('href')).toBe('/room/K7QX');
    expect(open?.get('a.avatar-button').attributes('href')).toBe('/p/ann000000000');
    // A private room shows no number; asking goes to the first friend in it.
    expect(closed?.get('.names').text()).toBe('Bobby, Cat');
    expect(closed?.get('.status').text()).toBe('Waiting for players');
    expect(closed?.text()).not.toContain('R2-');
    await closed?.get('button').trigger('click');
    expect(friends.askToJoin).toHaveBeenCalledWith('Bob');
  });

  test('say "Asked" while a request stands, and ask again when the friends change or the page comes back', async () => {
    const asked = { ...ROOMS[1], friends: [{ ...ann, asked: true as const }] } as FriendRoomView;
    mock.send.mockResolvedValue({ ok: true, rooms: [asked] });
    const wrapper = await mounted();
    expect(wrapper.get('.room button').text()).toBe('Asked');
    expect(wrapper.get('.room button').attributes('disabled')).toBeDefined();
    mock.send.mockResolvedValue({ ok: true, rooms: ROOMS });
    friends.friendsVersion.value += 1;
    await flushPromises();
    expect(wrapper.findAll('.room')).toHaveLength(2);
    mock.send.mockResolvedValue({ ok: true, rooms: [] });
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(mock.send).toHaveBeenCalledTimes(3);
    expect(wrapper.find('section').exists()).toBe(false);
  });

  test('are not there for a guest, nor while no friend is in a room', async () => {
    signedIn.account.summary = null;
    const guest = await mounted();
    expect(mock.send).not.toHaveBeenCalled();
    expect(guest.find('section').exists()).toBe(false);
    signedIn.account.summary = { username: 'Dan', avatar: null };
    mock.send.mockResolvedValue({ ok: true, rooms: [] });
    const alone = await mounted();
    expect(mock.send).toHaveBeenCalledWith('friends:rooms');
    expect(alone.find('section').exists()).toBe(false);
  });

  test('say it in Chinese too', async () => {
    setLanguage('zh', { remember: false });
    const wrapper = await mounted();
    expect(wrapper.get('h2').text()).toBe('\u597d\u53cb\u5728\u73a9');
    expect(wrapper.findAll('.room')[1]?.get('.names').text()).toBe('Bobby\u3001Cat');
    expect(wrapper.findAll('.room')[1]?.get('button').text()).toBe('\u7533\u8bf7\u52a0\u5165');
  });
});
