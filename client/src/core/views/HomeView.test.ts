// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import HomeView from './HomeView.vue';

vi.mock('../socket', () => ({
  connect: vi.fn(),
  send: vi.fn(),
  onceConnected: vi.fn(),
  socket: { connected: false, on: vi.fn(), once: vi.fn(), off: vi.fn() },
}));
vi.mock('../fields', () => ({ fields: { value: null }, loadFields: vi.fn() }));
vi.mock('../../games', async () => {
  const { defaultSettings } = await import('@reviewer2/shared');
  const RulesSheet = (await import('../../games/keywords/RulesSheet.vue')).default;
  return { games: { keywords: { Rules: RulesSheet, defaultSettings } } };
});
vi.mock('../account', () => ({ account: { loaded: true, summary: null, mail: false } }));
vi.mock('../friends', () => ({ askToJoin: vi.fn(), friendsVersion: { value: 0 } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
