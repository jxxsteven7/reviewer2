// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, toRef } from 'vue';

// The room, as the page's hook sees it: how it opens, and what it has shown.
const mock = vi.hoisted(() => ({
  openRoom: vi.fn(),
  closeRoomPage: vi.fn(),
  entry: { status: 'idle' as string, language: null },
  room: { value: null as { code: string } | null },
}));
vi.mock('./room', () => mock);
vi.mock('./i18n', () => ({ setLanguage: vi.fn(), storedLanguage: () => 'en', browserLanguage: () => 'en' }));
vi.mock('../games', () => ({ games: {} }));

import { useRoomPage } from './useRoomPage';

// A page in a room, as the room and screen pages are, which shows the code the tab names.
const Page = defineComponent({
  props: { code: { type: String, required: true }, invitation: { type: String, default: undefined } },
  setup(props) {
    const { roomCode } = useRoomPage(toRef(props, 'code'), { invitation: toRef(props, 'invitation') });
    return () => h('div', String(roomCode.value));
  },
});

beforeEach(() => {
  mock.openRoom.mockReset();
});

describe('the room page', () => {
  test('enters the room by the code, and again with each invitation the address brings', async () => {
    const page = mount(Page, { props: { code: 'K7QX', invitation: 'inv-1' } });
    expect(mock.openRoom).toHaveBeenLastCalledWith('K7QX', { screen: false, invitation: 'inv-1' });
    // The invitation leaves the address once the page is in: no reason to enter again.
    await page.setProps({ invitation: undefined });
    expect(mock.openRoom).toHaveBeenCalledOnce();
    // A new invitation to the same room, as when the first had lapsed, enters with it.
    await page.setProps({ invitation: 'inv-2' });
    expect(mock.openRoom).toHaveBeenLastCalledWith('K7QX', { screen: false, invitation: 'inv-2' });
    expect(mock.openRoom).toHaveBeenCalledTimes(2);
    // Another room, by its code alone.
    await page.setProps({ code: 'ABCD', invitation: undefined });
    expect(mock.openRoom).toHaveBeenLastCalledWith('ABCD', { screen: false });
    expect(mock.openRoom).toHaveBeenCalledTimes(3);
  });
});

// The code the tab's title names (RoomPage.vue, ScreenPage.vue).
describe('the code the tab names', () => {
  const named = (address: string): string => mount(Page, { props: { code: address } }).text();

  test("is the address's, read as a player would type it, until the room is known, and the room's then", () => {
    expect(named('K7QX')).toBe('K7QX');
    expect(named('k7qx')).toBe('K7QX');
    expect(named('R2-K7QX')).toBe('K7QX');
    expect(named('12345')).toBe('null');
    mock.room.value = { code: 'ABCD' };
    expect(named('k7qx')).toBe('ABCD');
    mock.room.value = null;
  });

  test('is none when no room has it', () => {
    mock.entry.status = 'not_found';
    expect(named('K7QX')).toBe('null');
    mock.entry.status = 'idle';
  });
});
