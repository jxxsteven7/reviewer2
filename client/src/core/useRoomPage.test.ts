// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';

// The room, as the page's hook sees it: how it opens, and what it has shown.
const mock = vi.hoisted(() => ({
  openRoom: vi.fn(),
  closeRoomPage: vi.fn(),
  entry: { status: 'idle', language: null },
  room: { value: null },
}));
vi.mock('./room', () => mock);
vi.mock('./i18n', () => ({ setLanguage: vi.fn(), storedLanguage: () => 'en', browserLanguage: () => 'en' }));
vi.mock('../games', () => ({ games: {} }));

import { useRoomPage } from './useRoomPage';

beforeEach(() => {
  mock.openRoom.mockReset();
});

describe('the room page', () => {
  test('enters the room by the code, and again with each invitation the address brings', async () => {
    const code = ref('K7QX');
    const invitation = ref<string | undefined>('inv-1');
    mount(
      defineComponent({
        setup() {
          useRoomPage(code, { invitation });
          return () => h('div');
        },
      }),
    );
    expect(mock.openRoom).toHaveBeenLastCalledWith('K7QX', { screen: false, invitation: 'inv-1' });
    // The invitation leaves the address once the page is in: no reason to enter again.
    invitation.value = undefined;
    await nextTick();
    expect(mock.openRoom).toHaveBeenCalledOnce();
    // A new invitation to the same room, as when the first had lapsed, enters with it.
    invitation.value = 'inv-2';
    await nextTick();
    expect(mock.openRoom).toHaveBeenLastCalledWith('K7QX', { screen: false, invitation: 'inv-2' });
    expect(mock.openRoom).toHaveBeenCalledTimes(2);
    // Another room, by its code alone.
    invitation.value = undefined;
    code.value = 'ABCD';
    await nextTick();
    expect(mock.openRoom).toHaveBeenLastCalledWith('ABCD', { screen: false });
    expect(mock.openRoom).toHaveBeenCalledTimes(3);
  });
});
