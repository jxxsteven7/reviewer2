// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { pageTitle, siteAddress, usePageHead, useUrgentTitle, type Head } from './head';
import { i18n, setLanguage } from './i18n';

// What index.html has, in both languages, before any page puts its own in place.
beforeAll(() => {
  document.title = 'Reviewer 2 \u00b7 Both languages';
  const description = document.createElement('meta');
  description.setAttribute('name', 'description');
  description.setAttribute('content', 'Both descriptions');
  document.head.append(description);
});

const description = () => document.head.querySelector('meta[name="description"]')?.getAttribute('content');
const canonical = () => document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;

// A page with a head of its own, or a part of one with an urgent title, such as a game's strip.
const Page = defineComponent({
  props: { head: { type: Function, default: null }, urgent: { type: Function, default: null } },
  setup(props) {
    if (props.head) usePageHead(props.head as () => Head);
    if (props.urgent) useUrgentTitle(props.urgent as () => string | null);
    return () => h('p');
  },
});

describe("a page's head", () => {
  test("is the page's while it is shown, and index.html's again once it goes", async () => {
    const title = ref('Your account \u00b7 Reviewer 2');
    const page = mount(Page, {
      props: {
        head: () => ({ title: title.value, description: 'Yours', canonical: 'https://example.com/', noindex: true }),
      },
    });
    await nextTick();
    expect(document.title).toBe('Your account \u00b7 Reviewer 2');
    expect(description()).toBe('Yours');
    expect(canonical()).toBe('https://example.com/');
    expect(robots()).toBe('noindex');
    title.value = 'Player page \u00b7 Reviewer 2';
    await nextTick();
    expect(document.title).toBe('Player page \u00b7 Reviewer 2');
    page.unmount();
    await nextTick();
    expect(document.title).toBe('Reviewer 2 \u00b7 Both languages');
    expect(description()).toBe('Both descriptions');
    expect(canonical()).toBeNull();
    expect(robots()).toBeNull();
  });

  test("keeps index.html's for what a page leaves out", async () => {
    const page = mount(Page, { props: { head: () => ({ canonical: 'https://example.com/' }) } });
    await nextTick();
    expect(document.title).toBe('Reviewer 2 \u00b7 Both languages');
    expect(description()).toBe('Both descriptions');
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    page.unmount();
  });

  test("is the next page's once it opens, whichever of the two goes first", async () => {
    const before = mount(Page, { props: { head: () => ({ title: 'Before' }) } });
    const after = mount(Page, { props: { head: () => ({ title: 'After' }) } });
    before.unmount();
    await nextTick();
    expect(document.title).toBe('After');
    after.unmount();
  });

  test('follows the language', async () => {
    setLanguage('en', { remember: false });
    const page = mount(Page, { props: { head: () => ({ title: pageTitle(i18n.global.t('notFound.title')) }) } });
    await nextTick();
    expect(document.title).toBe('Page not found \u00b7 Reviewer 2');
    setLanguage('zh', { remember: false });
    await nextTick();
    expect(document.title).toBe('\u9875\u9762\u4e0d\u5b58\u5728 \u00b7 Reviewer 2');
    page.unmount();
    setLanguage('en', { remember: false });
  });
});

describe('an urgent title', () => {
  test("stands over the page's while it says something, and the page's comes back after", async () => {
    const page = mount(Page, { props: { head: () => ({ title: 'Manuscript R2-K7QX \u00b7 Reviewer 2' }) } });
    const urgent = ref<string | null>('Your turn!');
    const strip = mount(Page, { props: { urgent: () => urgent.value } });
    await nextTick();
    expect(document.title).toBe('Your turn!');
    urgent.value = null;
    await nextTick();
    expect(document.title).toBe('Manuscript R2-K7QX \u00b7 Reviewer 2');
    urgent.value = 'Your turn!';
    await nextTick();
    strip.unmount();
    await nextTick();
    expect(document.title).toBe('Manuscript R2-K7QX \u00b7 Reviewer 2');
    page.unmount();
  });
});

describe("the site's address", () => {
  test('is a path at SITE_URL, and none without it', () => {
    expect(siteAddress('/?lang=en')).toBeNull();
    vi.stubGlobal('__SITE_URL__', 'https://example.com');
    expect(siteAddress('/?lang=en')).toBe('https://example.com/?lang=en');
    vi.unstubAllGlobals();
  });
});
