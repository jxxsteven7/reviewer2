// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import RoomNotice from './RoomNotice.vue';

// The address of the page, and how far it got in entering its room.
const page = vi.hoisted(() => ({ route: { path: '/', params: {} as Record<string, string> } }));
vi.mock('vue-router', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    useRoute: () => page.route,
    RouterLink: defineComponent({
      name: 'RouterLink',
      props: { to: { type: [String, Object], required: true } },
      setup:
        (_props, { slots }) =>
        () =>
          h('a', slots.default?.()),
    }),
  };
});
const room = vi.hoisted(() => ({
  entry: { status: 'failed', language: null, closed: null, error: 'account_required' as string | null },
}));
vi.mock('../room', () => room);
// The connection, which the server may have turned away.
const socket = vi.hoisted(() => ({ connection: { refusal: null as string | null } }));
vi.mock('../socket', () => socket);

beforeEach(() => {
  setLanguage('en', { remember: false });
  room.entry.status = 'failed';
  room.entry.error = 'account_required';
  socket.connection.refusal = null;
});

// The places the notice links to, for a room page at `path` with the code in it as `code`.
function links(path: string, code: string, screen = false) {
  page.route = { path, params: { code } };
  const wrapper = mount(RoomNotice, { props: { screen }, global: { plugins: [i18n] } });
  return wrapper.findAllComponents({ name: 'RouterLink' }).map((link) => link.props('to') as unknown);
}

describe('the notice of a room the page is not in', () => {
  test('sends a guest whom a public room refused to log in, and back to the room by its link', () => {
    expect(links('/room/K7QX', 'K7QX')).toEqual([{ path: '/account', query: { next: '/room/K7QX' } }, '/']);
    expect(links('/room/K7QX/screen', 'K7QX', true)).toEqual([
      { path: '/account', query: { next: '/room/K7QX/screen' } },
      '/',
    ]);
    // An address that gave the code as the room's number, or in another case, leads back all the same.
    expect(links('/room/R2-k7qx', 'R2-k7qx')[0]).toEqual({ path: '/account', query: { next: '/room/K7QX' } });
  });

  test('has only the way home for any other refusal', () => {
    room.entry.error = 'removed';
    expect(links('/room/K7QX', 'K7QX')).toEqual(['/']);
  });

  test('says that the room is opening, or that the server turned the page away, while it waits', () => {
    room.entry.status = 'connecting';
    page.route = { path: '/room/K7QX', params: { code: 'K7QX' } };
    const text = () => mount(RoomNotice, { global: { plugins: [i18n] } }).text();
    expect(text()).toBe('Opening the room...');
    socket.connection.refusal = 'server_busy';
    expect(text()).toBe('The server is a little busy. Come back in a few minutes.');
    socket.connection.refusal = 'too_many_connections';
    expect(text()).toContain('Too many connections');
  });
});
