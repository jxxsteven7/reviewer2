// @vitest-environment happy-dom
import type { Ack, FriendView, RoomView } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';

// The server, as the sheet hears it: the friends it lists, and what it says to an invitation.
const mock = vi.hoisted(() => ({
  socket: { connected: true, on: vi.fn(), off: vi.fn() },
  send: vi.fn<(event: string, payload?: object) => Promise<Ack>>(),
  connect: vi.fn(),
}));
vi.mock('../socket', () => mock);

import InviteFriends from './InviteFriends.vue';

// Every friend who isn't in the room, those online first, with their dot, and those offline after
// them, faded, whom an invitation reaches once they come online; whom the viewer has invited, as
// the room's view says, are invited still when the sheet opens again, and may be invited again
// once the room's view no longer says so, as when they ignored the invitation.

const friend = (username: string, online: boolean): FriendView => ({
  handle: `${username.toLowerCase()}000000000`.slice(0, 12),
  username,
  avatar: null,
  online,
  room: null,
  duo: null,
});

const room = (invited: string[]): RoomView =>
  ({
    players: [
      { id: 'p1', name: 'Ann', username: 'Ann', online: true },
      // A friend in the room goes by the viewer's name for them, the username beside (room.ts).
      { id: 'p2', name: 'Kitty', username: 'Cat', online: true },
    ],
    invited: invited.map((username) => ({ username, avatar: null })),
  }) as unknown as RoomView;

afterEach(() => {
  document.body.innerHTML = '';
  mock.send.mockReset();
});

describe('the sheet to invite friends', () => {
  test('lists every friend not in the room, online first, and keeps whom the viewer invited', async () => {
    mock.send.mockImplementation((event) =>
      Promise.resolve(
        event === 'friends:list'
          ? {
              ok: true,
              friends: [friend('Dan', false), friend('Bob', true), friend('Cat', true), friend('Eve', false)],
              incoming: [],
              outgoing: [],
            }
          : { ok: true },
      ),
    );
    const wrapper = mount(InviteFriends, {
      props: { open: true, room: room(['Eve']) },
      global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en, zh } })] },
      attachTo: document.body,
    });
    await flushPromises();
    const lines = [...document.querySelectorAll<HTMLElement>('.friend')];
    expect(lines.map((line) => line.querySelector('.name')?.childNodes[0]?.textContent)).toEqual(['Bob', 'Dan', 'Eve']);
    expect(lines.map((line) => line.querySelector('.dot') !== null)).toEqual([true, false, false]);
    expect(lines.map((line) => line.classList.contains('offline'))).toEqual([false, true, true]);
    expect(lines.map((line) => line.querySelector('button')?.textContent?.trim())).toEqual([
      'Invite',
      'Invite (seen once online)',
      'Invited',
    ]);
    lines[1]?.querySelector('button')?.click();
    await flushPromises();
    expect(mock.send).toHaveBeenCalledWith('friends:invite', { username: 'Dan' });
    // The server sends the room again, with Dan invited, before it answers; and again without him
    // once he has ignored it, when he may be invited anew.
    await wrapper.setProps({ room: room(['Eve', 'Dan']) });
    expect(lines[1]?.querySelector('button')?.textContent?.trim()).toBe('Invited');
    expect(lines[1]?.querySelector('button')?.disabled).toBe(true);
    await wrapper.setProps({ room: room(['Eve']) });
    expect(lines[1]?.querySelector('button')?.textContent?.trim()).toBe('Invite (seen once online)');
    expect(lines[1]?.querySelector('button')?.disabled).toBe(false);
    wrapper.unmount();
  });
});
