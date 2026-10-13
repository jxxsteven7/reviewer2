// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import AccountEntry from './AccountEntry.vue';

const signedIn = vi.hoisted(() => ({
  account: { loaded: true, summary: null as object | null, mail: false },
}));
vi.mock('../account', async () => {
  const { reactive } = await import('vue');
  signedIn.account = reactive(signedIn.account);
  return signedIn;
});

const global = () => ({
  plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
  stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
});

describe('AccountEntry', () => {
  beforeEach(() => {
    signedIn.account.summary = null;
  });

  test('offers to log in, or shows the account with the friend requests that wait', () => {
    const guest = mount(AccountEntry, { global: global() });
    expect(guest.text()).toBe('Log in');
    guest.unmount();

    signedIn.account.summary = { username: 'Ann', avatar: null, requests: 0 };
    const quiet = mount(AccountEntry, { global: global() });
    expect(quiet.find('.badge').exists()).toBe(false);
    expect(quiet.find('a').attributes('aria-label')).toBe('Your account: Ann');
    quiet.unmount();

    signedIn.account.summary = { username: 'Ann', avatar: null, requests: 3 };
    const waiting = mount(AccountEntry, { global: global() });
    expect(waiting.find('.badge').text()).toBe('3');
    expect(waiting.find('.badge').attributes('aria-hidden')).toBe('true');
    expect(waiting.find('a').attributes('aria-label')).toBe(
      'Your account: Ann. 3 friend requests are waiting for your answer.',
    );
    waiting.unmount();

    signedIn.account.summary = { username: 'Ann', avatar: null, requests: 1 };
    const one = mount(AccountEntry, { global: global() });
    expect(one.find('.badge').text()).toBe('1');
    expect(one.find('a').attributes('aria-label')).toBe(
      'Your account: Ann. 1 friend request is waiting for your answer.',
    );
    one.unmount();
  });
});
