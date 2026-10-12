// @vitest-environment happy-dom
import type { Ack, FriendsView } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';

// The connection, as the list sees it: whether there is one, the handlers it registers, and what
// the server answers.
const mock = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  return {
    handlers,
    socket: {
      connected: true,
      on: (event: string, handler: () => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
    },
    send: vi.fn<(event: string, payload?: object) => Promise<Ack>>(),
    connect: vi.fn(),
  };
});
vi.mock('./socket', () => mock);

import { friendsVersion } from './friends';
import { useFriendsList } from './useFriendsList';

const LIST: FriendsView = {
  friends: [{ username: 'Bob', avatar: null, online: true, room: null }],
  incoming: [],
  outgoing: [],
};
const listed = (): Ack => ({ ok: true, ...LIST });

// The parts mounted by the current test, which go at its end, so that their listeners do too.
const mounted: ReturnType<typeof mount>[] = [];

function shown(visible: Ref<boolean> = ref(true)) {
  let list: ReturnType<typeof useFriendsList> | undefined;
  const wrapper = mount(
    defineComponent({
      setup() {
        list = useFriendsList(visible);
        return () => h('div');
      },
    }),
  );
  mounted.push(wrapper);
  return { wrapper, list: list as ReturnType<typeof useFriendsList> };
}

beforeEach(() => {
  mock.send.mockReset();
  mock.send.mockResolvedValue(listed());
  mock.connect.mockReset();
  mock.socket.connected = true;
  mock.handlers.clear();
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the friends list', () => {
  test('is asked for when shown, on every connection after that, and when the friends change', async () => {
    const { list, wrapper } = shown();
    await flushPromises();
    expect(mock.send).toHaveBeenCalledWith('friends:list');
    expect(list.view.value).toEqual(LIST);
    // A connection after a break asks again, since a change may have gone by; so does the word
    // that something changed.
    mock.handlers.get('connect')?.();
    await flushPromises();
    expect(mock.send).toHaveBeenCalledTimes(2);
    friendsVersion.value += 1;
    await flushPromises();
    expect(mock.send).toHaveBeenCalledTimes(3);
    // A page that has gone listens no more.
    wrapper.unmount();
    expect(mock.handlers.has('connect')).toBe(false);
  });

  test('waits for a connection, and asks for one, when shown without', async () => {
    mock.socket.connected = false;
    const { list } = shown();
    await flushPromises();
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.connect).toHaveBeenCalledOnce();
    expect(list.view.value).toBeNull();
    expect(list.failed.value).toBeNull();
    mock.socket.connected = true;
    mock.handlers.get('connect')?.();
    await flushPromises();
    expect(list.view.value).toEqual(LIST);
  });

  test('says why the answer did not come, and asks again on the next connection', async () => {
    mock.send.mockResolvedValueOnce({ ok: false, error: 'timeout' });
    const { list } = shown();
    await flushPromises();
    expect(list.failed.value).toBe('timeout');
    expect(list.view.value).toBeNull();
    mock.handlers.get('connect')?.();
    await flushPromises();
    expect(list.failed.value).toBeNull();
    expect(list.view.value).toEqual(LIST);
  });

  test('asks for nothing while the part is not shown, and afresh when it is', async () => {
    const visible = ref(false);
    const { list } = shown(visible);
    await flushPromises();
    mock.handlers.get('connect')?.();
    friendsVersion.value += 1;
    await flushPromises();
    expect(mock.send).not.toHaveBeenCalled();
    visible.value = true;
    await flushPromises();
    expect(mock.send).toHaveBeenCalledOnce();
    expect(list.view.value).toEqual(LIST);
    // Shown again, the list is loaded anew: who is online has changed meanwhile.
    visible.value = false;
    await nextTick();
    visible.value = true;
    await flushPromises();
    expect(mock.send).toHaveBeenCalledTimes(2);
  });
});
