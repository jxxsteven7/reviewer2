// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import MailLinkPage from './MailLinkPage.vue';
import ProfilePage from './ProfilePage.vue';

const stubs = { PageMasthead: true, LanguageSwitch: true, AccountEntry: true, ProfileCard: true };

beforeEach(() => setLanguage('en', { remember: false }));

// A page's title stands on the bar under the masthead, with the way back before it when there is a
// page before (PageTitle.vue), and the masthead gives it the top of the screen then; the cards
// under it have no title of their own.
describe("a page's title", () => {
  test('of the pages that mails lead to is on the bar above the card', () => {
    const wrapper = mount(MailLinkPage, {
      props: { title: 'Choose a new password' },
      slots: { default: '<p class="intro">Setting it logs you out elsewhere.</p>' },
      global: { plugins: [i18n], stubs },
    });
    expect(wrapper.get('.page-title h1').text()).toBe('Choose a new password');
    expect(wrapper.findAll('h1')).toHaveLength(1);
    expect(wrapper.find('.content h1').exists()).toBe(false);
    expect(wrapper.get('page-masthead-stub').attributes('back')).toBe('true');
  });

  test("of a player's page is on the bar above the card", () => {
    const wrapper = mount(ProfilePage, { props: { handle: '0123456789ab' }, global: { plugins: [i18n], stubs } });
    expect(wrapper.get('.page-title h1').text()).toBe('Player page');
    expect(wrapper.findAll('h1')).toHaveLength(1);
    expect(wrapper.find('.card h1').exists()).toBe(false);
    expect(wrapper.get('page-masthead-stub').attributes('back')).toBe('true');
  });
});
