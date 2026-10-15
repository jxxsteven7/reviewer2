// @vitest-environment happy-dom
import { ACCOUNT_API, type Ack } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import ResetPassword from './ResetPassword.vue';

// The link from the mail, with its token after the hash, and where the router takes the page.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), hash: '#token' }));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: router.push, replace: router.replace }),
  useRoute: () => ({ path: '/account/reset', query: {}, hash: router.hash }),
}));
const signedIn = vi.hoisted(() => ({ logIn: vi.fn<(path: string, body: object) => Promise<Ack>>() }));
vi.mock('../account', () => signedIn);

beforeEach(() => {
  setLanguage('en', { remember: false });
  router.push.mockReset();
  router.replace.mockReset();
  router.replace.mockResolvedValue(undefined);
  signedIn.logIn.mockReset();
});

describe('ResetPassword', () => {
  // The link works once: the page that set the password can't be gone back to, so the account page
  // takes its place in the history rather than following it.
  test('takes the place of the used page with the account page', async () => {
    signedIn.logIn.mockResolvedValue({ ok: true });
    const wrapper = mount(ResetPassword, {
      global: { plugins: [i18n], stubs: { PageMasthead: true, LanguageSwitch: true, RouterLink: true } },
    });
    await wrapper.find('input[type="password"]').setValue('a new password');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(signedIn.logIn).toHaveBeenCalledWith(ACCOUNT_API.reset, { token: 'token', password: 'a new password' });
    expect(router.replace).toHaveBeenLastCalledWith('/account');
    expect(router.push).not.toHaveBeenCalled();
  });
});
