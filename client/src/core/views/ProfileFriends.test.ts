// @vitest-environment happy-dom
import type { DuoView, FriendsView, FriendView, ProfileView } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import ProfilePanel from '../components/ProfilePanel.vue';
import { closeProfile } from '../profilePanel';
import ProfileFriends from './ProfileFriends.vue';

// The friends on the account page, with what the account has played with each and the titles
// they hold among its friends (docs/architecture.md#friend-duos), and the search for someone to ask
// (docs/architecture.md#friends).

const list = vi.hoisted(() => ({ view: null as unknown }));
vi.mock('../useFriendsList', () => ({
  useFriendsList: () => ({ view: list.view, failed: ref(null), load: vi.fn() }),
}));
const send = vi.hoisted(() => vi.fn<(event: string, payload?: object) => Promise<object>>(async () => ({ ok: true })));
vi.mock('../socket', () => ({
  send,
  connect: vi.fn(),
  whenConnected: async () => true,
  socket: { connected: true, on: vi.fn(), off: vi.fn() },
}));
vi.mock('../toast', () => ({ toast: vi.fn(), toastError: vi.fn() }));
const asks = vi.hoisted(() => ({
  askToJoin: vi.fn(async () => true),
  answerFriend: vi.fn(async () => true),
  requestFriend: vi.fn(async () => true),
}));
const { askToJoin } = asks;
vi.mock('../friends', async (actual) => ({ ...(await actual<typeof import('../friends')>()), ...asks }));
// Who the account is, and the public pages that the panel and a pasted link read.
const signedIn = vi.hoisted(() => ({
  account: { loaded: true, summary: { handle: 'me0000000000' } },
  request: vi.fn<(path: string) => Promise<object>>(async () => ({ ok: false, error: 'no_such_profile' })),
  loadAccount: vi.fn(),
}));
vi.mock('../account', () => signedIn);

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

// The section with the site's panel of an account beside it (profilePanel.ts), which the search
// and the avatars open, as App.vue holds it beside the page.
const SectionWithPanel = defineComponent({
  render: () => h('div', [h(ProfileFriends), h(ProfilePanel)]),
});
// A link of the router, which hands its address to the slot of a `custom` one, as RouterLink does.
const routerLink = {
  props: { to: String, custom: Boolean },
  template: '<slot v-if="custom" :href="to" :navigate="() => undefined" /><a v-else :href="to"><slot /></a>',
};

