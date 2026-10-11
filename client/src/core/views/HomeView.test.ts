// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import HomeView from './HomeView.vue';

vi.mock('../socket', () => ({
  connect: vi.fn(),
  send: vi.fn(),
  onceConnected: vi.fn(),
  socket: { connected: false, once: vi.fn(), off: vi.fn() },
}));
vi.mock('../fields', () => ({ fields: { value: null }, loadFields: vi.fn() }));
vi.mock('../../games', () => ({ games: {} }));
vi.mock('../account', () => ({ account: { loaded: true, summary: null, mail: false } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
        stubs: ['AccountEntry', 'BackToRoom', 'CreateRoom', 'JoinRoom', 'SendFeedback', 'PageMasthead'],
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
