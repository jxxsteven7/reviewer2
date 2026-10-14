// @vitest-environment happy-dom
import type { JoinAskView } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import JoinAskNotices from './JoinAskNotices.vue';

// Friends' requests to be let into the room, on the room's page (docs/architecture.md#friends).

const mock = vi.hoisted(() => ({
  send: vi.fn<(event: string, payload: object) => Promise<{ ok: true } | { ok: false; error: string }>>(async () => ({
    ok: true,
  })),
  toast: vi.fn(),
  toastError: vi.fn(),
  dismissAsk: vi.fn(),
  asks: [] as JoinAskView[],
  room: { value: null as { roomId: string; me: string | null } | null },
}));
vi.mock('../socket', () => ({ send: mock.send }));
vi.mock('../toast', () => ({ toast: mock.toast, toastError: mock.toastError }));
vi.mock('../friends', async () => {
  const { reactive } = await import('vue');
  mock.asks = reactive([]);
  return { asks: mock.asks, dismissAsk: mock.dismissAsk };
});
vi.mock('../room', async () => {
  const { shallowRef } = await import('vue');
  mock.room = shallowRef(null);
  return { room: mock.room };
});

const ask = (id: string, roomId = 'room-1', alias?: string): JoinAskView => ({
  id,
  roomId,
  from: { username: 'Bob', ...(alias ? { alias } : {}), avatar: null },
  expiresInMs: 600_000,
});

beforeEach(() => {
  setLanguage('en', { remember: false });
  mock.asks.splice(0, mock.asks.length, ask('a'), ask('b', 'room-2'));
  mock.room.value = { roomId: 'room-1', me: 'p1' };
  mock.send.mockClear();
  mock.toast.mockClear();
  mock.toastError.mockClear();
  mock.dismissAsk.mockClear();
});

const mounted = () => mount(JoinAskNotices, { global: { plugins: [i18n] } });

describe("friends' requests to be let in", () => {
  test("show on the room's page alone, to a member, with the way to invite and to ignore", async () => {
    const wrapper = mounted();
    expect(wrapper.findAll('.join-ask')).toHaveLength(1);
    expect(wrapper.text()).toContain('Bob would like to join');
    const [invite, ignore] = wrapper.findAll('button');
    await invite?.trigger('click');
    await flushPromises();
    expect(mock.send).toHaveBeenCalledWith('friends:invite', { username: 'Bob' });
    expect(mock.toast).toHaveBeenCalledWith('friends.askInvited', { name: 'Bob' });
    await ignore?.trigger('click');
    expect(mock.dismissAsk).toHaveBeenCalledWith('a');
    // A screen, and a page that is no room's, show none.
    mock.room.value = { roomId: 'room-1', me: null };
    await flushPromises();
    expect(wrapper.findAll('.join-ask')).toHaveLength(0);
    mock.room.value = null;
    await flushPromises();
    expect(wrapper.findAll('.join-ask')).toHaveLength(0);
  });

  test('say why an invitation did not go, and keep the request', async () => {
    mock.send.mockResolvedValueOnce({ ok: false, error: 'invite_cooldown' });
    const wrapper = mounted();
    await wrapper.findAll('button')[0]?.trigger('click');
    await flushPromises();
    expect(mock.toastError).toHaveBeenCalledWith('invite_cooldown');
    expect(wrapper.findAll('.join-ask')).toHaveLength(1);
  });

  test('name the friend by the alias the account gives them, in Chinese too', () => {
    setLanguage('zh', { remember: false });
    mock.asks.splice(0, mock.asks.length, ask('c', 'room-1', 'Bobby'));
    const wrapper = mounted();
    expect(wrapper.text()).toContain('Bobby\uff08Bob\uff09\u60f3\u52a0\u5165');
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['\u9080\u8bf7', '\u5ffd\u7565']);
  });
});
