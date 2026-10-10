// @vitest-environment happy-dom
import type { Ack } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import SignIn from './SignIn.vue';

// The router: where the page goes after signing in, and what the address asked for.
const router = vi.hoisted(() => ({ push: vi.fn(), query: {} as Record<string, unknown> }));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: router.push }),
  useRoute: () => ({ query: router.query }),
}));
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

// Logs in, from a page whose address asked for `next`, if it did.
async function signIn(next?: string) {
  router.query = next === undefined ? {} : { next };
  const wrapper = mount(SignIn, { global: { plugins: [i18n], stubs: { RouterLink: true } } });
  await wrapper.get('input[autocomplete="username"]').setValue('Ann');
  await wrapper.get('input[autocomplete="current-password"]').setValue('correct horse');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}

describe('signing in', () => {
  test('leads back to the room, or the screen of one, that sent the player, and else home', async () => {
    const paths: [string | undefined, string][] = [
      [undefined, '/'],
      ['/room/K7QX', '/room/K7QX'],
      ['/room/K7QX/screen', '/room/K7QX/screen'],
      // Only room paths are honored: not another page, another site or a path with more in it.
      ['/account', '/'],
      ['https://elsewhere.example/room/K7QX', '/'],
      ['/room/K7QX/../account', '/'],
    ];
    for (const [next, path] of paths) {
      await signIn(next);
      expect(router.push).toHaveBeenLastCalledWith(path);
    }
  });
});
