// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { nextTick } from 'vue';
import { account, loadAccount } from '../account';
import { i18n, setLanguage, storedLanguage } from '../i18n';
import HomeView from './HomeView.vue';
import PracticeRoom from './PracticeRoom.vue';

vi.mock('../socket', () => ({
  connect: vi.fn(),
  send: vi.fn(),
  onceConnected: vi.fn(),
  socket: { connected: false, on: vi.fn(), once: vi.fn(), off: vi.fn() },
}));
vi.mock('../fields', () => ({ fields: { value: null }, loadFields: vi.fn() }));
vi.mock('../../games', async () => {
  const { defaultSettings } = await import('@reviewer2/shared/keywords');
  const RulesSheet = (await import('../../games/keywords/KeywordsRules.vue')).default;
  return { games: { keywords: { Rules: RulesSheet, defaultSettings, guide: {} } } };
});
vi.mock('../account', () => ({ account: { loaded: true, summary: null, mail: false }, loadAccount: vi.fn() }));
vi.mock('../friends', () => ({ askToJoin: vi.fn(), friendsVersion: { value: 0 } }));
// The address that the page opens at, which a test may give a query.
const router = vi.hoisted(() => ({ route: { path: '/', query: {} as Record<string, string> }, replace: vi.fn() }));
vi.mock('vue-router', () => ({
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
  useRoute: () => router.route,
  useRouter: () => ({ push: vi.fn(), replace: router.replace }),
}));

const stubs = [
  'AccountEntry',
  'AcknowledgmentsList',
  'BackToRoom',
  'ContributionsList',
  'CreateRoom',
  'FriendsPlaying',
  'JoinRoom',
  'PageMasthead',
  'SendFeedback',
  'SponsorsList',
];

// The rules of the first game, beside its name, as a new room in the page's language has them.
describe('the rules on the home page', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test("open from the small word beside the game's name, at the defaults of the page's language", async () => {
    setLanguage('zh', { remember: true });
    const wrapper = mount(HomeView, { attachTo: document.body, global: { plugins: [i18n], stubs } });
    const link = wrapper.get('.entry .title button.rules-link');
    expect(link.text()).toBe('\u89c4\u5219');
    await link.trigger('click');
    const sheet = document.querySelector('[role=dialog]');
    expect(sheet?.querySelector('h2')?.textContent).toBe('\u600e\u4e48\u73a9');
    expect(sheet?.querySelector('.defaults')?.textContent).toContain('\u8fd9\u91cc\u662f\u9ed8\u8ba4\u8bbe\u7f6e');
    // "Default settings", not "Rules of this room".
    expect(sheet?.querySelector('section h3')?.textContent).toBe('\u9ed8\u8ba4\u8bbe\u7f6e');
    // A Chinese room at its defaults: clues of up to four characters, and the line on homophones.
    expect(sheet?.textContent).toContain('\u9e21\u97f3');
    wrapper.unmount();
    setLanguage('en', { remember: true });
  });
});

// The sheet that offers a cola: the WeChat reward code, and for players without WeChat a link to
// the author's GitHub Sponsors page, which opens in a new tab without a hand on this one.
describe('the tip sheet', () => {
  beforeEach(() => setLanguage('en', { remember: true }));
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('links GitHub Sponsors for players without WeChat', async () => {
    const wrapper = mount(HomeView, {
      attachTo: document.body,
      global: {
        plugins: [i18n],
        stubs: [
          'AccountEntry',
          'AcknowledgmentsList',
          'BackToRoom',
          'ContributionsList',
          'CreateRoom',
          'FriendsPlaying',
          'JoinRoom',
          'PageMasthead',
          'SendFeedback',
          'SponsorsList',
        ],
      },
    });
    await wrapper.get('footer button').trigger('click');
    const link = document.querySelector<HTMLAnchorElement>('[role=dialog] .sponsor a');
    expect(link?.textContent).toBe('No WeChat? Sponsor the author on GitHub');
    expect(link?.getAttribute('href')).toBe('https://github.com/sponsors/jxxsteven7');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    wrapper.unmount();
  });
});

