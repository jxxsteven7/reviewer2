// @vitest-environment happy-dom
import type { AccountSummary } from '@reviewer2/shared';
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import ProfileView from './ProfileView.vue';

// The top of the account's own page: who it is, on one card.

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../account', () => ({ changeLogin: vi.fn(), loadAccount: vi.fn(), request: vi.fn() }));
vi.mock('../toast', () => ({ toast: vi.fn(), toastError: vi.fn() }));

const summary: AccountSummary = {
  id: 7,
  handle: 'a1b2c3d4e5f6',
  username: 'Ann',
  avatar: '/avatars/a.webp',
  createdAt: '2026-10-01T08:00:00.000Z',
  email: 'none',
  points: 40,
  titles: [],
  streaks: { wins: 0, losses: 0 },
  contributions: [],
  profile: { link: null, bio: null, showRecord: false, showThanks: false, banned: false },
  likes: 0,
  requests: 0,
  roomSetup: {},
};

const mountPage = () =>
  mount(ProfileView, {
    props: { summary },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })],
      stubs: { ProfilePublic: true, ProfileFriends: true, ProfileEmail: true, ProfileRecords: true },
    },
  });

describe('ProfileView', () => {
  test('shows who the account is on one card: the avatar, the name, the number and the ways to change them', async () => {
    const wrapper = mountPage();
    const card = wrapper.find('section.identity');
    expect(card.attributes('aria-labelledby')).toBe('profile-username');
    expect(card.find('#profile-username').text()).toBe('Ann');
    expect(card.find('.avatar img').attributes('src')).toBe('/avatars/a.webp');
    expect(card.text()).toContain('Player No. 7');
    expect(card.text()).toContain('Registered Oct 1, 2026');
    const buttons = () => card.findAll('button').map((button) => button.text());
    expect(buttons()).toEqual(['Rename', 'Upload a picture', 'Use the default']);
    // The username has no card of its own any more.
    expect(wrapper.findAll('h2').map((heading) => heading.text())).not.toContain('Username');

    // Renaming opens the form on the same card, under the name, which stays.
    await card.find('button').trigger('click');
    expect(card.find('form.inline-form').exists()).toBe(true);
    expect(card.find('#profile-username').text()).toBe('Ann');
    expect(buttons()).not.toContain('Rename');
  });
});
