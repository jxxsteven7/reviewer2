// @vitest-environment happy-dom
import type { DuoView, FriendsView, FriendView } from '@reviewer2/shared';
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import ProfileFriends from './ProfileFriends.vue';

// The friends on the account page, with what the account has played with each and the titles
// they hold among its friends (docs/architecture.md#friend-duos).

const list = vi.hoisted(() => ({ view: null as unknown }));
vi.mock('../useFriendsList', () => ({
  useFriendsList: () => ({ view: list.view, failed: ref(null), load: vi.fn() }),
}));
vi.mock('../socket', () => ({ send: vi.fn() }));
vi.mock('../toast', () => ({ toast: vi.fn(), toastError: vi.fn() }));

const NONE = { wonTogether: 0, lostTogether: 0, against: 0, beat: 0, beaten: 0 };
const friend = (username: string, duo: DuoView | null): FriendView => ({
  handle: `${username.toLowerCase()}00000000`.slice(0, 12),
  username,
  avatar: null,
  online: false,
  room: null,
  duo,
});

function mountWith(friends: FriendView[], locale: 'en' | 'zh' = 'en') {
  list.view = ref<FriendsView>({ friends, incoming: [], outgoing: [] });
  return mount(ProfileFriends, {
    global: {
      plugins: [createI18n({ legacy: false, locale, messages: { en, zh } })],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });
}

describe('ProfileFriends', () => {
  test('shows what the account has played with each friend, and who holds which title', () => {
    const wrapper = mountWith([
      friend('Bob', { ...NONE, wonTogether: 4, lostTogether: 1, titles: ['coauthor'] }),
      friend('Cat', { ...NONE, wonTogether: 4, against: 3, beaten: 3, titles: ['coauthor', 'reviewer2', 'rival'] }),
      friend('Dan', { ...NONE, against: 1, beat: 1, titles: [] }),
      friend('Eve', null),
    ]);
    const lines = wrapper.findAll('.list .line');
    const duoOf = (index: number) => lines[index]?.find('.duo');
    expect(duoOf(0)?.find('.games').text()).toBe('As teammates: won 4, lost 1');
    expect(
      duoOf(0)
        ?.findAll('.badge')
        .map((badge) => badge.text()),
    ).toEqual(['Co-First Author']);
    expect(duoOf(1)?.find('.games').text()).toBe('As teammates: won 4, lost 0 · As opponents: won 0, lost 3');
    expect(
      duoOf(1)
        ?.findAll('.badge')
        .map((badge) => badge.text()),
    ).toEqual(['Co-First Author', 'Your Reviewer 2', 'Rival Reviewer']);
    expect(duoOf(2)?.find('.games').text()).toBe('As opponents: won 1, lost 0');
    expect(duoOf(2)?.find('.badge').exists()).toBe(false);
    // A friend who shares no game has no line.
    expect(duoOf(3)?.exists()).toBe(false);

    const board = wrapper.find('.board');
    expect(board.find('h4').text()).toBe('Friend titles');
    expect(board.findAll('li').map((line) => [line.find('button').text(), line.find('.holder-names').text()])).toEqual([
      ['Co-First Author', 'Bob and Cat'],
      ['Your Reviewer 2', 'Cat'],
      ['Rival Reviewer', 'Cat'],
    ]);
  });

  test('has no board while no friend holds a title', () => {
    const wrapper = mountWith([friend('Bob', { ...NONE, wonTogether: 2, titles: [] }), friend('Cat', null)]);
    expect(wrapper.find('.board').exists()).toBe(false);
  });

  test('says it in Chinese too', () => {
    const wrapper = mountWith(
      [friend('Bob', { ...NONE, wonTogether: 3, lostTogether: 2, titles: ['coauthor'] })],
      'zh',
    );
    expect(wrapper.find('.duo .games').text()).toBe('同队 3 胜 2 负');
    expect(wrapper.find('.board li button').text()).toBe('共同一作');
    expect(wrapper.find('.board li .holder-names').text()).toBe('Bob');
  });
});
