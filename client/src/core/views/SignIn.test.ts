// @vitest-environment happy-dom
import type { Ack } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import SignIn from './SignIn.vue';

// The router: where the page goes after signing in.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: router.push }) }));
const signedIn = vi.hoisted(() => ({
  account: { loaded: true, summary: null as object | null, mail: false },
  logIn: vi.fn<(path: string, body: object) => Promise<Ack>>(),
}));
vi.mock('../account', () => signedIn);

beforeEach(() => {
  setLanguage('en', { remember: false });
  router.push.mockReset();
  signedIn.logIn.mockReset();
  signedIn.logIn.mockResolvedValue({ ok: true });
});

// Logs in, from an account page that leads back to `next`, if it does (AccountPage).
async function signIn(next?: string) {
  const wrapper = mount(SignIn, { props: { next }, global: { plugins: [i18n], stubs: { RouterLink: true } } });
  await wrapper.get('input[autocomplete="username"]').setValue('Ann');
  await wrapper.get('input[autocomplete="current-password"]').setValue('correct horse');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}

describe('signing in', () => {
  test('leads to where the account page says, and else home', async () => {
    await signIn('/room/K7QX');
    expect(router.push).toHaveBeenLastCalledWith('/room/K7QX');
    await signIn();
    expect(router.push).toHaveBeenLastCalledWith('/');
  });
});
