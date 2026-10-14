// @vitest-environment happy-dom
import { ACCOUNT_API, type Ack } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { h, reactive } from 'vue';
import { i18n, setLanguage } from '../i18n';
import AccountPage from './AccountPage.vue';
import SignIn from './SignIn.vue';

// The address that the page was opened with, and where the router takes it. A navigation lands
// after the page is gone, so one that was started never resolves here.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), query: {} as Record<string, unknown> }));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: router.push, replace: router.replace }),
  useRoute: () => ({ query: router.query }),
}));
// Who the server says the browser is, and the page's connection.
const signedIn = vi.hoisted(() => ({
  account: { loaded: false, summary: null as object | null, mail: false },
  loadAccount: vi.fn(),
  logIn: vi.fn<(path: string, body: object) => Promise<Ack>>(),
}));
vi.mock('../account', async () => {
  const { reactive: wrap } = await import('vue');
  signedIn.account = wrap(signedIn.account);
  return signedIn;
});
// The friends section, which the account's page shows, listens on the connection.
const socket = vi.hoisted(() => ({
  connection: { connected: true, everConnected: true },
  reconnect: vi.fn(),
  socket: { on: vi.fn() },
}));
vi.mock('../socket', () => socket);
vi.mock('../../games', () => ({ games: {} }));
// The account's own page, which counts how often it was built: a page about to leave must not
// build it, even for a moment.
const profileMounted = vi.fn();
const ProfileView = {
  setup() {
    profileMounted();
    return () => h('div', { class: 'profile' });
  },
};

beforeEach(() => {
  setLanguage('en', { remember: false });
  router.push.mockReset();
  router.push.mockReturnValue(new Promise(() => {}));
  router.replace.mockReset();
  router.replace.mockReturnValue(new Promise(() => {}));
  socket.reconnect.mockReset();
  profileMounted.mockReset();
  signedIn.logIn.mockReset();
});

// Opens the account page with `next` in its address, if given, in a browser that hasn't asked yet
// who it is, and that the server says is logged in, or not.
async function open(next: string | undefined, loggedIn: boolean) {
  router.query = next === undefined ? {} : { next };
  Object.assign(signedIn.account, { loaded: false, summary: null });
  signedIn.loadAccount.mockImplementation(async () => {
    Object.assign(signedIn.account, { loaded: true, summary: loggedIn ? reactive({ username: 'Ann' }) : null });
    return true;
  });
  const wrapper = mount(AccountPage, {
    global: {
      plugins: [i18n],
      stubs: { RouterLink: true, ProfileView, PageMasthead: true, LanguageSwitch: true },
    },
  });
  await flushPromises();
  return wrapper;
}

// Logs in, or registers, on the form, which the server grants: the page learns who it is before
// the form hears the answer, as it does (account.ts).
async function signIn(wrapper: ReturnType<typeof mount>, mode: 'login' | 'register') {
  signedIn.logIn.mockImplementation(async () => {
    signedIn.account.summary = reactive({ username: 'Ann' });
    return { ok: true };
  });
  if (mode === 'register') await wrapper.findAll('.tab')[1]?.trigger('click');
  await wrapper.get('input[autocomplete="username"]').setValue('Ann');
  await wrapper.get(`input[autocomplete="${mode === 'login' ? 'current' : 'new'}-password"]`).setValue('correct horse');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
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

  test('leaves after a login or a registration, for the room or home, with the form still up', async () => {
    const ways: ['login' | 'register', string | undefined, string][] = [
      ['login', '/room/K7QX', '/room/K7QX'],
      ['login', undefined, '/'],
      ['register', '/room/K7QX', '/room/K7QX'],
      ['register', undefined, '/'],
    ];
    for (const [mode, next, path] of ways) {
      const wrapper = await open(next, false);
      await signIn(wrapper, mode);
      expect(signedIn.logIn).toHaveBeenCalledWith(ACCOUNT_API[mode], { username: 'Ann', password: 'correct horse' });
      expect(router.push).toHaveBeenCalledExactlyOnceWith(path);
      // Until the navigation lands, the form stays, busy, and the account's own page is never built.
      expect(profileMounted).not.toHaveBeenCalled();
      expect(wrapper.findComponent(SignIn).exists()).toBe(true);
      expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
      wrapper.unmount();
      router.push.mockClear();
    }
    expect(socket.reconnect).not.toHaveBeenCalled();
  });

  test('shows what the server refused, and keeps the form', async () => {
    const wrapper = await open(undefined, false);
    signedIn.logIn.mockResolvedValue({ ok: false, error: 'login_failed' });
    await wrapper.get('input[autocomplete="username"]').setValue('Ann');
    await wrapper.get('input[autocomplete="current-password"]').setValue('wrong horse');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('The username or the password is wrong.');
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
    expect(router.push).not.toHaveBeenCalled();
    expect(profileMounted).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  test('takes a page that is logged in by now back to the room', async () => {
    // As when the player logged in from another tab: this page's connection is still a guest's,
    // which loadAccount() makes again (account.test.ts), not the page.
    const wrapper = await open('/room/K7QX', true);
    expect(socket.reconnect).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/room/K7QX');
    // Until the navigation lands, the page shows that it is loading, as it did, and not the account.
    expect(profileMounted).not.toHaveBeenCalled();
    expect(wrapper.find('.loading').exists()).toBe(true);
    expect(wrapper.findComponent(SignIn).exists()).toBe(false);
    wrapper.unmount();
  });

  test('shows the account to a page that is logged in, when no room sent it', async () => {
    for (const next of [undefined, 'https://elsewhere.example/room/K7QX']) {
      const wrapper = await open(next, true);
      expect(wrapper.find('.profile').exists()).toBe(true);
      wrapper.unmount();
    }
    expect(router.replace).not.toHaveBeenCalled();
    expect(socket.reconnect).not.toHaveBeenCalled();
  });

  test('turns the form into the account after a login elsewhere, as in another tab', async () => {
    // Whether a room sent the player here or not: the page was a guest's when it was opened.
    for (const next of [undefined, '/room/K7QX']) {
      const wrapper = await open(next, false);
      expect(wrapper.findComponent(SignIn).exists()).toBe(true);
      signedIn.account.summary = reactive({ username: 'Ann' });
      await flushPromises();
      expect(wrapper.find('.profile').exists()).toBe(true);
      expect(wrapper.findComponent(SignIn).exists()).toBe(false);
      wrapper.unmount();
    }
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(socket.reconnect).not.toHaveBeenCalled();
  });

  test('sends one login for a form submitted twice before the server has answered', async () => {
    const wrapper = await open(undefined, false);
    signedIn.logIn.mockReturnValue(new Promise(() => {}));
    await wrapper.get('input[autocomplete="username"]').setValue('Ann');
    await wrapper.get('input[autocomplete="current-password"]').setValue('correct horse');
    // Both before the page has rendered the form busy.
    const form = wrapper.get('form');
    await Promise.all([form.trigger('submit'), form.trigger('submit')]);
    await flushPromises();
    expect(signedIn.logIn).toHaveBeenCalledOnce();
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
});
