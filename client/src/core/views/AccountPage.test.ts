// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { reactive } from 'vue';
import { i18n, setLanguage } from '../i18n';
import AccountPage from './AccountPage.vue';
import SignIn from './SignIn.vue';

// The address that the page was opened with, and where the router takes it.
const router = vi.hoisted(() => ({ replace: vi.fn(), query: {} as Record<string, unknown> }));
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: router.replace }),
  useRoute: () => ({ query: router.query }),
}));
// Who the server says the browser is, and the page's connection.
const signedIn = vi.hoisted(() => ({
  account: { loaded: false, summary: null as object | null, mail: false },
  loadAccount: vi.fn(),
}));
vi.mock('../account', async () => {
  const { reactive: wrap } = await import('vue');
  signedIn.account = wrap(signedIn.account);
  return signedIn;
});
const socket = vi.hoisted(() => ({ connection: { connected: true, everConnected: true }, reconnect: vi.fn() }));
vi.mock('../socket', () => socket);
vi.mock('../../games', () => ({ games: {} }));

beforeEach(() => {
  setLanguage('en', { remember: false });
  router.replace.mockReset();
  socket.reconnect.mockReset();
  Object.assign(signedIn.account, { loaded: false, summary: null });
});

// Opens the account page with `next` in its address, if given, for a browser that the server says
// is logged in, or not.
async function open(next: string | undefined, loggedIn: boolean) {
  router.query = next === undefined ? {} : { next };
  signedIn.loadAccount.mockImplementation(async () => {
    Object.assign(signedIn.account, { loaded: true, summary: loggedIn ? reactive({ username: 'Ann' }) : null });
    return true;
  });
  const wrapper = mount(AccountPage, {
    global: {
      plugins: [i18n],
      stubs: { RouterLink: true, ProfileView: true, PageMasthead: true, LanguageSwitch: true, SignIn: true },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('the account page', () => {
  test('passes the room that sent a guest here on to the form, and no other path', async () => {
    const paths: [string | undefined, string | undefined][] = [
      [undefined, undefined],
      ['/room/K7QX', '/room/K7QX'],
      ['/room/K7QX/screen', '/room/K7QX/screen'],
      // Only room paths are honored: not another page, another site or a path with more in it.
      ['/account', undefined],
      ['https://elsewhere.example/room/K7QX', undefined],
      ['/room/K7QX/../account', undefined],
    ];
    for (const [next, path] of paths) {
      const wrapper = await open(next, false);
      expect(wrapper.getComponent(SignIn).props('next')).toBe(path);
      wrapper.unmount();
    }
    expect(router.replace).not.toHaveBeenCalled();
    expect(socket.reconnect).not.toHaveBeenCalled();
  });

  test('takes a page that is logged in by now back to the room, with a new connection', async () => {
    // As when the player logged in from another tab: this page's connection is still a guest's.
    await open('/room/K7QX', true);
    expect(socket.reconnect).toHaveBeenCalledOnce();
    expect(router.replace).toHaveBeenCalledWith('/room/K7QX');
  });

  test('shows the account to a page that is logged in, when no room sent it', async () => {
    for (const next of [undefined, 'https://elsewhere.example/room/K7QX']) {
      const wrapper = await open(next, true);
      expect(wrapper.findComponent({ name: 'ProfileView' }).exists()).toBe(true);
      wrapper.unmount();
    }
    expect(router.replace).not.toHaveBeenCalled();
    expect(socket.reconnect).not.toHaveBeenCalled();
  });
});