function mountWith(
  friends: FriendView[],
  locale: 'en' | 'zh' = 'en',
  requests: Pick<FriendsView, 'incoming' | 'outgoing'> = { incoming: [], outgoing: [] },
) {
  list.view = ref<FriendsView>({ friends, ...requests });
  closeProfile();
  return mount(SectionWithPanel, {
    global: {
      plugins: [createI18n({ legacy: false, locale, messages: { en, zh } })],
      stubs: { RouterLink: routerLink, teleport: true },
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
        ?.findAll('.holder button')
        .map((avatar) => avatar.attributes('aria-label')),
    ).toEqual(["View Bob's profile", "View Cat's profile"]);
  });

  test("opens each friend's panel from their avatar, with the name as plain text and the way into their room beside it", async () => {
    const online = { ...friend('Bob', null), online: true, room: { code: 'K7QX' } };
    const wrapper = mountWith([online, friend('Cat', null)]);
    const [bob, cat] = wrapper.findAll('.list .friend');
    expect(bob?.get('button.avatar-button').attributes('aria-label')).toBe("View Bob's profile");
    await bob?.get('button.avatar-button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role=dialog]:has(.panel-body) h2').text()).toBe('Bob');
    expect(bob?.get('.name').element.tagName).toBe('SPAN');
    // Online: a green dot on the avatar, with the word for screen readers alone, and the way into
    // the room on the name's line.
    expect(bob?.find('.face .dot').exists()).toBe(true);
    expect(bob?.get('.top .sr-only').text()).toBe('online');
    expect(bob?.get('.top a.join').text()).toBe('Join room');
    expect(bob?.get('a.join').attributes('href')).toBe('/room/K7QX');
    // An offline friend's whole card fades, with no dot.
    expect(bob?.classes()).not.toContain('offline');
    expect(cat?.classes()).toContain('offline');
    expect(cat?.find('.dot').exists()).toBe(false);
    expect(cat?.get('.top .sr-only').text()).toBe('offline');
    expect(cat?.find('.join').exists()).toBe(false);
  });

  test('answers a request on its card as the panels do, and takes one back', async () => {
    asks.answerFriend.mockClear();
    const bob = { handle: 'b0b000000000', username: 'Bob', avatar: null, note: 'Hi' };
    const cat = { handle: 'ca7000000000', username: 'Cat', avatar: null };
    const wrapper = mountWith([], 'en', { incoming: [bob], outgoing: [cat] });
    const card = (name: string) => {
      const found = wrapper.findAll('.request').find((request) => request.get('.name').text() === name);
      if (!found) throw new Error(`no request of ${name}`);
      return found;
    };
    expect(card('Bob').get('.note').text()).toBe('\u201cHi\u201d');
    await card('Bob').findAll('.end button')[0]?.trigger('click');
    expect(asks.answerFriend).toHaveBeenLastCalledWith('Bob', 'accept');
    await card('Bob').findAll('.end button')[1]?.trigger('click');
    expect(asks.answerFriend).toHaveBeenLastCalledWith('Bob', 'decline');
    await card('Cat').get('.end button').trigger('click');
    expect(asks.answerFriend).toHaveBeenLastCalledWith('Cat', 'remove');
  });

  test('asks a friend in a private room to be let in, and says so while the request stands', async () => {
    const inPrivate = { ...friend('Bob', null), online: true, room: { code: null } };
    const wrapper = mountWith([inPrivate, { ...friend('Cat', null), online: true, room: { code: null }, asked: true }]);
    const [bob, cat] = wrapper.findAll('.list .friend');
    expect(bob?.find('a.join').exists()).toBe(false);
    const asking = bob?.get('.top button.join');
    expect(asking?.text()).toBe('Ask to join room');
    await asking?.trigger('click');
    expect(askToJoin).toHaveBeenCalledWith('Bob');
    expect(cat?.get('button.join').text()).toBe('Asked');
    expect(cat?.get('button.join').attributes('disabled')).toBeDefined();
  });

  const press = async (wrapper: ReturnType<typeof mountWith>, text: string) => {
    const found = wrapper.findAll('[role=dialog] button').find((button) => button.text() === text);
    if (!found) throw new Error(`no button "${text}"`);
    await found.trigger('click');
  };

  test('removes a friend from behind the card\'s "more" button, after asking', async () => {
    send.mockClear();
    asks.answerFriend.mockClear();
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
    expect(asks.answerFriend).not.toHaveBeenCalled();
    await press(wrapper, 'Remove friend');
    await flushPromises();
    expect(asks.answerFriend).toHaveBeenCalledWith('Bob', 'remove');
    expect(wrapper.find('[role=dialog]').exists()).toBe(false);
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

describe('the search on the account page', () => {
  const page = (handle: string, username: string): ProfileView => ({
    id: 5,
    handle,
    username,
    avatar: null,
    rank: 'phd',
    createdAt: '2026-10-01',
    titles: [],
    streaks: { wins: 0, losses: 0 },
    link: null,
    bio: null,
    record: null,
    contributions: null,
    likes: 0,
    liked: false,
    mine: false,
    duo: null,
  });
  const cat = { handle: 'ca7000000000', username: 'Cat', avatar: null };

  beforeEach(() => {
    send.mockReset();
    signedIn.request.mockReset();
    signedIn.request.mockImplementation(async (path) => {
      const handle = path.split('/').at(-1) as string;
      return handle === cat.handle
        ? { ok: true, profile: page(handle, 'Cat') }
        : { ok: false, error: 'no_such_profile' };
    });
    asks.answerFriend.mockClear();
    asks.requestFriend.mockClear();
  });

  // Whoever the server finds by name, and every other message answered with { ok: true }.
  const finds = (found: object) =>
    send.mockImplementation(async (event) => (event === 'friends:find' ? found : { ok: true }));
  const search = async (wrapper: ReturnType<typeof mountWith>, text: string) => {
    await wrapper.get('form.search input').setValue(text);
    await wrapper.get('form.search').trigger('submit');
    await flushPromises();
  };
  const panel = (wrapper: ReturnType<typeof mountWith>) => wrapper.get('[role=dialog]:has(.panel-body)');
  const offers = (wrapper: ReturnType<typeof mountWith>) =>
    panel(wrapper)
      .findAll('.panel-actions button')
      .map((button) => [button.text(), button.attributes('disabled') !== undefined]);
  // A sheet over the panel, by its title.
  const sheet = (wrapper: ReturnType<typeof mountWith>, title: string) => {
    const found = wrapper.findAll('[role=dialog]').find((dialog) => dialog.get('h2').text() === title);
    if (!found) throw new Error(`no sheet "${title}"`);
    return found;
  };

  test('finds an account by its whole username, and asks it in a sheet with a line for it', async () => {
    finds({ ok: true, ...cat });
    const wrapper = mountWith([]);
    expect(wrapper.get('form.search button').attributes('disabled')).toBeDefined();
    await search(wrapper, ' cat ');
    expect(send).toHaveBeenCalledWith('friends:find', { username: 'cat' });
    expect(panel(wrapper).get('h2').text()).toBe('Cat');
    expect(panel(wrapper).text()).toContain('PhD student');
    expect(offers(wrapper)).toEqual([
      ['Add friend', false],
      ['Open the full page', false],
    ]);
    // The sheet with a line for them lies over the panel.
    await panel(wrapper).findAll('.panel-actions button')[0]?.trigger('click');
    expect(wrapper.findAll('[role=dialog]')).toHaveLength(2);
    const asking = sheet(wrapper, 'Add Cat as a friend');
    await asking.get('input').setValue('Lab mate?');
    await asking.get('form').trigger('submit');
    await flushPromises();
    expect(asks.requestFriend).toHaveBeenCalledWith({ username: 'Cat' }, 'Lab mate?');
    expect(wrapper.find('[role=dialog]').exists()).toBe(false);
    expect((wrapper.get('form.search input').element as HTMLInputElement).value).toBe('');
  });

  test('offers by how the two stand, and the whole page over the panel', async () => {
    const asked = mountWith([], 'en', { incoming: [], outgoing: [cat] });
    finds({ ok: true, ...cat });
    await search(asked, 'Cat');
    expect(offers(asked)).toEqual([
      ['Request sent', true],
      ['Open the full page', false],
    ]);
    await panel(asked).findAll('.panel-actions button')[1]?.trigger('click');
    await flushPromises();
    // The whole page, which says the same of the request.
    const whole = asked.findAll('[role=dialog]').at(-1);
    expect(whole?.get('h2').text()).toBe('Cat');
    expect(whole?.get('.actions').text()).toContain('Request sent');
    asked.unmount();

    // Cat asked the account, with a line, which the panel shows, and the account accepts.
    const asking = mountWith([], 'en', { incoming: [{ ...cat, note: 'Hello' }], outgoing: [] });
    await search(asking, 'Cat');
    expect(panel(asking).get('.asked-you').text()).toBe('They asked to be your friend\u201cHello\u201d');
    expect(offers(asking).map(([text]) => text)).toEqual(['Accept', 'Decline', 'Open the full page']);
    await panel(asking).findAll('.panel-actions button')[0]?.trigger('click');
    await flushPromises();
    expect(asks.answerFriend).toHaveBeenCalledWith('Cat', 'accept');
    expect(asking.find('[role=dialog]').exists()).toBe(false);
    asking.unmount();

    // A friend goes by the account's name for them, and may be given another, or parted from.
    const friendly = mountWith([{ ...friend('Cat', null), handle: cat.handle, alias: 'Kitty' }]);
    await search(friendly, 'Cat');
    expect(panel(friendly).get('h2').text()).toBe('Kitty Cat');
    expect(offers(friendly)).toEqual([
      ['Edit alias', false],
      ['Remove friend', false],
      ['Open the full page', false],
    ]);
    await panel(friendly).findAll('.panel-actions button')[0]?.trigger('click');
    expect((sheet(friendly, 'Alias for Cat').get('input').element as HTMLInputElement).value).toBe('Kitty');
    await sheet(friendly, 'Alias for Cat').get('form').trigger('submit');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('friends:alias', { username: 'Cat', alias: 'Kitty' });
    expect(friendly.find('[role=dialog]').exists()).toBe(false);
    await search(friendly, 'Cat');
    await panel(friendly).findAll('.panel-actions button')[1]?.trigger('click');
    const parting = sheet(friendly, 'Cat');
    expect(parting.text()).toContain('Remove Cat from your friends?');
    await parting
      .findAll('button')
      .find((button) => button.text() === 'Remove friend')
      ?.trigger('click');
    await flushPromises();
    expect(asks.answerFriend).toHaveBeenCalledWith('Cat', 'remove');
    expect(friendly.find('[role=dialog]').exists()).toBe(false);
    friendly.unmount();

    // The account itself.
    const self = mountWith([]);
    finds({ ok: true, handle: 'me0000000000', username: 'Me' });
    await search(self, 'me');
    expect(panel(self).text()).toContain('This is you.');
    // The way to the account page, where the account is changed, and its page as others see it.
    const mine = panel(self).get('.panel-actions a');
    expect([mine.text(), mine.attributes('href')]).toEqual(['My account', '/account']);
    expect(offers(self).map(([text]) => text)).toEqual(['Open the full page']);
    self.unmount();
  });

  test('reads a link to a page, with words around it, as the page and not as a name', async () => {
    const wrapper = mountWith([]);
    await search(wrapper, 'Add me: https://reviewer2.example/p/CA7000000000 thanks');
    expect(signedIn.request).toHaveBeenCalledWith('/api/profile/ca7000000000');
    expect(send).not.toHaveBeenCalledWith('friends:find', expect.anything());
    expect(panel(wrapper).get('h2').text()).toBe('Cat');
    wrapper.unmount();
  });

  test("asks the server for nothing that can't be a username, and knows a link that leads to no page", async () => {
    const wrapper = mountWith([]);
    const said = () => wrapper.get('form.search .note.error').text();
    // Longer than a name, or with a link in it that is no page's: no search is spent.
    await search(wrapper, 'x'.repeat(17));
    expect(said()).toBe("No account has that username. Type the full username; capitals don't matter.");
    await search(wrapper, 'Come and play https://reviewer2.example/room/K7QX tonight');
    expect(said()).toBe("That isn't the link to a player's page. Paste the link as the page shares it.");
    await search(wrapper, 'https://reviewer2.example/p/0123456789');
    expect(said()).toBe("That isn't the link to a player's page. Paste the link as the page shares it.");
    expect(send).not.toHaveBeenCalled();
    expect(signedIn.request).not.toHaveBeenCalled();
    // The box takes more than a name's length, for a link with the text around it.
    expect(Number(wrapper.get('form.search input').attributes('maxlength'))).toBeGreaterThan(256);
    wrapper.unmount();
  });

  test('keeps the button, and gives the focus back to the box once a request has gone', async () => {
    // The server answers the search once told to.
    let answer: (found: object) => void = () => {};
    send.mockImplementation((event) =>
      event === 'friends:find' ? new Promise<object>((resolve) => (answer = resolve)) : Promise.resolve({ ok: true }),
    );
    list.view = ref<FriendsView>({ friends: [], incoming: [], outgoing: [] });
    closeProfile();
    // On the page, so that the focus moves; the sheets are drawn in place.
    const wrapper = mount(SectionWithPanel, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages: { en, zh } })],
        stubs: { RouterLink: routerLink, teleport: true },
      },
      attachTo: document.body,
    });
    const input = wrapper.get('form.search input').element as HTMLInputElement;
    await wrapper.get('form.search input').setValue('Cat');
    const button = wrapper.get('form.search button');
    (button.element as HTMLButtonElement).focus();
    // The button stays as it is while the search is on its way, so that the focus stays with it.
    await wrapper.get('form.search').trigger('submit');
    await flushPromises();
    expect(button.attributes('disabled')).toBeUndefined();
    expect(document.activeElement).toBe(button.element);
    answer({ ok: true, ...cat });
    await flushPromises();
    expect(panel(wrapper).get('h2').text()).toBe('Cat');
    expect(document.activeElement?.closest('[role=dialog]')).not.toBeNull();
    await panel(wrapper).findAll('.panel-actions button')[0]?.trigger('click');
    await sheet(wrapper, 'Add Cat as a friend').get('form').trigger('submit');
    await flushPromises();
    expect(asks.requestFriend).toHaveBeenCalledWith({ username: 'Cat' }, null);
    expect(wrapper.find('[role=dialog]').exists()).toBe(false);
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    wrapper.unmount();
  });

  test('says under the box why nobody was found, until the box changes', async () => {
    const wrapper = mountWith([]);
    const said = () => wrapper.find('form.search .note.error');
    finds({ ok: false, error: 'no_such_account' });
    await search(wrapper, 'Ca');
    expect(said().text()).toBe("No account has that username. Type the full username; capitals don't matter.");
    expect(wrapper.find('[role=dialog]').exists()).toBe(false);
    await wrapper.get('form.search input').setValue('Cat');
    expect(said().exists()).toBe(false);
    finds({ ok: false, error: 'friend_find_limited' });
    await search(wrapper, 'Cat');
    expect(said().text()).toBe("You've searched a lot this hour. Try again later.");
    await search(wrapper, 'https://reviewer2.example/p/000000000000');
    expect(said().text()).toBe('There is no such page. The account may have been deleted.');
    wrapper.unmount();
  });

  test('says it in Chinese too', async () => {
    finds({ ok: false, error: 'no_such_account' });
    const wrapper = mountWith([], 'zh');
    expect(wrapper.get('form.search label').text()).toBe('按用户名或主页链接找人');
    await search(wrapper, 'Ca');
    expect(wrapper.get('form.search .note.error').text()).toBe('没有这个用户名。要输入完整的用户名，大小写都行。');
    wrapper.unmount();
  });
});
