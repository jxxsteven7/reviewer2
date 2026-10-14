// @vitest-environment happy-dom
import { ACCOUNT_API, type Ack } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import SignIn from './SignIn.vue';

// The router: where the page goes after signing in, and when the navigation has landed.
const router = vi.hoisted(() => ({ push: vi.fn(), landed: () => {} }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: router.push }) }));
const signedIn = vi.hoisted(() => ({
  account: { loaded: true, summary: null as object | null, mail: false },
  logIn: vi.fn<(path: string, body: object) => Promise<Ack>>(),
}));
vi.mock('../account', () => signedIn);

beforeEach(() => {
  setLanguage('en', { remember: false });
  router.push.mockReset();
  router.push.mockImplementation(() => new Promise<void>((resolve) => (router.landed = resolve)));
  signedIn.logIn.mockReset();
  signedIn.logIn.mockResolvedValue({ ok: true });
});

// Logs in, or registers, from an account page that leads back to `next`, if it does (AccountPage).
async function signIn(next?: string, mode: 'login' | 'register' = 'login') {
  const wrapper = mount(SignIn, { props: { next }, global: { plugins: [i18n], stubs: { RouterLink: true } } });
  if (mode === 'register') await wrapper.findAll('.tab')[1]?.trigger('click');
  await wrapper.get('input[autocomplete="username"]').setValue('Ann');
  await wrapper.get(`input[autocomplete="${mode === 'login' ? 'current' : 'new'}-password"]`).setValue('correct horse');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  return wrapper;
}

describe('signing in', () => {
  test('leads to where the account page says, and else home, after a login or a registration', async () => {
    await signIn('/room/K7QX');
    expect(signedIn.logIn).toHaveBeenLastCalledWith(ACCOUNT_API.login, { username: 'Ann', password: 'correct horse' });
    expect(router.push).toHaveBeenLastCalledWith('/room/K7QX');
    await signIn();
    expect(router.push).toHaveBeenLastCalledWith('/');
    await signIn('/room/K7QX', 'register');
    expect(signedIn.logIn).toHaveBeenLastCalledWith(ACCOUNT_API.register, {
      username: 'Ann',
      password: 'correct horse',
    });
    expect(router.push).toHaveBeenLastCalledWith('/room/K7QX');
    await signIn(undefined, 'register');
    expect(router.push).toHaveBeenLastCalledWith('/');
  });

  test('opens on registering when the page asks for it', async () => {
    const tabs = (register?: boolean) =>
      mount(SignIn, { props: { register }, global: { plugins: [i18n], stubs: { RouterLink: true } } })
        .findAll('.tab')
        .map((tab) => tab.attributes('aria-pressed'));
    expect(tabs()).toEqual(['true', 'false']);
    expect(tabs(true)).toEqual(['false', 'true']);
  });

  test('tells whoever registers what becomes of the record of their games', async () => {
    const wrapper = mount(SignIn, { global: { plugins: [i18n], stubs: { RouterLink: true } } });
    expect(wrapper.text()).not.toContain('Games are recorded.');
    await wrapper.findAll('.tab')[1]?.trigger('click');
    expect(wrapper.text()).toContain("used to train and test the game's AI players");
  });

  test('is busy, and says so, until the page has left', async () => {
    const wrapper = await signIn();
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('update:busy')).toEqual([[true]]);
    router.landed();
    await flushPromises();
    expect(wrapper.emitted('update:busy')).toEqual([[true], [false]]);
  });

  test('shows what the server refused, and stays', async () => {
    signedIn.logIn.mockResolvedValue({ ok: false, error: 'login_failed' });
    const wrapper = await signIn('/room/K7QX');
    expect(wrapper.get('[role="alert"]').text()).toBe('The username or the password is wrong.');
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.emitted('update:busy')).toEqual([[true], [false]]);
    expect(router.push).not.toHaveBeenCalled();
    // Typing again takes the message away.
    await wrapper.get('input[autocomplete="current-password"]').setValue('battery staple');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
