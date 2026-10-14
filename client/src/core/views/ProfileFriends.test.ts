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
const send = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../socket', () => ({ send }));
vi.mock('../toast', () => ({ toast: vi.fn(), toastError: vi.fn() }));

const NONE = { wonTogether: 0, lostTogether: 0, against: 0, beat: 0, beaten: 0 };
// The line keeps each number with its word by no-break spaces; the test reads them as spaces.
const plain = (text: string) => text.replace(/\u00a0/g, ' ');
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
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' }, teleport: true },
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
    const cards = wrapper.findAll('.list .friend');
    const games = (index: number) => plain(cards[index]?.find('.games').text() ?? '');
    const titles = (index: number) => cards[index]?.findAll('.folded-titles .title .pill').map((pill) => pill.text());
    expect(games(0)).toBe('As teammates: won 4, lost 1');
    expect(titles(0)).toEqual(['Co-First Author']);
    expect(games(1)).toBe('As teammates: won 4, lost 0 · As opponents: won 0, lost 3');
    expect(titles(1)).toEqual(['Co-First Author', 'Your Reviewer 2', 'Rival Reviewer']);
    expect(games(2)).toBe('As opponents: won 1, lost 0');
    expect(cards[2]?.find('.folded-titles').exists()).toBe(false);
    // A friend who shares no game has nothing under the name.
    expect(cards[3]?.find('.rest').exists()).toBe(false);

    const board = wrapper.find('.board');
    expect(board.find('h4').text()).toBe('Friend titles');
    // Each title with the avatar and the name of each friend who holds it, the avatar leading to
    // their page.
    expect(
      board
        .findAll('li')
        .map((line) => [line.find('.pill').text(), ...line.findAll('.holder-name').map((name) => name.text())]),
    ).toEqual([
      ['Co-First Author', 'Bob', 'Cat'],
      ['Your Reviewer 2', 'Cat'],
      ['Rival Reviewer', 'Cat'],
    ]);
    expect(
      board
        .findAll('li')[0]
        ?.findAll('.holder a')
        .map((link) => link.attributes('aria-label')),
    ).toEqual(["View Bob's profile", "View Cat's profile"]);
  });

  test("leads from each friend's avatar to their page, with the name as plain text and where they are beside it", () => {
    const online = { ...friend('Bob', null), online: true, room: { code: 'K7QX' } };
    const wrapper = mountWith([online, friend('Cat', null)]);
    const [bob, cat] = wrapper.findAll('.list .friend');
    expect(bob?.get('a.avatar-button').attributes('href')).toBe('/p/bob00000000');
    expect(bob?.get('a.avatar-button').attributes('aria-label')).toBe("View Bob's profile");
    expect(bob?.get('.name').element.tagName).toBe('SPAN');
    expect(bob?.get('.where').text().replace(/\s+/g, ' ')).toBe('online \u00b7 In room R2-K7QX');
    expect(bob?.get('a.join').attributes('href')).toBe('/room/K7QX');
    // An offline friend's whole card fades.
    expect(bob?.classes()).not.toContain('offline');
    expect(cat?.classes()).toContain('offline');
    expect(cat?.get('.where').text()).toBe('offline');
  });

  const press = async (wrapper: ReturnType<typeof mountWith>, text: string) => {
    const found = wrapper.findAll('[role=dialog] button').find((button) => button.text() === text);
    if (!found) throw new Error(`no button "${text}"`);
    await found.trigger('click');
  };

  test('removes a friend from behind the card\'s "more" button, after asking', async () => {
    send.mockClear();
    const wrapper = mountWith([friend('Bob', null)]);
    const more = wrapper.get('.friend button.more');
    expect(more.attributes('aria-label')).toBe('More for Bob');
    expect(wrapper.text()).not.toContain('Remove');
    await more.trigger('click');
    const sheet = wrapper.get('[role=dialog]');
    expect(sheet.get('h2').text()).toBe('Bob');
    expect(sheet.findAll('button').map((button) => button.text())).toEqual([
      '\u00d7',
      'Edit alias',
      'Remove friend',
      'Cancel',
    ]);
    await press(wrapper, 'Remove friend');
    expect(wrapper.get('[role=dialog]').text()).toContain('Remove Bob from your friends?');
    expect(send).not.toHaveBeenCalled();
    await press(wrapper, 'Remove friend');
    expect(send).toHaveBeenCalledWith('friends:remove', { username: 'Bob' });
  });

  test("gives a friend a name of the account's own, which shows with the username after it", async () => {
    send.mockClear();
    const wrapper = mountWith([{ ...friend('Bob', null), alias: 'Bobby' }, friend('Cat', null)]);
    const card = wrapper.findAll('.friend')[0];
    expect(card?.get('.name').text()).toBe('Bobby');
    expect(card?.get('.username').text()).toBe('Bob');
    expect(wrapper.findAll('.friend')[1]?.find('.username').exists()).toBe(false);
    await card?.get('button.more').trigger('click');
    expect(wrapper.get('[role=dialog] h2').text()).toBe('Bobby Bob');
    expect(wrapper.get('[role=dialog] h2 .subtitle').text()).toBe('Bob');
    await press(wrapper, 'Edit alias');
    // The sheet is drawn anew as it changes, so it is looked up each time.
    const sheet = () => wrapper.get('[role=dialog]');
    expect(sheet().get('h2').text()).toBe('Alias for Bob');
    expect(sheet().text()).toContain('Only you see it. Leave it empty to remove it. At most 20 characters.');
    expect((sheet().get('input').element as HTMLInputElement).value).toBe('Bobby');
    await sheet().get('input').setValue('x'.repeat(21));
    expect(sheet().text()).toContain('Use at most 20 characters.');
    await sheet().get('input').setValue('');
    await sheet().get('form').trigger('submit');
    expect(send).toHaveBeenCalledWith('friends:alias', { username: 'Bob', alias: '' });
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
    expect(plain(wrapper.find('.friend .games').text())).toBe('同队 3 胜 2 负');
    expect(wrapper.find('.board li .pill').text()).toBe('共同一作');
    expect(wrapper.find('.board li .holder-name').text()).toBe('Bob');
  });
});
