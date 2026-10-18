// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test } from 'vitest';
import { nextTick } from 'vue';
import ProfileCard from '../components/ProfileCard.vue';
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

// The tab's title is the page's, then the site's name, in the interface's language (head.ts).
describe("a page's tab", () => {
  test("names a player's page, and the player once the card has read who they are", async () => {
    const wrapper = mount(ProfilePage, { props: { handle: '0123456789ab' }, global: { plugins: [i18n], stubs } });
    await nextTick();
    expect(document.title).toBe('Player page \u00b7 Reviewer 2');
    wrapper.getComponent(ProfileCard).vm.$emit('name', 'Mira');
    await nextTick();
    expect(document.title).toBe('Mira \u00b7 Player page \u00b7 Reviewer 2');
    // Search engines may read it, but are asked not to list it.
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
    wrapper.unmount();
    await nextTick();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  test('names the pages that mails lead to by their title', async () => {
    const wrapper = mount(MailLinkPage, {
      props: { title: 'Choose a new password' },
      global: { plugins: [i18n], stubs },
    });
    await nextTick();
    expect(document.title).toBe('Choose a new password \u00b7 Reviewer 2');
    wrapper.unmount();
  });
});