// The home page in a language, /?lang=zh, as the sitemap lists it and the language gate links to it.
describe('the home page in a language', () => {
  beforeEach(() => setLanguage('en', { remember: true }));
  afterEach(() => {
    router.route.query = {};
    router.replace.mockClear();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    setLanguage('en', { remember: true });
  });

  test('opens in that language, which becomes the choice, and leaves the address', async () => {
    vi.stubGlobal('__SITE_URL__', 'https://example.com');
    router.route.query = { lang: 'zh', from: 'search' };
    const wrapper = mount(HomeView, { attachTo: document.body, global: { plugins: [i18n], stubs } });
    await nextTick();
    expect(i18n.global.locale.value).toBe('zh');
    expect(storedLanguage()).toBe('zh');
    expect(router.replace).toHaveBeenCalledWith({ query: { from: 'search' } });
    expect(wrapper.find('.gate').exists()).toBe(false);
    expect(document.title).toBe('Reviewer 2 \u00b7 \u5b66\u672f\u5708\u7684\u805a\u4f1a\u6e38\u620f');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://example.com/?lang=zh',
    );
    wrapper.unmount();
  });

  test('names no address of its own without SITE_URL', async () => {
    router.route.query = { lang: 'zh' };
    const wrapper = mount(HomeView, { attachTo: document.body, global: { plugins: [i18n], stubs } });
    await nextTick();
    expect(document.title).toBe('Reviewer 2 \u00b7 \u5b66\u672f\u5708\u7684\u805a\u4f1a\u6e38\u620f');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    wrapper.unmount();
  });

  test('leaves the address as it is for a language it has not', () => {
    router.route.query = { lang: 'fr' };
    const wrapper = mount(HomeView, { attachTo: document.body, global: { plugins: [i18n], stubs } });
    expect(i18n.global.locale.value).toBe('en');
    expect(router.replace).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

// The way into the tutorial in the first game's card, and the places that the tutorial leads to.
describe('the way into the tutorial', () => {
  beforeEach(() => setLanguage('en', { remember: true }));
  afterEach(() => {
    Object.assign(account, { loaded: true, summary: null });
    router.route.query = {};
    router.replace.mockClear();
    document.body.innerHTML = '';
  });
  const mountHome = () =>
    mount(HomeView, { attachTo: document.body, global: { plugins: [i18n], stubs: [...stubs, 'PracticeRoom'] } });

  test('is a green sticker above the button for a new room, for a guest', () => {
    const wrapper = mountHome();
    const entry = wrapper.get('.entry .guide-entry');
    expect(entry.attributes('href')).toBe('/guide');
    expect(entry.text()).toContain('Tutorial');
    expect(wrapper.find('.guide-link').exists()).toBe(false);
    wrapper.unmount();
  });

  test('is a small word beside the rules for an account that has played the game, which the page asks for again', () => {
    Object.assign(account, { summary: { username: 'Ann', played: ['keywords'] } });
    const wrapper = mountHome();
    expect(wrapper.find('.guide-entry').exists()).toBe(false);
    expect(wrapper.get('.entry .title .guide-link').attributes('href')).toBe('/guide');
    expect(loadAccount).toHaveBeenCalled();
    wrapper.unmount();
  });

  test('is the sticker for an account that has played no game of it yet, and nothing until the page knows who it is', () => {
    Object.assign(account, { summary: { username: 'Ann', played: [] } });
    const played = mountHome();
    expect(played.find('.guide-entry').exists()).toBe(true);
    played.unmount();
    Object.assign(account, { loaded: false, summary: null });
    const unknown = mountHome();
    expect(unknown.find('.guide-entry').exists()).toBe(false);
    expect(unknown.find('.guide-link').exists()).toBe(false);
    unknown.unmount();
  });

  test('leads to the room setup open, without the sticker, and drops that from the address', async () => {
    router.route.query = { create: '1' };
    const wrapper = mountHome();
    await nextTick();
    expect(wrapper.find('create-room-stub').exists()).toBe(true);
    expect(wrapper.find('.guide-entry').exists()).toBe(false);
    expect(router.replace).toHaveBeenCalledWith({ query: {} });
    wrapper.unmount();
  });

  test('leads to the practice sheet with who plays and the role chosen, or neither for anything else', async () => {
    router.route.query = { practice: 'guesser' };
    const alone = mountHome();
    expect(alone.getComponent(PracticeRoom).props('preset')).toEqual({ who: 'me', role: 'guesser' });
    expect(router.replace).toHaveBeenCalledWith({ query: {} });
    // The sheet takes them once: back from the room setup, which stands in its place meanwhile, it
    // has none to open with.
    alone.getComponent(PracticeRoom).vm.$emit('taken');
    await nextTick();
    expect(alone.getComponent(PracticeRoom).props('preset')).toBeNull();
    await alone.get('.entry .button.primary').trigger('click');
    expect(alone.find('create-room-stub').exists()).toBe(true);
    alone.getComponent({ name: 'CreateRoom' }).vm.$emit('cancel');
    await nextTick();
    expect(alone.getComponent(PracticeRoom).props('preset')).toBeNull();
    alone.unmount();
    router.route.query = { practice: 'friends' };
    const friends = mountHome();
    expect(friends.getComponent(PracticeRoom).props('preset')).toEqual({ who: 'friends' });
    friends.unmount();
    router.route.query = { practice: 'chair' };
    const neither = mountHome();
    expect(neither.getComponent(PracticeRoom).props('preset')).toBeNull();
    neither.unmount();
  });
});
